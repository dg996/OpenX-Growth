import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { secureStore } from "../db/schema";
import { seal, unseal, type XSession } from "./security";

const SESSION_KEY = "x-session";
const HEALTH_KEY = "x-session-health";
export type StoredAuthorizationHealth={state:"connected"|"disconnected"|"reconnect_required";lastVerifiedAt:number;lastVerifiedAccountId?:string};
export async function storeXSession(session:XSession) {
  const sealedValue = await seal(session);
  await getDb().insert(secureStore).values({key:SESSION_KEY,sealedValue,updatedAt:Date.now()}).onConflictDoUpdate({target:secureStore.key,set:{sealedValue,updatedAt:Date.now()}});
}
export async function loadXSession() {
  const row = await getDb().select().from(secureStore).where(eq(secureStore.key,SESSION_KEY)).get();
  return unseal<XSession>(row?.sealedValue);
}
export async function deleteXSession() { await getDb().delete(secureStore).where(eq(secureStore.key,SESSION_KEY)); }

export async function loadAuthorizationHealth() {
  const row=await getDb().select().from(secureStore).where(eq(secureStore.key,HEALTH_KEY)).get();
  return unseal<StoredAuthorizationHealth>(row?.sealedValue);
}

export async function storeAuthorizationHealth(health:StoredAuthorizationHealth) {
  const sealedValue=await seal(health),updatedAt=Date.now();
  await getDb().insert(secureStore).values({key:HEALTH_KEY,sealedValue,updatedAt}).onConflictDoUpdate({target:secureStore.key,set:{sealedValue,updatedAt}});
}

export async function markAuthorizationConnected(accountId?:string) {
  const previous=await loadAuthorizationHealth();
  await storeAuthorizationHealth({state:"connected",lastVerifiedAt:Date.now(),lastVerifiedAccountId:accountId??previous?.lastVerifiedAccountId});
}

export async function markReconnectRequired() {
  const previous=await loadAuthorizationHealth();
  await storeAuthorizationHealth({state:"reconnect_required",lastVerifiedAt:previous?.lastVerifiedAt??Date.now(),lastVerifiedAccountId:previous?.lastVerifiedAccountId});
}

export async function markAuthorizationDisconnected() {
  const previous=await loadAuthorizationHealth();
  await storeAuthorizationHealth({state:"disconnected",lastVerifiedAt:previous?.lastVerifiedAt??Date.now(),lastVerifiedAccountId:previous?.lastVerifiedAccountId});
}

export async function deleteAuthorizationHealth() { await getDb().delete(secureStore).where(eq(secureStore.key,HEALTH_KEY)); }

export async function resolveStoredAuthorization(cookieSession:XSession|null,now=Date.now()) {
  const [health,storedSession]=await Promise.all([loadAuthorizationHealth(),loadXSession()]);
  if(health?.state==="disconnected")return {state:"disconnected" as const,session:null,lastVerifiedAt:health.lastVerifiedAt,lastVerifiedAccountId:health.lastVerifiedAccountId};
  if(health?.state==="reconnect_required")return {state:"reconnect_required" as const,session:null,lastVerifiedAt:health.lastVerifiedAt,lastVerifiedAccountId:health.lastVerifiedAccountId};
  const session=storedSession??cookieSession;
  if(!session)return {state:"disconnected" as const,session:null,lastVerifiedAt:health?.lastVerifiedAt,lastVerifiedAccountId:health?.lastVerifiedAccountId};
  if(session.expiresAt>now)return {state:"connected" as const,session,lastVerifiedAt:health?.lastVerifiedAt??now,lastVerifiedAccountId:health?.lastVerifiedAccountId};
  if(session.refreshToken)return {state:"authorization_check_required" as const,session,lastVerifiedAt:health?.lastVerifiedAt,lastVerifiedAccountId:health?.lastVerifiedAccountId};
  return {state:"reconnect_required" as const,session,lastVerifiedAt:health?.lastVerifiedAt,lastVerifiedAccountId:health?.lastVerifiedAccountId};
}
