import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../db";
import { analyticsSnapshots } from "../../../../db/schema";
import { appConfig } from "../../../../lib/config";
import { consumeUsage, getUsage, readCache, writeCache } from "../../../../lib/data";
import { getXSession, hasAppAccess, setXSession } from "../../../../lib/security";
import { loadXSession, storeXSession } from "../../../../lib/session-store";
import { generateIdeas, rankReplyOpportunities, type XPost, type XUser } from "../../../../lib/x-growth";
import { refreshXAccessToken } from "../../../../lib/x-oauth";

type SyncPayload = {source:"live";syncedAt:string;account:{id:string;name:string;username:string;profileImageUrl?:string};opportunities:ReturnType<typeof rankReplyOpportunities>;ideas:ReturnType<typeof generateIdeas>;usage:Awaited<ReturnType<typeof getUsage>>};

const xFetch = async <T>(path:string,token:string):Promise<{ok:boolean;status:number,data?:T}> => {
  const response = await fetch(`https://api.x.com${path}`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
  return {ok:response.ok,status:response.status,data:response.ok ? await response.json() as T : undefined};
};

export async function GET(request:NextRequest) {
  if (!await hasAppAccess(request)) return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  const cached = request.nextUrl.searchParams.get("force") !== "1" ? await readCache<SyncPayload>("x-growth-sync") : null;
  if (cached) return NextResponse.json({...cached,cached:true});
  let session = await getXSession(request) ?? await loadXSession();
  if (!session) return NextResponse.json({error:"X_NOT_CONNECTED"},{status:401});
  try {
    await consumeUsage("read",3);
    let me = await xFetch<{data:{id:string;name:string;username:string;profile_image_url?:string}}>("/2/users/me?user.fields=name,username,profile_image_url",session.accessToken);
    let refreshed = false;
    if (me.status === 401) {
      const next = await refreshXAccessToken(session);
      if (!next) return NextResponse.json({error:"X_RECONNECT_REQUIRED"},{status:401});
      session = next; refreshed = true; await storeXSession(session); me = await xFetch<{data:{id:string;name:string;username:string;profile_image_url?:string}}>("/2/users/me?user.fields=name,username,profile_image_url",session.accessToken);
    }
    if (!me.ok || !me.data) throw new Error(`X_API_${me.status}`);
    const query = "max_results=50&tweet.fields=author_id,created_at,public_metrics&expansions=author_id&user.fields=name,username,profile_image_url,public_metrics";
    const [timeline,own] = await Promise.all([
      xFetch<{data?:XPost[];includes?:{users?:XUser[]}}>(`/2/users/${me.data.data.id}/timelines/reverse_chronological?${query}`,session.accessToken),
      xFetch<{data?:XPost[]}>(`/2/users/${me.data.data.id}/tweets?max_results=50&tweet.fields=created_at,public_metrics`,session.accessToken),
    ]);
    if (!timeline.ok || !own.ok) throw new Error(`X_API_${timeline.status}_${own.status}`);
    const feed = timeline.data?.data ?? [];
    const ownPosts = own.data?.data ?? [];
    const now = Date.now();
    if (ownPosts.length) await getDb().insert(analyticsSnapshots).values(ownPosts.map((post) => ({postId:post.id,recordedAt:now,impressions:post.public_metrics?.impression_count ?? 0,likes:post.public_metrics?.like_count ?? 0,replies:post.public_metrics?.reply_count ?? 0,reposts:post.public_metrics?.retweet_count ?? 0,bookmarks:0}))).onConflictDoNothing();
    const opportunities=rankReplyOpportunities(feed,timeline.data?.includes?.users ?? []);
    if(!appConfig().xAiRepliesApproved) for(const opportunity of opportunities) opportunity.suggestedReply="";
    const payload:SyncPayload = {source:"live",syncedAt:new Date().toISOString(),account:{id:me.data.data.id,name:me.data.data.name,username:me.data.data.username,profileImageUrl:me.data.data.profile_image_url},opportunities,ideas:generateIdeas(feed,ownPosts),usage:await getUsage()};
    await writeCache("x-growth-sync",payload,appConfig().syncTtlSeconds);
    const response = NextResponse.json({...payload,cached:false});
    if (refreshed) await setXSession(response,session,request.nextUrl.protocol==="https:");
    return response;
  } catch (error) { return NextResponse.json({error:error instanceof Error ? error.message : "SYNC_FAILED"},{status:502}); }
}
