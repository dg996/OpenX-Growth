import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../db";
import { posts } from "../../../../db/schema";
import { hasApiAuth, hasAppAccess, configuredInstanceResponse, requireCsrf } from "../../../../lib/security";

export async function PATCH(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const blocked=configuredInstanceResponse(); if(blocked)return blocked;
  const api=hasApiAuth(request); if (!await hasAppAccess(request)&&!api) return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  if(!api) try{requireCsrf(request)}catch{return NextResponse.json({error:"INVALID_CSRF"},{status:403})}
  const {id}=await params; const current=await getDb().select().from(posts).where(eq(posts.id,id)).get(); if(!current)return NextResponse.json({error:"NOT_FOUND"},{status:404});
  if(current.status==="publishing"||current.status==="published")return NextResponse.json({error:"IMMUTABLE_POST"},{status:409});
  const input=await request.json() as Partial<{text:string;thread:string[];scheduledAt:number|null;status:"draft"|"scheduled";evergreen:boolean;evergreenIntervalDays:number;topic:string;format:string;hook:string}>;
  const values={...(input.text!==undefined?{text:input.text.trim()}:{}),...(input.thread!==undefined?{threadJson:input.thread.length>1?JSON.stringify(input.thread):null}:{}),...(input.scheduledAt!==undefined?{scheduledAt:input.scheduledAt}:{}),...(input.status?{status:input.status}:{}),...(input.evergreen!==undefined?{evergreen:input.evergreen}:{}),...(input.evergreenIntervalDays?{evergreenIntervalDays:Math.max(7,input.evergreenIntervalDays)}:{}),...(input.topic!==undefined?{topic:input.topic}:{}),...(input.format!==undefined?{format:input.format}:{}),...(input.hook!==undefined?{hook:input.hook}:{}),updatedAt:Date.now()};
  await getDb().update(posts).set(values).where(eq(posts.id,id)); return NextResponse.json({ok:true});
}

export async function DELETE(request:NextRequest,{params}:{params:Promise<{id:string}>}) {
  const blocked=configuredInstanceResponse(); if(blocked)return blocked;
  const api=hasApiAuth(request); if(!await hasAppAccess(request)&&!api)return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  if(!api)try{requireCsrf(request)}catch{return NextResponse.json({error:"INVALID_CSRF"},{status:403})}
  const {id}=await params; await getDb().delete(posts).where(eq(posts.id,id)); return NextResponse.json({ok:true});
}
