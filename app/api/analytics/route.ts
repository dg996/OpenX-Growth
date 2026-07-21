import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../db";
import { analyticsSnapshots, followerSnapshots, posts } from "../../../db/schema";
import { deploymentPosture } from "../../../lib/config";
import { getEffectiveConfig } from "../../../lib/runtime-settings";
import { authorizeBrowserOrApiRead } from "../../../lib/security";
import { getUsage } from "../../../lib/data";
import { buildAnalyticsView, type AnalyticsRange } from "../../../lib/analytics";

export async function GET(request:NextRequest) {
  const denied=await authorizeBrowserOrApiRead(request);if(denied)return denied;
  const requestedRange=request.nextUrl.searchParams.get("range");
  const range:AnalyticsRange=requestedRange&&["7D","28D","90D","1Y"].includes(requestedRange)?requestedRange as AnalyticsRange:"28D";
  const now=Date.now();
  if(deploymentPosture(await getEffectiveConfig())==="demo"){
    const view=buildAnalyticsView({now,range,posts:[],snapshots:[],followerSnapshots:[]});
    return NextResponse.json({...view,usage:{requests:0,resources:0,reservedResources:0,writes:0,maxResources:0,maxSyncResources:0,maxWrites:0,deploymentMaxResources:0,deploymentMaxWrites:0,userConfigured:false,remainingResources:0,remainingWrites:0,warning:false,reads:0,maxReads:0,events:[],provenance:{source:"demo",recordedAt:now}}});
  }
  const [postRows,snapshots,followers,usage]=await Promise.all([
    getDb().select().from(posts).orderBy(desc(posts.createdAt)).limit(500),
    getDb().select().from(analyticsSnapshots).orderBy(desc(analyticsSnapshots.recordedAt)).limit(2000),
    getDb().select().from(followerSnapshots).orderBy(desc(followerSnapshots.recordedAt)).limit(1000),
    getUsage(),
  ]);
  const view=buildAnalyticsView({now,range,posts:postRows,snapshots,followerSnapshots:followers});
  return NextResponse.json({...view,usage:{...usage,provenance:{source:"live",recordedAt:now}}});
}
