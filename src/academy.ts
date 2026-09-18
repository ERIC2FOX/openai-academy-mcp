import { ConnectorError } from "./errors.js";

export type AcademyResource = { id: string; title: string; url: string; resourceType: "resource"; topics: string[]; description: string };
export type AcademyResourceDetail = AcademyResource & { text: string; summary: string };
export type AcademyOptions = { academyBaseUrl: string; sitemapUrl?: string; timeoutMs: number; maxResponseBytes: number; cacheTtlMs: number; userAgent: string; maxResults: number };
type FetchLike = typeof fetch;

const stripHtml = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&(?:nbsp|amp);/g, " ").replace(/\s+/g, " ").trim();
const decodeXml = (value: string) => value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
const idFor = (url: string) => `academy-${Buffer.from(url).toString("base64url")}`;

export class AcademyClient {
  private cache?: { expiresAt: number; resources: AcademyResource[] };
  private robots?: { expiresAt: number; rules: string[] };
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
    await this.assertAllowed(this.options.sitemapUrl);
    const sitemap = await this.fetchText(this.options.sitemapUrl, "application/xml");
    const urls = [...sitemap.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)].map((match) => decodeXml(match[1]));
    const resources = [...new Set(urls)].flatMap((url): AcademyResource[] => {
      try {
        const parsed = new URL(url);
        if (parsed.origin !== this.academyOrigin.origin || !/^https:$/.test(parsed.protocol) || !this.isIndexablePath(parsed.pathname)) return [];
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
    if (rules.some((rule) => rule === "/" || (rule && parsed.pathname.startsWith(rule)))) throw new ConnectorError("ROBOTS_DISALLOWED", "Academy robots.txt disallows this public path.", 403);
  }
  private async robotRules() {
    if (this.robots && this.robots.expiresAt > Date.now()) return this.robots.rules;
    const robotsUrl = new URL("/robots.txt", this.academyOrigin).toString();
    const response = await this.request(robotsUrl, { headers: { "user-agent": this.options.userAgent }, redirect: "error", signal: AbortSignal.timeout(this.options.timeoutMs) });
    if (!response.ok) throw new ConnectorError("ROBOTS_UNAVAILABLE", "Could not verify Academy robots.txt; requests are blocked by default.", 503);
    const lines = (await this.readBody(response)).split(/\r?\n/); let applies = false; const rules: string[] = [];
    for (const line of lines) { const [key, ...rest] = line.split(":"); const value = rest.join(":").trim(); if (key?.trim().toLowerCase() === "user-agent") applies = value === "*" || value.toLowerCase() === this.options.userAgent.toLowerCase(); if (applies && key?.trim().toLowerCase() === "disallow") rules.push(value); }
    this.robots = { rules, expiresAt: Date.now() + this.options.cacheTtlMs }; return rules;
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
