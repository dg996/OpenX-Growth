import { appConfig } from "./config";
import type { XSession } from "./security";

type TokenResponse = { access_token:string; refresh_token?:string; expires_in?:number };

function tokenAuth(clientId:string, params:URLSearchParams):Record<string,string> {
  const secret = appConfig().xClientSecret;
  if (!secret) { params.set("client_id",clientId); return {}; }
  return { Authorization:`Basic ${btoa(`${clientId}:${secret}`)}` };
}

export async function exchangeAuthorizationCode(code:string,verifier:string,clientId:string,redirectUri:string):Promise<TokenResponse | null> {
  const body = new URLSearchParams({code,grant_type:"authorization_code",redirect_uri:redirectUri,code_verifier:verifier});
  const response = await fetch("https://api.x.com/2/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",...tokenAuth(clientId,body)},body});
  if (!response.ok) return null;
  return response.json() as Promise<TokenResponse>;
}

export async function refreshXAccessToken(session:XSession):Promise<XSession | null> {
  if (!session.refreshToken) return null;
  const body = new URLSearchParams({refresh_token:session.refreshToken,grant_type:"refresh_token"});
  const response = await fetch("https://api.x.com/2/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",...tokenAuth(session.clientId,body)},body});
  if (!response.ok) return null;
  const token = await response.json() as TokenResponse;
  return {accessToken:token.access_token,refreshToken:token.refresh_token ?? session.refreshToken,clientId:session.clientId,expiresAt:Date.now()+(token.expires_in ?? 7200)*1000};
}
