import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../db";
import { posts } from "../../../db/schema";
import { deploymentPosture } from "../../../lib/config";
import { getEffectiveConfig } from "../../../lib/runtime-settings";
import { createPostInputSchema, validationIssues } from "../../../lib/post-validation";
import { authorizeBrowserOrApiMutation, authorizeBrowserOrApiRead } from "../../../lib/security";

export async function GET(request:NextRequest) {
  const denied=await authorizeBrowserOrApiRead(request);if(denied)return denied;
  if(deploymentPosture(await getEffectiveConfig())==="demo")return NextResponse.json({posts:[]});
  const rows=await getDb().select().from(posts).orderBy(desc(posts.createdAt)).limit(200);
  return NextResponse.json({posts:rows.map(({claimToken,...post})=>{void claimToken;return post;})});
}

export async function POST(request:NextRequest) {
  const denied=await authorizeBrowserOrApiMutation(request);if(denied)return denied;
  let raw:unknown;try{raw=await request.json();}catch{return NextResponse.json({error:"INVALID_JSON"},{status:400});}
  const now=Date.now();const parsed=createPostInputSchema(now).safeParse(raw);
  if(!parsed.success)return NextResponse.json({error:"INVALID_POST",issues:validationIssues(parsed.error)},{status:400});
  const input=parsed.data;const id=crypto.randomUUID();
  const record={id,text:input.text,threadJson:input.threadJson,status:input.status,scheduledAt:input.scheduledAt,publishedAt:null,xPostId:null,publishedIdsJson:null,publishReceiptsJson:null,claimToken:null,claimExpiresAt:null,deliveryState:"idle" as const,topic:input.topic,format:input.format,hook:input.hook,generated:input.generated,evergreen:input.evergreen,evergreenIntervalDays:input.evergreenIntervalDays,attempts:0,lastError:null,createdAt:now,updatedAt:now};
  await getDb().insert(posts).values(record);
  return NextResponse.json({post:record},{status:201});
}
