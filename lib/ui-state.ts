export const ONBOARDING_STORAGE_KEY = "openx-onboarding-complete";

type OnboardingInput = {
  statusLoaded: boolean;
  connected: boolean;
  dismissed: boolean;
};

export function decideOnboarding(input: OnboardingInput) {
  if (!input.statusLoaded) return { open: false, persistComplete: false };
  if (input.connected) return { open: false, persistComplete: true };
  return { open: false, persistComplete: false };
}

export type WorkspaceState =
  | "loading"
  | "unconfigured-demo"
  | "configured-disconnected"
  | "connected-syncing"
  | "connected-sync-error"
  | "connected-insufficient"
  | "live-refreshing"
  | "live-sync-error"
  | "live";

type WorkspaceStatus = {
  configured: boolean;
  demoMode: boolean;
  connected: boolean;
};

type WorkspaceStateInput = {
  status: WorkspaceStatus | null;
  syncing: boolean;
  syncError: string;
  lastSync?: string;
  hasLiveData: boolean;
};

export function resolveWorkspaceState(input: WorkspaceStateInput): WorkspaceState {
  if (!input.status) return "loading";
  if (input.status.demoMode) return "unconfigured-demo";
  if (!input.status.connected) return "configured-disconnected";
  if (input.syncing) return input.hasLiveData ? "live-refreshing" : "connected-syncing";
  if (input.syncError) return input.hasLiveData ? "live-sync-error" : "connected-sync-error";
  return input.hasLiveData ? "live" : "connected-insufficient";
}

type LivePlanningDataInput = {
  hasAccountProfile: boolean;
  ideaCount: number;
  replyOpportunityCount: number;
  analyticsStatus?: "available" | "insufficient_data";
};

export function hasLivePlanningData(input: LivePlanningDataInput) {
  // An account profile proves connection identity, not that planning data is ready.
  return input.ideaCount > 0 || input.replyOpportunityCount > 0 || input.analyticsStatus === "available";
}

export function isAiContentReady(input: { aiConfigured: boolean; aiContentApproved: boolean }) {
  return input.aiConfigured && input.aiContentApproved;
}

export function hasAiRewriteSource(parts: string[]) {
  return parts.some((part) => part.trim().length > 0);
}

export function growthPlanEmptyGuidance(kind: "content" | "replies") {
  return kind === "content"
    ? {
        title: "No content recommendation yet",
        body: "Open Discover and run a read-only sync to load ranked ideas. Any reply opportunities stay available.",
      }
    : {
        title: "No reply opportunities yet",
        body: "Open Discover and run a read-only sync to load ranked conversations. Your content recommendation stays available.",
      };
}

export function isWorkspaceBlocking(state: WorkspaceState): state is "loading" {
  return state === "loading";
}

const PUBLIC_SYNC_ERROR = /^(?:X_API_\d{3}(?:_\d{3})?|DAILY_X_(?:RESOURCE|WRITE)_(?:CAP|LIMIT)_REACHED|X_NOT_CONNECTED|X_RECONNECT_REQUIRED|X_ACCOUNT_MISMATCH|SYNC_ALREADY_IN_PROGRESS|SYNC_FAILED)$/;

export function sanitizeSyncError(error: unknown) {
  return typeof error === "string" && PUBLIC_SYNC_ERROR.test(error) ? error : "SYNC_FAILED";
}

export function syncErrorGuidance(error: unknown) {
  const code=sanitizeSyncError(error);
  if(code==="DAILY_X_RESOURCE_LIMIT_REACHED"||code==="DAILY_X_RESOURCE_CAP_REACHED")return {
    code,
    title:"OpenX daily safety limit reached",
    body:"OpenX's local safety counter cannot fund another complete sync. This is separate from your paid X Developer Credits. Open Credits & limits to adjust it, reset today's counter, or see the next UTC reset; existing verified data remains available.",
    retryable:false,
    manageLimits:true,
  };
  if(code==="DAILY_X_WRITE_LIMIT_REACHED"||code==="DAILY_X_WRITE_CAP_REACHED")return {
    code,
    title:"X writes are disabled or exhausted",
    body:"The local write-attempt cap blocked the operation. Open Credits & limits to review or change it. Existing verified data remains available.",
    retryable:false,
    manageLimits:true,
  };
  if(code==="X_RECONNECT_REQUIRED")return {
    code,
    title:"Reconnect X",
    body:"The stored authorization can no longer refresh. Open Settings to reconnect; existing verified data remains available.",
    retryable:false,
    manageLimits:false,
  };
  if(code==="X_ACCOUNT_MISMATCH")return {code,title:"Different X account detected",body:"Existing data was not changed. Reconnect the account used by this workspace.",retryable:false,manageLimits:false};
  if(code==="SYNC_ALREADY_IN_PROGRESS")return {code,title:"A sync is already running",body:"This request did not start another X sync. Existing saved data remains available.",retryable:false,manageLimits:false};
  const retryable=!/^X_API_429(?:_429)?$/.test(code);
  return {
    code,
    title:"Latest X sync failed",
    body:"The latest read-only sync stopped safely. Existing verified data remains available.",
    retryable,
    manageLimits:false,
  };
}

const AI_SETTINGS_ERRORS=new Set([
  "AI_NOT_CONFIGURED",
  "X_AI_CONTENT_APPROVAL_REQUIRED",
  "X_AI_REPLY_APPROVAL_REQUIRED",
  "AI_REPLY_APPROVAL_REQUIRED",
]);

export function aiErrorGuidance(error: unknown) {
  const code=typeof error==="string"?error:"";
  if(code==="AI_SOURCE_REQUIRED")return {
    message:"Write or paste the text you want to rewrite first.",
    openSettings:false,
  };
  if(AI_SETTINGS_ERRORS.has(code))return {
    message:"AI drafting is off. Review the provider and X approval settings to enable it.",
    openSettings:true,
  };
  if(code==="AI_PROVIDER_TIMEOUT")return {
    message:"The AI provider took too long to respond. Try again when you are ready.",
    openSettings:false,
  };
  return {
    message:"AI could not create a valid suggestion. Try again or start with the editable draft.",
    openSettings:false,
  };
}
