import "dotenv/config";

const required=(name:string)=>{const v=process.env[name];if(!v) throw new Error(`Missing required environment variable: ${name}`);return v;};
export const config={
  port:Number(process.env.PORT??3000),
  publicBaseUrl:required("PUBLIC_BASE_URL"),
  academyBaseUrl:process.env.ACADEMY_BASE_URL??"https://academy.openai.com",
  requestTimeoutMs:Number(process.env.REQUEST_TIMEOUT_MS??15000),
  maxSearchResults:Number(process.env.MAX_SEARCH_RESULTS??20),
  oauthIssuer:process.env.OAUTH_ISSUER??"",
  oauthAudience:process.env.OAUTH_AUDIENCE??"",
  oauthJwksUrl:process.env.OAUTH_JWKS_URL??"",
  oauthScopes:new Set((process.env.OAUTH_SCOPES??"academy:profile").split(/\s+/).filter(Boolean))
};
