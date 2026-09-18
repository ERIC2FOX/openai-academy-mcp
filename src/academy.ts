import { ConnectorError } from "./errors.js";

export type AcademyResource = { id: string; title: string; url: string; resourceType: "resource"; topics: string[]; description: string };
export type AcademyResourceDetail = AcademyResource & { text: string; summary: string };
export type AcademyOptions = { academyBaseUrl: string; sitemapUrl?: string; timeoutMs: number; maxResponseBytes: number; cacheTtlMs: number; userAgent: string; maxResults: number };
type FetchLike = typeof fetch;
type RobotsRule = { directive: "allow" | "disallow"; pattern: string };

const MAX_SITEMAP_DOCUMENTS = 64;
const MAX_SITEMAP_DEPTH = 8;

const stripHtml = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&(?:nbsp|amp);/g, " ").replace(/\s+/g, " ").trim();
const decodeXml = (value: string) => value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
const idFor = (url: string) => `academy-${Buffer.from(url).toString("base64url")}`;

export class AcademyClient {
  private cache?: { expiresAt: number; resources: AcademyResource[] };
  private robots?: { expiresAt: number; rules: RobotsRule[] };
  private readonly academyOrigin: URL;
  constructor(private readonly options: AcademyOptions, private readonly request: FetchLike = fetch) {
    this.academyOrigin = new URL(options.academyBaseUrl);
    if (options.sitemapUrl) {
      const sitemap = new URL(options.sitemapUrl);
      if (sitemap.origin !== this.academyOrigin.origin) throw new Error("ACADEMY_SITEMAP_URL must use the Academy origin");
    }
  }

  async search(query: string, topics: string[], limit: number) {
    const normalized = query.toLocaleLowerCase();
    const requestedTopics = topics.map((topic) => topic.toLocaleLowerCase());
    const resources = await this.list();
    const results = resources.filter((resource) => {
      const haystack = `${resource.title} ${resource.description} ${resource.topics.join(" ")} ${resource.url}`.toLocaleLowerCase();
      return haystack.includes(normalized) && requestedTopics.every((topic) => resource.topics.includes(topic));
    }).slice(0, Math.min(limit, this.options.maxResults));
    return { query, topics: requestedTopics, results, total: results.length };
  }

  async list(): Promise<AcademyResource[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.resources;
    if (!this.options.sitemapUrl) throw new ConnectorError("CATALOG_SOURCE_NOT_CONFIGURED", "Set ACADEMY_SITEMAP_URL to a verified, public Academy sitemap permitted by robots.txt.", 503);
    const urls = await this.resourceUrlsFromSitemaps(this.options.sitemapUrl);
    const resources = [...new Set(urls)].flatMap((url): AcademyResource[] => {
      try {
        const parsed = new URL(url);
        if (parsed.origin !== this.academyOrigin.origin || !/^https:$/.test(parsed.protocol) || !this.isIndexablePath(parsed.pathname) || /\.xml$/i.test(parsed.pathname)) return [];
        const title = decodeURIComponent(parsed.pathname).split("/").filter(Boolean).pop()?.replace(/[-_]/g, " ") ?? "OpenAI Academy resource";
        const topics = this.topicsFor(`${title} ${parsed.pathname}`);
        return [{ id: idFor(parsed.toString()), title, url: parsed.toString(), resourceType: "resource", topics, description: `Public Academy resource: ${title}.` }];
      } catch { return []; }
    });
    // Validate every catalog entry now, not only when it is opened. A sitemap must
    // never be used to discover a path that robots.txt excludes.
    for (const resource of resources) await this.assertAllowed(resource.url);
    this.cache = { resources, expiresAt: Date.now() + this.options.cacheTtlMs };
    return resources;
  }

  async getResource(idOrUrl: string): Promise<AcademyResourceDetail> {
    const resource = (await this.list()).find((item) => item.id === idOrUrl || item.url === idOrUrl);
    if (!resource) throw new ConnectorError("RESOURCE_NOT_FOUND", "The resource is not in the verified public Academy catalog.", 404);
    await this.assertAllowed(resource.url);
    const html = await this.fetchText(resource.url, "text/html");
    const text = stripHtml(html).slice(0, 50_000);
    if (!text) throw new ConnectorError("EMPTY_RESOURCE", "The public resource did not contain readable text.", 502);
    return { ...resource, text, summary: text.slice(0, 1_500) };
  }

  async topics() {
    const resources = await this.list();
    return [...new Set(resources.flatMap((resource) => resource.topics))].sort();
  }

