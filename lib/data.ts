import { desc, eq, lt } from "drizzle-orm";
import { getD1, getDb } from "../db";
import { apiUsage, syncCache, xUsageEvents } from "../db/schema";
import { getEffectiveConfig } from "./runtime-settings";
import { parseUserXUsageLimits, xUsageWindow, type UserXUsageLimits } from "./usage-policy";
import type { XUsageAccounting, XUsageOutcome, XUsageReservation } from "./x-transport";

const safeLimit=(value:number,fallback:number)=>Number.isFinite(value)&&value>=0?Math.trunc(value):fallback;
const USER_USAGE_LIMITS_KEY="openx-user-usage-limits";

export async function getXUsageLimits() {
  const config=await getEffectiveConfig();
  const deploymentMaxResources=safeLimit(config.maxDailyResources,500),deploymentMaxWrites=safeLimit(config.maxDailyWrites,50);
  const stored=await readRetainedCache<UserXUsageLimits>(USER_USAGE_LIMITS_KEY);
  const override=parseUserXUsageLimits(stored?.data);
  return {
    maxResources:override?.maxResources??deploymentMaxResources,
    maxSyncResources:override?.maxSyncResources??11,
    maxWrites:override?.maxWrites??deploymentMaxWrites,
    deploymentMaxResources,
    deploymentMaxWrites,
    userConfigured:Boolean(override),
  };
}

export async function setXUsageLimits(input:UserXUsageLimits) {
  const limits=parseUserXUsageLimits(input);
  if(!limits)throw new Error("INVALID_USAGE_LIMITS");
  await writeCache(USER_USAGE_LIMITS_KEY,limits,2_000_000_000);
  return limits;
}

export async function reserveXUsage(input:XUsageReservation):Promise<XUsageReservation> {
  const {maxResources,maxWrites}=await getXUsageLimits();
  const reservedResources=input.kind==="read"?Math.max(0,Math.trunc(input.reservedResources)):0;
  const writes=input.kind==="write"?1:0;
  if(reservedResources>maxResources)throw new Error("DAILY_X_RESOURCE_LIMIT_REACHED");
  if(writes>maxWrites)throw new Error("DAILY_X_WRITE_LIMIT_REACHED");
  const day=xUsageWindow(input.occurredAt).day;
  const row=await getD1().prepare(`
    INSERT INTO api_usage (day,reads,requests,resources,reserved_resources,writes,updated_at)
    VALUES (?,0,1,0,?,?,?)
    ON CONFLICT(day) DO UPDATE SET
      requests=api_usage.requests+1,
      reserved_resources=api_usage.reserved_resources+excluded.reserved_resources,
      writes=api_usage.writes+excluded.writes,
      updated_at=excluded.updated_at
    WHERE api_usage.resources+api_usage.reserved_resources+excluded.reserved_resources<=?
      AND api_usage.writes+excluded.writes<=?
    RETURNING requests,resources,reserved_resources,writes
  `).bind(day,reservedResources,writes,input.occurredAt,maxResources,maxWrites).first();
  if(!row)throw new Error(input.kind==="write"?"DAILY_X_WRITE_LIMIT_REACHED":"DAILY_X_RESOURCE_LIMIT_REACHED");
  return {...input,reservedResources};
}

export async function completeXUsage(reservation:XUsageReservation,outcome:XUsageOutcome) {
  const day=xUsageWindow(reservation.occurredAt).day;
  const resources=reservation.kind==="read"?Math.max(0,Math.trunc(outcome.resources)):0;
  const updated=await getD1().prepare(`
    UPDATE api_usage
    SET reads=reads+?,resources=resources+?,reserved_resources=reserved_resources-?,updated_at=?
    WHERE day=? AND reserved_resources>=?
    RETURNING resources,reserved_resources
  `).bind(resources,resources,reservation.reservedResources,outcome.occurredAt,day,reservation.reservedResources).first();
  if(!updated)throw new Error("X_USAGE_RESERVATION_NOT_FOUND");
  await getDb().insert(xUsageEvents).values({
    id:crypto.randomUUID(),
    day,
    endpoint:reservation.endpoint.slice(0,80),
    kind:reservation.kind,
    requestCount:1,
    resourceCount:resources,
    writeCount:reservation.kind==="write"?1:0,
    status:outcome.status,
    rateLimit:outcome.rateLimit.limit??null,
    rateRemaining:outcome.rateLimit.remaining??null,
    rateResetAt:outcome.rateLimit.resetAt??null,
    occurredAt:outcome.occurredAt,
  });
}

export const xUsageAccounting:XUsageAccounting={reserve:reserveXUsage,complete:completeXUsage};

export async function getUsage(now=Date.now()) {
  const day=xUsageWindow(now).day;
  const limits=await getXUsageLimits();
  const [current,events]=await Promise.all([
    getDb().select().from(apiUsage).where(eq(apiUsage.day,day)).get(),
    getDb().select().from(xUsageEvents).where(eq(xUsageEvents.day,day)).orderBy(desc(xUsageEvents.occurredAt)).limit(50),
  ]);
  const {maxResources,maxSyncResources,maxWrites,deploymentMaxResources,deploymentMaxWrites,userConfigured}=limits;
  const resources=current?.resources??current?.reads??0,reservedResources=current?.reservedResources??0,writes=current?.writes??0;
  const remainingResources=Math.max(0,maxResources-resources-reservedResources),remainingWrites=Math.max(0,maxWrites-writes);
  return {
    requests:current?.requests??0,
    resources,
    reservedResources,
    writes,
    maxResources,
    maxSyncResources,
    maxWrites,
    deploymentMaxResources,
    deploymentMaxWrites,
    userConfigured,
    remainingResources,
    remainingWrites,
    warning:remainingResources<=Math.max(1,Math.floor(maxResources*.1))||remainingWrites<=Math.max(1,Math.floor(maxWrites*.1)),
    // Compatibility aliases for existing API clients; UI labels use resource units.
    reads:resources,
    maxReads:maxResources,
    events:events.map((event)=>({
      endpoint:event.endpoint,
      kind:event.kind,
      requestCount:event.requestCount,
      resourceCount:event.resourceCount,
      writeCount:event.writeCount,
      status:event.status,
      rateLimit:event.rateLimit,
      rateRemaining:event.rateRemaining,
      rateResetAt:event.rateResetAt,
      occurredAt:event.occurredAt,
    })),
  };
}

