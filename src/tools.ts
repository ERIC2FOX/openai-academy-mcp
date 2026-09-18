import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AcademyClient } from "./academy.js";
import { asConnectorError, ConnectorError } from "./errors.js";

const toolResult = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const toolError = (error: unknown) => {
  const safe = asConnectorError(error);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: { code: safe.code, message: safe.message, details: safe.details } }) }], isError: true };
};
const run = async (operation: () => Promise<unknown>) => { try { return toolResult(await operation()); } catch (error) { return toolError(error); } };

const topicSchema = z.enum(["codex", "chatgpt", "prompting", "agents", "api", "mcp", "automation"]);
export function registerTools(server: McpServer, academy: AcademyClient) {
  server.registerTool("search_academy", { description: "Searches the verified, public OpenAI Academy catalog. It never accesses private Academy data.", inputSchema: { query: z.string().trim().min(1).max(200), topics: z.array(topicSchema).max(7).default([]), limit: z.number().int().min(1).max(50).default(10) } }, async ({ query, topics, limit }) => run(() => academy.search(query, topics, limit)));
  server.registerTool("get_academy_resource", { description: "Gets readable text and a short extract from a resource in the verified public Academy catalog.", inputSchema: { id_or_url: z.string().trim().min(1).max(2_048) } }, async ({ id_or_url }) => run(() => academy.getResource(id_or_url)));
  server.registerTool("list_academy_resources", { description: "Lists verified public OpenAI Academy resources, optionally filtered by topic.", inputSchema: { topic: topicSchema.optional(), limit: z.number().int().min(1).max(50).default(20) } }, async ({ topic, limit }) => run(async () => ({ results: (await academy.list()).filter((resource) => !topic || resource.topics.includes(topic)).slice(0, limit) })));
  server.registerTool("search_academy_topics", { description: "Lists normalized topics represented in the verified public Academy catalog.", inputSchema: {} }, async () => run(async () => ({ topics: await academy.topics() })));
  server.registerTool("get_academy_learning_path", { description: "Reports whether a public official Academy learning path can be retrieved. This connector does not infer or fabricate learning paths.", inputSchema: { topic: topicSchema } }, async ({ topic }) => run(async () => { throw new ConnectorError("LEARNING_PATHS_NOT_PUBLICLY_AVAILABLE", `No verified public official learning path is available for '${topic}'.`, 404, { topic }); }));
}
