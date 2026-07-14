import assert from "node:assert/strict";
import test from "node:test";
import { buildGrowthPlan, growthPlanStatusMessage } from "../lib/growth-plan.ts";
import type { IdeaSignal, ReplyOpportunity } from "../lib/x-growth.ts";

const idea = (topic: string, score: number): IdeaSignal => ({
  topic,
  change: "test",
  score,
  hook: `Hook for ${topic}`,
  rationale: "test",
  pillar: "Industry insight",
  scoreProvenance: { source: "derived", recordedAt: 0 },
});

const opportunity = (id: string, relevance: number): ReplyOpportunity => ({
  id,
  initials: "AB",
  name: "Account",
  handle: "@account",
  post: "Post text",
  reach: "10K",
  relevance,
  url: "https://x.com",
  suggestedReply: "",
  reason: "test",
  reachProvenance: { source: "live", recordedAt: 0 },
  relevanceProvenance: { source: "derived", recordedAt: 0 },
});

test("buildGrowthPlan picks highest-scored idea and top three reply opportunities", () => {
  const plan = buildGrowthPlan({
    dataSource: "live",
    connected: true,
    ideas: [idea("Lower", 40), idea("Higher", 88), idea("Middle", 60)],
    opportunities: [
      opportunity("c", 70),
      opportunity("a", 95),
      opportunity("d", 50),
      opportunity("b", 80),
    ],
  });
  assert.equal(plan.status, "ready");
  assert.equal(plan.content?.topic, "Higher");
  assert.deepEqual(plan.replies.map((row) => row.id), ["a", "b", "c"]);
});

test("buildGrowthPlan labels demo data without requiring a live connection", () => {
  const plan = buildGrowthPlan({
    dataSource: "demo",
    connected: false,
    ideas: [idea("Demo topic", 90)],
    opportunities: [opportunity("demo-1", 80)],
  });
  assert.equal(plan.status, "demo");
  assert.equal(plan.content?.topic, "Demo topic");
  assert.equal(plan.replies.length, 1);
});

test("buildGrowthPlan surfaces disconnected and insufficient live states", () => {
  assert.equal(
    buildGrowthPlan({ dataSource: "live", connected: false, ideas: [idea("A", 1)], opportunities: [] }).status,
    "disconnected",
  );
  assert.equal(
    buildGrowthPlan({ dataSource: "live", connected: true, ideas: [], opportunities: [] }).status,
    "insufficient",
  );
  const partial = buildGrowthPlan({
    dataSource: "live",
    connected: true,
    ideas: [],
    opportunities: [opportunity("only", 70)],
  });
  assert.equal(partial.status, "ready");
  assert.equal(partial.content, undefined);
  assert.equal(partial.replies.length, 1);
});

test("growthPlanStatusMessage documents each empty-state reason", () => {
  assert.match(growthPlanStatusMessage("demo").body, /Connect X/i);
  assert.match(growthPlanStatusMessage("disconnected").body, /Settings/i);
  assert.match(growthPlanStatusMessage("insufficient").body, /sync/i);
});
