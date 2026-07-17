import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root=resolve(new URL("..",import.meta.url).pathname);
const vite=join(root,"node_modules/.bin/vite");
const wrangler=join(root,"node_modules/.bin/wrangler");
const config=join(root,"tests/fixtures/wrangler.e2e.jsonc");
const accessToken="e2e-app-access-token";
const sessionSecret="e2e-session-secret-with-more-than-thirty-two-characters";
const analyticsFixtureNow=Date.now();

function safeEnv(extra={}) {
  const names=["PATH","HOME","TMPDIR","USER","SHELL","LANG","LC_ALL","CI"];
  const inherited=Object.fromEntries(names.flatMap((name)=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
  return {
    ...inherited,
    WRANGLER_WRITE_LOGS:"false",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:"false",
    CLOUDFLARE_INCLUDE_PROCESS_ENV:"false",
    ...extra,
  };
}

function redact(value) {
  return value
    .replace(/(authorization|cookie|set-cookie)\s*[:=]\s*[^\s,;]+/gi,"$1=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi,"Bearer [REDACTED]");
}

function run(command,args,options={}) {
  return new Promise((resolveRun,reject)=>{
    const child=spawn(command,args,{cwd:root,stdio:["ignore","pipe","pipe"],...options});
    let output="";
    for(const stream of [child.stdout,child.stderr])stream?.on("data",(chunk)=>{output=(output+redact(String(chunk))).slice(-20_000);});
    child.on("error",reject);
    child.on("exit",(code,signal)=>code===0?resolveRun({child,output}):reject(new Error(`${command} exited with ${code??signal}\n${output}`)));
  });
}

async function freePort() {
  return new Promise((resolvePort,reject)=>{
    const server=net.createServer();
    server.unref();
    server.on("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const address=server.address();
      const port=typeof address==="object"&&address?address.port:0;
      server.close((error)=>error?reject(error):resolvePort(port));
    });
  });
}

async function startAiFixture(port) {
  let duplicateRequests=0;
  const server=createServer(async(request,response)=>{
    if(request.method!=="POST"||request.url!=="/v1/chat/completions"){
      response.writeHead(404,{"Content-Type":"application/json"});response.end(JSON.stringify({error:"NOT_FOUND"}));return;
    }
    let body="";
    for await(const chunk of request)body+=String(chunk);
    if(body.includes("E2E_TIMEOUT")){
      await new Promise((resolveClose)=>response.once("close",resolveClose));return;
    }
    if(body.includes("E2E_PROVIDER_FAILURE")){
      response.writeHead(503,{"Content-Type":"text/plain"});response.end("FIXTURE_PRIVATE_PROVIDER_FAILURE");return;
    }
    if(body.includes("E2E_DELAYED_VALID"))await new Promise((resolveWait)=>setTimeout(resolveWait,3_000));
    if(body.includes("E2E_DUPLICATE")){duplicateRequests+=1;await new Promise((resolveWait)=>setTimeout(resolveWait,3_000));}
    let content;
    if(body.includes("E2E_VALID_THREAD"))content=JSON.stringify({content:["Fixture thread part one.","Fixture thread part two.","Fixture thread part three."],rationale:"Deterministic thread fixture."});
    else if(body.includes("E2E_MALFORMED_JSON"))content="not-json";
    else if(body.includes("E2E_OVERSIZED_PART"))content=JSON.stringify({content:"x".repeat(281),rationale:"Oversized fixture."});
    else if(body.includes("E2E_GUIDANCE"))content=JSON.stringify({content:"Share the original post or opening line first.",rationale:"Fixture guidance."});
    else if(body.includes("E2E_REFUSAL"))content=JSON.stringify({content:"I cannot help rewrite that request.",rationale:"Fixture refusal."});
    else if(body.includes("E2E_METADATA"))content=JSON.stringify({content:"Metadata: tone=concise",rationale:"Fixture metadata."});
    else if(body.includes("E2E_DUPLICATE"))content=JSON.stringify({content:duplicateRequests===1?"A single guarded rewrite.":"Duplicate request escaped the guard.",rationale:"Duplicate fixture."});
    else content=JSON.stringify({content:"A deterministic fixture post.",rationale:"Deterministic post fixture."});
    response.writeHead(200,{"Content-Type":"application/json"});
    response.end(JSON.stringify({choices:[{message:{content}}]}));
  });
  await new Promise((resolveListen,reject)=>{server.once("error",reject);server.listen(port,"127.0.0.1",resolveListen);});
  return {server,baseUrl:`http://127.0.0.1:${port}/v1`};
}

async function waitFor(url,expectedStatus,child,logs) {
  const deadline=Date.now()+45_000;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw new Error(`E2E server exited before readiness\n${logs()}`);
    try{const response=await fetch(url);if(response.status===expectedStatus)return;}catch{}
    await new Promise((resolveWait)=>setTimeout(resolveWait,250));
  }
  throw new Error(`Timed out waiting for ${url}\n${logs()}`);
}

const base64url=(bytes)=>Buffer.from(bytes).toString("base64url");

async function sealFixture(value,secret) {
  const iv=new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12]);
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));
  const key=await crypto.subtle.importKey("raw",digest,{name:"AES-GCM"},false,["encrypt"]);
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(JSON.stringify(value)));
  return `${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}

async function seedAnalytics(stateDir,now) {
  const publishDay=new Date(now-86_400_000);
  const statements=[];
  for(let index=0;index<8;index++){
    const hour=index<4?9:10;
    const publishedAt=Date.UTC(publishDay.getUTCFullYear(),publishDay.getUTCMonth(),publishDay.getUTCDate(),hour,index);
    statements.push(`INSERT INTO posts (id,text,status,published_at,x_post_id,format,generated,evergreen,evergreen_interval_days,attempts,created_at,updated_at) VALUES ('fixture-${index}','Fixture post ${index}','published',${publishedAt},'x-${index}','post',0,0,30,0,${publishedAt},${publishedAt})`);
    statements.push(`INSERT INTO analytics_snapshots (post_id,recorded_at,impressions,likes,replies,reposts,bookmarks) VALUES ('x-${index}',${now-index*1000},${index<4?10_000:100},10,0,0,0)`);
  }
  statements.push(`INSERT INTO analytics_snapshots (post_id,recorded_at,impressions,likes,replies,reposts,bookmarks) VALUES ('x-stale',${now-8*86_400_000},999999,999,0,0,0)`);
  statements.push(`INSERT INTO follower_snapshots (account_id,recorded_at,followers) VALUES ('owner',${now-2*86_400_000},120)`);
  statements.push(`INSERT INTO follower_snapshots (account_id,recorded_at,followers) VALUES ('owner',${now-86_400_000},123)`);
  const sealedSession=await sealFixture({accessToken:"fixture-access-token",refreshToken:"fixture-refresh-token",clientId:"e2e-x-client",expiresAt:now+3_600_000},sessionSecret);
  statements.push(`INSERT INTO secure_store (key,sealed_value,updated_at) VALUES ('x-session','${sealedSession}',${now})`);
  await run(wrangler,["d1","execute","DB","--local","--config",config,"--persist-to",stateDir,"--command",statements.join(";")],{env:safeEnv()});
}

async function seedDemoResidue(stateDir,now) {
  const statements=[
    `INSERT INTO posts (id,text,status,format,generated,evergreen,evergreen_interval_days,attempts,created_at,updated_at) VALUES ('demo-residue','must stay private','draft','post',0,0,30,0,${now},${now})`,
    `INSERT INTO feedback (id,target_type,target_id,vote,created_at) VALUES ('00000000-0000-4000-8000-000000000099','idea','private-feedback',1,${now})`,
    `INSERT INTO analytics_snapshots (post_id,recorded_at,impressions,likes,replies,reposts,bookmarks) VALUES ('private-x-id',${now},999,9,9,9,9)`,
    `INSERT INTO follower_snapshots (account_id,recorded_at,followers) VALUES ('private-account',${now},999)`,
    `INSERT INTO api_usage (day,reads,requests,resources,reserved_resources,writes,updated_at) VALUES ('${new Date(now).toISOString().slice(0,10)}',7,7,7,0,3,${now})`,
    `INSERT INTO secure_store (key,sealed_value,updated_at) VALUES ('x-session','unreadable-demo-residue',${now})`,
  ];
  await run(wrangler,["d1","execute","DB","--local","--config",config,"--persist-to",stateDir,"--command",statements.join(";")],{env:safeEnv()});
}

async function startInstance({port,stateDir,configured,protectedAccess,analyticsFixture=false,demoResidue=false,maxWrites,aiBaseUrl,aiEnabled=false}) {
  await run(wrangler,["d1","migrations","apply","DB","--local","--config",config,"--persist-to",stateDir],{env:safeEnv()});
  if(analyticsFixture)await seedAnalytics(stateDir,analyticsFixtureNow);
  if(demoResidue)await seedDemoResidue(stateDir,analyticsFixtureNow);
  const appUrl=`http://127.0.0.1:${port}`;
  const env=safeEnv({
    OPENX_E2E:"1",
    OPENX_E2E_STATE_DIR:stateDir,
    APP_URL:appUrl,
    X_CLIENT_ID:configured?"e2e-x-client":"",
    SESSION_SECRET:configured?sessionSecret:"",
    APP_ACCESS_TOKEN:protectedAccess?accessToken:"",
    OPENX_API_TOKEN:configured?"e2e-api-token":"",
    CRON_SECRET:configured?"e2e-cron-token":"",
    AI_API_KEY:aiEnabled?"e2e-ai-key":"",
    AI_BASE_URL:aiBaseUrl??"https://api.openai.com/v1",
    AI_MODEL:aiEnabled?"e2e-ai-model":"gpt-5-mini",
    X_AI_CONTENT_APPROVED:aiEnabled?"true":"false",
    X_AI_REPLIES_APPROVED:"false",
    MAX_DAILY_X_RESOURCES:protectedAccess?"25":"500",
    MAX_DAILY_X_WRITES:String(maxWrites??(protectedAccess?3:50)),
    OPENX_E2E_X_FIXTURE:protectedAccess?"sync":"",
  });
  const child=spawn(vite,["--host","127.0.0.1","--port",String(port),"--strictPort"],{cwd:root,env,stdio:["ignore","pipe","pipe"]});
  let output="";
  for(const stream of [child.stdout,child.stderr])stream?.on("data",(chunk)=>{output=(output+redact(String(chunk))).slice(-20_000);});
  await waitFor(`${appUrl}/api/x/status`,protectedAccess?401:configured?503:200,child,()=>output);
  return {child,appUrl,logs:()=>output};
}

