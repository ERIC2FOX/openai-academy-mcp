import {config} from "./config.js";

const strip=(html:string)=>html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();

async function get(url:string){
  const u=new URL(url);
  if(u.hostname!==new URL(config.academyBaseUrl).hostname) throw new Error("URL fuera del dominio permitido");
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),config.requestTimeoutMs);
  try{const r=await fetch(u,{signal:c.signal,headers:{"user-agent":"openai-academy-mcp/1.0"}});if(!r.ok) throw new Error(`Academy HTTP ${r.status}`);return await r.text();}
  finally{clearTimeout(t);}
}
export async function searchAcademy(query:string,type="all"){
  const url=`${config.academyBaseUrl}/public/search?query=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}`;
  const html=await get(url); const base=new URL(config.academyBaseUrl); const out:any[]=[]; const seen=new Set<string>();
  for(const m of html.matchAll(/href=["']([^"']+)["']/gi)){try{const u=new URL(m[1],base);if(u.hostname!==base.hostname||seen.has(u.href))continue;seen.add(u.href);if(!u.pathname.startsWith("/public/")&&!u.pathname.startsWith("/courses")&&!u.pathname.startsWith("/events"))continue;out.push({title:u.pathname.split("/").filter(Boolean).pop()??"resource",url:u.href,type:u.pathname.includes("course")?"course":u.pathname.includes("event")?"event":"resource"});if(out.length>=config.maxSearchResults)break;}catch{}}
  return {query,type,results:out};
}
export async function openAcademyResource(url:string){
  const html=await get(url); const title=(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??"OpenAI Academy").replace(/\s+/g," ").trim();
  return {url,title,text:strip(html).slice(0,50000)};
}
