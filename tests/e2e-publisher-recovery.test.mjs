import assert from "node:assert/strict";
import test from "node:test";

const baseUrl=process.env.E2E_BASE_URL??"http://localhost:5179";
const apiToken=process.env.E2E_API_TOKEN??"";
const cronToken=process.env.E2E_CRON_TOKEN??"";
const BASE_TIME=Date.UTC(2026,6,13,14);
const LEASE_MS=60_000;

async function api(path,options={}) {
  const response=await fetch(`${baseUrl}${path}`,{
    ...options,
    headers:{accept:"application/json",authorization:`Bearer ${apiToken}`,...(options.headers??{})},
  });
  const contentType=response.headers.get("content-type")??"";
  const body=contentType.includes("application/json")?await response.json():await response.text();
  return {response,body};
}

async function create(parts=["publisher fixture"]) {
  const result=await api("/api/posts",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:parts[0],thread:parts,evergreen:false})});
  assert.equal(result.response.status,201,JSON.stringify(result.body));
  return result.body.post;
}

async function publish(id,{fault,now=BASE_TIME,body,providerStatus}={}) {
  return api(`/api/posts/${id}/publish`,{
    method:"POST",
    headers:{
      ...(fault?{"x-openx-e2e-publish-fault":fault}:{}),
      ...(now?{"x-openx-e2e-publish-now":String(now)}:{}),
      ...(providerStatus?{"x-openx-e2e-provider-status":String(providerStatus)}:{}),
      ...(body?{"content-type":"application/json"}:{}),
    },
    ...(body?{body:JSON.stringify(body)}:{}),
  });
}

async function stored(id) {
  const result=await api("/api/posts");assert.equal(result.response.status,200);
  return result.body.posts.find((post)=>post.id===id);
}

async function writes() {
  const result=await api("/api/analytics?range=7D");assert.equal(result.response.status,200);
  return result.body.usage.writes;
}

async function cron() {
  return api("/api/cron/publish",{method:"POST",headers:{authorization:`Bearer ${cronToken}`}});
}

test("fault before claim has no state effect; active lease cannot be stolen; expired safe lease resumes",async()=>{
  const before=await create(["before claim"]);
  const untouched=await publish(before.id,{fault:"before_claim"});
  assert.equal(untouched.response.status,502);
  assert.equal((await stored(before.id)).status,"draft");

  const claimedPost=await create(["lease recovery"]);
  const crashed=await publish(claimedPost.id,{fault:"after_claim"});
  assert.equal(crashed.response.status,502);
  const claimed=await stored(claimedPost.id);
  assert.equal(claimed.status,"publishing");
  assert.equal(claimed.deliveryState,"idle");
  assert.equal("claimToken" in claimed,false);
  assert.equal(claimed.claimExpiresAt,BASE_TIME+LEASE_MS);
  const deleted=await api(`/api/posts/${claimedPost.id}`,{method:"DELETE"});
  assert.equal(deleted.response.status,409);

  const active=await publish(claimedPost.id,{now:BASE_TIME+1});
  assert.equal(active.response.status,409);
  assert.equal(active.body.error,"POST_ALREADY_BEING_PUBLISHED");
  const recovered=await publish(claimedPost.id,{now:BASE_TIME+LEASE_MS+1});
  assert.equal(recovered.response.status,200,JSON.stringify(recovered.body));
  assert.equal((await stored(claimedPost.id)).status,"published");
});

test("cron revisits expired publishing leases without touching active ones",async()=>{
  const expiredPost=await create(["cron stale lease"]);
  await publish(expiredPost.id,{fault:"after_claim",now:Date.now()-LEASE_MS-1_000});
  const activePost=await create(["cron active lease"]);
  await publish(activePost.id,{fault:"after_claim",now:Date.now()});
  const result=await cron();
  assert.equal(result.response.status,200,JSON.stringify(result.body));
  assert.equal((await stored(expiredPost.id)).status,"published");
  assert.equal((await stored(activePost.id)).status,"publishing");
});

