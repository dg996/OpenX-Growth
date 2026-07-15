import assert from "node:assert/strict";
import test from "node:test";

import { buildGrowthPlan } from "../lib/growth-plan.ts";
import type { IdeaSignal, ReplyOpportunity } from "../lib/x-growth.ts";

function idea(topic: string, score: number): IdeaSignal {
  return {
    topic,
    score,
    change: "Fixture change",
    hook: `${topic} hook`,
    rationale: "Fixture rationale",
    pillar: "Fixture pillar",
    scoreProvenance: { source: "derived", recordedAt: 1 },
  };
}

function opportunity(id: string, relevance: number): ReplyOpportunity {
  return {
    id,
    relevance,
    initials: "FX",
    name: "Fixture author",
    handle: "@fixture",
    post: `Fixture post ${id}`,
    reach: "10",
    url: `https://x.com/fixture/status/${id}`,
    suggestedReply: "",
    reason: "Fixture reason",
    reachProvenance: { source: "estimate", recordedAt: 1 },
    relevanceProvenance: { source: "derived", recordedAt: 1 },
  };
}

test("selects the highest-scored idea with a deterministic topic tie-break", () => {
  const plan = buildGrowthPlan(
    [idea("Beta", 80), idea("Lower", 79), idea("Alpha", 80)],
    [],
  );

  assert.equal(plan.content?.topic, "Alpha");
});

test("orders, deduplicates, and limits reply actions deterministically", () => {
  const plan = buildGrowthPlan(
    [],
    [
      opportunity("reply-d", 60),
      opportunity("reply-b", 95),
      opportunity("reply-a", 95),
      opportunity("reply-c", 70),
      opportunity("reply-a", 50),
    ],
  );

  assert.deepEqual(plan.replies.map((reply) => reply.id), ["reply-a", "reply-b", "reply-c"]);
});

test("returns explicit empty actions and does not mutate either input", () => {
  assert.deepEqual(buildGrowthPlan([], []), { content: null, replies: [] });

  const ideas = [idea("Beta", 80), idea("Alpha", 80)];
  const opportunities = [opportunity("reply-b", 70), opportunity("reply-a", 95)];
  const ideasBefore = structuredClone(ideas);
  const opportunitiesBefore = structuredClone(opportunities);

  buildGrowthPlan(ideas, opportunities);

  assert.deepEqual(ideas, ideasBefore);
  assert.deepEqual(opportunities, opportunitiesBefore);
});
