import { and, asc, eq, lte } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../db";
import { posts } from "../../../../db/schema";
import { appConfig } from "../../../../lib/config";
import { deleteExpiredCache } from "../../../../lib/data";
import { publishStoredPost } from "../../../../lib/publisher";

export async function POST(request:NextRequest) {
  const secret=appConfig().cronSecret; if(!secret||request.headers.get("authorization")!==`Bearer ${secret}`)return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  await deleteExpiredCache();
  const due=await getDb().select().from(posts).where(and(eq(posts.status,"scheduled"),lte(posts.scheduledAt,Date.now()))).orderBy(asc(posts.scheduledAt)).limit(10);
  const results=[]; for(const post of due){try{results.push({postId:post.id,...await publishStoredPost(post)})}catch(error){results.push({postId:post.id,ok:false,error:error instanceof Error?error.message:"FAILED"})}}
  return NextResponse.json({processed:results.length,results});
}
