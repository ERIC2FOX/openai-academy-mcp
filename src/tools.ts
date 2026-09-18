import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod";
import {searchAcademy,openAcademyResource} from "./academy.js";
import {authenticate,requireScope} from "./auth.js";

const text=(v:unknown)=>({content:[{type:"text" as const,text:JSON.stringify(v,null,2)}]});
export function registerTools(server:McpServer,request:any){
  server.registerTool("academy_search",{description:"Busca recursos públicos de OpenAI Academy.",inputSchema:{query:z.string().min(1),type:z.string().default("all")}},async({query,type})=>text(await searchAcademy(query,type)));
  server.registerTool("academy_open_resource",{description:"Abre un recurso público de OpenAI Academy.",inputSchema:{url:z.string().url()}},async({url})=>text(await openAcademyResource(url)));
  server.registerTool("academy_profile",{description:"Muestra la identidad autenticada por este MCP; no es el perfil privado de Academy.",inputSchema:{}},async()=>{const ctx=await authenticate(request);requireScope(ctx,"academy:profile");return text({subject:ctx.subject,email:ctx.email,scopes:[...ctx.scopes],note:"Esto autentica contra el proveedor OAuth del MCP, no contra los datos privados de OpenAI Academy."});});
  server.registerTool("academy_connection_status",{description:"Comprueba si la petición al MCP está autenticada.",inputSchema:{}},async()=>{const ctx=await authenticate(request);return text({authenticated:ctx.authenticated,scopes:[...ctx.scopes]});});
}
