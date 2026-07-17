import assert from "node:assert/strict";
import test from "node:test";

import { clearExpiredBudgetState, parseUserXUsageLimits, syncPageSize, syncResourcePlan, xUsageWindow } from "../lib/usage-policy.ts";

test("sync page size reserves both collection reads without crossing remaining resources", () => {
  assert.equal(syncPageSize(101),50);
  assert.equal(syncPageSize(24),12);
  assert.equal(syncPageSize(10),5);
  assert.equal(syncPageSize(9),null);
});

test("explicit sync preflight includes identity and both minimum collections",()=>{
  assert.deepEqual(syncResourcePlan(10),{enabled:false,blockedReason:"DAILY_X_RESOURCE_LIMIT_REACHED",maxReadResources:0,pageSize:0,maxRequests:3,writes:0});
  assert.deepEqual(syncResourcePlan(11),{enabled:true,blockedReason:null,maxReadResources:11,pageSize:5,maxRequests:3,writes:0});
  assert.equal(syncResourcePlan(25).maxReadResources,11);
  assert.equal(syncResourcePlan(101).maxReadResources,11);
  assert.equal(syncResourcePlan(25,false,25).maxReadResources,25);
  assert.equal(syncResourcePlan(101,false,101).maxReadResources,101);
  assert.equal(syncResourcePlan(25,true).maxRequests,4);
});

test("the local safety cap opens a new usage window every UTC day",()=>{
  const lastMillisecond=Date.UTC(2026,6,17,23,59,59,999);
  assert.deepEqual(xUsageWindow(lastMillisecond),{
    day:"2026-07-17",
    resetsAt:Date.UTC(2026,6,18),
  });
  assert.deepEqual(xUsageWindow(lastMillisecond+1),{
    day:"2026-07-18",
    resetsAt:Date.UTC(2026,6,19),
  });
});

test("a stale exhausted status clears automatically when the new daily window has capacity",()=>{
  assert.equal(clearExpiredBudgetState("budget_exhausted",false,true),"budget_exhausted");
  assert.equal(clearExpiredBudgetState("budget_exhausted",true,true),"succeeded");
  assert.equal(clearExpiredBudgetState("budget_exhausted",true,false),"never");
  assert.equal(clearExpiredBudgetState("failed",true,true),"failed");
});

test("user-defined usage limits are bounded and keep a complete sync possible",()=>{
  assert.deepEqual(parseUserXUsageLimits({maxResources:500,maxSyncResources:11,maxWrites:50}),{maxResources:500,maxSyncResources:11,maxWrites:50});
  assert.deepEqual(parseUserXUsageLimits({maxResources:500,maxSyncResources:12,maxWrites:50}),{maxResources:500,maxSyncResources:12,maxWrites:50});
  assert.deepEqual(parseUserXUsageLimits({maxResources:101,maxSyncResources:101,maxWrites:0}),{maxResources:101,maxSyncResources:101,maxWrites:0});
  for(const invalid of [
    {maxResources:10,maxSyncResources:11,maxWrites:50},
    {maxResources:500,maxSyncResources:10,maxWrites:50},
    {maxResources:50,maxSyncResources:51,maxWrites:50},
    {maxResources:500,maxSyncResources:11,maxWrites:-1},
    {maxResources:"500",maxSyncResources:11,maxWrites:50},
  ])assert.equal(parseUserXUsageLimits(invalid),null);
});
