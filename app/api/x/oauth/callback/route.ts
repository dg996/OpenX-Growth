import { NextRequest, NextResponse } from "next/server";
import { exchangeAuthorizationCode } from "../../../../../lib/x-oauth";
import { cookieName, OAUTH_COOKIE, readCookie, setXSession, unseal } from "../../../../../lib/security";
import { storeXSession } from "../../../../../lib/session-store";

type OAuthState = {verifier:string;state:string;clientId:string;redirectUri:string};

export async function GET(request:NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauth = await unseal<OAuthState>(readCookie(request,OAUTH_COOKIE));
  if (!code || !state || !oauth || state !== oauth.state) return NextResponse.redirect(new URL("/?x_error=oauth_state",request.url));
  const token = await exchangeAuthorizationCode(code,oauth.verifier,oauth.clientId,oauth.redirectUri);
  if (!token) return NextResponse.redirect(new URL("/?x_error=token_exchange",request.url));
  const response = NextResponse.redirect(new URL("/?x_connected=1",request.url));
  const session = {accessToken:token.access_token,refreshToken:token.refresh_token,clientId:oauth.clientId,expiresAt:Date.now()+(token.expires_in ?? 7200)*1000};
  const secure=request.nextUrl.protocol==="https:";
  await setXSession(response,session,secure);
  await storeXSession(session);
  response.cookies.set(cookieName(OAUTH_COOKIE,secure),"",{httpOnly:true,secure,sameSite:"lax",path:"/",maxAge:0});
  return response;
}
