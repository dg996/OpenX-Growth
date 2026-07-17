import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../db";
import { analyticsSnapshots, feedback, followerSnapshots } from "../../../../db/schema";
import { appConfig } from "../../../../lib/config";
import { claimSyncLease, getUsage, readIdempotentResult, readRetainedCache, releaseSyncLease, writeCache, writeIdempotentResult, writeSyncStatus } from "../../../../lib/data";
import { chunkForD1Insert } from "../../../../lib/d1";
import { authorizeBrowserOrApiMutation, authorizeBrowserOrApiRead, clearXSession, configuredInstanceResponse, getXSession, setXSession } from "../../../../lib/security";
import { deleteXSession, markAuthorizationConnected, markReconnectRequired, resolveStoredAuthorization, storeXSession } from "../../../../lib/session-store";
import { filterNetworkPosts, generateIdeas, rankReplyOpportunities, type RankingFeedback, type XPost, type XUser } from "../../../../lib/x-growth";
import { refreshXAccessToken } from "../../../../lib/x-oauth";
import { getXTransport } from "../../../../lib/x-transport";
import { syncResourcePlan } from "../../../../lib/usage-policy";

type SyncPayload={source:"live";syncedAt:string;account:{id:string;name:string;username:string;profileImageUrl?:string;followersCount?:number};opportunities:ReturnType<typeof rankReplyOpportunities>;ideas:ReturnType<typeof generateIdeas>;usage:Awaited<ReturnType<typeof getUsage>>};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_ERROR=/^(?:X_API_\d{3}(?:_\d{3})?|DAILY_X_RESOURCE_LIMIT_REACHED|X_ACCOUNT_MISMATCH|X_RECONNECT_REQUIRED|X_NOT_CONNECTED|SYNC_FAILED)$/;

function safeCode(error:unknown) {
  const raw=error instanceof Error?error.message:"";
  return PUBLIC_ERROR.test(raw)?raw:"SYNC_FAILED";
}

function response(payload:unknown,status=200) { return NextResponse.json(payload,{status,headers:{"Cache-Control":"no-store"}}); }

export async function GET(request:NextRequest) {
  const denied=await authorizeBrowserOrApiRead(request);if(denied)return denied;
  if([...request.nextUrl.searchParams.keys()].length)return response({error:"INVALID_QUERY"},400);
  const cached=await readRetainedCache<SyncPayload>("x-growth-sync");
  if(!cached)return response({available:false});
  return response({available:true,data:cached.data,cache:{syncedAt:cached.data.syncedAt,freshness:cached.freshness}});
}

async function strictEmptyBody(request:NextRequest) {
  try{
    const value=await request.json() as unknown;
    return Boolean(value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).length===0);
  }catch{return false;}
}

