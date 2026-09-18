import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AcademyClient } from "./academy.js";
import { config } from "./config.js";
import { registerTools } from "./tools.js";

const academy = new AcademyClient({ academyBaseUrl: config.academyBaseUrl, sitemapUrl: config.academySitemapUrl, timeoutMs: config.requestTimeoutMs, maxResponseBytes: config.maxResponseBytes, cacheTtlMs: config.cacheTtlMs, userAgent: config.userAgent, maxResults: config.maxSearchResults });
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
app.get("/health", (_req, res) => res.json({ ok: true, service: "openai-academy-connector", access: "public-content-only" }));
app.get("/", (_req, res) => res.json({ service: "openai-academy-connector", mcp: "/mcp", authentication: "No Academy authentication is implemented or required." }));
app.all("/mcp", async (req, res, next) => {
  try {
    const server = new McpServer({ name: "openai-academy-connector", version: "1.0.0" });
    registerTools(server, academy);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) { next(error); }
});
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("request_failed", error instanceof Error ? { name: error.name, message: error.message } : { name: "UnknownError" });
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "The connector could not process the request." } });
});
app.listen(config.port, "0.0.0.0", () => console.log(`OpenAI Academy Connector listening on ${config.port}`));
