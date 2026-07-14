import type { IdeaSignal, ReplyOpportunity } from "./x-growth";

export type GrowthPlanStatus = "demo" | "disconnected" | "insufficient" | "ready";

export type GrowthPlan = {
  status: GrowthPlanStatus;
  content?: IdeaSignal;
  replies: ReplyOpportunity[];
};

const byScore = (left: IdeaSignal, right: IdeaSignal) =>
  right.score - left.score || left.topic.localeCompare(right.topic, "en");

const byRelevance = (left: ReplyOpportunity, right: ReplyOpportunity) =>
  right.relevance - left.relevance || left.name.localeCompare(right.name, "en");

export function buildGrowthPlan(input: {
  dataSource: "demo" | "live";
  connected: boolean;
  ideas: IdeaSignal[];
  opportunities: ReplyOpportunity[];
}): GrowthPlan {
  const replies = [...input.opportunities].sort(byRelevance).slice(0, 3);
  const content = [...input.ideas].sort(byScore)[0];

  if (input.dataSource === "demo") {
    return { status: "demo", content, replies };
  }
  if (!input.connected) {
    return { status: "disconnected", replies: [] };
  }
  if (!content && replies.length === 0) {
    return { status: "insufficient", replies: [] };
  }
  return { status: "ready", content, replies };
}

export function growthPlanStatusMessage(status: GrowthPlanStatus): { title: string; body: string } {
  switch (status) {
    case "demo":
      return {
        title: "Sample plan",
        body: "Connect X and sync to replace demo ideas and reply opportunities with ranked live data.",
      };
    case "disconnected":
      return {
        title: "Connect X to unlock your plan",
        body: "Authorize your account in Settings, then run Sync from X on Discover.",
      };
    case "insufficient":
      return {
        title: "Not enough verified data yet",
        body: "Run a read-only sync after connecting X. Ideas and reply opportunities need recent timeline data.",
      };
    default:
      return { title: "", body: "" };
  }
}
