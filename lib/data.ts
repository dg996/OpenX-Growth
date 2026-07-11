import { eq, lte } from "drizzle-orm";
import { getDb } from "../db";
import { apiUsage, syncCache } from "../db/schema";
import { appConfig } from "./config";

export async function consumeUsage(kind:"read"|"write",amount:number) {
  const db = getDb();
  const day = new Date().toISOString().slice(0,10);
  const existing = await db.select().from(apiUsage).where(eq(apiUsage.day,day)).get();
  const config = appConfig();
  const nextReads = (existing?.reads ?? 0)+(kind === "read" ? amount : 0);
  const nextWrites = (existing?.writes ?? 0)+(kind === "write" ? amount : 0);
  if (nextReads > config.maxDailyReads || nextWrites > config.maxDailyWrites) throw new Error("DAILY_API_LIMIT_REACHED");
  await db.insert(apiUsage).values({day,reads:nextReads,writes:nextWrites,updatedAt:Date.now()}).onConflictDoUpdate({target:apiUsage.day,set:{reads:nextReads,writes:nextWrites,updatedAt:Date.now()}});
  return {reads:nextReads,writes:nextWrites,maxReads:config.maxDailyReads,maxWrites:config.maxDailyWrites};
}

export async function getUsage() {
  const day = new Date().toISOString().slice(0,10);
  const current = await getDb().select().from(apiUsage).where(eq(apiUsage.day,day)).get();
  const config = appConfig();
  return {reads:current?.reads ?? 0,writes:current?.writes ?? 0,maxReads:config.maxDailyReads,maxWrites:config.maxDailyWrites};
}

export async function readCache<T>(key:string):Promise<T | null> {
  const row = await getDb().select().from(syncCache).where(eq(syncCache.key,key)).get();
  if (!row) return null;
  if (row.expiresAt < Date.now()) { await getDb().delete(syncCache).where(eq(syncCache.key,key)); return null; }
  try { return JSON.parse(row.payload) as T; } catch { return null; }
}

export async function deleteExpiredCache() { await getDb().delete(syncCache).where(lte(syncCache.expiresAt,Date.now())); }
export async function deleteXCache() { await getDb().delete(syncCache); }

export async function writeCache(key:string,payload:unknown,ttlSeconds:number) {
  const now = Date.now();
  await getDb().insert(syncCache).values({key,payload:JSON.stringify(payload),expiresAt:now+ttlSeconds*1000,updatedAt:now}).onConflictDoUpdate({target:syncCache.key,set:{payload:JSON.stringify(payload),expiresAt:now+ttlSeconds*1000,updatedAt:now}});
}
