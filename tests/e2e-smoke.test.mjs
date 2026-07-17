import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:5175";

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
  return { response, body };
}

test("demo instance exposes public status without login", async () => {
  const { response, body } = await api("/api/x/status");
  assert.equal(response.status, 200);
  assert.equal(body.demoMode, true);
  assert.equal(body.accessProtected, false);
  assert.equal(body.connected, false);
  assert.equal("xConfiguration" in body,false);
  assert.equal("aiConfiguration" in body,false);
});

test("dashboard HTML renders", async () => {
  const { response, body } = await api("/", { headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  assert.match(String(body), /OpenX Growth/i);
  assert.match(String(body), /DEMO DATA|Overview|Discover/i);
});

test("compliance endpoint reports demo posture", async () => {
  const { response, body } = await api("/api/compliance");
  assert.equal(response.status, 200);
  assert.equal(body.demoMode, true);
  assert.equal(body.accessProtected, false);
  assert.equal(body.checks.autonomousRepliesDisabled, true);
});

test("unconfigured demo exposes public reads", async () => {
  for (const path of ["/api/posts", "/api/analytics", "/api/data/export", "/api/feedback", "/api/security/csrf", "/api/x/sync"]) {
    const result = await api(path);
    assert.equal(result.response.status, 200, path);
  }
});

test("public demo never exposes stale local records",async()=>{
  const posts=await api("/api/posts");
  assert.deepEqual(posts.body.posts,[]);
  const feedback=await api("/api/feedback");
  assert.deepEqual(feedback.body.feedback,[]);
  const exported=await api("/api/data/export");
  assert.deepEqual(exported.body.posts,[]);
  assert.deepEqual(exported.body.feedback,[]);
  assert.deepEqual(exported.body.analytics,[]);
  const analytics=await api("/api/analytics");
  assert.equal(analytics.body.dataStatus,"insufficient_data");
  assert.deepEqual(analytics.body.raw.postSnapshots,[]);
  assert.deepEqual(analytics.body.followers.series,[]);
  assert.equal(analytics.body.usage.requests,0);
  assert.equal(analytics.body.usage.provenance.source,"demo");
  const status=await api("/api/x/status");
  assert.equal(status.body.connected,false);
});

test("unconfigured demo rejects every application mutation", async () => {
  const cases = [
    ["/api/posts", "POST"],
    ["/api/posts/00000000-0000-4000-8000-000000000000", "PATCH"],
    ["/api/posts/00000000-0000-4000-8000-000000000000", "DELETE"],
    ["/api/posts/00000000-0000-4000-8000-000000000000/publish", "POST"],
    ["/api/feedback", "POST"],
    ["/api/data/import", "POST"],
    ["/api/data/delete", "DELETE"],
    ["/api/ai/generate", "POST"],
    ["/api/x/reply", "POST"],
    ["/api/x/disconnect", "POST"],
    ["/api/x/sync", "POST"],
    ["/api/cron/publish", "POST"],
  ];
  for (const [path, method] of cases) {
    const result = await api(path, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" ? undefined : "{}",
    });
    assert.equal(result.response.status, 503, path);
    assert.equal(result.body.error, "INSTANCE_NOT_CONFIGURED", path);
  }
});
