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
  assert.match(page,/setContent\(status\.demoMode\?initialContent:/);
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

test("the local safety cap is visibly distinct from paid X Developer Credits", () => {
  const overview=page.slice(page.indexOf('{view === "Overview"'),page.indexOf('{view === "Discover"'));
  const credits=page.slice(page.indexOf("function CreditsLimitsView"),page.indexOf("function AnalyticsView"));
  assert.match(page,/OpenX daily safety limit reached/);
  assert.match(page,/separate from your paid X Developer Credits/);
  assert.match(page,/Sync paused — local limit reached/);
  assert.match(page,/No additional X API request will be sent while paused/);
  assert.match(page,/resets automatically every day/);
  assert.match(page,/Credits & limits/);
  assert.match(credits,/Reset today&apos;s OpenX counters/);
  assert.match(credits,/Save limits/);
  assert.match(credits,/X Developer Credits/);
  assert.match(credits,/AI provider/);
  assert.match(credits,/Balance not imported/);
  assert.doesNotMatch(overview,/Reset today|resetLocalUsage/);
  assert.match(page,/OpenX daily safety cap/);
  assert.doesNotMatch(page,/label:"X resources"/);
});

test("credit and limit messages lead to the dedicated management page",()=>{
  assert.match(page,/onCredits:\(\)=>void/);
  assert.match(page,/Open Credits &amp; limits/);
  assert.match(page,/Review limits and credits/);
  assert.match(page,/changeView\("Credits & limits"\)/);
});

test("stored analytics and cache enter UI state without an automatic live sync", () => {
  const bootstrap=page.slice(page.indexOf("const [csrfResponse,postsResponse,analyticsPayload,cachePayload]"),page.indexOf("const loadPosts="));
  const storeAnalytics=bootstrap.indexOf("if(analyticsPayload)setAnalytics(analyticsPayload)");
  const storeCache=bootstrap.indexOf("if(cachePayload.available&&cachePayload.data)");
  assert.ok(storeAnalytics>=0);
  assert.ok(storeCache>storeAnalytics);
  assert.doesNotMatch(bootstrap,/postXSync|syncFromX/);
});

test("explicit sync errors are surfaced and sync completion uses lastSync", () => {
  assert.match(page,/postXSync\(csrf,crypto\.randomUUID\(\)\)/);
  assert.match(page,/setSyncError\(sanitizeSyncError/);
  assert.match(page,/onRetry=\{\(\)=>void syncFromX\(\)\}/);
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
  assert.match(settings,/Content approval/);
  assert.match(settings,/Reply approval/);
  assert.match(settings,/aria-expanded=\{setupReferenceOpen\}/);
  assert.match(settings,/ADVANCED SETUP REFERENCE/);
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

test("Composer AI controls guard duplicate requests and guide empty-source clicks without requesting AI", () => {
  const composer=page.slice(page.indexOf("function Composer"),page.indexOf("function ReplyComposer"));
  assert.match(composer,/if\(!aiReady\|\|aiInFlight\.current\)return/);
  assert.match(composer,/hasAiRewriteSource\(parts\)/);
  assert.match(composer,/if\(!context\.trim\(\)\)\{setAiError\("AI_SOURCE_REQUIRED"\);return\}/);
  assert.equal(composer.match(/disabled=\{saving\|\|activeAi!==null\}/g)?.length,3);
  assert.doesNotMatch(composer,/ai-source-guidance/);
  assert.match(composer,/role="alert"/);
  assert.match(composer,/aiInFlight\.current=true/);
  assert.match(composer,/new AbortController\(\)/);
  assert.match(composer,/activeAi===\"Stronger hook\"/);
  assert.match(composer,/activeAi===\"Shorten\"/);
  assert.match(composer,/activeAi===\"Match my voice\"/);
  assert.match(composer,/\{aiReady&&<div className="ai-tools">/);
  assert.match(page,/aiReady=\{aiReady\}/);
  assert.match(page,/const aiReady=isAiContentReady\(runtimeConfig\)/);
});
