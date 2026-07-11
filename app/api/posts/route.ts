import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../db";
import { posts } from "../../../db/schema";
import { hasApiAuth, hasAppAccess, configuredInstanceResponse, requireCsrf } from "../../../lib/security";

export async function GET(request:NextRequest) {
  if (!await hasAppAccess(request) && !hasApiAuth(request)) return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  return NextResponse.json({posts:await getDb().select().from(posts).orderBy(desc(posts.createdAt)).limit(200)});
}

export async function POST(request:NextRequest) {
  const blocked=configuredInstanceResponse(); if(blocked)return blocked;
  const api = hasApiAuth(request);
  if (!await hasAppAccess(request) && !api) return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  if (!api) try { requireCsrf(request); } catch { return NextResponse.json({error:"INVALID_CSRF"},{status:403}); }
  const input = await request.json() as {text?:string;thread?:string[];scheduledAt?:number;topic?:string;format?:string;hook?:string;evergreen?:boolean;evergreenIntervalDays?:number;generated?:boolean};
  const thread = (input.thread ?? []).map((part)=>part.trim()).filter(Boolean);
  const text = (input.text ?? thread[0] ?? "").trim();
  if (!text || text.length > 25_000 || thread.some((part)=>part.length>280)) return NextResponse.json({error:"INVALID_CONTENT"},{status:400});
  const now = Date.now(); const id = crypto.randomUUID();
  const record = {id,text,threadJson:thread.length>1?JSON.stringify(thread):null,status:input.scheduledAt?"scheduled" as const:"draft" as const,scheduledAt:input.scheduledAt??null,publishedAt:null,xPostId:null,publishedIdsJson:null,topic:input.topic??null,format:input.format??(thread.length>1?"thread":"post"),hook:input.hook??text.split("\n")[0],generated:Boolean(input.generated),evergreen:Boolean(input.evergreen),evergreenIntervalDays:Math.max(7,input.evergreenIntervalDays??30),attempts:0,lastError:null,createdAt:now,updatedAt:now};
  await getDb().insert(posts).values(record);
  return NextResponse.json({post:record},{status:201});
}
