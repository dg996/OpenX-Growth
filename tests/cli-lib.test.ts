import assert from "node:assert/strict";
import test from "node:test";

import {
  createOutputFormatter,
  generateSecretMaterial,
  generateWranglerConfig,
  isD1NameConflict,
  isWranglerAuthenticated,
  parseD1CreateOutput,
  parseD1ListOutput,
  parseDeployOutput,
  parseEnvFile,
  isValidD1DatabaseId,
  parseSecretListOutput,
  parseWranglerConfig,
  planSetupSteps,
  redactSecrets,
  updateEnvFile,
  updateWranglerAppUrl,
} from "../scripts/cli/lib.mjs";

const databaseId = "11111111-2222-4333-8444-555555555555";
const placeholderDatabaseId = "00000000-0000-4000-8000-000000000000";

test("D1 validation rejects syntactically valid placeholder identifiers",()=>{
  assert.equal(isValidD1DatabaseId(databaseId),true);
  assert.equal(isValidD1DatabaseId(placeholderDatabaseId),false);
});

test("secret material uses independent requested byte counts and base64 encoding", () => {
  const calls:number[]=[];
  let marker=1;
  const values=generateSecretMaterial((bytes:number)=>{calls.push(bytes);return Buffer.alloc(bytes,marker++);}) as Record<string,string>;
  assert.deepEqual(calls,[48,32,32,32]);
  assert.equal(Buffer.from(values.SESSION_SECRET,"base64").length,48);
  for(const name of ["APP_ACCESS_TOKEN","CRON_SECRET","OPENX_API_TOKEN"] as const)assert.equal(Buffer.from(values[name],"base64").length,32);
  assert.equal(new Set(Object.values(values)).size,4);
});

test("D1 create and list parsers accept current Wrangler shapes",()=>{
  assert.deepEqual(parseD1CreateOutput(`Successfully created DB\ndatabase_id = "${databaseId}"`),{databaseId});
  assert.deepEqual(parseD1CreateOutput("A database with that name already exists"),{conflict:true});
  assert.throws(()=>parseD1CreateOutput("created without an identifier"),/valid D1 database_id/);
  assert.deepEqual(parseD1ListOutput(JSON.stringify([{uuid:databaseId,name:"openx-growth"}])),[{name:"openx-growth",databaseId}]);
  assert.deepEqual(parseD1ListOutput(`notice\n${JSON.stringify({result:[{database_id:databaseId,database_name:"openx-growth"}]})}`),[{name:"openx-growth",databaseId}]);
  assert.throws(()=>parseD1ListOutput("not-json"),/malformed JSON/);
});

test("secret list and deploy parsers reject ambiguous output",()=>{
  assert.deepEqual([...parseSecretListOutput(JSON.stringify([{name:"SESSION_SECRET"},{name:"OPENX_API_TOKEN"}]))],["SESSION_SECRET","OPENX_API_TOKEN"]);
  assert.equal(parseDeployOutput("Deployed openx-growth\nhttps://openx-growth.account.workers.dev"),"https://openx-growth.account.workers.dev");
  assert.equal(
    parseDeployOutput("Registered https://account.workers.dev\nDeployed https://openx-growth.account.workers.dev"),
    "https://openx-growth.account.workers.dev",
  );
  assert.throws(()=>parseDeployOutput("Deployed to https://custom.example"),/workers.dev URL/);
});

test("Wrangler authentication detection fails closed on code-zero logout output",()=>{
  assert.equal(isWranglerAuthenticated({code:0,stdout:"You are logged in with an OAuth Token"}),true);
  assert.equal(isWranglerAuthenticated({code:0,stdout:"Account ID: fixture-account"}),true);
  assert.equal(isWranglerAuthenticated({code:0,stdout:"You are not authenticated. Please run `wrangler login`."}),false);
  assert.equal(isWranglerAuthenticated({code:0,stdout:""}),false);
  assert.equal(isWranglerAuthenticated({code:1,stderr:"not authenticated"}),false);
});

test("wrangler generator preserves the template contract and writes valid JSONC",()=>{
  const template=`{\n// retained source values\n"name":"openx-growth",\n"d1_databases":[{"binding":"DB","database_name":"openx-growth","database_id":"YOUR_D1_DATABASE_ID","migrations_dir":"drizzle",}],\n}`;
  const generated=generateWranglerConfig(template,{databaseId,appUrl:"https://openx.example"});
  const parsed=parseWranglerConfig(generated);
  assert.equal(parsed.databaseId,databaseId);
  assert.equal(parsed.appUrl,"https://openx.example");
  assert.equal(parsed.config.d1_databases[0].migrations_dir,"drizzle");
  const updated=updateWranglerAppUrl(generated,"https://next.example");
  assert.equal(parseWranglerConfig(updated).appUrl,"https://next.example");
  assert.throws(()=>generateWranglerConfig(template,{databaseId:"not-an-id"}),/valid D1/);
  assert.throws(()=>updateWranglerAppUrl(generated,"javascript:alert(1)"),/https/);
});

test("formatter redacts every marked value including adversarial errors",()=>{
  const secrets=["secret+with/symbols=","short-secret"];
  const formatter=createOutputFormatter(secrets);
  formatter.markSecret("later-secret");
  const output=formatter.format(`failed: secret+with/symbols= nested-short-secret later-secret Authorization: Bearer another-token`);
  for(const secret of [...secrets,"later-secret","another-token"])assert.equal(output.includes(secret),false);
  assert.match(output,/failed: ••• nested-••• ••• Authorization: Bearer •••/);
  assert.equal(redactSecrets("Cookie: private=value",[]),"Cookie: •••");
});

test("env updates preserve template keys and parse the resulting local values",()=>{
  const updated=updateEnvFile("# comment\nAPP_URL=http://localhost:3000\nSESSION_SECRET=\n",{APP_URL:"https://openx.example",SESSION_SECRET:"local-value",NEW_VALUE:"public"});
  assert.deepEqual(parseEnvFile(updated),{APP_URL:"https://openx.example",SESSION_SECRET:"local-value",NEW_VALUE:"public"});
});

test("step planner marks only observed state as already done",()=>{
  const plan=planSetupSteps({preflightReady:true,cloudflareAuthenticated:true,databaseConfigured:true,deployed:true,appUrl:"https://openx.example",requiredSecretsPresent:false});
  assert.deepEqual(plan.map((step)=>step.status),["done","done","done","pending","done","pending","pending","pending"]);
});

test("D1 conflict detection uses failed command output only",()=>{
  assert.equal(isD1NameConflict({code:1,stderr:"Database already exists"}),true);
  assert.equal(isD1NameConflict({code:0,stdout:"Database already exists"}),false);
  assert.equal(isD1NameConflict({code:1,stderr:"network unavailable"}),false);
});
