import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "../../../../db";
import { analyticsSnapshots, feedback, posts } from "../../../../db/schema";
import { hasApiAuth, hasAppAccess, configuredInstanceResponse, requireCsrf } from "../../../../lib/security";

const nullableText = (max:number) => z.string().max(max).nullable().optional();
const postSchema = z.object({
  id:z.string().uuid().optional(), text:z.string().min(1).max(25_000), threadJson:nullableText(100_000),
  status:z.enum(["draft","scheduled","publishing","published","failed"]).default("draft"), scheduledAt:z.number().int().nonnegative().nullable().optional(),
  publishedAt:z.number().int().nonnegative().nullable().optional(), xPostId:nullableText(100), publishedIdsJson:nullableText(10_000), topic:nullableText(200),
  format:z.enum(["post","thread","article"]).default("post"), hook:nullableText(1_000), generated:z.boolean().default(false),
  evergreen:z.boolean().default(false), evergreenIntervalDays:z.number().int().min(7).max(365).default(30), attempts:z.number().int().min(0).max(20).default(0),
  lastError:nullableText(1_000), createdAt:z.number().int().nonnegative(), updatedAt:z.number().int().nonnegative(),
}).strict();
const feedbackSchema = z.object({id:z.string().uuid().optional(),targetType:z.enum(["idea","reply"]),targetId:z.string().min(1).max(200),vote:z.union([z.literal(1),z.literal(-1)]),contextJson:nullableText(10_000),createdAt:z.number().int().nonnegative()}).strict();
const analyticsSchema = z.object({id:z.number().int().positive().optional(),postId:z.string().min(1).max(100),recordedAt:z.number().int().nonnegative(),impressions:z.number().int().nonnegative().default(0),likes:z.number().int().nonnegative().default(0),replies:z.number().int().nonnegative().default(0),reposts:z.number().int().nonnegative().default(0),bookmarks:z.number().int().nonnegative().default(0)}).strict();
const importSchema = z.object({schemaVersion:z.literal(1),posts:z.array(postSchema).max(1_000).default([]),feedback:z.array(feedbackSchema).max(5_000).default([]),analytics:z.array(analyticsSchema).max(10_000).default([])}).strict();

export async function POST(request:NextRequest) {
  const blocked=configuredInstanceResponse(); if(blocked)return blocked;
  const api=hasApiAuth(request);
  if(!await hasAppAccess(request)&&!api)return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  if(!api)try{requireCsrf(request)}catch{return NextResponse.json({error:"INVALID_CSRF"},{status:403})}
  let raw:unknown; try { raw=await request.json(); } catch { return NextResponse.json({error:"INVALID_JSON"},{status:400}); }
  const parsed=importSchema.safeParse(raw);
  if(!parsed.success)return NextResponse.json({error:"INVALID_IMPORT",issues:parsed.error.issues.slice(0,20).map((issue)=>({path:issue.path.join("."),message:issue.message}))},{status:400});
  const db=getDb(); const input=parsed.data;
  for(const row of input.posts)await db.insert(posts).values({...row,id:row.id??crypto.randomUUID(),status:row.scheduledAt&&row.scheduledAt>Date.now()?"scheduled":"draft",publishedAt:null,xPostId:null,publishedIdsJson:null,attempts:0,lastError:null}).onConflictDoNothing();
  for(const row of input.feedback)await db.insert(feedback).values({...row,id:row.id??crypto.randomUUID()}).onConflictDoNothing();
  for(const row of input.analytics)await db.insert(analyticsSnapshots).values(row).onConflictDoNothing();
  return NextResponse.json({ok:true,imported:{posts:input.posts.length,feedback:input.feedback.length,analytics:input.analytics.length}});
}
