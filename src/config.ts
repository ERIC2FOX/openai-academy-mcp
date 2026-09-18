import "dotenv/config";

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function url(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  try { return new URL(value).toString().replace(/\/$/, ""); }
  catch { throw new Error(`${name} must be an absolute URL`); }
}

export const config = {
  port: positiveInteger("PORT", 3000),
  publicBaseUrl: url("PUBLIC_BASE_URL", "http://localhost:3000"),
  academyBaseUrl: url("ACADEMY_BASE_URL", "https://academy.openai.com"),
  academySitemapUrl: process.env.ACADEMY_SITEMAP_URL ? url("ACADEMY_SITEMAP_URL", "") : undefined,
  requestTimeoutMs: positiveInteger("REQUEST_TIMEOUT_MS", 15_000),
  maxSearchResults: positiveInteger("MAX_SEARCH_RESULTS", 20),
  maxResponseBytes: positiveInteger("MAX_RESPONSE_BYTES", 1_000_000),
  cacheTtlMs: positiveInteger("CACHE_TTL_MS", 300_000),
  userAgent: process.env.USER_AGENT ?? "OpenAI-Academy-Connector/1.0",
};
