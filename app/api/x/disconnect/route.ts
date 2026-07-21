import { NextRequest, NextResponse } from "next/server";
import { activeSyncLease, deleteXCache } from "../../../../lib/data";
import { authorizeBrowserMutation, clearXSession, getXSession } from "../../../../lib/security";
import { deleteXSession, markAuthorizationDisconnected, resolveStoredAuthorization } from "../../../../lib/session-store";

export async function POST(request:NextRequest) {
  const denied=await authorizeBrowserMutation(request);if(denied)return denied;
  let body:unknown;try{body=await request.json()}catch{return NextResponse.json({error:"INVALID_DISCONNECT_INPUT"},{status:400});}
  if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).length!==1||!("intent" in body)||!(["disconnect","reconnect"] as unknown[]).includes(body.intent))return NextResponse.json({error:"INVALID_DISCONNECT_INPUT"},{status:400});
  if(await activeSyncLease())return NextResponse.json({error:"SYNC_ALREADY_IN_PROGRESS"},{status:409,headers:{"Retry-After":"5"}});
  const intent=(body as {intent:"disconnect"|"reconnect"}).intent;
  if(intent==="reconnect"){
    const authorization=await resolveStoredAuthorization(await getXSession(request));
    if(authorization.state!=="reconnect_required")return NextResponse.json({error:"RECONNECT_NOT_REQUIRED"},{status:409});
    await deleteXSession();
    const response=NextResponse.json({next:"/api/x/oauth/start",retainedData:true});
    clearXSession(response,request.nextUrl.protocol==="https:");
    return response;
  }
  await Promise.all([deleteXSession(),markAuthorizationDisconnected(),deleteXCache()]);
  const response=NextResponse.json({connected:false,retainedData:true});
  clearXSession(response,request.nextUrl.protocol==="https:");
  return response;
}
