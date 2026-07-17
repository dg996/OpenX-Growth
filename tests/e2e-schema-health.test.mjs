import assert from "node:assert/strict";
import test from "node:test";

const baseUrl=process.env.E2E_BASE_URL;
const expected=process.env.E2E_EXPECTED_SCHEMA_CODE;

test("missing or outdated D1 schema is bounded before application reads",async()=>{
  assert.ok(baseUrl&&expected);
  const response=await fetch(`${baseUrl}/api/x/status`,{headers:{accept:"application/json"}});
  const body=await response.json();
  assert.equal(response.status,503);assert.equal(body.error,expected);assert.equal(body.schema.requiredThrough,"0003_rainy_juggernaut.sql");assert.ok(["missing","outdated"].includes(body.schema.state));
  assert.equal(response.headers.get("x-openx-e2e-x-call-count"),"0");
  const serialized=JSON.stringify(body);assert.doesNotMatch(serialized,/SELECT|no such table|D1_ERROR|fixture|token|https?:\/\//i);
});
