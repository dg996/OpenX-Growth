import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { secureStore } from "../db/schema";
import { seal, unseal, type XSession } from "./security";

const SESSION_KEY = "x-session";
export async function storeXSession(session:XSession) {
  const sealedValue = await seal(session);
  await getDb().insert(secureStore).values({key:SESSION_KEY,sealedValue,updatedAt:Date.now()}).onConflictDoUpdate({target:secureStore.key,set:{sealedValue,updatedAt:Date.now()}});
}
export async function loadXSession() {
  const row = await getDb().select().from(secureStore).where(eq(secureStore.key,SESSION_KEY)).get();
  return unseal<XSession>(row?.sealedValue);
}
export async function deleteXSession() { await getDb().delete(secureStore).where(eq(secureStore.key,SESSION_KEY)); }
