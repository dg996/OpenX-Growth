import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../db";
import { posts } from "../../../../../db/schema";
import { publishStoredPost } from "../../../../../lib/publisher";
import { hasApiAuth, hasAppAccess, configuredInstanceResponse, requireCsrf } from "../../../../../lib/security";

export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const blocked=configuredInstanceResponse(); if(blocked)return blocked;
  const api=hasApiAuth(request); if(!await hasAppAccess(request)&&!api)return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  if(!api)try{requireCsrf(request)}catch{return NextResponse.json({error:"INVALID_CSRF"},{status:403})}
  const {id}=await params; const post=await getDb().select().from(posts).where(eq(posts.id,id)).get(); if(!post)return NextResponse.json({error:"NOT_FOUND"},{status:404});
  try{return NextResponse.json(await publishStoredPost(post))}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"PUBLISH_FAILED"},{status:502})}
}
