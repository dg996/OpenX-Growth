import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPublishClaim,
  publishReceiptsSchema,
  redactPublishDetail,
} from "../lib/publish-state.ts";

const NOW=Date.UTC(2026,6,13,12);

test("active claims cannot be stolen and safe expired claims can resume",()=>{
  assert.equal(classifyPublishClaim({status:"publishing",claimExpiresAt:NOW+1,deliveryState:"idle"},NOW),"active");
  assert.equal(classifyPublishClaim({status:"publishing",claimExpiresAt:NOW-1,deliveryState:"idle"},NOW),"recoverable");
  assert.equal(classifyPublishClaim({status:"publishing",claimExpiresAt:NOW-1,deliveryState:"confirmed"},NOW),"recoverable");
});

test("an expired claim with possible remote acceptance requires review",()=>{
  assert.equal(classifyPublishClaim({status:"needs_review",claimExpiresAt:null,deliveryState:"ambiguous"},NOW),"needs_review");
  for(const deliveryState of ["sending","accepted","ambiguous"] as const){
    assert.equal(classifyPublishClaim({status:"publishing",claimExpiresAt:NOW-1,deliveryState},NOW),"needs_review");
  }
  assert.equal(classifyPublishClaim({status:"publishing",claimExpiresAt:null,deliveryState:"idle"},NOW),"needs_review");
});

test("publish receipts are strict, ordered, and contain confirmation time",()=>{
  const valid=[
    {partIndex:0,xPostId:"x-1",acceptedAt:NOW-2,confirmedAt:NOW-1},
    {partIndex:1,xPostId:"x-2",acceptedAt:NOW,confirmedAt:NOW},
  ];
  assert.deepEqual(publishReceiptsSchema.parse(valid),valid);
  for(const invalid of [
    [{partIndex:1,xPostId:"x-1",acceptedAt:NOW,confirmedAt:NOW}],
    [{partIndex:0,xPostId:"",acceptedAt:NOW,confirmedAt:NOW}],
    [{partIndex:0,xPostId:"x-1",acceptedAt:NOW,confirmedAt:NOW,providerPayload:"secret"}],
  ])assert.equal(publishReceiptsSchema.safeParse(invalid).success,false);
});

test("operational event details never retain credentials or provider bodies",()=>{
  assert.equal(redactPublishDetail(new Error("Bearer personal-token response body: private")),"PUBLISH_FAILED");
  assert.equal(redactPublishDetail(new Error("X_PUBLISH_429")),"X_PUBLISH_429");
  assert.equal(redactPublishDetail(new Error("DAILY_X_WRITE_CAP_REACHED")),"DAILY_X_WRITE_CAP_REACHED");
  assert.equal(redactPublishDetail(new Error("DAILY_X_WRITE_LIMIT_REACHED")),"DAILY_X_WRITE_LIMIT_REACHED");
});