const stateRoot=await mkdtemp(join(tmpdir(),"openx-growth-e2e-"));
const instances=[];
let aiFixture;
try{
  const ports=await Promise.all(Array.from({length:6},()=>freePort()));
  const [demoPort,misconfiguredPort,protectedPort,publisherPort,aiPort,aiFixturePort]=ports;
  aiFixture=await startAiFixture(aiFixturePort);
  instances.push(await startInstance({port:demoPort,stateDir:join(stateRoot,"demo"),configured:false,protectedAccess:false,demoResidue:true}));
  instances.push(await startInstance({port:misconfiguredPort,stateDir:join(stateRoot,"misconfigured"),configured:true,protectedAccess:false}));
  instances.push(await startInstance({port:protectedPort,stateDir:join(stateRoot,"protected"),configured:true,protectedAccess:true,analyticsFixture:true}));
  instances.push(await startInstance({port:publisherPort,stateDir:join(stateRoot,"publisher"),configured:true,protectedAccess:true,analyticsFixture:true,maxWrites:50}));
  instances.push(await startInstance({port:aiPort,stateDir:join(stateRoot,"ai"),configured:true,protectedAccess:true,analyticsFixture:true,aiBaseUrl:aiFixture.baseUrl,aiEnabled:true}));
  await run(process.execPath,["--test","tests/e2e-smoke.test.mjs"],{env:safeEnv({E2E_BASE_URL:instances[0].appUrl})});
  process.stdout.write("E2E demo fixture: passed\n");
  await run(process.execPath,["--test","tests/e2e-misconfigured.test.mjs"],{env:safeEnv({E2E_BASE_URL:instances[1].appUrl})});
  process.stdout.write("E2E misconfigured fixture: passed\n");
  await run(process.execPath,["--test","tests/e2e-configured.test.mjs"],{env:safeEnv({E2E_BASE_URL:instances[2].appUrl,E2E_APP_ACCESS_TOKEN:accessToken,E2E_API_TOKEN:"e2e-api-token",E2E_CRON_TOKEN:"e2e-cron-token",E2E_ANALYTICS_FIXTURE_NOW:String(analyticsFixtureNow)})});
  process.stdout.write("E2E protected fixture: passed\n");
  await run(process.execPath,["--test","tests/e2e-publisher-recovery.test.mjs"],{env:safeEnv({E2E_BASE_URL:instances[3].appUrl,E2E_API_TOKEN:"e2e-api-token",E2E_CRON_TOKEN:"e2e-cron-token"})});
  process.stdout.write("E2E publisher recovery fixture: passed\n");
  await run(process.execPath,["--test","tests/e2e-ai.test.mjs"],{env:safeEnv({E2E_BASE_URL:instances[4].appUrl,E2E_APP_ACCESS_TOKEN:accessToken})});
  process.stdout.write("E2E AI fixture: passed\n");
  if(process.env.OPENX_E2E_BROWSER_HOLD==="1"){
    process.stdout.write(`E2E browser fixtures: ai=${instances[4].appUrl} no-ai=${instances[2].appUrl}\n`);
    await new Promise((resolveHold)=>{process.once("SIGINT",resolveHold);process.once("SIGTERM",resolveHold);});
  }
}catch(error){
  for(const instance of instances)process.stderr.write(instance.logs());
  throw error;
}finally{
  for(const instance of instances)instance.child.kill("SIGTERM");
  await Promise.all(instances.map((instance)=>instance.child.exitCode!==null?Promise.resolve():new Promise((resolveExit)=>instance.child.once("exit",resolveExit))));
  if(aiFixture)await new Promise((resolveClose,reject)=>aiFixture.server.close((error)=>error?reject(error):resolveClose()));
  await rm(stateRoot,{recursive:true,force:true});
}
