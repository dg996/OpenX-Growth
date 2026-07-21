import { NextRequest, NextResponse } from "next/server";
import { deploymentPosture, protectedConfigSummary, publicConfig } from "../../../../lib/config";
import { authorizeBrowserMutation, authorizeBrowserOrApiRead, getXSession } from "../../../../lib/security";
import { resolveStoredAuthorization } from "../../../../lib/session-store";
import { getSchemaHealth, schemaErrorCode } from "../../../../lib/schema-health";
import { canonicalOriginStatus, safeOriginDiagnostic } from "../../../../lib/canonical-origin";
import { getEffectiveConfig } from "../../../../lib/runtime-settings";
import { activeSyncLease, claimSyncLease, getUsage, readRetainedCache, readSyncStatus, releaseSyncLease, resetDailyXUsage, setXUsageLimits } from "../../../../lib/data";
import { clearExpiredBudgetState, parseUserXUsageLimits, syncResourcePlan, xUsageWindow } from "../../../../lib/usage-policy";
import { getD1 } from "../../../../db";

type CachedSync={syncedAt:string;ideas?:unknown[];opportunities?:unknown[]};

async function readiness(cache:CachedSync|null) {
  if(!cache)return {overall:"unavailable",contentRecommendation:"unavailable",replyRanking:"unavailable",analytics:"unavailable",followerHistory:"unavailable"} as const;
  const [analytics,followers]=await Promise.all([
    getD1().prepare("SELECT COUNT(*) AS count FROM analytics_snapshots").first<{count:number}>(),
    getD1().prepare("SELECT COUNT(DISTINCT recorded_at) AS count FROM follower_snapshots").first<{count:number}>(),
  ]);
  const contentRecommendation=(cache.ideas?.length??0)>0?"sufficient":"insufficient";
  const replyRanking=(cache.opportunities?.length??0)>0?"sufficient":"insufficient";
  const analyticsState=Number(analytics?.count??0)>0?"sufficient":"insufficient";
  const followerHistory=Number(followers?.count??0)>=2?"sufficient":"insufficient";
  const values=[contentRecommendation,replyRanking,analyticsState,followerHistory];
  const sufficient=values.filter((value)=>value==="sufficient").length;
  return {overall:sufficient===4?"sufficient":sufficient===0?"insufficient":"partial",contentRecommendation,replyRanking,analytics:analyticsState,followerHistory};
}
export async function GET(request:NextRequest) {
  const now=Date.now();
  const schema=await getSchemaHealth();
  if(schema.state!=="ready")return NextResponse.json({error:schemaErrorCode(schema.state),schema},{status:503,headers:{"Cache-Control":"no-store"}});
  const denied=await authorizeBrowserOrApiRead(request);if(denied)return denied;
  const config=await getEffectiveConfig();
  const posture=deploymentPosture(config);
  const authorization=posture==="demo"?{state:"disconnected" as const,session:null,lastVerifiedAt:undefined,lastVerifiedAccountId:undefined}:await resolveStoredAuthorization(await getXSession(request));
  const [usage,cache,status,lease]=await Promise.all([getUsage(now),readRetainedCache<CachedSync>("x-growth-sync"),readSyncStatus(),activeSyncLease(now)]);
  const needsRefresh=authorization.state==="authorization_check_required";
  const next=syncResourcePlan(usage.remainingResources,needsRefresh,usage.maxSyncResources);
  const lastSuccessfulAt=cache?Date.parse(cache.data.syncedAt)||cache.updatedAt:undefined;
  const storedSyncState=status?.data.state??(cache?"succeeded":"never");
  const syncState=lease?"in_progress":clearExpiredBudgetState(storedSyncState,next.enabled,Boolean(cache));
  const usageWindow=xUsageWindow(now);
  const origin=canonicalOriginStatus(config.appUrl,request.nextUrl.origin);
  if(!origin.currentMatchesCanonical&&process.env.NODE_ENV!=="production")console.warn("[openx:origin-mismatch]",{
    configured:safeOriginDiagnostic(config.appUrl),
    nextUrl:safeOriginDiagnostic(request.nextUrl.origin),
    requestUrl:safeOriginDiagnostic(request.url),
  });
  return NextResponse.json({
    connected:authorization.state==="connected",...publicConfig(config),...protectedConfigSummary(config),schema,
    usageControlsEnabled:posture!=="demo",
    origin:{configured:origin.configured,currentMatchesCanonical:origin.currentMatchesCanonical},
    authorization:{state:authorization.state,lastVerifiedAt:authorization.lastVerifiedAt},
    sync:{state:syncState,lastAttemptAt:status?.data.lastAttemptAt,lastSuccessfulAt:status?.data.lastSuccessfulAt??lastSuccessfulAt,lastErrorCode:status?.data.lastErrorCode??null,freshness:cache?.freshness??"unavailable",cacheAvailable:Boolean(cache),activeMaxReadResources:lease?status?.data.activeMaxReadResources:undefined,activeMaxRequests:lease?status?.data.activeMaxRequests:undefined,next},
    usage:{usedResources:usage.resources,inUseResources:usage.reservedResources,availableResources:usage.remainingResources,maxResources:usage.maxResources,maxSyncResources:usage.maxSyncResources,usedWrites:usage.writes,availableWrites:usage.remainingWrites,maxWrites:usage.maxWrites,deploymentMaxResources:usage.deploymentMaxResources,deploymentMaxWrites:usage.deploymentMaxWrites,userConfigured:usage.userConfigured,resetsAt:new Date(usageWindow.resetsAt).toISOString()},
    readiness:await readiness(cache?.data??null),
  },{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request:NextRequest) {
  const headers={"Cache-Control":"no-store"};
  const schema=await getSchemaHealth();
  if(schema.state!=="ready")return NextResponse.json({error:schemaErrorCode(schema.state),schema},{status:503,headers});
  const denied=await authorizeBrowserMutation(request);if(denied)return denied;
  let body:unknown;try{body=await request.json()}catch{return NextResponse.json({error:"INVALID_USAGE_RESET_INPUT"},{status:400,headers});}
  if(!body||typeof body!=="object"||Array.isArray(body)||!("intent" in body))return NextResponse.json({error:"INVALID_USAGE_CONTROL_INPUT"},{status:400,headers});
  const input=body as {intent?:unknown;maxResources?:unknown;maxSyncResources?:unknown;maxWrites?:unknown};
  const resetting=input.intent==="reset_local_usage"&&Object.keys(input).length===1;
  const limits=input.intent==="set_local_usage_limits"&&Object.keys(input).length===4?parseUserXUsageLimits(input):null;
  if(!resetting&&!limits)return NextResponse.json({error:"INVALID_USAGE_CONTROL_INPUT"},{status:400,headers});
  const operationId=`local-usage-control:${crypto.randomUUID()}`;
  if(!await claimSyncLease(operationId,15_000))return NextResponse.json({error:"SYNC_ALREADY_IN_PROGRESS"},{status:409,headers:{...headers,"Retry-After":"5"}});
  try{
    if(resetting){
      const result=await resetDailyXUsage();
      console.info("[openx:local-usage-reset]",{day:result.day});
      return NextResponse.json({reset:true,day:result.day},{headers});
    }
    const updated=await setXUsageLimits(limits!);
    console.info("[openx:local-usage-limits]",updated);
    return NextResponse.json({updated:true,limits:updated},{headers});
  }finally{await releaseSyncLease(operationId);}
}
