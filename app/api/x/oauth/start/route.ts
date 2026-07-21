import { NextRequest, NextResponse } from "next/server";
import { getEffectiveConfig } from "../../../../../lib/runtime-settings";
import { authorizeBrowserRead, cookieName, OAUTH_COOKIE, randomToken, seal } from "../../../../../lib/security";
import { canonicalOriginStatus } from "../../../../../lib/canonical-origin";
import { getSchemaHealth } from "../../../../../lib/schema-health";

const base64url = (bytes:Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");

export async function GET(request:NextRequest) {
  const denied=await authorizeBrowserRead(request);if(denied)return denied;
  const schema=await getSchemaHealth();
  if(schema.state!=="ready")return NextResponse.redirect(new URL("/?x_error=database_setup",request.url));
  const config=await getEffectiveConfig();
  if (!config.xClientId || !config.sessionSecret) return NextResponse.redirect(new URL("/?x_error=not_configured",request.url));
  const originStatus=canonicalOriginStatus(config.appUrl,request.nextUrl.origin);
  if(!originStatus.valid||!originStatus.currentMatchesCanonical)return NextResponse.redirect(new URL("/?x_error=origin_mismatch",request.url));
  const verifier = randomToken(48);
  const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier));
  const challenge = base64url(new Uint8Array(digest));
  const state = randomToken();
  const redirectUri = new URL("/api/x/oauth/callback",originStatus.canonicalOrigin).toString();
  const authorize = new URL("https://x.com/i/oauth2/authorize");
  authorize.search = new URLSearchParams({response_type:"code",client_id:config.xClientId,redirect_uri:redirectUri,scope:"tweet.read tweet.write users.read offline.access",state,code_challenge:challenge,code_challenge_method:"S256"}).toString();
  const response = NextResponse.redirect(authorize);
  const secure=request.nextUrl.protocol==="https:";
  response.cookies.set(cookieName(OAUTH_COOKIE,secure),await seal({verifier,state,clientId:config.xClientId,redirectUri,createdAt:Date.now()}),{httpOnly:true,secure,sameSite:"lax",path:"/",maxAge:600});
  return response;
}
