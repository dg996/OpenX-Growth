import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalOriginStatus, safeOriginDiagnostic } from "../lib/canonical-origin.ts";
import { REQUIRED_SCHEMA_MIGRATION, REQUIRED_SCHEMA_PROBES, schemaErrorCode } from "../lib/schema-health.ts";

test("canonical origin comparison is exact and rejects unsafe APP_URL shapes",()=>{
  assert.equal(canonicalOriginStatus("http://127.0.0.1:3000","http://127.0.0.1:3000").currentMatchesCanonical,true);
  for(const current of ["http://localhost:3000","https://127.0.0.1:3000","http://127.0.0.1:3001"])assert.equal(canonicalOriginStatus("http://127.0.0.1:3000",current).currentMatchesCanonical,false);
  for(const configured of ["not-a-url","ftp://example.com","https://user@example.com","https://example.com/path","https://example.com?x=1","https://example.com#x"])assert.equal(canonicalOriginStatus(configured,"https://example.com").valid,false);
});

test("origin diagnostics expose loopback only and redact deployment hosts",()=>{
  assert.equal(safeOriginDiagnostic("http://localhost:3000/path"),"http://localhost:3000");
  assert.equal(safeOriginDiagnostic("https://private.example/path"),"https://[non-loopback]");
  assert.equal(safeOriginDiagnostic("not-a-url"),"[invalid]");
});

test("schema health manifest covers the current required D1 surfaces",()=>{
  assert.equal(REQUIRED_SCHEMA_MIGRATION,"0003_rainy_juggernaut.sql");
  for(const name of ["secure_store","sync_cache","api_usage","x_usage_events","follower_snapshots","posts"])assert.ok(REQUIRED_SCHEMA_PROBES.some((probe)=>probe.includes(name)),name);
  assert.equal(schemaErrorCode("missing"),"LOCAL_DATABASE_NOT_INITIALIZED");
  assert.equal(schemaErrorCode("outdated"),"LOCAL_DATABASE_OUTDATED");
  assert.equal(schemaErrorCode("unavailable"),"LOCAL_DATABASE_UNAVAILABLE");
});

test("render and cache reads cannot invoke explicit X or AI operations",()=>{
  const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
  const bootstrap=page.slice(page.indexOf("useEffect(() => {\n    void (async()=>"),page.indexOf("const loadPosts="));
  assert.match(bootstrap,/fetchXCache\(\)/);
  assert.doesNotMatch(bootstrap,/postXSync|requestAiGeneration/);
  const syncRoute=readFileSync(new URL("../app/api/x/sync/route.ts",import.meta.url),"utf8");
  const getHandler=syncRoute.slice(syncRoute.indexOf("export async function GET"),syncRoute.indexOf("async function strictEmptyBody"));
  assert.match(getHandler,/readRetainedCache/);
  assert.doesNotMatch(getHandler,/getXTransport|refreshXAccessToken|writeCache|reserveXUsage/);
});

test("limits live inside Settings and are not duplicated in the primary sidebar",()=>{
  const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(page,/"Credits & limits" as View/);
  assert.match(page,/\{id:"limits",label:"Limits"/);
  assert.match(page,/selected==="limits"/);
  assert.match(page,/openSettings\("limits"\)/);
});

test("explicit sync is mutation-authorized, idempotent, leased, and preflighted before transport",()=>{
  const source=readFileSync(new URL("../app/api/x/sync/route.ts",import.meta.url),"utf8");
  assert.match(source,/authorizeBrowserOrApiMutation/);
  assert.match(source,/idempotency-key/);
  assert.match(source,/claimSyncLease/);
  assert.ok(source.indexOf("syncResourcePlan(usageBefore.remainingResources")<source.indexOf("const transport=getXTransport()"));
});

test("local usage controls are CSRF-protected, leased, and make no provider call",()=>{
  const source=readFileSync(new URL("../app/api/x/status/route.ts",import.meta.url),"utf8");
  const getHandler=source.slice(source.indexOf("export async function GET"),source.indexOf("export async function POST"));
  const handler=source.slice(source.indexOf("export async function POST"));
  assert.match(getHandler,/authorizeBrowserOrApiRead/);
  assert.doesNotMatch(getHandler,/authorizeBrowserRead/);
  assert.match(handler,/authorizeBrowserMutation/);
  assert.doesNotMatch(handler,/authorizeBrowserOrApiMutation/);
  assert.match(handler,/claimSyncLease/);
  assert.match(handler,/resetDailyXUsage/);
  assert.match(handler,/setXUsageLimits/);
  assert.match(handler,/parseUserXUsageLimits/);
  assert.doesNotMatch(handler,/getXTransport|refreshXAccessToken|requestAiGeneration/);
});
