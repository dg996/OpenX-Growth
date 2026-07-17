import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  aiErrorGuidance,
  decideOnboarding,
  growthPlanEmptyGuidance,
  hasAiRewriteSource,
  hasLivePlanningData,
  isAiContentReady,
  isWorkspaceBlocking,
  resolveWorkspaceState,
  sanitizeSyncError,
  syncErrorGuidance,
} from "../lib/ui-state.ts";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("onboarding stays closed until connection status is authoritative", () => {
  assert.deepEqual(decideOnboarding({ statusLoaded: false, connected: false, dismissed: false }), {
    open: false,
    persistComplete: false,
  });
});

test("an existing X connection completes onboarding without opening it", () => {
  assert.deepEqual(decideOnboarding({ statusLoaded: true, connected: true, dismissed: false }), {
    open: false,
    persistComplete: true,
  });
});

test("dismissed onboarding remains closed while a first-time disconnected user sees it", () => {
  assert.deepEqual(decideOnboarding({ statusLoaded: true, connected: false, dismissed: true }), {
    open: false,
    persistComplete: false,
  });
  assert.deepEqual(decideOnboarding({ statusLoaded: true, connected: false, dismissed: false }), {
    open: true,
    persistComplete: false,
  });
});

test("both dismiss controls persist onboarding while Settings can reopen it manually", () => {
  const setupGuide = page.slice(page.indexOf("function SetupGuide"), page.indexOf("export default function HomePage"));
  assert.match(setupGuide, /aria-label="Close setup"><X size=\{18\}\/><\/button>/);
  assert.match(setupGuide, /className="ghost-btn" onClick=\{onClose\}>I&apos;ll do this later/);
  assert.match(page, /SetupGuide onClose=\{dismissOnboarding\}/);
  assert.match(page, /onOpenGuide=\{\(\) => setSetupGuide\(true\)\}/);
});

test("workspace state is explicit across demo, connection, sync, error, and live cases", () => {
  const demo = { configured: false, demoMode: true, connected: false };
  const disconnected = { configured: true, demoMode: false, connected: false };
  const connected = { configured: true, demoMode: false, connected: true };

  assert.equal(resolveWorkspaceState({ status: null, syncing: false, syncError: "", lastSync: undefined, hasLiveData: false }), "loading");
  assert.equal(resolveWorkspaceState({ status: demo, syncing: false, syncError: "", lastSync: undefined, hasLiveData: false }), "unconfigured-demo");
  assert.equal(resolveWorkspaceState({ status: disconnected, syncing: false, syncError: "", lastSync: undefined, hasLiveData: false }), "configured-disconnected");
  assert.equal(resolveWorkspaceState({ status: connected, syncing: true, syncError: "", lastSync: undefined, hasLiveData: false }), "connected-syncing");
  assert.equal(resolveWorkspaceState({ status: connected, syncing: true, syncError: "", lastSync: undefined, hasLiveData: true }), "live-refreshing");
  assert.equal(resolveWorkspaceState({ status: connected, syncing: false, syncError: "X_API_503", lastSync: undefined, hasLiveData: false }), "connected-sync-error");
  assert.equal(resolveWorkspaceState({ status: connected, syncing: false, syncError: "X_API_503", lastSync: undefined, hasLiveData: true }), "live-sync-error");
  assert.equal(resolveWorkspaceState({ status: connected, syncing: false, syncError: "", lastSync: "2026-07-13T10:00:00.000Z", hasLiveData: false }), "connected-insufficient");
  assert.equal(resolveWorkspaceState({ status: connected, syncing: false, syncError: "", lastSync: undefined, hasLiveData: true }), "live");
  assert.equal(resolveWorkspaceState({ status: connected, syncing: false, syncError: "", lastSync: "2026-07-13T10:00:00.000Z", hasLiveData: true }), "live");
});

