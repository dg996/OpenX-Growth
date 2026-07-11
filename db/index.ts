import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

declare global { var __OPENX_ENV__: Record<string,unknown> | undefined; }

export function getDb() {
  const database = globalThis.__OPENX_ENV__?.DB as D1Database | undefined;
  if (!database) throw new Error("Cloudflare D1 binding `DB` is unavailable. Configure the DB binding before using persistent features.");
  return drizzle(database,{schema});
}
