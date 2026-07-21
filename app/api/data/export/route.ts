import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../db";
import { analyticsSnapshots, feedback, posts } from "../../../../db/schema";
import { deploymentPosture } from "../../../../lib/config";
import { getEffectiveConfig } from "../../../../lib/runtime-settings";
import { authorizeBrowserOrApiRead } from "../../../../lib/security";

export async function GET(request:NextRequest){
  const denied=await authorizeBrowserOrApiRead(request);if(denied)return denied;
  if(deploymentPosture(await getEffectiveConfig())==="demo")return new NextResponse(JSON.stringify({schemaVersion:1,exportedAt:new Date().toISOString(),posts:[],feedback:[],analytics:[]},null,2),{headers:{"Content-Type":"application/json","Content-Disposition":`attachment; filename="openx-growth-export-${new Date().toISOString().slice(0,10)}.json"`,"Cache-Control":"no-store"}});
  const [postRows,feedbackRows,analyticsRows]=await Promise.all([
    getDb().select().from(posts),
    getDb().select().from(feedback),
    getDb().select().from(analyticsSnapshots),
  ]);
  const portablePosts=postRows.map((row)=>({
    id:row.id,text:row.text,threadJson:row.threadJson,
    status:row.status==="needs_review"?"failed":row.status,
    scheduledAt:row.scheduledAt,publishedAt:row.publishedAt,xPostId:row.xPostId,publishedIdsJson:row.publishedIdsJson,
    topic:row.topic,format:row.format,hook:row.hook,generated:row.generated,evergreen:row.evergreen,
    evergreenIntervalDays:row.evergreenIntervalDays,attempts:row.attempts,
    lastError:row.status==="needs_review"?"PUBLISH_NEEDS_REVIEW":row.lastError,
    createdAt:row.createdAt,updatedAt:row.updatedAt,
  }));
  return new NextResponse(JSON.stringify({schemaVersion:1,exportedAt:new Date().toISOString(),posts:portablePosts,feedback:feedbackRows,analytics:analyticsRows},null,2),{headers:{"Content-Type":"application/json","Content-Disposition":`attachment; filename="openx-growth-export-${new Date().toISOString().slice(0,10)}.json"`,"Cache-Control":"no-store"}});
}