test("a crash after every confirmed thread part resumes only unconfirmed parts",async()=>{
  for(let faultIndex=0;faultIndex<3;faultIndex++){
    const post=await create([`thread ${faultIndex}.1`,`thread ${faultIndex}.2`,`thread ${faultIndex}.3`]);
    const crashed=await publish(post.id,{fault:`after_part:${faultIndex}`,now:BASE_TIME+faultIndex*200_000});
    assert.equal(crashed.response.status,502);
    const partial=await stored(post.id);
    assert.equal(partial.status,"publishing");
    assert.equal(partial.deliveryState,"confirmed");
    assert.equal(JSON.parse(partial.publishReceiptsJson).length,faultIndex+1);
    const resumed=await publish(post.id,{now:BASE_TIME+faultIndex*200_000+LEASE_MS+1});
    assert.equal(resumed.response.status,200,JSON.stringify(resumed.body));
    const complete=await stored(post.id);
    const receipts=JSON.parse(complete.publishReceiptsJson);
    assert.equal(complete.status,"published");
    assert.equal(receipts.length,3);
    assert.deepEqual(receipts.map((receipt)=>receipt.partIndex),[0,1,2]);
    assert.equal(new Set(receipts.map((receipt)=>receipt.xPostId)).size,3);
  }
});

for(const fault of ["after_remote_acceptance","before_receipt"]){
  test(`${fault} becomes needs_review and never blindly retries`,async()=>{
    const post=await create([`ambiguous ${fault}`]);
    const writesBefore=await writes();
    const crashed=await publish(post.id,{fault,now:BASE_TIME+1_000_000});
    assert.equal(crashed.response.status,502);
    const ambiguous=await stored(post.id);
    assert.equal(ambiguous.status,"publishing");
    assert.ok(["accepted","sending"].includes(ambiguous.deliveryState));
    assert.equal(ambiguous.publishReceiptsJson,null);
    assert.equal(await writes(),writesBefore+1);

    const stopped=await publish(post.id,{now:BASE_TIME+1_000_000+LEASE_MS+1});
    assert.equal(stopped.response.status,409);
    assert.equal(stopped.body.error,"PUBLISH_NEEDS_REVIEW");
    assert.equal((await stored(post.id)).status,"needs_review");
    assert.equal(await writes(),writesBefore+1);

    const reconciled=await publish(post.id,{now:BASE_TIME+1_100_000,body:{action:"reconcile",resolution:"accepted",xPostIds:[`manual-${fault}`]}});
    assert.equal(reconciled.response.status,200,JSON.stringify(reconciled.body));
    const final=await stored(post.id);
    assert.equal(final.status,"published");
    assert.equal(final.xPostId,`manual-${fault}`);
  });
}

test("manual not-accepted reconciliation makes only the ambiguous part retryable",async()=>{
  const post=await create(["confirmed first","ambiguous second"]);
  await publish(post.id,{fault:"after_part:0",now:BASE_TIME+2_000_000});
  await publish(post.id,{fault:"after_remote_acceptance",now:BASE_TIME+2_000_000+LEASE_MS+1});
  await publish(post.id,{now:BASE_TIME+2_000_000+2*LEASE_MS+2});
  const review=await stored(post.id);
  assert.equal(review.status,"needs_review");
  assert.equal(JSON.parse(review.publishReceiptsJson).length,1);
  const reconciled=await publish(post.id,{body:{action:"reconcile",resolution:"not_accepted"},now:BASE_TIME+2_100_000});
  assert.equal(reconciled.response.status,200);
  assert.equal((await stored(post.id)).status,"failed");
  const retried=await publish(post.id,{now:BASE_TIME+2_100_001});
  assert.equal(retried.response.status,200,JSON.stringify(retried.body));
  assert.equal(JSON.parse((await stored(post.id)).publishReceiptsJson).length,2);
});