  private isIndexablePath(pathname: string) { return pathname !== "/" && !pathname.includes("/login") && !pathname.includes("/signin") && !pathname.includes("/account"); }
  private topicsFor(value: string) { return ["codex", "chatgpt", "prompting", "agents", "api", "mcp", "automation"].filter((topic) => value.toLocaleLowerCase().includes(topic)); }
  private async assertAllowed(url: string) {
    const parsed = new URL(url);
    if (parsed.origin !== this.academyOrigin.origin || parsed.protocol !== "https:") throw new ConnectorError("SOURCE_NOT_ALLOWED", "Only HTTPS public Academy resources are allowed.", 400);
    const rules = await this.robotRules();
    const path = `${parsed.pathname}${parsed.search}`;
    const matching = rules.filter((rule) => this.robotsRuleMatches(rule.pattern, path));
    if (!matching.length) return;
    const longest = Math.max(...matching.map((rule) => rule.pattern.length));
    // RFC-style robots evaluation: the most specific matching rule wins; Allow
    // wins ties, so a public exception can override a broad Disallow.
    if (!matching.some((rule) => rule.pattern.length === longest && rule.directive === "allow")) throw new ConnectorError("ROBOTS_DISALLOWED", "Academy robots.txt disallows this public path.", 403);
  }
  private async robotRules() {
    if (this.robots && this.robots.expiresAt > Date.now()) return this.robots.rules;
    const robotsUrl = new URL("/robots.txt", this.academyOrigin).toString();
    const response = await this.request(robotsUrl, { headers: { "user-agent": this.options.userAgent }, redirect: "error", signal: AbortSignal.timeout(this.options.timeoutMs) });
    if (!response.ok) throw new ConnectorError("ROBOTS_UNAVAILABLE", "Could not verify Academy robots.txt; requests are blocked by default.", 503);
    const rules = this.parseRobots(await this.readBody(response));
    this.robots = { rules, expiresAt: Date.now() + this.options.cacheTtlMs }; return rules;
  }
  private async resourceUrlsFromSitemaps(rootUrl: string) {
    const pending = [{ url: rootUrl, depth: 0 }];
    const seen = new Set<string>();
    const resourceUrls: string[] = [];
    while (pending.length) {
      const current = pending.shift()!;
      const sitemapUrl = this.publicUrl(current.url);
      if (seen.has(sitemapUrl)) continue;
      if (seen.size >= MAX_SITEMAP_DOCUMENTS || current.depth > MAX_SITEMAP_DEPTH) throw new ConnectorError("SITEMAP_LIMIT_EXCEEDED", "The Academy sitemap tree exceeds the safe traversal limit.", 502);
      seen.add(sitemapUrl);
      await this.assertAllowed(sitemapUrl);
      const xml = await this.fetchText(sitemapUrl, "application/xml");
      const locs = [...xml.matchAll(/<loc\b[^>]*>\s*([\s\S]*?)\s*<\/loc>/gi)].map((match) => decodeXml(match[1]));
      if (/<(?:\w+:)?sitemapindex\b/i.test(xml)) {
        for (const loc of locs) pending.push({ url: loc, depth: current.depth + 1 });
      } else if (/<(?:\w+:)?urlset\b/i.test(xml)) {
        resourceUrls.push(...locs);
      } else throw new ConnectorError("INVALID_SITEMAP", "Academy returned an unrecognized sitemap document.", 502);
    }
    return resourceUrls;
  }
  private publicUrl(value: string) {
    const parsed = new URL(value);
    if (parsed.origin !== this.academyOrigin.origin || parsed.protocol !== "https:") throw new ConnectorError("SOURCE_NOT_ALLOWED", "Only HTTPS public Academy resources are allowed.", 400);
    return parsed.toString();
  }
  private parseRobots(text: string): RobotsRule[] {
    const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
    let group: { agents: string[]; rules: RobotsRule[] } | undefined;
    let sawRule = false;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*/, "").trim();
      if (!line) continue;
      const separator = line.indexOf(":"); if (separator < 0) continue;
      const key = line.slice(0, separator).trim().toLowerCase(); const value = line.slice(separator + 1).trim();
      if (key === "user-agent") {
        if (!group || sawRule) { group = { agents: [], rules: [] }; groups.push(group); sawRule = false; }
        group.agents.push(value.toLowerCase());
      } else if ((key === "allow" || key === "disallow") && group) {
        sawRule = true;
        if (value) group.rules.push({ directive: key, pattern: value });
      }
    }
    const userAgent = this.options.userAgent.toLowerCase();
    const matchingGroups = groups.filter((candidate) => candidate.agents.some((agent) => agent === "*" || userAgent.includes(agent)));
    const specificity = Math.max(0, ...matchingGroups.flatMap((candidate) => candidate.agents.filter((agent) => agent !== "*" && userAgent.includes(agent)).map((agent) => agent.length)));
    return matchingGroups.filter((candidate) => candidate.agents.some((agent) => (specificity ? agent.length === specificity : agent === "*") && (agent === "*" || userAgent.includes(agent)))).flatMap((candidate) => candidate.rules);
  }
  private robotsRuleMatches(pattern: string, path: string) {
    const anchored = pattern.endsWith("$"); const source = anchored ? pattern.slice(0, -1) : pattern;
    const expression = source.split("*").map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")).join(".*");
    return new RegExp(`^${expression}${anchored ? "$" : ""}`).test(path);
  }
  private async fetchText(url: string, expected: string) {
    let response: Response;
    try { response = await this.request(url, { headers: { "user-agent": this.options.userAgent, accept: `${expected}, text/plain;q=0.8` }, redirect: "error", signal: AbortSignal.timeout(this.options.timeoutMs) }); }
    catch (error) { if (error instanceof DOMException && error.name === "TimeoutError") throw new ConnectorError("NETWORK_TIMEOUT", "The Academy request timed out.", 504); throw new ConnectorError("NETWORK_ERROR", "Could not reach the Academy public source.", 503); }
    if (!response.ok) throw new ConnectorError("UPSTREAM_HTTP_ERROR", `Academy returned HTTP ${response.status}.`, 502);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes(expected) && !(expected === "application/xml" && contentType.includes("text/xml"))) throw new ConnectorError("UNEXPECTED_CONTENT_TYPE", "Academy returned an unexpected content type.", 502);
    return this.readBody(response);
  }
  private async readBody(response: Response) { const length = Number(response.headers.get("content-length") ?? 0); if (length > this.options.maxResponseBytes) throw new ConnectorError("RESPONSE_TOO_LARGE", "The Academy response exceeds the configured size limit.", 502); const text = await response.text(); if (Buffer.byteLength(text) > this.options.maxResponseBytes) throw new ConnectorError("RESPONSE_TOO_LARGE", "The Academy response exceeds the configured size limit.", 502); return text; }
}
