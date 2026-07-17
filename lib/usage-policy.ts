export function syncPageSize(remainingResources:number) {
  const available=Math.max(0,Math.trunc(remainingResources));
  const pageSize=Math.min(50,Math.floor(available/2));
  return pageSize>=5?pageSize:null;
}

export function xUsageWindow(timestamp:number) {
  const instant=new Date(timestamp);
  if(!Number.isFinite(instant.getTime()))throw new RangeError("Invalid usage timestamp");
  const day=instant.toISOString().slice(0,10);
  const resetsAt=Date.UTC(instant.getUTCFullYear(),instant.getUTCMonth(),instant.getUTCDate()+1);
  return {day,resetsAt};
}

export const USER_USAGE_LIMIT_BOUNDS={
  minDailyResources:11,
  maxDailyResources:10_000,
  minSyncResources:11,
  maxSyncResources:101,
  minDailyWrites:0,
  maxDailyWrites:1_000,
} as const;

export type UserXUsageLimits={maxResources:number;maxSyncResources:number;maxWrites:number};

export function parseUserXUsageLimits(input:unknown):UserXUsageLimits|null {
  if(!input||typeof input!=="object"||Array.isArray(input))return null;
  const {maxResources,maxSyncResources,maxWrites}=input as Partial<UserXUsageLimits>;
  const bounds=USER_USAGE_LIMIT_BOUNDS;
  if(!Number.isInteger(maxResources)||!Number.isInteger(maxSyncResources)||!Number.isInteger(maxWrites))return null;
  if(maxResources!<bounds.minDailyResources||maxResources!>bounds.maxDailyResources)return null;
  if(maxSyncResources!<bounds.minSyncResources||maxSyncResources!>bounds.maxSyncResources||maxSyncResources!>maxResources!)return null;
  if(maxWrites!<bounds.minDailyWrites||maxWrites!>bounds.maxDailyWrites)return null;
  return {maxResources:maxResources!,maxSyncResources:maxSyncResources!,maxWrites:maxWrites!};
}

export function clearExpiredBudgetState<T extends string>(state:T,nextEnabled:boolean,cacheAvailable:boolean):T|"succeeded"|"never" {
  if(state!=="budget_exhausted"||!nextEnabled)return state;
  return cacheAvailable?"succeeded":"never";
}

export type SyncResourcePlan = {
  enabled:boolean;
  blockedReason:"DAILY_X_RESOURCE_LIMIT_REACHED"|null;
  maxReadResources:number;
  pageSize:number;
  maxRequests:3|4;
  writes:0;
};

export function syncResourcePlan(availableResources:number,authorizationNeedsRefresh=false,maxSyncResources=11):SyncResourcePlan {
  const available=Math.min(Math.max(0,Math.trunc(availableResources)),Math.max(0,Math.trunc(maxSyncResources)));
  const pageSize=Math.min(50,Math.floor((available-1)/2));
  if(pageSize<5)return {enabled:false,blockedReason:"DAILY_X_RESOURCE_LIMIT_REACHED",maxReadResources:0,pageSize:0,maxRequests:authorizationNeedsRefresh?4:3,writes:0};
  return {enabled:true,blockedReason:null,maxReadResources:1+2*pageSize,pageSize,maxRequests:authorizationNeedsRefresh?4:3,writes:0};
}
