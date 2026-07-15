import assert from "node:assert/strict";
import test from "node:test";

const baseUrl=process.env.E2E_BASE_URL??"http://localhost:5180";
const accessToken=process.env.E2E_APP_ACCESS_TOKEN??"";

async function api(path,options={}) {
  const response=await fetch(`${baseUrl}${path}`,{
    ...options,
    headers:{accept:"application/json",...(options.headers??{})},
  });
  const contentType=response.headers.get("content-type")??"";
  const body=contentType.includes("application/json")?await response.json():await response.text();
  return {response,body};
}

function cookieJar(response) {
  return (response.headers.getSetCookie?.()??[]).map((entry)=>entry.split(";")[0]).join("; ");
}

async function authenticatedSession() {
  assert.ok(accessToken,"E2E_APP_ACCESS_TOKEN is required");
  const login=await api("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:accessToken})});
  assert.equal(login.response.status,200);
  const authCookies=cookieJar(login.response);
  const csrf=await api("/api/security/csrf",{headers:{cookie:authCookies}});
  assert.equal(csrf.response.status,200);
  return {token:csrf.body.token,cookies:[authCookies,cookieJar(csrf.response)].filter(Boolean).join("; ")};
}

async function generate(kind,prompt) {
  const {token,cookies}=await authenticatedSession();
  return api("/api/ai/generate",{
    method:"POST",
    headers:{cookie:cookies,"x-csrf-token":token,"content-type":"application/json"},
    body:JSON.stringify({kind,prompt}),
  });
}

test("AI-enabled instance returns validated post and thread suggestions from the local fixture",async()=>{
  const post=await generate("post","E2E_VALID_POST");
  assert.equal(post.response.status,200);
  assert.deepEqual(post.body,{content:"A deterministic fixture post.",rationale:"Deterministic post fixture.",generated:true});

  const thread=await generate("thread","E2E_VALID_THREAD");
  assert.equal(thread.response.status,200);
  assert.deepEqual(thread.body.content,["Fixture thread part one.","Fixture thread part two.","Fixture thread part three."]);
  assert.equal(thread.body.generated,true);
});

test("malformed and oversized provider suggestions are rejected before reaching the client",async()=>{
  for(const marker of ["E2E_MALFORMED_JSON","E2E_OVERSIZED_PART"]){
    const result=await generate("post",marker);
    assert.equal(result.response.status,502);
    assert.deepEqual(result.body,{error:"AI_INVALID_RESPONSE"});
  }
});

test("provider failures expose one safe error without the provider body or status",async()=>{
  const result=await generate("post","E2E_PROVIDER_FAILURE");
  assert.equal(result.response.status,502);
  assert.deepEqual(result.body,{error:"AI_PROVIDER_UNAVAILABLE"});
  assert.doesNotMatch(JSON.stringify(result.body),/FIXTURE_PRIVATE_PROVIDER_FAILURE|503/);
});
