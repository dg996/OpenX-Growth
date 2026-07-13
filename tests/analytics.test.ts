import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalyticsView, MIN_POSTING_TIME_SAMPLES, summarizeLatestSnapshots } from "../lib/analytics.ts";

test("analytics totals count only the latest snapshot for every synced X post", () => {
  const result = summarizeLatestSnapshots([
    {postId:"x-1",recordedAt:100,impressions:10,likes:1,replies:0,reposts:0},
    {postId:"x-2",recordedAt:300,impressions:40,likes:3,replies:2,reposts:1},
    {postId:"x-1",recordedAt:200,impressions:25,likes:2,replies:1,reposts:0},
  ]);

  assert.equal(result.latest.size,2);
  assert.equal(result.latest.get("x-1")?.recordedAt,200);
  assert.deepEqual(result.totals,{impressions:65,likes:5,replies:3,reposts:1});
});

test("analytics snapshot order does not affect the latest totals", () => {
  const result = summarizeLatestSnapshots([
    {postId:"x-1",recordedAt:200,impressions:25,likes:2,replies:1,reposts:0},
    {postId:"x-1",recordedAt:100,impressions:10,likes:1,replies:0,reposts:0},
  ]);

  assert.equal(result.totals.impressions,25);
});

const DAY=86_400_000;
const NOW=Date.UTC(2026,6,13);

test("analytics range filters raw snapshots and returns fixture-exact derived series", () => {
  const result=buildAnalyticsView({
    now:NOW,
    range:"7D",
    posts:[],
    snapshots:[
      {postId:"x-1",recordedAt:NOW-8*DAY,impressions:5,likes:1,replies:0,reposts:0},
      {postId:"x-1",recordedAt:NOW-6*DAY,impressions:10,likes:2,replies:1,reposts:0},
      {postId:"x-2",recordedAt:NOW-DAY,impressions:20,likes:1,replies:0,reposts:1},
    ],
    followerSnapshots:[],
  });

  assert.deepEqual(result.raw.postSnapshots.map((row)=>row.recordedAt),[NOW-6*DAY,NOW-DAY]);
  assert.deepEqual(result.derived.series.map((point)=>({recordedAt:point.recordedAt,impressions:point.impressions.value})),[
    {recordedAt:NOW-6*DAY,impressions:10},
    {recordedAt:NOW-DAY,impressions:30},
  ]);
  assert.equal(result.derived.totals.impressions.value,30);
  assert.deepEqual(result.derived.totals.impressions.provenance,{source:"derived",recordedAt:NOW-DAY});
});

test("follower charts use live snapshots or report insufficient data explicitly", () => {
  const sparse=buildAnalyticsView({
    now:NOW,
    range:"28D",
    posts:[],
    snapshots:[],
    followerSnapshots:[{accountId:"owner",recordedAt:NOW-DAY,followers:123}],
  });
  assert.equal(sparse.followers.status,"insufficient_data");
  assert.deepEqual(sparse.followers.series,[{recordedAt:NOW-DAY,followers:{value:123,provenance:{source:"live",recordedAt:NOW-DAY}}}]);

  const ready=buildAnalyticsView({
    now:NOW,
    range:"28D",
    posts:[],
    snapshots:[],
    followerSnapshots:[
      {accountId:"owner",recordedAt:NOW-2*DAY,followers:120},
      {accountId:"owner",recordedAt:NOW-DAY,followers:123},
    ],
  });
  assert.equal(ready.followers.status,"ready");
  assert.deepEqual(ready.followers.series.map((point)=>point.followers.value),[120,123]);
});

test("posting-time suggestions require the documented sample threshold", () => {
  const posts=Array.from({length:MIN_POSTING_TIME_SAMPLES-1},(_,index)=>({
    id:`post-${index}`,
    text:`Post ${index}`,
    xPostId:`x-${index}`,
    publishedAt:NOW-(index+1)*60_000,
    topic:null,
    format:"post",
    hook:null,
  }));
  const snapshots=posts.map((post,index)=>({postId:post.xPostId!,recordedAt:NOW-index,impressions:100,likes:10,replies:0,reposts:0}));
  const result=buildAnalyticsView({now:NOW,range:"28D",posts,snapshots,followerSnapshots:[]});
  assert.equal(result.postingTimes.status,"insufficient_data");
  assert.equal(result.postingTimes.sampleSize,MIN_POSTING_TIME_SAMPLES-1);
  assert.deepEqual(result.postingTimes.suggestions,[]);
});

test("rates and posting-time samples exclude snapshots without measured impressions", () => {
  const posts=[
    {id:"measured",text:"Measured post",xPostId:"x-measured",publishedAt:NOW-DAY,topic:"AI",format:"post",hook:null},
    {id:"unmeasured",text:"Unmeasured post",xPostId:"x-unmeasured",publishedAt:NOW-2*DAY,topic:"AI",format:"post",hook:null},
  ];
  const result=buildAnalyticsView({
    now:NOW,
    range:"28D",
    posts,
    snapshots:[
      {postId:"x-measured",recordedAt:NOW,impressions:100,likes:10,replies:0,reposts:0},
      {postId:"x-unmeasured",recordedAt:NOW,impressions:0,likes:1_000,replies:0,reposts:0},
    ],
    followerSnapshots:[],
  });

  assert.equal(result.derived.totals.engagements.value,1_010);
  assert.equal(result.derived.totals.engagementRate.value,0.1);
  assert.equal(result.derived.series.at(-1)?.engagementRate.value,0.1);
  assert.equal(result.derived.byTopic[0]?.medianEngagementRate.value,0.1);
  assert.equal(result.postingTimes.sampleSize,1);
  assert.equal(result.postingTimes.status,"insufficient_data");
  assert.match(result.postingTimes.method,/measured impressions/);
});

test("posting-time ranking uses median engagement rate instead of impression totals", () => {
  const posts=Array.from({length:MIN_POSTING_TIME_SAMPLES},(_,index)=>({
    id:`post-${index}`,
    text:`Post ${index}`,
    xPostId:`x-${index}`,
    publishedAt:Date.UTC(2026,6,1,index<4?9:10,index),
    topic:index<4?"Large":"Useful",
    format:"post",
    hook:null,
  }));
  const snapshots=posts.map((post,index)=>({
    postId:post.xPostId!,
    recordedAt:NOW-index,
    impressions:index<4?10_000:100,
    likes:index<4?10:10,
    replies:0,
    reposts:0,
  }));
  const result=buildAnalyticsView({now:NOW,range:"28D",posts,snapshots,followerSnapshots:[]});
  assert.equal(result.postingTimes.status,"ready");
  assert.equal(result.postingTimes.suggestions[0]?.hour,10);
  assert.equal(result.postingTimes.suggestions[0]?.medianEngagementRate,0.1);
  assert.equal(result.postingTimes.suggestions[0]?.provenance.source,"derived");
});
