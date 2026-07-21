import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { posts, publishEvents } from "../db/schema";
import { getEffectiveConfig } from "./runtime-settings";
import { publishablePostSchema } from "./post-validation";
import {
  classifyPublishClaim,
  parsePublishReceipts,
  redactPublishDetail,
  type DeliveryState,
  type PublishReceipt,
} from "./publish-state";
import { loadXSession, storeXSession } from "./session-store";
import { refreshXAccessToken } from "./x-oauth";
import { getXTransport, type XTransport } from "./x-transport";

type PostRecord=typeof posts.$inferSelect;
type PublishEventType=typeof publishEvents.$inferInsert.eventType;
type FaultPoint="before_claim"|"after_claim"|"after_remote_acceptance"|"before_receipt"|`after_part:${number}`;
type PublishOptions={clock?:()=>number;fault?:(point:FaultPoint)=>void;transport?:XTransport;leaseMs?:number};

class SimulatedPublishCrash extends Error {
  constructor(point:FaultPoint){super(`SIMULATED_PUBLISH_CRASH:${point}`);this.name="SimulatedPublishCrash";}
}

function runtimeClock() {
  const env=globalThis.__OPENX_ENV__;
  return env?.OPENX_E2E==="1"&&typeof env.PUBLISH_NOW==="number"?env.PUBLISH_NOW:Date.now();
}

function runtimeFault(point:FaultPoint) {
  const env=globalThis.__OPENX_ENV__;
  if(env?.OPENX_E2E==="1"&&env.PUBLISH_FAULT===point)throw new SimulatedPublishCrash(point);
}

async function recordEvent(postId:string,eventType:PublishEventType,occurredAt:number,values:{partIndex?:number;providerStatus?:number;detailCode?:string}={}) {
  await getDb().insert(publishEvents).values({id:crypto.randomUUID(),postId,eventType,occurredAt,partIndex:values.partIndex??null,providerStatus:values.providerStatus??null,detailCode:values.detailCode??null});
}

async function sendPost(transport:XTransport,text:string,replyTo:string|undefined,accessToken:string) {
  return transport.request<{data?:{id?:string}}>({path:"/2/tweets",method:"POST",accessToken,json:{text,...(replyTo?{reply:{in_reply_to_tweet_id:replyTo}}:{})},accounting:{kind:"write",endpoint:replyTo?"posts.thread_part":"posts.create"}});
}

function preflight(record:PostRecord) {
  const parsed=publishablePostSchema.safeParse({text:record.text,threadJson:record.threadJson,format:record.format,evergreen:record.evergreen,evergreenIntervalDays:record.evergreenIntervalDays});
  if(!parsed.success)throw new Error("PUBLISH_PREFLIGHT_FAILED");
  return parsed.data;
}

async function markNeedsReview(record:PostRecord,now:number,detailCode="PUBLISH_NEEDS_REVIEW") {
  const updated=await getDb().update(posts).set({status:"needs_review",deliveryState:"ambiguous",claimToken:null,claimExpiresAt:null,lastError:detailCode,updatedAt:now}).where(and(eq(posts.id,record.id),eq(posts.status,"publishing"))).returning().get();
  if(updated)await recordEvent(record.id,"needs_review",now,{detailCode});
  return updated;
}

export async function reconcileStoredPost(record:PostRecord,command:{resolution:"accepted";xPostIds:string[]}|{resolution:"not_accepted"},options:PublishOptions={}) {
  const clock=options.clock??runtimeClock;const now=clock();const content=preflight(record);
  const current=await getDb().select().from(posts).where(eq(posts.id,record.id)).get();
  if(!current||current.status!=="needs_review")throw new Error("RECONCILIATION_NOT_REQUIRED");
  const priorReceipts=parsePublishReceipts(current.publishReceiptsJson);
  if(command.resolution==="accepted"){
    if(command.xPostIds.length!==content.parts.length)throw new Error("RECONCILIATION_ID_COUNT_MISMATCH");
    if(priorReceipts.some((receipt,index)=>command.xPostIds[index]!==receipt.xPostId))throw new Error("RECONCILIATION_RECEIPT_MISMATCH");
    const receipts:PublishReceipt[]=command.xPostIds.map((xPostId,partIndex)=>({partIndex,xPostId,acceptedAt:now,confirmedAt:now}));
    const updated=await getDb().update(posts).set({status:"published",publishedAt:now,xPostId:command.xPostIds[0],publishedIdsJson:JSON.stringify(command.xPostIds),publishReceiptsJson:JSON.stringify(receipts),deliveryState:"confirmed",claimToken:null,claimExpiresAt:null,lastError:null,updatedAt:now}).where(and(eq(posts.id,record.id),eq(posts.status,"needs_review"))).returning().get();
    if(!updated)throw new Error("RECONCILIATION_CONFLICT");
    await recordEvent(record.id,"reconciliation",now,{detailCode:"MANUAL_ACCEPTED"});
    return {ok:true,reconciled:true,status:"published",id:command.xPostIds[0],threadIds:command.xPostIds};
  }
  const deliveryState:DeliveryState=priorReceipts.length?"confirmed":"idle";
  const updated=await getDb().update(posts).set({status:"failed",deliveryState,claimToken:null,claimExpiresAt:null,lastError:"MANUAL_NOT_ACCEPTED",updatedAt:now}).where(and(eq(posts.id,record.id),eq(posts.status,"needs_review"))).returning().get();
  if(!updated)throw new Error("RECONCILIATION_CONFLICT");
  await recordEvent(record.id,"reconciliation",now,{detailCode:"MANUAL_NOT_ACCEPTED"});
  return {ok:true,reconciled:true,status:"failed"};
}

