import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  decideOnboarding,
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
