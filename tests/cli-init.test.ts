import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { commandStdinMode, runSetup, SetupFailure } from "../scripts/cli/init.mjs";

const databaseId="11111111-2222-4333-8444-555555555555";
const appUrl="https://openx-growth.fixture.workers.dev";
const requiredSecrets=["SESSION_SECRET","APP_ACCESS_TOKEN","CRON_SECRET","OPENX_API_TOKEN"];

async function fixtureRoot({dependencies=true}={}) {
  const root=await mkdtemp(join(tmpdir(),"openx-setup-test-"));
  await writeFile(join(root,"package.json"),JSON.stringify({name:"openx-growth"}));
  await writeFile(join(root,"wrangler.example.jsonc"),JSON.stringify({
    name:"openx-growth",
    main:"dist/server/index.js",
    d1_databases:[{binding:"DB",database_name:"openx-growth",database_id:"YOUR_D1_DATABASE_ID",migrations_dir:"drizzle"}],
  },null,2));
  await writeFile(join(root,".env.example"),"APP_URL=http://localhost:3000\nX_CLIENT_ID=\nX_CLIENT_SECRET=\nSESSION_SECRET=\nAPP_ACCESS_TOKEN=\nCRON_SECRET=\nOPENX_API_TOKEN=\n");
  if(dependencies){
    await mkdir(join(root,"node_modules/.bin"),{recursive:true});
    await writeFile(join(root,"node_modules/.bin/wrangler"),"");
    await chmod(join(root,"node_modules/.bin/wrangler"),0o755);
  }
  return root;
}

type Call={command:string;args:string[];input:string};
type RunnerState={
  calls:Call[];
  remoteSecrets:Set<string>;
  overrides:Record<string,(call:Call)=>{code:number;stdout?:string;stderr?:string}>;
};

function commandKey(call:Call){return `${call.command} ${call.args.join(" ")}`;}

function createRunner(settings:Partial<RunnerState>={}) {
  const state:RunnerState={calls:[],remoteSecrets:new Set(),overrides:{},...settings};
  const runner=async({command,args,input=""}:{command:string;args:string[];input?:string})=>{
    const call={command,args:[...args],input};state.calls.push(call);
    const key=commandKey(call);
    const override=state.overrides[key];
    if(override)return override(call);
    if(key==="timeout --version")return {code:0,stdout:"timeout (GNU coreutils) 9.5"};
    if(key.startsWith("git check-ignore --quiet --"))return {code:0};
    if(key==="npx wrangler whoami")return {code:0,stdout:"logged in"};
    if(key==="npx wrangler d1 create openx-growth")return {code:0,stdout:`database_id = \"${databaseId}\"`};
    if(key==="npm run db:migrate:remote")return {code:0};
    if(key==="npm run build")return {code:0};
    if(key==="npm run deploy:cloudflare")return {code:0,stdout:`Deployed ${appUrl}`};
    if(key==="npx wrangler secret list --config wrangler.jsonc --format json")return {code:0,stdout:JSON.stringify([...state.remoteSecrets].map((name)=>({name,type:"secret_text"})))};
    if(key.startsWith("npx wrangler secret put ")){
      const name=args[3];state.remoteSecrets.add(name);return {code:0,stdout:"secret uploaded"};
    }
    return {code:1,stderr:`Unexpected command: ${key}`};
  };
  return {state,runner};
}

function createPrompt(answers:Record<string,string>={}) {
  const questions:string[]=[];
  const requests:{query:string;settings:Record<string,unknown>}[]=[];
  return {
    questions,
    requests,
    prompt:{ask:async(query:string,settings:Record<string,unknown>={})=>{questions.push(query);requests.push({query,settings});for(const [part,value] of Object.entries(answers))if(query.includes(part))return value;return "";}},
  };
}

