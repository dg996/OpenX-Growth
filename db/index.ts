import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.ts";

declare global { var __OPENX_ENV__: Record<string,unknown> | undefined; }

export function getD1() {
  const database = globalThis.__OPENX_ENV__?.DB as D1Database | undefined;
  if (!database) throw new Error("Cloudflare D1 binding `DB` is unavailable. Configure the DB binding before using persistent features.");
  return database;
}

export function getDb() { return drizzle(getD1(),{schema}); }
