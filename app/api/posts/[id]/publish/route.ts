import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../db";
import { posts } from "../../../../../db/schema";
import { publishCommandSchema, validationIssues } from "../../../../../lib/post-validation";
import { publishStoredPost, reconcileStoredPost } from "../../../../../lib/publisher";
import { authorizeBrowserOrApiMutation } from "../../../../../lib/security";

const PUBLIC_ERRORS=new Set(["AI_CONTENT_APPROVAL_REQUIRED","X_NOT_CONNECTED","POST_ALREADY_BEING_PUBLISHED","PUBLISH_NEEDS_REVIEW","PUBLISH_PREFLIGHT_FAILED","RECONCILIATION_NOT_REQUIRED","RECONCILIATION_ID_COUNT_MISMATCH","RECONCILIATION_RECEIPT_MISMATCH","RECONCILIATION_CONFLICT","DAILY_X_WRITE_CAP_REACHED","X_RECONNECT_REQUIRED"]);

function publishError(error:unknown) {
  const raw=error instanceof Error?error.message:"";
  const message=PUBLIC_ERRORS.has(raw)||/^DAILY_X_(?:WRITE|RESOURCE)_(?:CAP|LIMIT)_REACHED$/.test(raw)?raw:"PUBLISH_FAILED";
  const status=message.includes("DAILY_X_")?429:message==="PUBLISH_PREFLIGHT_FAILED"?400:message.includes("RECONCILIATION")||message==="PUBLISH_NEEDS_REVIEW"||message==="POST_ALREADY_BEING_PUBLISHED"?409:message==="X_NOT_CONNECTED"?401:502;
  return NextResponse.json({error:message},{status});
}

export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const denied=await authorizeBrowserOrApiMutation(request);if(denied)return denied;
  const {id}=await params; const post=await getDb().select().from(posts).where(eq(posts.id,id)).get(); if(!post)return NextResponse.json({error:"NOT_FOUND"},{status:404});
  let raw:unknown={};try{const body=await request.text();if(body.trim())raw=JSON.parse(body);}catch{return NextResponse.json({error:"INVALID_JSON"},{status:400});}
  const parsed=publishCommandSchema.safeParse(raw);if(!parsed.success)return NextResponse.json({error:"INVALID_PUBLISH_COMMAND",issues:validationIssues(parsed.error)},{status:400});
  try{
    if(parsed.data.action==="reconcile")return NextResponse.json(await reconcileStoredPost(post,parsed.data));
    return NextResponse.json(await publishStoredPost(post));
  }catch(error){return publishError(error);}
}
