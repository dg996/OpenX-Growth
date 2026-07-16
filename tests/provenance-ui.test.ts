import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page=readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
const growth=readFileSync(new URL("../lib/x-growth.ts",import.meta.url),"utf8");

test("live analytics and follower charts are data-driven with explicit sparse states", () => {
  const analyticsView=page.slice(page.indexOf("function AnalyticsView"),page.indexOf("function SettingsView"));
  assert.match(analyticsView,/DataSeriesChart label="Impressions from X snapshots"/);
  assert.match(page,/DataSeriesChart label="Follower snapshots"/);
  assert.match(page,/Insufficient data/);
  assert.doesNotMatch(analyticsView,/DemoGrowthChart/);
});

test("live discovery removes synthetic microbars and exposes metric provenance", () => {
  assert.doesNotMatch(growth,/Array\.from\(\{length:13\}/);
  assert.match(page,/dataSource==="demo"&&signal\.bars/);
  assert.match(page,/ProvenanceText provenance=\{signal\.scoreProvenance\}/);
});

test("posting-time UI never invents alternating suggested hours", () => {
  assert.doesNotMatch(page,/index%2\?"17:30":"10:00"/);
  assert.match(page,/postingTimes\.sampleSize/);
  assert.match(page,/Insufficient data for posting-time recommendations/);
});

test("configured workspaces cannot fall back to demo fixtures or quantities", () => {
  assert.match(page,/setContent\(status\?\.demoMode\?initialContent:/);
  assert.match(page,/if\(status\.demoMode\)\{setOpportunityData\(opportunities\);setSignalData\(signals\)\}/);
  assert.match(page,/:dataSource==="demo"\?metricData:\[\]/);
  assert.doesNotMatch(page,/setDataSource/);
  assert.match(page,/WorkspaceStatePanel state=\{workspaceState\}/);
  assert.doesNotMatch(page,/dataSource === "live" && account \?/);
  assert.match(page,/dataSource === "live" \? <>/);
});

test("sync failures remain visible without hiding stored content and analytics", () => {
  assert.match(page,/isWorkspaceBlocking\(workspaceState\)/);
  assert.match(page,/WorkspaceSyncNotice state=\{workspaceState\}/);
  assert.match(page,/syncErrorGuidance\(error\)/);
});

test("stored analytics enter UI state before the live sync can fail", () => {
  const bootstrap=page.slice(page.indexOf("const [csrfResponse,postsResponse,analyticsPayload]"),page.indexOf("const loadPosts="));
  const storeAnalytics=bootstrap.indexOf("if(analyticsPayload)setAnalytics(analyticsPayload)");
  const startLiveSync=bootstrap.indexOf("if(status.connected)");
  assert.ok(storeAnalytics>=0);
  assert.ok(storeAnalytics<startLiveSync);
});

test("initial sync errors are surfaced with retry and sync completion uses lastSync", () => {
  assert.match(page,/catch\(error\)\{setSyncError\(sanitizeSyncError/);
  assert.match(page,/onRetry=\{\(\)=>void syncFromX\(true\)\}/);
  assert.match(page,/synced=\{Boolean\(lastSync\)\}/);
  assert.match(page,/className=\{synced\?"done":""\}>Discover → Sync from X/);
});

test("Settings separates authoritative runtime state from a collapsed setup reference", () => {
  const settings=page.slice(page.indexOf("function SettingsView"),page.indexOf("function ConfigurationLine"));
  const currentSummary=settings.slice(0,settings.indexOf("setup-reference-toggle"));
  const setupReference=settings.slice(settings.indexOf("setup-reference-toggle"));
  assert.match(settings,/CURRENT CONFIGURATION/);
  assert.match(settings,/Provider/);
  assert.match(settings,/Model/);
  assert.match(settings,/API key/);
  assert.match(settings,/AI content/);
  assert.match(settings,/AI replies/);
  assert.match(settings,/aria-expanded=\{setupReferenceOpen\}/);
  assert.match(settings,/SETUP REFERENCE/);
  assert.match(page,/Schema: \{required \? "required" : "optional"\}/);
  assert.doesNotMatch(currentSummary,/AI_MODEL=gpt-4o-mini|AI_BASE_URL=https:\/\/api\.openai\.com/);
  assert.match(setupReference,/AI_MODEL=gpt-4o-mini/);
});

test("overview growth plan uses loaded discovery data and user-initiated AI only", () => {
  const plan=page.slice(page.indexOf("function TodaysGrowthPlan"),page.indexOf("function Progress"));
  assert.match(page,/ideas=\{signalData\}/);
  assert.match(page,/opportunities=\{opportunityData\}/);
  assert.match(plan,/buildGrowthPlan\(ideas,opportunities\)/);
  assert.match(plan,/inFlight=useRef\(false\)/);
  assert.match(plan,/Create draft/);
  assert.match(plan,/Generate with AI/);
  assert.match(plan,/kind:selectedFormat/);
  assert.match(plan,/buildGrowthPlanDraftSeed\(plan\.content!\)/);
  assert.match(plan,/Connect X/);
  assert.match(plan,/growthPlanEmptyGuidance\("content"\)/);
  assert.match(plan,/growthPlanEmptyGuidance\("replies"\)/);
  assert.match(plan,/onClick=\{onDiscover\}>Open Discover/);
  assert.doesNotMatch(plan,/kind:\"draft\"/);
});

test("Composer AI controls use the shared readiness gate and cannot request AI while unavailable", () => {
  const composer=page.slice(page.indexOf("function Composer"),page.indexOf("function ReplyComposer"));
  assert.match(composer,/if\(!aiReady\|\|busy\)return/);
  assert.match(composer,/\{aiReady&&<div className="ai-tools">/);
  assert.match(page,/aiReady=\{aiReady\}/);
  assert.match(page,/const aiReady=isAiContentReady\(runtimeConfig\)/);
});
