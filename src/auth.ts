import {createRemoteJWKSet,jwtVerify} from "jose";
import {config} from "./config.js";
export type AuthContext={authenticated:boolean;subject?:string;email?:string;scopes:Set<string>;claims:Record<string,unknown>};
export async function authenticate(req:any):Promise<AuthContext>{
  const h=String(req.headers?.authorization??""); if(!h.startsWith("Bearer ")||!config.oauthIssuer||!config.oauthAudience||!config.oauthJwksUrl)return {authenticated:false,scopes:new Set(),claims:{}};
  const token=h.slice(7); const jwks=createRemoteJWKSet(new URL(config.oauthJwksUrl));
  const {payload}=await jwtVerify(token,jwks,{issuer:config.oauthIssuer,audience:config.oauthAudience});
  const raw=typeof payload.scope==="string"?payload.scope:""; return {authenticated:true,subject:payload.sub,email:typeof payload.email==="string"?payload.email:undefined,scopes:new Set(raw.split(/\s+/).filter(Boolean)),claims:payload as Record<string,unknown>};
}
export function requireScope(ctx:AuthContext,scope:string){if(!ctx.authenticated)throw Object.assign(new Error("Authentication required"),{status:401});if(!ctx.scopes.has(scope))throw Object.assign(new Error("Insufficient scope"),{status:403});}
