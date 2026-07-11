import { NextRequest, NextResponse } from "next/server";
import { appConfig } from "../../../../../lib/config";
import { cookieName, hasAppAccess, OAUTH_COOKIE, randomToken, seal } from "../../../../../lib/security";

const base64url = (bytes:Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");

export async function GET(request:NextRequest) {
  if (!await hasAppAccess(request)) return NextResponse.redirect(new URL("/login",request.url));
  const config = appConfig();
  if (!config.xClientId || !config.sessionSecret) return NextResponse.redirect(new URL("/?x_error=not_configured",request.url));
  const verifier = randomToken(48);
  const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier));
  const challenge = base64url(new Uint8Array(digest));
  const state = randomToken();
  const origin = config.appUrl || request.nextUrl.origin;
  const redirectUri = new URL("/api/x/oauth/callback",origin).toString();
  const authorize = new URL("https://x.com/i/oauth2/authorize");
  authorize.search = new URLSearchParams({response_type:"code",client_id:config.xClientId,redirect_uri:redirectUri,scope:"tweet.read tweet.write users.read offline.access",state,code_challenge:challenge,code_challenge_method:"S256"}).toString();
  const response = NextResponse.redirect(authorize);
  const secure=request.nextUrl.protocol==="https:";
  response.cookies.set(cookieName(OAUTH_COOKIE,secure),await seal({verifier,state,clientId:config.xClientId,redirectUri}),{httpOnly:true,secure,sameSite:"lax",path:"/",maxAge:600});
  return response;
}