export async function publishStoredPost(record:PostRecord,options:PublishOptions={}) {
  const db=getDb();const clock=options.clock??runtimeClock;const fault=options.fault??runtimeFault;const leaseMs=options.leaseMs??60_000;const transport=options.transport??getXTransport();
  const config=await getEffectiveConfig();
  if(record.xPostId&&record.status==="published")return {ok:true,id:record.xPostId,alreadyPublished:true};
  if(record.generated&&!config.xAiContentApproved)throw new Error("AI_CONTENT_APPROVAL_REQUIRED");
  let current=await db.select().from(posts).where(eq(posts.id,record.id)).get();if(!current)throw new Error("POST_NOT_FOUND");
  if(current.xPostId&&current.status==="published")return {ok:true,id:current.xPostId,alreadyPublished:true};
  if(current.publishedIdsJson&&!current.publishReceiptsJson&&current.status!=="published"){
    if(current.status!=="publishing")await db.update(posts).set({status:"publishing",deliveryState:"ambiguous",claimToken:null,claimExpiresAt:null,updatedAt:clock()}).where(eq(posts.id,current.id));
    await markNeedsReview(current,clock());throw new Error("PUBLISH_NEEDS_REVIEW");
  }
  const now=clock();const claimState=classifyPublishClaim(current,now);
  if(claimState==="needs_review"){await markNeedsReview(current,now);throw new Error("PUBLISH_NEEDS_REVIEW");}
  if(claimState==="active")throw new Error("POST_ALREADY_BEING_PUBLISHED");
  const sessionAtClaim=await loadXSession();if(!sessionAtClaim)throw new Error("X_NOT_CONNECTED");

  fault("before_claim");
  const claimToken=crypto.randomUUID();
  const claimed=await db.update(posts).set({status:"publishing",claimToken,claimExpiresAt:now+leaseMs,attempts:sql`${posts.attempts} + 1`,lastError:null,updatedAt:now}).where(and(eq(posts.id,record.id),or(
    inArray(posts.status,["draft","scheduled","failed"]),
    and(eq(posts.status,"publishing"),lte(posts.claimExpiresAt,now),inArray(posts.deliveryState,["idle","confirmed"])),
  ))).returning().get();
  if(!claimed){
    current=await db.select().from(posts).where(eq(posts.id,record.id)).get();
    if(current?.status==="published"&&current.xPostId)return {ok:true,id:current.xPostId,alreadyPublished:true};
    if(current&&classifyPublishClaim(current,now)==="needs_review"){await markNeedsReview(current,now);throw new Error("PUBLISH_NEEDS_REVIEW");}
    throw new Error("POST_ALREADY_BEING_PUBLISHED");
  }
  await recordEvent(record.id,claimState==="recoverable"?"claim_recovered":"claim_acquired",now);
  fault("after_claim");

  let session=sessionAtClaim;
  try{
    const content=preflight(claimed);
    if(claimed.generated&&!config.xAiContentApproved)throw new Error("AI_CONTENT_APPROVAL_REQUIRED");
    const receipts=parsePublishReceipts(claimed.publishReceiptsJson);
    const publishedIds=receipts.map((receipt)=>receipt.xPostId);
    for(let index=receipts.length;index<content.parts.length;index++){
      const safeState:DeliveryState=receipts.length?"confirmed":"idle";
      const prepare=async()=>{
        const prepared=await db.update(posts).set({deliveryState:"sending",claimExpiresAt:clock()+leaseMs,updatedAt:clock()}).where(and(eq(posts.id,record.id),eq(posts.status,"publishing"),eq(posts.claimToken,claimToken))).returning().get();
        if(!prepared)throw new Error("PUBLISH_CLAIM_LOST");
        await recordEvent(record.id,"provider_request",clock(),{partIndex:index});
      };
      await prepare();
      let response=await sendPost(transport,content.parts[index],publishedIds.at(-1),session.accessToken);
      await recordEvent(record.id,"provider_response",clock(),{partIndex:index,providerStatus:response.status});
      if(response.status===401){
        await db.update(posts).set({deliveryState:safeState,updatedAt:clock()}).where(and(eq(posts.id,record.id),eq(posts.claimToken,claimToken)));
        const refreshed=await refreshXAccessToken(session);if(!refreshed)throw new Error("X_RECONNECT_REQUIRED");
        session=refreshed;await storeXSession(session);await recordEvent(record.id,"retry",clock(),{partIndex:index,detailCode:"AUTH_REFRESH"});
        await prepare();response=await sendPost(transport,content.parts[index],publishedIds.at(-1),session.accessToken);
        await recordEvent(record.id,"provider_response",clock(),{partIndex:index,providerStatus:response.status});
      }
      if(!response.ok){
        // A timeout or provider-side failure may happen after X accepted the write.
        // Keep the sending state so the catch path fails closed into needs_review.
        if(response.status===408||response.status>=500)throw new Error(`X_PUBLISH_${response.status}`);
        await db.update(posts).set({deliveryState:safeState,updatedAt:clock()}).where(and(eq(posts.id,record.id),eq(posts.claimToken,claimToken)));
        throw new Error(`X_PUBLISH_${response.status}`);
      }
      const xPostId=response.data?.data?.id;if(!xPostId)throw new Error("X_PUBLISH_NO_ID");
      const acceptedAt=clock();
      fault("after_remote_acceptance");
      await db.update(posts).set({deliveryState:"accepted",updatedAt:acceptedAt}).where(and(eq(posts.id,record.id),eq(posts.claimToken,claimToken)));
      fault("before_receipt");
      const receipt:PublishReceipt={partIndex:index,xPostId,acceptedAt,confirmedAt:clock()};receipts.push(receipt);publishedIds.push(xPostId);
      const persisted=await db.update(posts).set({publishedIdsJson:JSON.stringify(publishedIds),publishReceiptsJson:JSON.stringify(receipts),xPostId:publishedIds[0],deliveryState:"confirmed",claimExpiresAt:clock()+leaseMs,updatedAt:clock()}).where(and(eq(posts.id,record.id),eq(posts.status,"publishing"),eq(posts.claimToken,claimToken))).returning().get();
      if(!persisted)throw new Error("PUBLISH_CLAIM_LOST");
      await recordEvent(record.id,"receipt_persisted",clock(),{partIndex:index});
      fault(`after_part:${index}`);
    }
    const publishedAt=clock();
    const completed=await db.update(posts).set({status:"published",publishedAt,lastError:null,deliveryState:"confirmed",claimToken:null,claimExpiresAt:null,updatedAt:publishedAt}).where(and(eq(posts.id,record.id),eq(posts.status,"publishing"),eq(posts.claimToken,claimToken))).returning().get();
    if(!completed)throw new Error("PUBLISH_CLAIM_LOST");
    await recordEvent(record.id,"published",publishedAt);
    if(claimed.evergreen&&config.evergreenEnabled){
      const next=publishedAt+claimed.evergreenIntervalDays*86_400_000;
      await db.insert(posts).values({...claimed,id:crypto.randomUUID(),status:"scheduled",scheduledAt:next,publishedAt:null,xPostId:null,publishedIdsJson:null,publishReceiptsJson:null,claimToken:null,claimExpiresAt:null,deliveryState:"idle",attempts:0,lastError:null,createdAt:publishedAt,updatedAt:publishedAt}).onConflictDoNothing();
    }
    return {ok:true,id:publishedIds[0],threadIds:publishedIds,receipts};
  }catch(error){
    if(error instanceof SimulatedPublishCrash)throw error;
    const latest=await db.select().from(posts).where(eq(posts.id,record.id)).get();
    if(latest?.status==="publishing"&&latest.claimToken===claimToken){
      if(latest.deliveryState==="sending"||latest.deliveryState==="accepted"||latest.deliveryState==="ambiguous"){
        await markNeedsReview(latest,clock());throw new Error("PUBLISH_NEEDS_REVIEW");
      }
      const detailCode=redactPublishDetail(error);
      await db.update(posts).set({status:"failed",claimToken:null,claimExpiresAt:null,lastError:detailCode,updatedAt:clock()}).where(and(eq(posts.id,record.id),eq(posts.claimToken,claimToken)));
      await recordEvent(record.id,"terminal_failure",clock(),{detailCode});
      throw new Error(detailCode);
    }
    throw new Error("PUBLISH_NEEDS_REVIEW");
  }
}

export { classifyPublishClaim, publishReceiptsSchema, redactPublishDetail } from "./publish-state";
