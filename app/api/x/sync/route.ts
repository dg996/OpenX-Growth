import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../db";
import { analyticsSnapshots, feedback, followerSnapshots } from "../../../../db/schema";
import { appConfig } from "../../../../lib/config";
import { getUsage, readCache, writeCache } from "../../../../lib/data";
import { chunkForD1Insert } from "../../../../lib/d1";
import { authorizeBrowserOrApiRead, configuredInstanceResponse, getXSession, setXSession } from "../../../../lib/security";
import { loadXSession, storeXSession } from "../../../../lib/session-store";
import { filterNetworkPosts, generateIdeas, rankReplyOpportunities, type RankingFeedback, type XPost, type XUser } from "../../../../lib/x-growth";
import { refreshXAccessToken } from "../../../../lib/x-oauth";
import { getXTransport } from "../../../../lib/x-transport";
import { syncPageSize } from "../../../../lib/usage-policy";

type SyncPayload = {source:"live";syncedAt:string;account:{id:string;name:string;username:string;profileImageUrl?:string;followersCount?:number};opportunities:ReturnType<typeof rankReplyOpportunities>;ideas:ReturnType<typeof generateIdeas>;usage:Awaited<ReturnType<typeof getUsage>>};

function publicSyncError(error:unknown) {
  const raw=error instanceof Error?error.message:"";
  const code=/^(?:X_API_\d{3}(?:_\d{3})?|DAILY_X_(?:RESOURCE|WRITE)_(?:CAP|LIMIT)_REACHED)$/.test(raw)?raw:"SYNC_FAILED";
  return NextResponse.json({error:code},{status:code.startsWith("DAILY_X_")?429:502});
}

export async function GET(request:NextRequest) {
  const blocked=configuredInstanceResponse(); if(blocked)return blocked;
  const denied=await authorizeBrowserOrApiRead(request);if(denied)return denied;
  const cached = request.nextUrl.searchParams.get("force") !== "1" ? await readCache<SyncPayload>("x-growth-sync") : null;
  if (cached) return NextResponse.json({...cached,cached:true});
  let session = await getXSession(request) ?? await loadXSession();
  if (!session) return NextResponse.json({error:"X_NOT_CONNECTED"},{status:401});
  try {
    const transport=getXTransport();
    let me = await transport.request<{data:XUser}>({path:"/2/users/me?user.fields=name,username,profile_image_url,public_metrics",accessToken:session.accessToken,accounting:{kind:"read",endpoint:"users.me",reservedResources:1,resourceCount:(data)=>((data as {data?:unknown}|undefined)?.data?1:0)}});
    let refreshed = false;
    if (me.status === 401) {
      const next = await refreshXAccessToken(session);
      if (!next) return NextResponse.json({error:"X_RECONNECT_REQUIRED"},{status:401});
      session = next; refreshed = true; await storeXSession(session); me = await transport.request<{data:XUser}>({path:"/2/users/me?user.fields=name,username,profile_image_url,public_metrics",accessToken:session.accessToken,accounting:{kind:"read",endpoint:"users.me",reservedResources:1,resourceCount:(data)=>((data as {data?:unknown}|undefined)?.data?1:0)}});
    }
    if (!me.ok || !me.data) throw new Error(`X_API_${me.status}`);
    const available=(await getUsage()).remainingResources;
    const maxResults=syncPageSize(available);
    if(maxResults===null)throw new Error("DAILY_X_RESOURCE_LIMIT_REACHED");
    const query = `max_results=${maxResults}&tweet.fields=author_id,created_at,public_metrics&expansions=author_id&user.fields=name,username,profile_image_url,public_metrics`;
    const [timeline,own] = await Promise.all([
      transport.request<{data?:XPost[];includes?:{users?:XUser[]}}>({path:`/2/users/${me.data.data.id}/timelines/reverse_chronological?${query}`,accessToken:session.accessToken,accounting:{kind:"read",endpoint:"timeline.home",reservedResources:maxResults,resourceCount:(data)=>((data as {data?:unknown[]}|undefined)?.data?.length??0)}}),
      transport.request<{data?:XPost[]}>({path:`/2/users/${me.data.data.id}/tweets?max_results=${maxResults}&tweet.fields=created_at,public_metrics`,accessToken:session.accessToken,accounting:{kind:"read",endpoint:"users.posts",reservedResources:maxResults,resourceCount:(data)=>((data as {data?:unknown[]}|undefined)?.data?.length??0)}}),
    ]);
    if (!timeline.ok || !own.ok) throw new Error(`X_API_${timeline.status}_${own.status}`);
    const feed = filterNetworkPosts(timeline.data?.data ?? [],me.data.data.id);
    const ownPosts = own.data?.data ?? [];
    const now = Date.now();
    const followerCount=me.data.data.public_metrics?.followers_count;
    if(typeof followerCount==="number")await getDb().insert(followerSnapshots).values({accountId:me.data.data.id,recordedAt:now,followers:followerCount});
    const analyticsRows = ownPosts.map((post) => ({postId:post.id,recordedAt:now,impressions:post.public_metrics?.impression_count ?? 0,likes:post.public_metrics?.like_count ?? 0,replies:post.public_metrics?.reply_count ?? 0,reposts:post.public_metrics?.retweet_count ?? 0,bookmarks:0}));
    // D1 accepts at most 100 bound parameters per statement; each snapshot binds seven values.
    for (const batch of chunkForD1Insert(analyticsRows,7)) await getDb().insert(analyticsSnapshots).values(batch).onConflictDoNothing();
    const feedbackRows=await getDb().select().from(feedback).orderBy(desc(feedback.createdAt)).limit(500);
    const rankingFeedback=feedbackRows.flatMap<RankingFeedback>((row)=>{
      if(row.vote!==1&&row.vote!==-1)return [];
      let context:unknown;
      if(row.contextJson){try{context=JSON.parse(row.contextJson)}catch{context=undefined}}
      return [{targetType:row.targetType,targetId:row.targetId,vote:row.vote,context,createdAt:row.createdAt}];
    });
    const rankingOptions={clock:()=>now,ownPosts,feedback:rankingFeedback};
    const opportunities=rankReplyOpportunities(feed,timeline.data?.includes?.users ?? [],rankingOptions);
    if(!appConfig().xAiRepliesApproved) for(const opportunity of opportunities) opportunity.suggestedReply="";
    const payload:SyncPayload = {source:"live",syncedAt:new Date(now).toISOString(),account:{id:me.data.data.id,name:me.data.data.name,username:me.data.data.username,profileImageUrl:me.data.data.profile_image_url,followersCount:me.data.data.public_metrics?.followers_count},opportunities,ideas:generateIdeas(feed,ownPosts,rankingOptions),usage:await getUsage()};
    await writeCache("x-growth-sync",payload,appConfig().syncTtlSeconds);
    const response = NextResponse.json({...payload,cached:false});
    if (refreshed) await setXSession(response,session,request.nextUrl.protocol==="https:");
    return response;
  } catch (error) { return publicSyncError(error); }
}