function healthyHttp(url:string) {
  if(url.endsWith("/api/compliance"))return {status:200,body:{checks:{accessProtected:true,officialApiOnly:true,xConfigured:false}}};
  if(url.endsWith("/api/x/status"))return {status:200,body:{schema:{state:"ready"},origin:{currentMatchesCanonical:true}}};
  if(url.endsWith("/api/posts"))return {status:401,body:{error:"UNAUTHORIZED"}};
  return {status:404,body:{}};
}

function healthyConfiguredHttp(url:string) {
  if(url.endsWith("/api/compliance"))return {status:200,body:{checks:{accessProtected:true,officialApiOnly:true,xConfigured:true}}};
  return healthyHttp(url);
}

test("normal Wrangler commands inherit the terminal while secret input uses a pipe",()=>{
  assert.equal(commandStdinMode(""),"inherit");
  assert.equal(commandStdinMode("secret-value\n"),"pipe");
});

async function captureRun(options:Parameters<typeof runSetup>[0]) {
  const stdout:string[]=[];const stderr:string[]=[];
  const result=await runSetup({...options,stdout:(value:string)=>stdout.push(value),stderr:(value:string)=>stderr.push(value),healthTimeoutMs:0});
  return {result,stdout,stderr};
}

async function expectFailure(options:Parameters<typeof runSetup>[0],pattern:RegExp) {
  const stdout:string[]=[];const stderr:string[]=[];
  await assert.rejects(
    runSetup({...options,stdout:(value:string)=>stdout.push(value),stderr:(value:string)=>stderr.push(value),healthTimeoutMs:0}),
    (error:unknown)=>error instanceof SetupFailure&&error.exitCode!==0&&pattern.test(error.message),
  );
  assert.match(stderr.join("\n"),pattern);
  return {stdout,stderr};
}

test("full wizard calls external effects in order, uses stdin for secrets, and redacts all output",async(t)=>{
  const root=await fixtureRoot();t.after(()=>rm(root,{recursive:true,force:true}));
  const {state,runner}=createRunner();
  const {prompt}=createPrompt();
  let marker=1;const generated:string[]=[];
  const random=(bytes:number)=>{const value=Buffer.alloc(bytes,marker++);generated.push(value.toString("base64"));return value;};
  const {result,stdout,stderr}=await captureRun({root,runner,prompt,httpRunner:healthyHttp,randomBytes:random,nodeVersion:"v22.13.0"});
  assert.equal(result.appUrl,appUrl);
  assert.equal(result.xConfigured,false);
  assert.deepEqual(result.summaries.map((step)=>step.number),[1,2,3,4,5,6,7,8]);

  const keys=state.calls.map(commandKey);
  assert.ok(keys.indexOf("npx wrangler d1 create openx-growth")<keys.indexOf("npm run db:migrate:remote"));
  assert.ok(keys.indexOf("npm run db:migrate:remote")<keys.indexOf("npm run build"));
  assert.equal(keys.filter((key)=>key==="npm run deploy:cloudflare").length,2);
  const puts=state.calls.filter((call)=>commandKey(call).startsWith("npx wrangler secret put "));
  assert.deepEqual(puts.map((call)=>call.args[3]),requiredSecrets);
  for(const call of puts){
    assert.equal(call.args.includes(call.input.trim()),false,"secret must not appear in argv");
    assert.ok(call.input.endsWith("\n"));
  }
  const transcript=[...stdout,...stderr].join("\n");
  for(const secret of generated)assert.equal(transcript.includes(secret),false);
  const env=await readFile(join(root,".env.local"),"utf8");
  for(const secret of generated)assert.ok(env.includes(secret));
  assert.equal((await stat(join(root,".env.local"))).mode&0o777,0o600);
  assert.match(stdout.join("\n"),/Warning: X is not configured yet/);
  assert.match(stdout.join("\n"),/must match character-for-character/);
});

