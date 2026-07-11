import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { posts } from "../db/schema";
import { appConfig } from "./config";
import { consumeUsage } from "./data";
import { loadXSession, storeXSession } from "./session-store";
import { refreshXAccessToken } from "./x-oauth";

type PostRecord = typeof posts.$inferSelect;

async function sendPost(text:string,replyTo:string | undefined,accessToken:string) {
  return fetch("https://api.x.com/2/tweets",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({text,...(replyTo ? {reply:{in_reply_to_tweet_id:replyTo}} : {})})});
}

export async function publishStoredPost(record:PostRecord) {
  const db = getDb();
  if (record.xPostId && record.status === "published") return {ok:true,id:record.xPostId,alreadyPublished:true};
  if (record.generated && !appConfig().xAiContentApproved) throw new Error("AI_CONTENT_APPROVAL_REQUIRED");
  let session = await loadXSession();
  if (!session) throw new Error("X_NOT_CONNECTED");
  const claimed = await db.update(posts).set({status:"publishing",attempts:record.attempts+1,lastError:null,updatedAt:Date.now()}).where(and(eq(posts.id,record.id),inArray(posts.status,["draft","scheduled","failed"]))).returning().get();
  if (!claimed) {
    const current = await db.select().from(posts).where(eq(posts.id,record.id)).get();
    if (current?.status === "published" && current.xPostId) return {ok:true,id:current.xPostId,alreadyPublished:true};
    throw new Error("POST_ALREADY_BEING_PUBLISHED");
  }
  record = claimed;
  const parts = record.threadJson ? JSON.parse(record.threadJson) as string[] : [record.text];
  const publishedIds = record.publishedIdsJson ? JSON.parse(record.publishedIdsJson) as string[] : [];
  try {
    for (let index=publishedIds.length; index<parts.length; index++) {
      await consumeUsage("write",1);
      let response = await sendPost(parts[index],publishedIds.at(-1),session.accessToken);
      if (response.status === 401) {
        const refreshed = await refreshXAccessToken(session);
        if (!refreshed) throw new Error("X_RECONNECT_REQUIRED");
        session = refreshed; await storeXSession(session); response = await sendPost(parts[index],publishedIds.at(-1),session.accessToken);
      }
      if (!response.ok) throw new Error(`X_PUBLISH_${response.status}`);
      const payload = await response.json() as {data?:{id?:string}};
      if (!payload.data?.id) throw new Error("X_PUBLISH_NO_ID");
      publishedIds.push(payload.data.id);
      await db.update(posts).set({publishedIdsJson:JSON.stringify(publishedIds),xPostId:publishedIds[0],updatedAt:Date.now()}).where(eq(posts.id,record.id));
    }
    const publishedAt = Date.now();
    await db.update(posts).set({status:"published",publishedAt,lastError:null,updatedAt:publishedAt}).where(eq(posts.id,record.id));
    if (record.evergreen && appConfig().evergreenEnabled) {
      const next = publishedAt + record.evergreenIntervalDays*86_400_000;
      await db.insert(posts).values({...record,id:crypto.randomUUID(),status:"scheduled",scheduledAt:next,publishedAt:null,xPostId:null,publishedIdsJson:null,attempts:0,lastError:null,createdAt:publishedAt,updatedAt:publishedAt}).onConflictDoNothing();
    }
    return {ok:true,id:publishedIds[0],threadIds:publishedIds};
  } catch (error) {
    const message = error instanceof Error ? error.message : "PUBLISH_FAILED";
    await db.update(posts).set({status:"failed",lastError:message,updatedAt:Date.now()}).where(eq(posts.id,record.id));
    throw error;
  }
}
