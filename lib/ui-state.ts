export const ONBOARDING_STORAGE_KEY = "openx-onboarding-complete";

type OnboardingInput = {
  statusLoaded: boolean;
  connected: boolean;
  dismissed: boolean;
};

export function decideOnboarding(input: OnboardingInput) {
  if (!input.statusLoaded) return { open: false, persistComplete: false };
  if (input.connected) return { open: false, persistComplete: true };
  return { open: !input.dismissed, persistComplete: false };
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

export function isWorkspaceBlocking(state: WorkspaceState): state is "loading" | "configured-disconnected" {
  return state === "loading" || state === "configured-disconnected";
}

const PUBLIC_SYNC_ERROR = /^(?:X_API_\d{3}(?:_\d{3})?|DAILY_X_(?:RESOURCE|WRITE)_(?:CAP|LIMIT)_REACHED|X_NOT_CONNECTED|X_RECONNECT_REQUIRED|SYNC_FAILED)$/;

export function sanitizeSyncError(error: unknown) {
  return typeof error === "string" && PUBLIC_SYNC_ERROR.test(error) ? error : "SYNC_FAILED";
}

export function syncErrorGuidance(error: unknown) {
  const code=sanitizeSyncError(error);
  if(code==="DAILY_X_RESOURCE_LIMIT_REACHED"||code==="DAILY_X_RESOURCE_CAP_REACHED")return {
    code,
    title:"Daily X resource budget reached",
    body:"The local cap cannot fund another complete sync. Increase MAX_DAILY_X_RESOURCES or wait for the next UTC day; existing verified data remains available.",
    retryable:false,
  };
  if(code==="DAILY_X_WRITE_LIMIT_REACHED"||code==="DAILY_X_WRITE_CAP_REACHED")return {
    code,
    title:"X writes are disabled or exhausted",
    body:"The local write cap blocked the operation. Existing verified data remains available and no retry should be attempted until the policy changes.",
    retryable:false,
  };
  if(code==="X_RECONNECT_REQUIRED")return {
    code,
    title:"Reconnect X",
    body:"The stored authorization can no longer refresh. Open Settings to reconnect; existing verified data remains available.",
    retryable:false,
  };
  const retryable=!/^X_API_429(?:_429)?$/.test(code);
  return {
    code,
    title:"Latest X sync failed",
    body:`The latest read-only sync stopped with ${code}. Existing verified data remains available.`,
    retryable,
  };
}
