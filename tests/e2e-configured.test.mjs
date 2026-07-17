import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:5176";
const accessToken = process.env.E2E_APP_ACCESS_TOKEN ?? "";
const apiToken = process.env.E2E_API_TOKEN ?? "";
const cronToken = process.env.E2E_CRON_TOKEN ?? "";
const fixtureNow = Number(process.env.E2E_ANALYTICS_FIXTURE_NOW ?? 0);

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.headers ?? {}),
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, body, headers: response.headers };
}

function cookieJar(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  return raw.map((entry) => entry.split(";")[0]).join("; ");
}

async function authenticatedSession() {
  assert.ok(accessToken,"E2E_APP_ACCESS_TOKEN is required");
  const login=await api("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:accessToken})});
  assert.equal(login.response.status,200);
  const authCookies=cookieJar(login.response);
  const csrf = await api("/api/security/csrf",{headers:{cookie:authCookies}});
  assert.equal(csrf.response.status, 200);
  return {
    token: csrf.body.token,
    cookies: [authCookies,cookieJar(csrf.response)].filter(Boolean).join("; "),
  };
}

test("protected routes reject missing, direct bearer, and tampered application auth", async () => {
  for (const path of ["/api/posts", "/api/analytics", "/api/data/export", "/api/feedback", "/api/x/status", "/api/security/csrf", "/api/compliance"]) {
    const anonymous = await api(path);
    assert.equal(anonymous.response.status, 401, path);
    const directBearer = await api(path, { headers: { authorization: `Bearer ${accessToken}` } });
    assert.equal(directBearer.response.status, 401, `${path} direct bearer`);
  }

  const login = await api("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: accessToken }) });
  const sealedCookie=cookieJar(login.response);
  const separator=sealedCookie.indexOf("=");
  const tamperAt=separator+1+Math.floor((sealedCookie.length-separator-1)/2);
  const cookie = `${sealedCookie.slice(0,tamperAt)}${sealedCookie[tamperAt]==="x"?"y":"x"}${sealedCookie.slice(tamperAt+1)}`;
  const tampered = await api("/api/posts", { headers: { cookie } });
  assert.equal(tampered.response.status, 401);
});

test("browser, API, and cron authorities stay separate", async () => {
  assert.ok(apiToken && cronToken);
  const apiRead = await api("/api/posts", { headers: { authorization: `Bearer ${apiToken}` } });
  assert.equal(apiRead.response.status, 200);
  const apiWrite = await api("/api/posts", {
    method: "POST",
    headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
    body: JSON.stringify({ text: "API authority draft" }),
  });
  assert.equal(apiWrite.response.status, 201, JSON.stringify(apiWrite.body));

  const apiOnBrowserOnly = await api("/api/x/status", { headers: { authorization: `Bearer ${apiToken}` } });
  assert.equal(apiOnBrowserOnly.response.status, 401);
  const cronOnApi = await api("/api/posts", { headers: { authorization: `Bearer ${cronToken}` } });
  assert.equal(cronOnApi.response.status, 401);
  const apiOnCron = await api("/api/cron/publish", { method: "POST", headers: { authorization: `Bearer ${apiToken}` } });
  assert.equal(apiOnCron.response.status, 401);
  const cron = await api("/api/cron/publish", { method: "POST", headers: { authorization: `Bearer ${cronToken}` } });
  assert.equal(cron.response.status, 200);

  const { cookies } = await authenticatedSession();
  const browserOnCron = await api("/api/cron/publish", { method: "POST", headers: { cookie: cookies } });
  assert.equal(browserOnCron.response.status, 401);
});

test("CSRF remains a second gate for browser mutations", async () => {
  assert.ok(accessToken);
  const login = await api("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: accessToken }) });
  const withoutCsrf = await api("/api/posts", {
    method: "POST",
    headers: { cookie: cookieJar(login.response), "content-type": "application/json" },
    body: JSON.stringify({ text: "must not persist" }),
  });
  assert.equal(withoutCsrf.response.status, 403);
  assert.equal(withoutCsrf.body.error, "INVALID_CSRF");
});

test("analytics API preserves snapshot provenance, range filtering, and sufficient-data recommendations", async () => {
  assert.ok(fixtureNow>0);
  const { cookies } = await authenticatedSession();
  const analytics = await api("/api/analytics?range=7D", { headers: { cookie: cookies } });
  assert.equal(analytics.response.status, 200);
  assert.equal(analytics.body.raw.postSnapshots.length, 8);
  assert.ok(analytics.body.raw.postSnapshots.every((row) => row.provenance.source === "live" && row.provenance.recordedAt === row.recordedAt));
  assert.deepEqual(analytics.body.followers.series.map((point) => point.followers.value), [120, 123]);
  assert.equal(analytics.body.followers.status, "ready");
  assert.equal(analytics.body.derived.totals.impressions.value, 40_400);
  assert.equal(analytics.body.derived.totals.impressions.provenance.source, "derived");
  assert.equal(analytics.body.postingTimes.status, "ready");
  assert.equal(analytics.body.postingTimes.suggestions[0].hour, 10);
  assert.ok(analytics.body.raw.postSnapshots.every((row) => row.recordedAt >= fixtureNow - 7*86_400_000));
});

test("configured instance can create posts and feedback signals", async () => {
  const { token, cookies } = await authenticatedSession();

  const post = await api("/api/posts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": token,
      cookie: cookies,
    },
    body: JSON.stringify({
      text: "E2E configured draft",
      topic: "Open source AI",
      hook: "E2E configured draft",
      evergreen: false,
    }),
  });
  assert.equal(post.response.status, 201, JSON.stringify(post.body));
  assert.equal(post.body.post.text, "E2E configured draft");

  const feedback = await api("/api/feedback", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": token,
      cookie: cookies,
    },
    body: JSON.stringify({
      targetType: "idea",
      targetId: "Open source AI",
      vote: 1,
      context: { topic: "Open source AI" },
    }),
  });
  assert.equal(feedback.response.status, 201);

  const posts = await api("/api/posts",{headers:{cookie:cookies}});
  assert.equal(posts.response.status, 200);
  assert.ok(posts.body.posts.some((row) => row.text === "E2E configured draft"));
});