test("live planning evidence excludes account-only state and preserves verified data through refreshes", () => {
  const connected = { configured: true, demoMode: false, connected: true };
  const accountOnly=hasLivePlanningData({hasAccountProfile:true,ideaCount:0,replyOpportunityCount:0,analyticsStatus:"insufficient_data"});
  assert.equal(accountOnly,false);
  assert.equal(resolveWorkspaceState({status:connected,syncing:true,syncError:"",hasLiveData:accountOnly}),"connected-syncing");
  assert.equal(resolveWorkspaceState({status:connected,syncing:false,syncError:"",hasLiveData:accountOnly}),"connected-insufficient");

  const withIdeas=hasLivePlanningData({hasAccountProfile:true,ideaCount:1,replyOpportunityCount:0,analyticsStatus:"insufficient_data"});
  const withReplies=hasLivePlanningData({hasAccountProfile:true,ideaCount:0,replyOpportunityCount:1,analyticsStatus:"insufficient_data"});
  const withAnalytics=hasLivePlanningData({hasAccountProfile:true,ideaCount:0,replyOpportunityCount:0,analyticsStatus:"available"});
  assert.equal(withIdeas,true);
  assert.equal(withReplies,true);
  assert.equal(withAnalytics,true);
  assert.equal(resolveWorkspaceState({status:connected,syncing:true,syncError:"",hasLiveData:withIdeas}),"live-refreshing");
  assert.equal(resolveWorkspaceState({status:connected,syncing:false,syncError:"X_API_503",hasLiveData:withReplies}),"live-sync-error");
  assert.equal(resolveWorkspaceState({status:connected,syncing:false,syncError:"",hasLiveData:withAnalytics}),"live");
});

test("connected empty-plan guidance routes to Discover while preserving partial actions", () => {
  const content=growthPlanEmptyGuidance("content");
  const replies=growthPlanEmptyGuidance("replies");
  assert.match(content.body,/Discover.*read-only sync/i);
  assert.match(content.body,/reply opportunities stay available/i);
  assert.match(replies.body,/Discover.*read-only sync/i);
  assert.match(replies.body,/content recommendation stays available/i);
});

test("AI content tools require both provider configuration and content approval", () => {
  assert.equal(isAiContentReady({aiConfigured:false,aiContentApproved:false}),false);
  assert.equal(isAiContentReady({aiConfigured:true,aiContentApproved:false}),false);
  assert.equal(isAiContentReady({aiConfigured:false,aiContentApproved:true}),false);
  assert.equal(isAiContentReady({aiConfigured:true,aiContentApproved:true}),true);
});

test("AI rewrite source requires at least one non-whitespace draft part", () => {
  assert.equal(hasAiRewriteSource([]),false);
  assert.equal(hasAiRewriteSource(["", " \n\t "]),false);
  assert.equal(hasAiRewriteSource(["", "Draft text"]),true);
});

test("only loading and disconnected states block local workspace features", () => {
  assert.equal(isWorkspaceBlocking("loading"), true);
  assert.equal(isWorkspaceBlocking("configured-disconnected"), true);
  for (const state of ["unconfigured-demo", "connected-syncing", "connected-sync-error", "connected-insufficient", "live-refreshing", "live-sync-error", "live"] as const) {
    assert.equal(isWorkspaceBlocking(state), false, state);
  }
});

test("resource exhaustion explains the local cap without encouraging a wasteful retry", () => {
  const budget = syncErrorGuidance("DAILY_X_RESOURCE_LIMIT_REACHED");
  assert.equal(budget.retryable, false);
  assert.match(budget.body, /MAX_DAILY_X_RESOURCES/);
  assert.match(budget.body, /existing verified data remains available/i);

  const provider = syncErrorGuidance("X_API_503");
  assert.equal(provider.retryable, true);
  assert.match(provider.body, /X_API_503/);
});

test("sync errors are reduced to the public operational allowlist", () => {
  for (const code of ["X_API_503", "X_API_503_429", "DAILY_X_RESOURCE_LIMIT_REACHED", "X_RECONNECT_REQUIRED", "SYNC_FAILED"]) {
    assert.equal(sanitizeSyncError(code), code);
  }
  assert.equal(sanitizeSyncError("provider body with private details"), "SYNC_FAILED");
  assert.equal(sanitizeSyncError(undefined), "SYNC_FAILED");
});

test("AI failures become friendly guidance without exposing provider details", () => {
  const source=aiErrorGuidance("AI_SOURCE_REQUIRED");
  assert.equal(source.openSettings,false);
  assert.equal(source.message,"Write or paste the text you want to rewrite first.");

  const settings=aiErrorGuidance("AI_NOT_CONFIGURED");
  assert.equal(settings.openSettings,true);
  assert.match(settings.message,/settings/i);

  const timeout=aiErrorGuidance("AI_PROVIDER_TIMEOUT");
  assert.equal(timeout.openSettings,false);
  assert.match(timeout.message,/too long|try again/i);

  const provider=aiErrorGuidance("AI_PROVIDER_429_PRIVATE_BODY");
  assert.equal(provider.openSettings,false);
  assert.doesNotMatch(provider.message,/429|PRIVATE_BODY|AI_PROVIDER/);
});
