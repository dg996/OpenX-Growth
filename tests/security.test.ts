import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

process.env.SESSION_SECRET="test-only-session-secret-with-more-than-32-characters";

test("sealed sessions do not expose plaintext",async()=>{
  const {safeEqual,seal,unseal}=await import("../lib/security.ts");
  const value={accessToken:"private-access-token",refreshToken:"private-refresh-token",clientId:"client",expiresAt:123};
  const encrypted=await seal(value);
  assert.equal(encrypted.includes(value.accessToken),false);
  assert.deepEqual(await unseal(encrypted),value);
  assert.equal(await unseal("tampered.value"),null);
  assert.equal(await safeEqual("same-value","same-value"),true);
  assert.equal(await safeEqual("same-value","other-value"),false);
});

test("X write routes require CSRF or dedicated bearer authorization",()=>{
  for(const path of ["app/api/x/reply/route.ts","app/api/posts/route.ts","app/api/posts/[id]/route.ts","app/api/posts/[id]/publish/route.ts","app/api/feedback/route.ts","app/api/data/import/route.ts","app/api/data/delete/route.ts","app/api/ai/generate/route.ts"]){
    const source=readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
    assert.match(source,/requireCsrf/);
    assert.match(source,/hasApiAuth|hasAppAccess/);
  }
});

test("cached X content has bounded retention and disconnect removal",()=>{
  const data=readFileSync(new URL("../lib/data.ts",import.meta.url),"utf8");
  const cron=readFileSync(new URL("../app/api/cron/publish/route.ts",import.meta.url),"utf8");
  const disconnect=readFileSync(new URL("../app/api/x/disconnect/route.ts",import.meta.url),"utf8");
  assert.match(data,/deleteExpiredCache/);
  assert.match(cron,/deleteExpiredCache/);
  assert.match(disconnect,/deleteXCache/);
});

test("AI publishing is gated behind explicit X approval flags",()=>{
  assert.match(readFileSync(new URL("../app/api/ai/generate/route.ts",import.meta.url),"utf8"),/xAiContentApproved/);
  assert.match(readFileSync(new URL("../app/api/x/reply/route.ts",import.meta.url),"utf8"),/xAiRepliesApproved/);
  assert.match(readFileSync(new URL("../lib/publisher.ts",import.meta.url),"utf8"),/xAiContentApproved/);
});

test("application sources contain no owner identity or email",()=>{
  const files=["app/page.tsx","lib/config.ts","lib/security.ts","db/schema.ts"];
  for(const file of files){const source=readFileSync(new URL(`../${file}`,import.meta.url),"utf8");assert.doesNotMatch(source,/PRIVATE_OWNER_NAME|owner@example\.com/i)}
});

test("environment files are ignored except the empty template",()=>{
  const ignore=readFileSync(new URL("../.gitignore",import.meta.url),"utf8");
  assert.match(ignore,/\.env\*/);
  assert.match(ignore,/!\.env\.example/);
});

test("scheduler publishing uses an atomic conditional claim",()=>{
  const source=readFileSync(new URL("../lib/publisher.ts",import.meta.url),"utf8");
  assert.match(source,/returning\(\)\.get\(\)/);
  assert.match(source,/\["draft","scheduled","failed"\]/);
  assert.doesNotMatch(source,/\["draft","scheduled","failed","publishing"\]/);
});

test("imports are strictly schema validated and cannot restore remote publish identities",()=>{
  const source=readFileSync(new URL("../app/api/data/import/route.ts",import.meta.url),"utf8");
  assert.match(source,/importSchema\.safeParse/);
  assert.match(source,/xPostId:null/);
  assert.match(source,/publishedIdsJson:null/);
});

test("instance-specific deployment identity is not tracked",()=>{
  const tracked=execFileSync("git",["ls-files"],{encoding:"utf8"}).split("\n");
  assert.equal(tracked.includes(".openai/hosting.json"),false);
  assert.equal(tracked.includes(".openai/hosting.example.json"),true);
});