test("configured instance exposes oauth start redirect to X", async () => {
  const {cookies}=await authenticatedSession();
  const { response, headers } = await api("/api/x/oauth/start", { redirect: "manual",headers:{cookie:cookies} });
  assert.ok([302, 307].includes(response.status), `expected redirect, got ${response.status}`);
  const location = headers.get("location") ?? "";
  assert.match(location, /^https:\/\/x\.com\/i\/oauth2\/authorize\?/);
  assert.match(location, /client_id=/);
  assert.match(location, /code_challenge=/);
  assert.match(location, /tweet\.read/);
});

test("configured instance blocks AI until provider and policy flags are set", async () => {
  const { token, cookies } = await authenticatedSession();
  const ai = await api("/api/ai/generate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": token,
      cookie: cookies,
    },
    body: JSON.stringify({ kind: "rewrite", prompt: "Make this sharper", context: "A valid fixture draft." }),
  });
  assert.equal(ai.response.status, 503);
  assert.equal(ai.body.error, "AI_NOT_CONFIGURED");
});

test("protected status reports sanitized current X and AI configuration", async () => {
  const {cookies}=await authenticatedSession();
  const status=await api("/api/x/status",{headers:{cookie:cookies}});
  assert.equal(status.response.status,200);
  assert.equal(status.body.xConfiguration.xClientIdConfigured,true);
  assert.equal(status.body.xConfiguration.sessionSecretConfigured,true);
  assert.equal(status.body.xConfiguration.appAccessTokenConfigured,true);
  assert.deepEqual(status.body.aiConfiguration,{
    provider:"OpenAI",
    model:"gpt-5-mini",
    apiKeyConfigured:false,
    contentApproved:false,
    repliesApproved:false,
  });
  const serialized=JSON.stringify(status.body);
  assert.doesNotMatch(serialized,/https:\/\/api\.openai\.com\/v1|e2e-app-access-token|e2e-session-secret/);
});

