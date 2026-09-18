import assert from "node:assert/strict";
import test from "node:test";
import { AcademyClient } from "../dist/academy.js";

const options = { academyBaseUrl: "https://academy.openai.com", sitemapUrl: "https://academy.openai.com/sitemap.xml", timeoutMs: 1000, maxResponseBytes: 10_000, cacheTtlMs: 60_000, userAgent: "test-agent", maxResults: 20 };
const response = (body, type = "text/plain", status = 200) => new Response(body, { status, headers: { "content-type": type } });
function fixture(overrides = {}) { return async (url) => {
  if (url.endsWith("/robots.txt")) return response("User-agent: *\nDisallow:");
  if (url.endsWith("/sitemap.xml")) return response("<?xml version='1.0'?><urlset><url><loc>https://academy.openai.com/resources/mcp-agents</loc></url></urlset>", "application/xml");
  if (url.endsWith("mcp-agents")) return response("<html><title>MCP agents</title><body><h1>MCP agents</h1><p>Public Academy content.</p></body></html>", "text/html");
  throw new Error(`Unexpected ${url}`);
}; }

test("indexes a public sitemap and searches normalized topics", async () => {
  const client = new AcademyClient(options, fixture());
  const found = await client.search("mcp", ["mcp", "agents"], 10);
  assert.equal(found.total, 1);
  assert.deepEqual(await client.topics(), ["agents", "mcp"]);
});
test("returns readable content only for a catalogued public URL", async () => {
  const client = new AcademyClient(options, fixture());
  const [resource] = await client.list();
  const detail = await client.getResource(resource.id);
  assert.match(detail.text, /Public Academy content/);
  await assert.rejects(() => client.getResource("https://academy.openai.com/private"), { code: "RESOURCE_NOT_FOUND" });
});
test("blocks paths disallowed by robots", async () => {
  const client = new AcademyClient(options, async (url) => {
    if (url.endsWith("robots.txt")) return response("User-agent: *\nDisallow: /resources/");
    return response("<urlset><url><loc>https://academy.openai.com/resources/mcp</loc></url></urlset>", "application/xml");
  });
  await assert.rejects(() => client.list(), { code: "ROBOTS_DISALLOWED" });
});

test("follows sitemap indexes to public resource URLs without cataloguing child XML files", async () => {
  const requests = [];
  const client = new AcademyClient(options, async (url) => {
    requests.push(url);
    if (url.endsWith("robots.txt")) return response("User-agent: *\nDisallow:");
    if (url.endsWith("/sitemap.xml")) return response("<sitemapindex><sitemap><loc>https://academy.openai.com/sitemaps/public.xml</loc></sitemap></sitemapindex>", "application/xml");
    if (url.endsWith("/sitemaps/public.xml")) return response("<urlset><url><loc>https://academy.openai.com/resources/sitemap-indexed</loc></url></urlset>", "application/xml");
    if (url.endsWith("sitemap-indexed")) return response("<html><body>Indexed public page</body></html>", "text/html");
    throw new Error(`Unexpected ${url}`);
  });
  const resources = await client.list();
  assert.deepEqual(resources.map(({ url }) => url), ["https://academy.openai.com/resources/sitemap-indexed"]);
  assert.ok(requests.includes("https://academy.openai.com/sitemaps/public.xml"));
  assert.match((await client.getResource(resources[0].id)).text, /Indexed public page/);
});

test("uses robots Allow precedence and wildcard/end-anchor matching", async () => {
  const robots = "User-agent: *\nDisallow: /\nAllow: /sitemap.xml\nAllow: /resources/public$\nDisallow: /resources/*.pdf$";
  const client = new AcademyClient(options, async (url) => {
    if (url.endsWith("robots.txt")) return response(robots);
    if (url.endsWith("sitemap.xml")) return response("<urlset><url><loc>https://academy.openai.com/resources/public</loc></url></urlset>", "application/xml");
    if (url.endsWith("/resources/public")) return response("<html><body>Allowed exception</body></html>", "text/html");
    throw new Error(`Unexpected ${url}`);
  });
  const [resource] = await client.list();
  assert.equal(resource.url, "https://academy.openai.com/resources/public");
  await assert.rejects(() => client.assertAllowed("https://academy.openai.com/resources/file.pdf"), { code: "ROBOTS_DISALLOWED" });
  assert.match((await client.getResource(resource.id)).text, /Allowed exception/);
});
