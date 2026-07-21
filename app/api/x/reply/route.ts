import { NextRequest, NextResponse } from "next/server";
import { getEffectiveConfig } from "../../../../lib/runtime-settings";
import { replyInputSchema, validationIssues } from "../../../../lib/post-validation";
import { authorizeBrowserMutation, getXSession, setXSession } from "../../../../lib/security";
import { resolveStoredAuthorization, storeXSession } from "../../../../lib/session-store";
import { refreshXAccessToken } from "../../../../lib/x-oauth";
import { getXTransport } from "../../../../lib/x-transport";

function transportFailure(error:unknown) {
  const code=error instanceof Error&&/^DAILY_X_(?:WRITE|RESOURCE)_(?:CAP|LIMIT)_REACHED$/.test(error.message)?error.message:"X_REPLY_FAILED";
  return NextResponse.json({error:code},{status:code.startsWith("DAILY_X_")?429:502});
}

export async function POST(request:NextRequest) {
  const denied=await authorizeBrowserMutation(request);if(denied)return denied;
  const authorization=await resolveStoredAuthorization(await getXSession(request));
  if(authorization.state==="disconnected")return NextResponse.json({error:"X_NOT_CONNECTED"},{status:401});
  if(authorization.state==="reconnect_required")return NextResponse.json({error:"X_RECONNECT_REQUIRED"},{status:401});
  let session=authorization.session!;
  let raw:unknown;try{raw=await request.json();}catch{return NextResponse.json({error:"INVALID_JSON"},{status:400});}
  const parsed=replyInputSchema.safeParse(raw);if(!parsed.success)return NextResponse.json({error:"INVALID_REPLY",issues:validationIssues(parsed.error)},{status:400});
  const {postId,text,generated}=parsed.data;
  if(generated&&!(await getEffectiveConfig()).xAiRepliesApproved)return NextResponse.json({error:"AI_REPLY_APPROVAL_REQUIRED"},{status:403});
  const transport=getXTransport();
  const body={text:text.trim(),reply:{in_reply_to_tweet_id:postId}};
  let xResponse;
  try{xResponse=await transport.request({path:"/2/tweets",method:"POST",accessToken:session.accessToken,json:body,accounting:{kind:"write",endpoint:"posts.reply"}})}catch(error){return transportFailure(error)}
  let refreshed = false;
  if (xResponse.status === 401) {
    const next = await refreshXAccessToken(session);
    if (!next) return NextResponse.json({error:"X_RECONNECT_REQUIRED"},{status:401});
    session = next; refreshed = true; await storeXSession(session);
    try{xResponse = await transport.request({path:"/2/tweets",method:"POST",accessToken:session.accessToken,json:body,accounting:{kind:"write",endpoint:"posts.reply"}})}catch(error){return transportFailure(error)}
  }
  const response=NextResponse.json(xResponse.ok?(xResponse.data??{}):{error:`X_REPLY_${xResponse.status}`},{status:xResponse.status});
  if (refreshed) await setXSession(response,session,request.nextUrl.protocol==="https:");
  return response;
}