test("successful re-run preserves database, deployment, and remote secrets without generating or uploading values",async(t)=>{
  const root=await fixtureRoot();t.after(()=>rm(root,{recursive:true,force:true}));
  const {state,runner}=createRunner();
  const {prompt}=createPrompt();
  await captureRun({root,runner,prompt,httpRunner:healthyHttp,randomBytes:(bytes:number)=>Buffer.alloc(bytes,7),nodeVersion:"v22.13.0"});
  state.calls.length=0;
  let randomCalls=0;
  const second=await captureRun({root,runner,prompt,httpRunner:healthyHttp,randomBytes:(bytes:number)=>{randomCalls+=1;return Buffer.alloc(bytes,9);},nodeVersion:"v22.13.0"});
  const keys=state.calls.map(commandKey);
  assert.equal(randomCalls,0);
  assert.equal(keys.some((key)=>key.includes("d1 create")),false);
  assert.equal(keys.some((key)=>key==="npm run build"||key==="npm run deploy:cloudflare"),false);
  assert.equal(keys.some((key)=>key.includes("secret put")),false);
  assert.match(second.stdout.join("\n"),/already set — not rotated/);
});

test("D1 name conflict reuses the existing database without deleting data",async(t)=>{
  const root=await fixtureRoot();t.after(()=>rm(root,{recursive:true,force:true}));
  const {state,runner}=createRunner({overrides:{
    "npx wrangler d1 create openx-growth":()=>({code:1,stderr:"Database already exists"}),
    "npx wrangler d1 list --json":()=>({code:0,stdout:JSON.stringify([{name:"openx-growth",uuid:databaseId}])}),
  }});
  const {prompt}=createPrompt({"already exists":"yes"});
  await captureRun({root,runner,prompt,httpRunner:healthyHttp,randomBytes:(bytes:number)=>Buffer.alloc(bytes,1),nodeVersion:"v22.13.0"});
  assert.equal(state.calls.some((call)=>commandKey(call).includes("d1 delete")),false);
  assert.equal(JSON.parse(await readFile(join(root,"wrangler.jsonc"),"utf8")).d1_databases[0].database_id,databaseId);
});

test("preflight failures are diagnostic and non-zero",async(t)=>{
  const missing=await fixtureRoot({dependencies:false});t.after(()=>rm(missing,{recursive:true,force:true}));
  const base=createRunner();
  await expectFailure({root:missing,runner:base.runner,prompt:createPrompt().prompt,httpRunner:healthyHttp,nodeVersion:"v22.13.0"},/npm ci/);

  const timeoutRoot=await fixtureRoot();t.after(()=>rm(timeoutRoot,{recursive:true,force:true}));
  const noTimeout=createRunner({overrides:{"timeout --version":()=>({code:127,stderr:"not found"})}});
  await expectFailure({root:timeoutRoot,runner:noTimeout.runner,prompt:createPrompt().prompt,httpRunner:healthyHttp,nodeVersion:"v22.13.0"},/brew install coreutils/);

  const ignoredRoot=await fixtureRoot();t.after(()=>rm(ignoredRoot,{recursive:true,force:true}));
  const notIgnored=createRunner({overrides:{"git check-ignore --quiet -- .env.local":()=>({code:1})}});
  await expectFailure({root:ignoredRoot,runner:notIgnored.runner,prompt:createPrompt().prompt,httpRunner:healthyHttp,nodeVersion:"v22.13.0"},/.env.local is not ignored/);
});

test("Cloudflare login refusal exits with manual remediation",async(t)=>{
  const root=await fixtureRoot();t.after(()=>rm(root,{recursive:true,force:true}));
  const fake=createRunner({overrides:{
    "npx wrangler whoami":()=>({code:1,stderr:"not authenticated"}),
    "npx wrangler login":()=>({code:1,stderr:"declined"}),
  }});
  await expectFailure({root,runner:fake.runner,prompt:createPrompt().prompt,httpRunner:healthyHttp,nodeVersion:"v22.13.0"},/Cloudflare login failed/);
});

type FailureScenario={name:string;key:string;message:RegExp;setup:RunnerState["overrides"];answers?:Record<string,string>};