export async function POST(request:NextRequest) {
  const blocked=configuredInstanceResponse();if(blocked)return blocked;
  const denied=await authorizeBrowserOrApiMutation(request);if(denied)return denied;
  if([...request.nextUrl.searchParams.keys()].length)return response({error:"INVALID_QUERY"},400);
  const idempotencyKey=request.headers.get("idempotency-key")??"";
  if(!idempotencyKey)return response({error:"IDEMPOTENCY_KEY_REQUIRED"},400);
  if(!UUID.test(idempotencyKey))return response({error:"INVALID_IDEMPOTENCY_KEY"},400);
  if(!await strictEmptyBody(request))return response({error:"INVALID_SYNC_INPUT"},400);

  const replay=await readIdempotentResult(idempotencyKey);
  if(replay){
    const payload:Record<string,unknown>={...(replay.data.payload as Record<string,unknown>),replayed:true};
    const replayResponse=response(payload,replay.data.status);
    if(payload.error==="X_RECONNECT_REQUIRED")clearXSession(replayResponse,request.nextUrl.protocol==="https:");
    return replayResponse;
  }

  const operationId=crypto.randomUUID();
  if(!await claimSyncLease(operationId))return response({error:"SYNC_ALREADY_IN_PROGRESS"},409);
  let refreshedSession=false;
  let clearSession=false;
  const attemptAt=Date.now();

  const terminal=async(status:number,payload:Record<string,unknown>)=>{
    await writeIdempotentResult(idempotencyKey,{status,payload,completedAt:Date.now()});
    return response({...payload,replayed:false},status);
  };

  try{
    const usageBefore=await getUsage();
    const cookieSession=await getXSession(request);
    const authorization=await resolveStoredAuthorization(cookieSession);
    const plan=syncResourcePlan(usageBefore.remainingResources,authorization.state==="authorization_check_required",usageBefore.maxSyncResources);
    if(!plan.enabled){
      await writeSyncStatus({state:"budget_exhausted",lastAttemptAt:attemptAt,lastErrorCode:"DAILY_X_RESOURCE_LIMIT_REACHED",retryable:false});
      return terminal(429,{error:"DAILY_X_RESOURCE_LIMIT_REACHED"});
    }
    await writeSyncStatus({state:"in_progress",lastAttemptAt:attemptAt,lastErrorCode:null,activeMaxReadResources:plan.maxReadResources,activeMaxRequests:plan.maxRequests});

    if(authorization.state==="disconnected")return terminal(401,{error:"X_NOT_CONNECTED"});
    if(authorization.state==="reconnect_required"){
      await Promise.all([deleteXSession(),markReconnectRequired()]);clearSession=true;
      throw new Error("X_RECONNECT_REQUIRED");
    }

    let session=authorization.session!;
    if(authorization.state==="authorization_check_required"){
      const refreshed=await refreshXAccessToken(session);
      if(!refreshed){await Promise.all([deleteXSession(),markReconnectRequired()]);clearSession=true;throw new Error("X_RECONNECT_REQUIRED");}
      session=refreshed;refreshedSession=true;await storeXSession(session);
    }

    const transport=getXTransport();
    const me=await transport.request<{data:XUser}>({path:"/2/users/me?user.fields=name,username,profile_image_url,public_metrics",accessToken:session.accessToken,accounting:{kind:"read",endpoint:"users.me",reservedResources:1,resourceCount:(data)=>((data as {data?:unknown}|undefined)?.data?1:0)}});
    if(!me.ok||!me.data){
      if(me.status===401){await Promise.all([deleteXSession(),markReconnectRequired()]);clearSession=true;throw new Error("X_RECONNECT_REQUIRED");}
      throw new Error(`X_API_${me.status}`);
    }
    if(authorization.lastVerifiedAccountId&&authorization.lastVerifiedAccountId!==me.data.data.id)throw new Error("X_ACCOUNT_MISMATCH");

    const maxResults=plan.pageSize;
    const query=`max_results=${maxResults}&tweet.fields=author_id,created_at,public_metrics&expansions=author_id&user.fields=name,username,profile_image_url,public_metrics`;
    const [timeline,own]=await Promise.all([
      transport.request<{data?:XPost[];includes?:{users?:XUser[]}}>({path:`/2/users/${me.data.data.id}/timelines/reverse_chronological?${query}`,accessToken:session.accessToken,accounting:{kind:"read",endpoint:"timeline.home",reservedResources:maxResults,resourceCount:(data)=>((data as {data?:unknown[]}|undefined)?.data?.length??0)}}),
      transport.request<{data?:XPost[]}>({path:`/2/users/${me.data.data.id}/tweets?max_results=${maxResults}&tweet.fields=created_at,public_metrics`,accessToken:session.accessToken,accounting:{kind:"read",endpoint:"users.posts",reservedResources:maxResults,resourceCount:(data)=>((data as {data?:unknown[]}|undefined)?.data?.length??0)}}),
    ]);
    if(!timeline.ok||!own.ok)throw new Error(`X_API_${timeline.status}_${own.status}`);

    const feed=filterNetworkPosts(timeline.data?.data??[],me.data.data.id),ownPosts=own.data?.data??[],now=Date.now();
    const followerCount=me.data.data.public_metrics?.followers_count;
    if(typeof followerCount==="number")await getDb().insert(followerSnapshots).values({accountId:me.data.data.id,recordedAt:now,followers:followerCount});
    const analyticsRows=ownPosts.map((post)=>({postId:post.id,recordedAt:now,impressions:post.public_metrics?.impression_count??0,likes:post.public_metrics?.like_count??0,replies:post.public_metrics?.reply_count??0,reposts:post.public_metrics?.retweet_count??0,bookmarks:0}));
    for(const batch of chunkForD1Insert(analyticsRows,7))await getDb().insert(analyticsSnapshots).values(batch).onConflictDoNothing();
    const feedbackRows=await getDb().select().from(feedback).orderBy(desc(feedback.createdAt)).limit(500);
    const rankingFeedback=feedbackRows.flatMap<RankingFeedback>((row)=>{if(row.vote!==1&&row.vote!==-1)return [];let context:unknown;if(row.contextJson){try{context=JSON.parse(row.contextJson)}catch{context=undefined}}return [{targetType:row.targetType,targetId:row.targetId,vote:row.vote,context,createdAt:row.createdAt}];});
    const rankingOptions={clock:()=>now,ownPosts,feedback:rankingFeedback};
    const opportunities=rankReplyOpportunities(feed,timeline.data?.includes?.users??[],rankingOptions);
    if(!appConfig().xAiRepliesApproved)for(const opportunity of opportunities)opportunity.suggestedReply="";
    const payload:SyncPayload={source:"live",syncedAt:new Date(now).toISOString(),account:{id:me.data.data.id,name:me.data.data.name,username:me.data.data.username,profileImageUrl:me.data.data.profile_image_url,followersCount:followerCount},opportunities,ideas:generateIdeas(feed,ownPosts,rankingOptions),usage:await getUsage()};
    await writeCache("x-growth-sync",payload,appConfig().syncTtlSeconds);
    await Promise.all([markAuthorizationConnected(me.data.data.id),writeSyncStatus({state:"succeeded",lastAttemptAt:attemptAt,lastSuccessfulAt:now,lastErrorCode:null})]);
    const success=await terminal(200,payload as unknown as Record<string,unknown>);
    if(refreshedSession)await setXSession(success,session,request.nextUrl.protocol==="https:");
    return success;
  }catch(error){
    const code=safeCode(error),status=code==="X_ACCOUNT_MISMATCH"?409:code==="X_RECONNECT_REQUIRED"||code==="X_NOT_CONNECTED"?401:code==="DAILY_X_RESOURCE_LIMIT_REACHED"?429:502;
    await writeSyncStatus({state:code==="DAILY_X_RESOURCE_LIMIT_REACHED"?"budget_exhausted":"failed",lastAttemptAt:attemptAt,lastErrorCode:code,retryable:status===502&&code!=="X_API_429"});
    const failure=await terminal(status,{error:code});
    if(clearSession||code==="X_RECONNECT_REQUIRED")clearXSession(failure,request.nextUrl.protocol==="https:");
    return failure;
  }finally{await releaseSyncLease(operationId);}
}