test("configured instance syncs only through the injected X fixture and persists follower provenance", async () => {
  const {cookies,token}=await authenticatedSession();
  const sync = await api("/api/x/sync?force=1",{headers:{cookie:cookies}});
  assert.equal(sync.response.status, 200,JSON.stringify(sync.body));
  assert.equal(sync.body.source,"live");
  assert.equal(sync.body.account.username,"fixture_owner");
  assert.equal(sync.body.account.followersCount,125);
  assert.ok(sync.body.ideas.length>0);
  assert.ok(sync.body.opportunities.length>0);
  assert.ok(sync.body.opportunities.every((row)=>row.id!=="feed-owner"));
  assert.ok(sync.body.opportunities.every((row)=>["live","estimate"].includes(row.reachProvenance.source)));
  assert.ok(sync.body.ideas.every((row)=>row.bars===undefined&&row.scoreProvenance.source==="derived"));
  assert.ok(sync.body.opportunities.every((row)=>row.algorithmVersion&&row.featureExplanation));
  const candidate=sync.body.opportunities.find((row)=>row.id==="feed-1");
  const negative=await api("/api/feedback",{method:"POST",headers:{cookie:cookies,"x-csrf-token":token,"content-type":"application/json"},body:JSON.stringify({targetType:"reply",targetId:candidate.id,vote:-1,context:candidate})});
  assert.equal(negative.response.status,201);
  const reranked=await api("/api/x/sync?force=1",{headers:{cookie:cookies}});
  assert.ok(reranked.body.opportunities.find((row)=>row.id==="feed-1").relevance<candidate.relevance);
  const analytics=await api("/api/analytics?range=7D",{headers:{cookie:cookies}});
  assert.equal(analytics.body.followers.series.at(-1).followers.value,125);
  assert.equal(analytics.body.followers.series.at(-1).followers.provenance.source,"live");
});

test("configured sync failures expose only an allowlisted retryable code", async () => {
  const {cookies}=await authenticatedSession();
  const sync=await api("/api/x/sync?force=1",{headers:{cookie:cookies,"x-openx-e2e-sync-status":"503"}});
  assert.equal(sync.response.status,502);
  assert.equal(sync.body.error,"X_API_503");
  assert.doesNotMatch(JSON.stringify(sync.body),/FIXTURE_SYNC_FAILURE|fixture-access-token/);
});

test("concurrent sync and write attempts cannot cross local resource or write caps", async () => {
  const {cookies,token}=await authenticatedSession();
  const syncAttempts=await Promise.all(Array.from({length:12},()=>api("/api/x/sync?force=1",{headers:{cookie:cookies}})));
  assert.ok(syncAttempts.some((result)=>result.response.status===429));
  const afterReads=await api("/api/analytics?range=7D",{headers:{cookie:cookies}});
  const readUsage=afterReads.body.usage;
  assert.equal(readUsage.maxResources,25);
  assert.ok(readUsage.resources+readUsage.reservedResources<=readUsage.maxResources);
  assert.ok(readUsage.events.length>0);
  assert.ok(readUsage.events.every((event)=>typeof event.endpoint==="string"&&Number.isInteger(event.status)&&Number.isInteger(event.occurredAt)));
  assert.ok(readUsage.events.some((event)=>event.requestCount===1&&event.resourceCount>=0&&event.writeCount===0));
  assert.ok(readUsage.events.some((event)=>event.rateRemaining===99));

  const writeAttempts=await Promise.all(Array.from({length:8},(_,index)=>api("/api/x/reply",{method:"POST",headers:{cookie:cookies,"x-csrf-token":token,"content-type":"application/json"},body:JSON.stringify({postId:`fixture-target-${index}`,text:`Fixture-only reply ${index}`})})));
  assert.equal(writeAttempts.filter((result)=>result.response.status===200).length,3);
  assert.equal(writeAttempts.filter((result)=>result.response.status===429).length,5);
  const afterWrites=await api("/api/analytics?range=7D",{headers:{cookie:cookies}});
  assert.equal(afterWrites.body.usage.writes,3);
  assert.equal(afterWrites.body.usage.remainingWrites,0);
  assert.ok(afterWrites.body.usage.events.some((event)=>event.endpoint==="posts.reply"&&event.writeCount===1));
});

test("cron publisher stays protected", async () => {
  const cron = await api("/api/cron/publish", { method: "POST" });
  assert.equal(cron.response.status, 401);
});

test("login failures reach a deterministic local rate limit", async () => {
  for(let attempt=0;attempt<5;attempt++){
    const result=await api("/api/auth/login",{method:"POST",headers:{"content-type":"application/json","x-forwarded-for":"192.0.2.10"},body:JSON.stringify({token:"invalid-e2e-token"})});
    assert.equal(result.response.status,401);
  }
  const blocked=await api("/api/auth/login",{method:"POST",headers:{"content-type":"application/json","x-forwarded-for":"192.0.2.10"},body:JSON.stringify({token:"invalid-e2e-token"})});
  assert.equal(blocked.response.status,429);
  assert.equal(blocked.body.error,"TOO_MANY_ATTEMPTS");
});