const failureScenarios:FailureScenario[]=[
  {name:"alternate D1 creation",key:"npx wrangler d1 create openx-growth-2",message:/D1 creation failed/,setup:{
    "npx wrangler d1 create openx-growth":()=>({code:1,stderr:"Database already exists"}),
    "npx wrangler d1 list --json":()=>({code:0,stdout:"[]"}),
    "npx wrangler d1 create openx-growth-2":()=>({code:1,stderr:"quota exceeded"}),
  },answers:{"alternate D1":"openx-growth-2"}},
  {name:"remote migration",key:"npm run db:migrate:remote",message:/Remote D1 migrations failed/,setup:{"npm run db:migrate:remote":()=>({code:1,stderr:"binding DB missing"})}},
  {name:"build",key:"npm run build",message:/Build failed/,setup:{"npm run build":()=>({code:1,stderr:"compile failure"})}},
  {name:"deploy",key:"npm run deploy:cloudflare",message:/Cloudflare deploy failed/,setup:{"npm run deploy:cloudflare":()=>({code:1,stderr:"upload failure"})}},
];

for(const scenario of failureScenarios){
  test(`${scenario.name} failure exits non-zero with recovery guidance`,async(t)=>{
    const root=await fixtureRoot();t.after(()=>rm(root,{recursive:true,force:true}));
    const fake=createRunner({overrides:scenario.setup});
    await expectFailure({root,runner:fake.runner,prompt:createPrompt(scenario.answers??{}).prompt,httpRunner:healthyHttp,randomBytes:(bytes:number)=>Buffer.alloc(bytes,1),nodeVersion:"v22.13.0"},scenario.message);
    assert.ok(fake.state.calls.some((call)=>commandKey(call)===scenario.key));
    assert.equal(fake.state.calls.some((call)=>commandKey(call).includes("d1 delete")),false);
  });
}

test("secret upload failure redacts an adversarial echoed secret and leaves it only in chmod-600 env",async(t)=>{
  const root=await fixtureRoot();t.after(()=>rm(root,{recursive:true,force:true}));
  const generated=Buffer.alloc(48,4).toString("base64");
  const fake=createRunner({overrides:{
    "npx wrangler secret put SESSION_SECRET --config wrangler.jsonc":(call)=>({code:1,stderr:`provider echoed ${call.input.trim()}`}),
  }});
  const captured=await expectFailure({root,runner:fake.runner,prompt:createPrompt().prompt,httpRunner:healthyHttp,randomBytes:(bytes:number)=>Buffer.alloc(bytes,4),nodeVersion:"v22.13.0"},/Could not upload SESSION_SECRET/);
  assert.equal([...captured.stdout,...captured.stderr].join("\n").includes(generated),false);
  assert.ok((await readFile(join(root,".env.local"),"utf8")).includes(generated));
  assert.equal((await stat(join(root,".env.local"))).mode&0o777,0o600);
});

test("existing remote secret without its local value fails closed instead of rotating",async(t)=>{
  const root=await fixtureRoot();t.after(()=>rm(root,{recursive:true,force:true}));
  const fake=createRunner({remoteSecrets:new Set(["SESSION_SECRET"])});
  let randomCalls=0;
  await expectFailure({root,runner:fake.runner,prompt:createPrompt().prompt,httpRunner:healthyHttp,randomBytes:(bytes:number)=>{randomCalls+=1;return Buffer.alloc(bytes,1);},nodeVersion:"v22.13.0"},/already set remotely but missing from .env.local/);
  assert.equal(randomCalls,0);
  assert.equal(fake.state.calls.some((call)=>commandKey(call).includes("secret put SESSION_SECRET")),false);
});

