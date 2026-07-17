import { NextRequest, NextResponse } from "next/server";
import { exchangeAuthorizationCode } from "../../../../../lib/x-oauth";
import { configuredAccessGateResponse, cookieName, OAUTH_COOKIE, readCookie, setXSession, unseal } from "../../../../../lib/security";
import { markAuthorizationConnected, storeXSession } from "../../../../../lib/session-store";
import { appConfig } from "../../../../../lib/config";
import { canonicalOriginStatus } from "../../../../../lib/canonical-origin";
import { getSchemaHealth } from "../../../../../lib/schema-health";

type OAuthState = {verifier:string;state:string;clientId:string;redirectUri:string;createdAt:number};

function failed(request:NextRequest,code:string) {
  const response=NextResponse.redirect(new URL(`/?x_error=${code}`,request.url));
  const secure=request.nextUrl.protocol==="https:";
  response.cookies.set(cookieName(OAUTH_COOKIE,secure),"",{httpOnly:true,secure,sameSite:"lax",path:"/",maxAge:0});
  return response;
}

export async function GET(request:NextRequest) {
  const blocked=configuredAccessGateResponse();if(blocked)return blocked;
  const schema=await getSchemaHealth();if(schema.state!=="ready")return failed(request,"database_setup");
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauth = await unseal<OAuthState>(readCookie(request,OAUTH_COOKIE));
  const origin=canonicalOriginStatus(appConfig().appUrl,request.nextUrl.origin);
  let redirectOrigin="";try{redirectOrigin=oauth?new URL(oauth.redirectUri).origin:""}catch{}
  if(!origin.valid||!origin.currentMatchesCanonical||redirectOrigin!==origin.canonicalOrigin)return failed(request,"origin_mismatch");
  if (!code || !state || !oauth || state !== oauth.state || !Number.isFinite(oauth.createdAt) || Date.now()-oauth.createdAt>600_000) return failed(request,"oauth_state");
  const token = await exchangeAuthorizationCode(code,oauth.verifier,oauth.clientId,oauth.redirectUri);
  if (!token) return failed(request,"token_exchange");
  const response = NextResponse.redirect(new URL("/?x_connected=1",request.url));
  const session = {accessToken:token.access_token,refreshToken:token.refresh_token,clientId:oauth.clientId,expiresAt:Date.now()+(token.expires_in ?? 7200)*1000};
  const secure=request.nextUrl.protocol==="https:";
  await setXSession(response,session,secure);
  await storeXSession(session);
  await markAuthorizationConnected();
  response.cookies.set(cookieName(OAUTH_COOKIE,secure),"",{httpOnly:true,secure,sameSite:"lax",path:"/",maxAge:0});
  return response;
}
