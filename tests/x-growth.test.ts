import test from "node:test";
import assert from "node:assert/strict";
import { generateIdeas, rankReplyOpportunities } from "../lib/x-growth.ts";

test("reply opportunities are ranked and retain X post identity", () => {
  const users = [
    { id:"u1",name:"Fast Founder",username:"fast",public_metrics:{followers_count:50_000} },
    { id:"u2",name:"Quiet Builder",username:"quiet",public_metrics:{followers_count:800} },
  ];
  const posts = [
    { id:"p1",author_id:"u1",text:"Open source distribution",created_at:new Date(Date.now()-3_600_000).toISOString(),public_metrics:{like_count:240,retweet_count:50,reply_count:30,impression_count:70_000} },
    { id:"p2",author_id:"u2",text:"A small update",created_at:new Date(Date.now()-86_400_000).toISOString(),public_metrics:{like_count:2,retweet_count:0,reply_count:0,impression_count:300} },
  ];
  const ranked = rankReplyOpportunities(posts,users);
  assert.equal(ranked[0].id,"p1");
  assert.equal(ranked[0].handle,"@fast");
  assert.equal(ranked[0].reach,"70K");
  assert.equal(ranked[0].suggestedReply,"");
  assert.ok(ranked[0].reason.includes("followers"));
});

test("ideas come from feed topics missing from recent authored posts", () => {
  const feed = [
    {id:"1",text:"Agentic workflows are changing startup operations"},
    {id:"2",text:"Agentic products need better evaluation"},
    {id:"3",text:"Open source agentic tools keep shipping"},
  ];
  const own = [{id:"mine",text:"A post about European founders"}];
  const ideas = generateIdeas(feed,own);
  assert.ok(ideas.some((idea) => idea.topic.toLowerCase().includes("agentic")));
  assert.ok(ideas.every((idea) => idea.hook && idea.rationale));
  assert.ok(ideas.every((idea) => idea.pillar));
});