test("accepted reconciliation cannot replace already confirmed thread receipts",async()=>{
  const post=await create(["confirmed receipt","ambiguous tail"]);
  await publish(post.id,{fault:"after_part:0",now:BASE_TIME+2_500_000});
  await publish(post.id,{fault:"after_remote_acceptance",now:BASE_TIME+2_500_000+LEASE_MS+1});
  await publish(post.id,{now:BASE_TIME+2_500_000+2*LEASE_MS+2});
  const review=await stored(post.id);
  assert.equal(review.status,"needs_review");
  const confirmedId=JSON.parse(review.publishReceiptsJson)[0].xPostId;

  const mismatched=await publish(post.id,{body:{action:"reconcile",resolution:"accepted",xPostIds:["replacement-id","manual-tail"]},now:BASE_TIME+2_700_000});
  assert.equal(mismatched.response.status,409,JSON.stringify(mismatched.body));
  assert.equal(mismatched.body.error,"RECONCILIATION_RECEIPT_MISMATCH");
  assert.equal((await stored(post.id)).status,"needs_review");

  const accepted=await publish(post.id,{body:{action:"reconcile",resolution:"accepted",xPostIds:[confirmedId,"manual-tail"]},now:BASE_TIME+2_700_001});
  assert.equal(accepted.response.status,200,JSON.stringify(accepted.body));
  assert.equal((await stored(post.id)).status,"published");
});

test("definitive provider rejection is safely retryable",async()=>{
  const post=await create(["provider rejection"]);
  const failed=await publish(post.id,{providerStatus:400,now:BASE_TIME+3_000_000});
  assert.equal(failed.response.status,502);
  const storedFailure=await stored(post.id);
  assert.equal(storedFailure.status,"failed");
  assert.equal(storedFailure.lastError,"X_PUBLISH_400");
  assert.equal(storedFailure.deliveryState,"idle");
  const retried=await publish(post.id,{now:BASE_TIME+3_000_001});
  assert.equal(retried.response.status,200,JSON.stringify(retried.body));
});

test("provider 5xx acceptance is ambiguous and never retried automatically",async()=>{
  const post=await create(["ambiguous provider failure"]);
  const writesBefore=await writes();
  const failed=await publish(post.id,{providerStatus:503,now:BASE_TIME+3_100_000});
  assert.equal(failed.response.status,409,JSON.stringify(failed.body));
  assert.equal(failed.body.error,"PUBLISH_NEEDS_REVIEW");
  const ambiguous=await stored(post.id);
  assert.equal(ambiguous.status,"needs_review");
  assert.equal(ambiguous.deliveryState,"ambiguous");
  assert.equal(await writes(),writesBefore+1);

  const stopped=await publish(post.id,{now:BASE_TIME+3_100_001});
  assert.equal(stopped.response.status,409);
  assert.equal(stopped.body.error,"PUBLISH_NEEDS_REVIEW");
  assert.equal(await writes(),writesBefore+1);
});

test("HTTP create, patch, import, and publish boundaries reject inconsistent input",async()=>{
  for(const input of [
    {text:""},
    {text:"x".repeat(281)},
    {text:"first",thread:["first",""]},
    {text:"past",scheduledAt:Date.now()-1},
    {text:"evergreen",evergreen:true,evergreenIntervalDays:2},
  ]){
    const result=await api("/api/posts",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});
    assert.equal(result.response.status,400,JSON.stringify(input));
  }
  const post=await create(["editable"]);
  const patch=await api(`/api/posts/${post.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({status:"scheduled",scheduledAt:Date.now()-1})});
  assert.equal(patch.response.status,400);
  const malformedPublish=await publish(post.id,{body:{action:"retry"}});
  assert.equal(malformedPublish.response.status,400);

  const exported=await api("/api/data/export");assert.equal(exported.response.status,200);
  const badImport={...exported.body,posts:[{...exported.body.posts[0],text:"x".repeat(281)}]};
  const imported=await api("/api/data/import",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(badImport)});
  assert.equal(imported.response.status,400);
});
