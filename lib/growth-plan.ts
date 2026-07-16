import type { IdeaSignal, ReplyOpportunity } from "./x-growth";

export type GrowthPlan = {
  content: IdeaSignal | null;
  replies: ReplyOpportunity[];
};

export function buildGrowthPlanDraftSeed(idea: IdeaSignal) {
  return { parts: [idea.hook], topic: idea.topic, generated: false as const };
}

export function buildGrowthPlan(
  ideas: IdeaSignal[],
  opportunities: ReplyOpportunity[],
): GrowthPlan {
  const content = [...ideas].sort(
    (left, right) => right.score - left.score || left.topic.localeCompare(right.topic),
  )[0] ?? null;

  const replies: ReplyOpportunity[] = [];
  const seenIds = new Set<string>();
  for (const opportunity of [...opportunities].sort(
    (left, right) => right.relevance - left.relevance || left.id.localeCompare(right.id),
  )) {
    if (seenIds.has(opportunity.id)) continue;
    seenIds.add(opportunity.id);
    replies.push(opportunity);
    if (replies.length === 3) break;
  }

  return { content, replies };
}
