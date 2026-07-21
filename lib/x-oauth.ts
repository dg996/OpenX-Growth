import { getEffectiveConfig } from "./runtime-settings";
import type { XSession } from "./security";
import { getXTransport } from "./x-transport";

type TokenResponse = { access_token:string; refresh_token?:string; expires_in?:number };

function tokenAuth(clientId:string,params:URLSearchParams,secret:string):Record<string,string> {
  if (!secret) { params.set("client_id",clientId); return {}; }
  return { Authorization:`Basic ${btoa(`${clientId}:${secret}`)}` };
}

export async function exchangeAuthorizationCode(code:string,verifier:string,clientId:string,redirectUri:string):Promise<TokenResponse | null> {
  const body = new URLSearchParams({code,grant_type:"authorization_code",redirect_uri:redirectUri,code_verifier:verifier});
  const response = await getXTransport().request<TokenResponse>({path:"/2/oauth2/token",method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",...tokenAuth(clientId,body,(await getEffectiveConfig()).xClientSecret)},body,accounting:{kind:"request",endpoint:"oauth.token"}});
  return response.ok&&response.data?response.data:null;
}

export async function refreshXAccessToken(session:XSession):Promise<XSession | null> {
  if (!session.refreshToken) return null;
  const body = new URLSearchParams({refresh_token:session.refreshToken,grant_type:"refresh_token"});
  const response = await getXTransport().request<TokenResponse>({path:"/2/oauth2/token",method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",...tokenAuth(session.clientId,body,(await getEffectiveConfig()).xClientSecret)},body,accounting:{kind:"request",endpoint:"oauth.refresh"}});
  if (!response.ok||!response.data) return null;
  const token = response.data;
  return {accessToken:token.access_token,refreshToken:token.refresh_token ?? session.refreshToken,clientId:session.clientId,expiresAt:Date.now()+(token.expires_in ?? 7200)*1000};
}
