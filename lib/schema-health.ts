import { getD1 } from "../db/index.ts";

export const REQUIRED_SCHEMA_MIGRATION = "0003_rainy_juggernaut.sql";

export type SchemaHealthState = "ready" | "missing" | "outdated" | "unavailable";
export type SchemaHealth = { state: SchemaHealthState; requiredThrough: typeof REQUIRED_SCHEMA_MIGRATION };

export const REQUIRED_SCHEMA_PROBES = [
  "SELECT key, sealed_value, updated_at FROM secure_store LIMIT 0",
  "SELECT key, payload, expires_at, updated_at FROM sync_cache LIMIT 0",
  "SELECT day, requests, resources, reserved_resources, writes FROM api_usage LIMIT 0",
  "SELECT day, endpoint, resource_count, occurred_at FROM x_usage_events LIMIT 0",
  "SELECT account_id, recorded_at, followers FROM follower_snapshots LIMIT 0",
  "SELECT id, text, status, published_ids_json, publish_receipts_json, claim_token, claim_expires_at, delivery_state FROM posts LIMIT 0",
] as const;

export async function getSchemaHealth(): Promise<SchemaHealth> {
  let database: D1Database;
  try {
    database = getD1();
  } catch {
    return { state: "unavailable", requiredThrough: REQUIRED_SCHEMA_MIGRATION };
  }

  let passed = 0;
  for (const statement of REQUIRED_SCHEMA_PROBES) {
    try {
      await database.prepare(statement).first();
      passed += 1;
    } catch {
      // Driver details stay inside this bounded probe.
    }
  }
  return {
    state: passed === REQUIRED_SCHEMA_PROBES.length ? "ready" : passed === 0 ? "missing" : "outdated",
    requiredThrough: REQUIRED_SCHEMA_MIGRATION,
  };
}

export function schemaErrorCode(state: Exclude<SchemaHealthState, "ready">) {
  if (state === "missing") return "LOCAL_DATABASE_NOT_INITIALIZED" as const;
  if (state === "outdated") return "LOCAL_DATABASE_OUTDATED" as const;
  return "LOCAL_DATABASE_UNAVAILABLE" as const;
}
