import { NextRequest, NextResponse } from "next/server";
import { appConfig } from "../../../../lib/config";
import { consumeUsage } from "../../../../lib/data";
import { getXSession, hasAppAccess, configuredInstanceResponse, requireCsrf, setXSession } from "../../../../lib/security";
import { loadXSession, storeXSession } from "../../../../lib/session-store";
import { refreshXAccessToken } from "../../../../lib/x-oauth";

export async function POST(request:NextRequest) {
  const blocked=configuredInstanceResponse(); if(blocked)return blocked;
  if (!await hasAppAccess(request)) return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  try { requireCsrf(request); } catch { return NextResponse.json({error:"INVALID_CSRF"},{status:403}); }
  let session = await getXSession(request) ?? await loadXSession();
  if (!session) return NextResponse.json({error:"X_NOT_CONNECTED"},{status:401});
  const {postId,text,generated=false} = await request.json() as {postId?:string;text?:string;generated?:boolean};
  if (!postId || !text?.trim() || text.length > 280) return NextResponse.json({error:"INVALID_REPLY"},{status:400});
  if (generated && !appConfig().xAiRepliesApproved) return NextResponse.json({error:"AI_REPLY_APPROVAL_REQUIRED"},{status:403});
  try { await consumeUsage("write",1); } catch (error) { return NextResponse.json({error:error instanceof Error ? error.message : "LIMIT"},{status:429}); }
  const body = JSON.stringify({text:text.trim(),reply:{in_reply_to_tweet_id:postId}});
  let xResponse = await fetch("https://api.x.com/2/tweets",{method:"POST",headers:{Authorization:`Bearer ${session.accessToken}`,"Content-Type":"application/json"},body});
  let refreshed = false;
  if (xResponse.status === 401) {
    const next = await refreshXAccessToken(session);
    if (!next) return NextResponse.json({error:"X_RECONNECT_REQUIRED"},{status:401});
    session = next; refreshed = true; await storeXSession(session);
    xResponse = await fetch("https://api.x.com/2/tweets",{method:"POST",headers:{Authorization:`Bearer ${session.accessToken}`,"Content-Type":"application/json"},body});
  }
  const payload = await xResponse.json();
  const response = NextResponse.json(payload,{status:xResponse.status});
  if (refreshed) await setXSession(response,session,request.nextUrl.protocol==="https:");
  return response;
}
