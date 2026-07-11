import { and, eq, like, lt } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../db";
import { secureStore } from "../../../../db/schema";
import { appConfig } from "../../../../lib/config";
import { AUTH_COOKIE, cookieName, safeEqual, seal, unseal } from "../../../../lib/security";

const WINDOW_MS=15*60_000, MAX_ATTEMPTS=5;
async function requestKey(request:NextRequest) {
  const source=request.headers.get("cf-connecting-ip")??request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()??"unknown";
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].slice(0,12).map((byte)=>byte.toString(16).padStart(2,"0")).join("");
}

export async function POST(request:NextRequest) {
  const expected=appConfig().appAccessToken;
  if(!expected)return NextResponse.json({error:"APP_ACCESS_TOKEN_REQUIRED"},{status:503});
  const key=`auth-attempt:${await requestKey(request)}`,now=Date.now(),db=getDb();
  await db.delete(secureStore).where(and(like(secureStore.key,"auth-attempt:%"),lt(secureStore.updatedAt,now-WINDOW_MS)));
  const attemptRow=await db.select().from(secureStore).where(eq(secureStore.key,key)).get();
  const attempts=await unseal<{count:number;windowStart:number;blockedUntil:number|null}>(attemptRow?.sealedValue);
  if(attempts?.blockedUntil&&attempts.blockedUntil>now)return NextResponse.json({error:"TOO_MANY_ATTEMPTS",retryAfterSeconds:Math.ceil((attempts.blockedUntil-now)/1000)},{status:429,headers:{"Retry-After":String(Math.ceil((attempts.blockedUntil-now)/1000))}});
  let token="";try{const body=await request.json() as {token?:unknown};if(typeof body.token==="string")token=body.token;}catch{}
  if(!token||!await safeEqual(token,expected)){
    const within=attempts&&now-attempts.windowStart<WINDOW_MS;const count=within?attempts.count+1:1;const blockedUntil=count>=MAX_ATTEMPTS?now+WINDOW_MS:null;
    const sealedValue=await seal({count,windowStart:within?attempts.windowStart:now,blockedUntil});
    await db.insert(secureStore).values({key,sealedValue,updatedAt:now}).onConflictDoUpdate({target:secureStore.key,set:{sealedValue,updatedAt:now}});
    return NextResponse.json({error:"INVALID_ACCESS_TOKEN",attemptsRemaining:Math.max(0,MAX_ATTEMPTS-count)},{status:401});
  }
  await db.delete(secureStore).where(eq(secureStore.key,key));
  const response=NextResponse.json({ok:true});
  const secure=request.nextUrl.protocol==="https:";
  response.cookies.set(cookieName(AUTH_COOKIE,secure),await seal({authorized:true}),{httpOnly:true,secure,sameSite:"strict",path:"/",maxAge:2_592_000});
  return response;
}