test("X_CLIENT_ID upload failure resumes from the saved local value without a rotation",async(t)=>{
  const root=await fixtureRoot();t.after(()=>rm(root,{recursive:true,force:true}));
  const fake=createRunner({overrides:{
    "npx wrangler secret put X_CLIENT_ID --config wrangler.jsonc":()=>({code:1,stderr:"temporary upload failure"}),
  }});
  const firstPrompt=createPrompt({"X_CLIENT_ID —":"fixture-public-client-id"});
  await expectFailure({root,runner:fake.runner,prompt:firstPrompt.prompt,httpRunner:healthyConfiguredHttp,randomBytes:(bytes:number)=>Buffer.alloc(bytes,3),nodeVersion:"v22.13.0"},/Could not upload X_CLIENT_ID/);
  assert.match(await readFile(join(root,".env.local"),"utf8"),/X_CLIENT_ID=fixture-public-client-id/);
  assert.equal(fake.state.remoteSecrets.has("X_CLIENT_ID"),false);

  delete fake.state.overrides["npx wrangler secret put X_CLIENT_ID --config wrangler.jsonc"];
  fake.state.calls.length=0;
  await captureRun({root,runner:fake.runner,prompt:createPrompt().prompt,httpRunner:healthyConfiguredHttp,randomBytes:()=>{throw new Error("required secrets must not rotate on resume");},nodeVersion:"v22.13.0"});
  const upload=fake.state.calls.find((call)=>commandKey(call)==="npx wrangler secret put X_CLIENT_ID --config wrangler.jsonc");
  assert.equal(upload?.input,"fixture-public-client-id\n");
  assert.equal(upload?.args.includes("fixture-public-client-id"),false);
});

test("X console step accepts an optional hidden client secret without exposing it",async(t)=>{
  const root=await fixtureRoot();t.after(()=>rm(root,{recursive:true,force:true}));
  const fake=createRunner();
  const prompts=createPrompt({"Paste X_CLIENT_ID now":"fixture-public-client-id","Optional X_CLIENT_SECRET":"fixture-private-client-secret"});
  const captured=await captureRun({root,runner:fake.runner,prompt:prompts.prompt,httpRunner:healthyConfiguredHttp,randomBytes:(bytes:number)=>Buffer.alloc(bytes,8),nodeVersion:"v22.13.0"});
  const secretUpload=fake.state.calls.find((call)=>commandKey(call)==="npx wrangler secret put X_CLIENT_SECRET --config wrangler.jsonc");
  assert.equal(secretUpload?.input,"fixture-private-client-secret\n");
  assert.equal(secretUpload?.args.includes("fixture-private-client-secret"),false);
  assert.equal([...captured.stdout,...captured.stderr].join("\n").includes("fixture-private-client-secret"),false);
  assert.match(await readFile(join(root,".env.local"),"utf8"),/X_CLIENT_SECRET=fixture-private-client-secret/);
  assert.equal(prompts.requests.find((request)=>request.query.includes("Optional X_CLIENT_SECRET"))?.settings.hidden,true);
});

test("malformed existing wrangler config is never overwritten or followed by D1 creation",async(t)=>{
  const root=await fixtureRoot();t.after(()=>rm(root,{recursive:true,force:true}));
  const malformed="{ invalid jsonc";
  await writeFile(join(root,"wrangler.jsonc"),malformed);
  const fake=createRunner();
  await expectFailure({root,runner:fake.runner,prompt:createPrompt().prompt,httpRunner:healthyHttp,nodeVersion:"v22.13.0"},/Existing wrangler.jsonc is invalid and was left unchanged/);
  assert.equal(await readFile(join(root,"wrangler.jsonc"),"utf8"),malformed);
  assert.equal(fake.state.calls.some((call)=>commandKey(call).includes("d1 create")),false);
});

