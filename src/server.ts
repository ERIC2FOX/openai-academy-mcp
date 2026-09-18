import express from "express";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {config} from "./config.js";
import {registerTools} from "./tools.js";

const app=express();app.use(express.json());
app.get("/health",(_req,res)=>res.json({ok:true,service:"openai-academy-mcp"}));
app.get("/.well-known/oauth-protected-resource",(_req,res)=>res.json({resource:`${config.publicBaseUrl}/mcp`,authorization_servers:config.oauthIssuer?[config.oauthIssuer]:[],bearer_methods_supported:["header"],scopes_supported:[...config.oauthScopes]}));
app.get("/",(_req,res)=>res.json({service:"openai-academy-mcp",mcp:"/mcp"}));
app.all("/mcp",async(req,res,next)=>{try{const server=new McpServer({name:"openai-academy-mcp",version:"1.0.0"});registerTools(server,req);const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});await server.connect(transport);await transport.handleRequest(req,res,req.body);}catch(e){next(e)}});
app.use((err:any,_req:any,res:any,_next:any)=>res.status(err?.status??500).json({error:err?.message??"Internal error"}));
app.listen(config.port,"0.0.0.0",()=>console.log(`OpenAI Academy MCP listening on ${config.port}`));
