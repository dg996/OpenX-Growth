import test from "node:test";
import assert from "node:assert/strict";
import {
  createPostInputSchema,
  importPayloadSchema,
  patchPostInputSchema,
  publishCommandSchema,
  publishablePostSchema,
  replyInputSchema,
} from "../lib/post-validation.ts";

const NOW=Date.UTC(2026,6,13,12);
const validCreate={text:"A concise post",thread:["A concise post"],evergreen:false};

test("create and publish preflight enforce one strict post/thread domain",()=>{
  const created=createPostInputSchema(NOW).parse(validCreate);
  assert.equal(created.format,"post");
  assert.deepEqual(created.thread,["A concise post"]);

  const publishable=publishablePostSchema.parse({text:created.text,threadJson:null,format:created.format,evergreen:false,evergreenIntervalDays:30});
  assert.deepEqual(publishable.parts,["A concise post"]);

  for(const input of [
    {text:""},
    {text:"x".repeat(281)},
    {text:"first",thread:["first",""]},
    {text:"first",thread:["different","second"]},
    {text:"one",thread:["one","two"],format:"post"},
    {text:"one",thread:["one"],format:"thread"},
    {text:"one",unknown:true},
  ])assert.equal(createPostInputSchema(NOW).safeParse(input).success,false);
});

test("schedule and evergreen invariants reject unsafe create and patch states",()=>{
  for(const input of [
    {...validCreate,scheduledAt:NOW},
    {...validCreate,evergreen:true,evergreenIntervalDays:6},
    {...validCreate,evergreen:false,evergreenIntervalDays:30},
  ])assert.equal(createPostInputSchema(NOW).safeParse(input).success,false);

  const current={text:"draft",threadJson:null,format:"post",status:"draft",scheduledAt:null,evergreen:false,evergreenIntervalDays:30};
  assert.equal(patchPostInputSchema(current,NOW).safeParse({scheduledAt:NOW-1,status:"scheduled"}).success,false);
  assert.equal(patchPostInputSchema(current,NOW).safeParse({status:"scheduled"}).success,false);
  assert.equal(patchPostInputSchema(current,NOW).safeParse({evergreen:true,evergreenIntervalDays:3}).success,false);
  assert.equal(patchPostInputSchema(current,NOW).safeParse({status:"publishing"}).success,false);
  assert.equal(patchPostInputSchema(current,NOW).safeParse({}).success,false);
});

test("import shares content, thread, schedule, evergreen, and status constraints",()=>{
  const base={
    schemaVersion:1 as const,
    posts:[{id:"00000000-0000-4000-8000-000000000001",text:"portable",threadJson:null,status:"draft",scheduledAt:null,publishedAt:null,xPostId:null,publishedIdsJson:null,topic:null,format:"post",hook:null,generated:false,evergreen:false,evergreenIntervalDays:30,attempts:0,lastError:null,createdAt:NOW-1,updatedAt:NOW-1}],
    feedback:[],analytics:[],
  };
  assert.equal(importPayloadSchema(NOW).safeParse(base).success,true);
  for(const mutate of [
    {text:""},
    {text:"x".repeat(281)},
    {threadJson:JSON.stringify(["portable",""])},
    {threadJson:"not-json"},
    {status:"scheduled",scheduledAt:NOW-1},
    {status:"published"},
    {evergreen:true,evergreenIntervalDays:6},
  ])assert.equal(importPayloadSchema(NOW).safeParse({...base,posts:[{...base.posts[0],...mutate}]}).success,false);

  const legacyArticle={...base.posts[0],text:"a".repeat(1_000),format:"article",threadJson:null};
  assert.equal(importPayloadSchema(NOW).safeParse({...base,posts:[legacyArticle]}).success,true);
});

test("reply and publish commands are strict and bounded",()=>{
  assert.equal(replyInputSchema.safeParse({postId:"123",text:" useful reply ",generated:false}).success,true);
  for(const input of [{postId:"",text:"reply"},{postId:"123",text:""},{postId:"123",text:"x".repeat(281)},{postId:"123",text:"reply",extra:true}])assert.equal(replyInputSchema.safeParse(input).success,false);

  assert.deepEqual(publishCommandSchema.parse({}),{action:"publish"});
  assert.equal(publishCommandSchema.safeParse({action:"reconcile",resolution:"accepted",xPostIds:["one"]}).success,true);
  assert.equal(publishCommandSchema.safeParse({action:"reconcile",resolution:"not_accepted"}).success,true);
  for(const input of [
    {action:"reconcile",resolution:"accepted"},
    {action:"reconcile",resolution:"accepted",xPostIds:["duplicate","duplicate"]},
    {action:"reconcile",resolution:"not_accepted",xPostIds:["one"]},
    {action:"publish",xPostIds:["one"]},
    {action:"retry"},
  ])assert.equal(publishCommandSchema.safeParse(input).success,false);
});
