import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../db";
import { analyticsSnapshots, posts } from "../../../db/schema";
import { hasApiAuth, hasAppAccess } from "../../../lib/security";
import { getUsage } from "../../../lib/data";

export async function GET(request:NextRequest) {
  if(!await hasAppAccess(request)&&!hasApiAuth(request))return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  const [postRows,snapshots]=await Promise.all([getDb().select().from(posts).orderBy(desc(posts.createdAt)).limit(500),getDb().select().from(analyticsSnapshots).orderBy(desc(analyticsSnapshots.recordedAt)).limit(2000)]);
  const latest=new Map<string,(typeof snapshots)[number]>(); for(const row of snapshots)if(!latest.has(row.postId))latest.set(row.postId,row);
  const rows=postRows.map((post)=>({post,metrics:latest.get(post.xPostId??"")})).filter((row)=>row.metrics);
  const totals=rows.reduce((sum,row)=>({impressions:sum.impressions+(row.metrics?.impressions??0),likes:sum.likes+(row.metrics?.likes??0),replies:sum.replies+(row.metrics?.replies??0),reposts:sum.reposts+(row.metrics?.reposts??0)}),{impressions:0,likes:0,replies:0,reposts:0});
  const group=(key:(post:(typeof postRows)[number])=>string)=>Object.values(rows.reduce<Record<string,{label:string;posts:number;impressions:number;engagements:number}>>((map,row)=>{const label=key(row.post)||"Uncategorized";const item=map[label]??={label,posts:0,impressions:0,engagements:0};item.posts++;item.impressions+=row.metrics?.impressions??0;item.engagements+=(row.metrics?.likes??0)+(row.metrics?.replies??0)+(row.metrics?.reposts??0);return map},{})).sort((a,b)=>b.impressions-a.impressions);
  return NextResponse.json({source:rows.length?"live":"empty",totals,byTopic:group((post)=>post.topic??"Uncategorized"),byFormat:group((post)=>post.format),byHook:group((post)=>(post.hook??post.text).split(" ").slice(0,5).join(" ")),byHour:group((post)=>post.publishedAt?`${new Date(post.publishedAt).getUTCHours().toString().padStart(2,"0")}:00 UTC`:"Unscheduled"),usage:await getUsage()});
}
