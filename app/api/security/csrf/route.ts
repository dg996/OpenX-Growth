import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { cookieName, CSRF_COOKIE, hasAppAccess, randomToken } from "../../../../lib/security";
export async function GET(request:NextRequest) {
  if (!await hasAppAccess(request)) return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  const token = randomToken();
  const response = NextResponse.json({token},{headers:{"Cache-Control":"no-store"}});
  const secure=request.nextUrl.protocol==="https:";
  response.cookies.set(cookieName(CSRF_COOKIE,secure),token,{httpOnly:false,secure,sameSite:"strict",path:"/",maxAge:86_400});
  return response;
}