test("parsable wrangler config without a valid DB id requires explicit replacement approval",async(t)=>{
  const root=await fixtureRoot();t.after(()=>rm(root,{recursive:true,force:true}));
  const placeholder=await readFile(join(root,"wrangler.example.jsonc"),"utf8");
  await writeFile(join(root,"wrangler.jsonc"),placeholder);
  const declined=createRunner();
  await expectFailure({root,runner:declined.runner,prompt:createPrompt().prompt,httpRunner:healthyHttp,nodeVersion:"v22.13.0"},/Existing wrangler.jsonc was left unchanged/);
  assert.equal(declined.state.calls.some((call)=>commandKey(call).includes("d1 create")),false);

  const approved=createRunner();
  const prompt=createPrompt({"Replace its local DB binding":"yes"});
  await captureRun({root,runner:approved.runner,prompt:prompt.prompt,httpRunner:healthyHttp,randomBytes:(bytes:number)=>Buffer.alloc(bytes,6),nodeVersion:"v22.13.0"});
  assert.equal(JSON.parse(await readFile(join(root,"wrangler.jsonc"),"utf8")).d1_databases[0].database_id,databaseId);
});

for(const health of [
  {name:"bearer rejection",http:(url:string)=>url.endsWith("/api/compliance")?{status:401,body:{error:"UNAUTHORIZED"}}:healthyHttp(url),message:/OPENX_API_TOKEN was not accepted/},
  {name:"misconfigured posture",http:(url:string)=>url.endsWith("/api/x/status")?{status:503,body:{error:"APP_ACCESS_TOKEN_REQUIRED"}}:healthyHttp(url),message:/missing APP_ACCESS_TOKEN/},
  {name:"origin mismatch",http:(url:string)=>url.endsWith("/api/x/status")?{status:200,body:{schema:{state:"ready"},origin:{currentMatchesCanonical:false}}}:healthyHttp(url),message:/APP_URL does not match/},
  {name:"unhealthy schema",http:(url:string)=>url.endsWith("/api/x/status")?{status:200,body:{schema:{state:"outdated"},origin:{currentMatchesCanonical:true}}}:healthyHttp(url),message:/D1 schema is outdated/},
  {name:"fail-open posts",http:(url:string)=>url.endsWith("/api/posts")?{status:200,body:{posts:[]}}:healthyHttp(url),message:/did not fail closed/},
] as const){
  test(`healthcheck ${health.name} exits non-zero with a specific diagnosis`,async(t)=>{
    const root=await fixtureRoot();t.after(()=>rm(root,{recursive:true,force:true}));
    const fake=createRunner();
    await expectFailure({root,runner:fake.runner,prompt:createPrompt().prompt,httpRunner:health.http,randomBytes:(bytes:number)=>Buffer.alloc(bytes,2),nodeVersion:"v22.13.0"},health.message);
  });
}

test("interruption-style command failure advises a resumable rerun and performs no destructive command",async(t)=>{
  const root=await fixtureRoot();t.after(()=>rm(root,{recursive:true,force:true}));
  const fake=createRunner({overrides:{"npm run db:migrate:remote":()=>({code:130,stderr:"interrupted"})}});
  await expectFailure({root,runner:fake.runner,prompt:createPrompt().prompt,httpRunner:healthyHttp,nodeVersion:"v22.13.0"},/re-run `npm run db:migrate:remote` or setup/);
  assert.equal(fake.state.calls.some((call)=>/delete|destroy/.test(commandKey(call))),false);
});

test("repository exposes the guided setup command in package, UI, and durable deployment docs",async()=>{
  const repositoryRoot=new URL("..",import.meta.url);
  const packageJson=JSON.parse(await readFile(new URL("package.json",repositoryRoot),"utf8"));
  const page=await readFile(new URL("app/page.tsx",repositoryRoot),"utf8");
  const readme=await readFile(new URL("README.md",repositoryRoot),"utf8");
  const deployment=await readFile(new URL("docs/DEPLOYMENT.md",repositoryRoot),"utf8");
  assert.equal(packageJson.scripts.setup,"node scripts/cli/init.mjs");
  assert.match(page,/guided Cloudflare deployment, run <code>npm run setup<\/code>/);
  assert.match(readme,/## Guided setup \(recommended\)/);
  assert.match(readme,/manual reference and recovery path/);
  assert.match(deployment,/## Guided setup/);
});
