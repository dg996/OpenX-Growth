import { and, asc, eq, lte, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../db";
import { posts } from "../../../../db/schema";
import { getEffectiveConfig } from "../../../../lib/runtime-settings";
import { deleteExpiredCache } from "../../../../lib/data";
import { publishStoredPost } from "../../../../lib/publisher";
import { redactPublishDetail } from "../../../../lib/publish-state";
import { configuredAccessGateResponse, configuredInstanceResponse, hasBearerAuth } from "../../../../lib/security";

export async function POST(request:NextRequest) {
  const unconfigured=await configuredInstanceResponse();if(unconfigured)return unconfigured;
  const blocked=await configuredAccessGateResponse();if(blocked)return blocked;
  const secret=(await getEffectiveConfig()).cronSecret;if(!await hasBearerAuth(request,secret))return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  await deleteExpiredCache();
  const now=Date.now();
  const due=await getDb().select().from(posts).where(or(
    and(eq(posts.status,"scheduled"),lte(posts.scheduledAt,now)),
    and(eq(posts.status,"publishing"),lte(posts.claimExpiresAt,now)),
  )).orderBy(asc(posts.scheduledAt)).limit(10);
  const results=[]; for(const post of due){try{results.push({postId:post.id,...await publishStoredPost(post)})}catch(error){results.push({postId:post.id,ok:false,error:redactPublishDetail(error)})}}
  return NextResponse.json({processed:results.length,results});
}