export async function resetDailyXUsage(now=Date.now()) {
  const day=xUsageWindow(now).day;
  const database=getD1();
  const status=await readSyncStatus();
  const statements=[
    database.prepare("DELETE FROM x_usage_events WHERE day=?").bind(day),
    database.prepare("DELETE FROM api_usage WHERE day=?").bind(day),
  ];
  if(status?.data.state==="budget_exhausted")statements.push(database.prepare("DELETE FROM sync_cache WHERE key=?").bind("x-growth-sync-status"));
  await database.batch(statements);
  return {day};
}

export async function readCache<T>(key:string):Promise<T | null> {
  const row = await getDb().select().from(syncCache).where(eq(syncCache.key,key)).get();
  if (!row) return null;
  if (row.expiresAt < Date.now()) { await getDb().delete(syncCache).where(eq(syncCache.key,key)); return null; }
  try { return JSON.parse(row.payload) as T; } catch { return null; }
}

export async function readRetainedCache<T>(key:string) {
  const row=await getDb().select().from(syncCache).where(eq(syncCache.key,key)).get();
  if(!row)return null;
  try{return {data:JSON.parse(row.payload) as T,updatedAt:row.updatedAt,expiresAt:row.expiresAt,freshness:row.expiresAt>Date.now()?"cached_fresh" as const:"cached_stale" as const};}catch{return null;}
}

export async function deleteExpiredCache() {
  await Promise.all([
    getD1().prepare("DELETE FROM sync_cache WHERE expires_at<=? AND key<>?").bind(Date.now(),"x-growth-sync").run(),
    getDb().delete(xUsageEvents).where(lt(xUsageEvents.occurredAt,Date.now()-90*86_400_000)),
  ]);
}
export async function deleteXCache() {
  await getD1().prepare("DELETE FROM sync_cache WHERE key = ? OR key = ? OR key = ? OR key LIKE ?")
    .bind("x-growth-sync","x-growth-sync-status","x-growth-sync-lock","x-growth-sync-idempotency:%").run();
}

export async function writeCache(key:string,payload:unknown,ttlSeconds:number) {
  const now = Date.now();
  await getDb().insert(syncCache).values({key,payload:JSON.stringify(payload),expiresAt:now+ttlSeconds*1000,updatedAt:now}).onConflictDoUpdate({target:syncCache.key,set:{payload:JSON.stringify(payload),expiresAt:now+ttlSeconds*1000,updatedAt:now}});
}

const SYNC_LOCK_KEY="x-growth-sync-lock";
const SYNC_STATUS_KEY="x-growth-sync-status";
const IDEMPOTENCY_PREFIX="x-growth-sync-idempotency:";

export type SyncTerminalRecord={status:number;payload:unknown;completedAt:number};

export async function claimSyncLease(operationId:string,leaseMs=120_000,now=Date.now()) {
  const payload=JSON.stringify({operationId,startedAt:now});
  const row=await getD1().prepare(`
    INSERT INTO sync_cache (key,payload,expires_at,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at,updated_at=excluded.updated_at
    WHERE sync_cache.expires_at<=?
    RETURNING payload
  `).bind(SYNC_LOCK_KEY,payload,now+leaseMs,now,now).first();
  return Boolean(row);
}

export async function activeSyncLease(now=Date.now()) {
  const row=await getDb().select().from(syncCache).where(eq(syncCache.key,SYNC_LOCK_KEY)).get();
  if(!row||row.expiresAt<=now)return null;
  try{return JSON.parse(row.payload) as {operationId:string;startedAt:number};}catch{return {operationId:"unknown",startedAt:row.updatedAt};}
}

export async function releaseSyncLease(operationId:string) {
  const row=await getDb().select().from(syncCache).where(eq(syncCache.key,SYNC_LOCK_KEY)).get();
  if(!row)return false;
  try{if((JSON.parse(row.payload) as {operationId?:string}).operationId!==operationId)return false;}catch{return false;}
  await getD1().prepare("DELETE FROM sync_cache WHERE key=? AND payload=?").bind(SYNC_LOCK_KEY,row.payload).run();
  return true;
}

type SyncStatusRecord={state:"in_progress"|"succeeded"|"failed"|"budget_exhausted";lastAttemptAt:number;lastSuccessfulAt?:number;lastErrorCode?:string|null;retryable?:boolean;activeMaxReadResources?:number;activeMaxRequests?:3|4};

export async function writeSyncStatus(payload:SyncStatusRecord,ttlSeconds=2_592_000) {
  await writeCache(SYNC_STATUS_KEY,payload,ttlSeconds);
}

export async function readSyncStatus() { return readRetainedCache<SyncStatusRecord>(SYNC_STATUS_KEY); }

export async function readIdempotentResult(key:string) { return readRetainedCache<SyncTerminalRecord>(`${IDEMPOTENCY_PREFIX}${key}`); }
export async function writeIdempotentResult(key:string,result:SyncTerminalRecord) { await writeCache(`${IDEMPOTENCY_PREFIX}${key}`,result,600); }
