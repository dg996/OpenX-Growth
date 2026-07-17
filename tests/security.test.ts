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

test("demo mode allows browsing without access token",async()=>{
  delete process.env.APP_ACCESS_TOKEN;
  process.env.X_CLIENT_ID="";
  const {hasAppAccess}=await import("../lib/security.ts");
  const request={headers:{get:()=>null},cookies:{get:()=>undefined}} as unknown as import("next/server").NextRequest;
  assert.equal(await hasAppAccess(request),true);
});

test("cached X content has bounded retention and disconnect removal",()=>{
  const data=readFileSync(new URL("../lib/data.ts",import.meta.url),"utf8");
  const cron=readFileSync(new URL("../app/api/cron/publish/route.ts",import.meta.url),"utf8");
  const disconnect=readFileSync(new URL("../app/api/x/disconnect/route.ts",import.meta.url),"utf8");
  assert.match(data,/deleteExpiredCache/);
  assert.match(cron,/deleteExpiredCache/);
  assert.match(disconnect,/deleteXCache/);
});

test("full local deletion includes publishing recovery events",()=>{
  const source=readFileSync(new URL("../app/api/data/delete/route.ts",import.meta.url),"utf8");
  assert.match(source,/publishEvents/);
  assert.match(source,/delete\(publishEvents\)/);
});

test("AI publishing is gated behind explicit X approval flags",()=>{
  assert.match(readFileSync(new URL("../app/api/ai/generate/route.ts",import.meta.url),"utf8"),/xAiContentApproved/);
  assert.match(readFileSync(new URL("../app/api/x/reply/route.ts",import.meta.url),"utf8"),/xAiRepliesApproved/);
  assert.match(readFileSync(new URL("../lib/publisher.ts",import.meta.url),"utf8"),/xAiContentApproved/);
});

test("reply failures do not echo transport errors or provider bodies",()=>{
  const source=readFileSync(new URL("../app/api/x/reply/route.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/error instanceof Error\?error\.message/);
  assert.match(source,/xResponse\.ok\?\(xResponse\.data\?\?/);
  assert.doesNotMatch(source,/NextResponse\.json\(xResponse\.data\?\?/);
});

test("sync failures expose only allowlisted operational codes",()=>{
  const source=readFileSync(new URL("../app/api/x/sync/route.ts",import.meta.url),"utf8");
  assert.match(source,/const PUBLIC_ERROR=/);
  assert.match(source,/function safeCode/);
  assert.doesNotMatch(source,/const message=error instanceof Error \? error\.message/);
  assert.doesNotMatch(source,/response\.json\(\).*error/);
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
  assert.match(source,/preflight\(claimed\)/);
});

test("imports are strictly schema validated and cannot restore remote publish identities",()=>{
  const source=readFileSync(new URL("../app/api/data/import/route.ts",import.meta.url),"utf8");
  assert.match(source,/importPayloadSchema\(Date\.now\(\)\)\.safeParse/);
  assert.match(source,/xPostId:null/);
  assert.match(source,/publishedIdsJson:null/);
});

test("instance-specific deployment identity is not tracked",()=>{
  const tracked=execFileSync("git",["ls-files"],{encoding:"utf8"}).split("\n");
  assert.equal(tracked.includes(".openai/hosting.json"),false);
  assert.equal(tracked.includes(".openai/hosting.example.json"),true);
});

test("the hermetic HTTP suite is part of the release and CI gates",()=>{
  const packageJson=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8")) as {scripts:Record<string,string>};
  const ci=readFileSync(new URL("../.github/workflows/ci.yml",import.meta.url),"utf8");
  assert.match(packageJson.scripts["release:check"],/test:e2e/);
  assert.match(ci,/npm run release:check/);
});

test("release build disables local env files and privacy audit scans untracked work",()=>{
  const build=readFileSync(new URL("../scripts/build-verified.sh",import.meta.url),"utf8");
  const vite=readFileSync(new URL("../vite.config.ts",import.meta.url),"utf8");
  const privacy=readFileSync(new URL("../scripts/privacy-audit.mjs",import.meta.url),"utf8");
  assert.match(build,/OPENX_DISABLE_ENV_FILES=1/);
  assert.match(build,/CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false/);
  assert.match(vite,/OPENX_DISABLE_ENV_FILES/);
  assert.match(privacy,/--others/);
  assert.match(privacy,/--exclude-standard/);
});

test("Next resolves a fixed PostCSS without force or a new direct dependency",()=>{
  const packageJson=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8")) as {dependencies:Record<string,string>;overrides?:Record<string,unknown>};
  assert.equal("postcss" in packageJson.dependencies,false);
  assert.deepEqual(packageJson.overrides?.next,{postcss:"8.5.19"});
});

test("AI provider labels recognize only public OpenAI and OpenRouter hosts",async()=>{
  const {aiProviderLabel}=await import("../lib/config.ts");
  assert.equal(aiProviderLabel("https://api.openrouter.ai/v1"),"OpenRouter");
  assert.equal(aiProviderLabel("https://api.openai.com/v1"),"OpenAI");
  assert.equal(aiProviderLabel("https://api.openai.com.evil.example/v1"),"Custom OpenAI-compatible");
  assert.equal(aiProviderLabel("https://private-provider.example/v1"),"Custom OpenAI-compatible");
  assert.equal(aiProviderLabel("not a url"),"Custom OpenAI-compatible");
});

test("protected runtime configuration serializes labels and booleans without secret values",async()=>{
  process.env.X_CLIENT_ID="fixture-client-id-secret";
  process.env.X_CLIENT_SECRET="fixture-client-secret";
  process.env.SESSION_SECRET="fixture-session-secret-with-more-than-thirty-two-characters";
  process.env.APP_ACCESS_TOKEN="fixture-app-access-secret";
  process.env.APP_URL="https://fixture-instance.example";
  process.env.AI_BASE_URL="https://openrouter.ai/api/v1";
  process.env.AI_API_KEY="fixture-ai-key-secret";
  process.env.AI_MODEL="openai/gpt-5.6-luna";
  process.env.X_AI_CONTENT_APPROVED="true";
  process.env.X_AI_REPLIES_APPROVED="false";
  const {protectedConfigSummary}=await import("../lib/config.ts");
  const serialized=JSON.stringify(protectedConfigSummary());
  assert.deepEqual(protectedConfigSummary().aiConfiguration,{
    provider:"OpenRouter",
    model:"openai/gpt-5.6-luna",
    apiKeyConfigured:true,
    contentApproved:true,
    repliesApproved:false,
    state:"ready",
  });
  for(const secret of [process.env.X_CLIENT_ID,process.env.X_CLIENT_SECRET,process.env.SESSION_SECRET,process.env.APP_ACCESS_TOKEN,process.env.AI_BASE_URL,process.env.AI_API_KEY])assert.ok(secret&&!serialized.includes(secret));
});
