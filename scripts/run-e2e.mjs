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
  const server=createServer(async(request,response)=>{
    if(request.method!=="POST"||request.url!=="/v1/chat/completions"){
      response.writeHead(404,{"Content-Type":"application/json"});response.end(JSON.stringify({error:"NOT_FOUND"}));return;
    }
    let body="";
    for await(const chunk of request)body+=String(chunk);
    if(body.includes("E2E_PROVIDER_FAILURE")){
      response.writeHead(503,{"Content-Type":"text/plain"});response.end("FIXTURE_PRIVATE_PROVIDER_FAILURE");return;
    }
    let content;
    if(body.includes("E2E_VALID_THREAD"))content=JSON.stringify({content:["Fixture thread part one.","Fixture thread part two.","Fixture thread part three."],rationale:"Deterministic thread fixture."});
    else if(body.includes("E2E_MALFORMED_JSON"))content="not-json";
    else if(body.includes("E2E_OVERSIZED_PART"))content=JSON.stringify({content:"x".repeat(281),rationale:"Oversized fixture."});
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

async function seedAnalytics(stateDir,now,{sessionMode="valid",seedCache=false,analyticsRecords=true}={}) {
  const publishDay=new Date(now-86_400_000);
  const statements=[];
  for(let index=0;analyticsRecords&&index<8;index++){
    const hour=index<4?9:10;
    const publishedAt=Date.UTC(publishDay.getUTCFullYear(),publishDay.getUTCMonth(),publishDay.getUTCDate(),hour,index);
    statements.push(`INSERT INTO posts (id,text,status,published_at,x_post_id,format,generated,evergreen,evergreen_interval_days,attempts,created_at,updated_at) VALUES ('fixture-${index}','Fixture post ${index}','published',${publishedAt},'x-${index}','post',0,0,30,0,${publishedAt},${publishedAt})`);
    statements.push(`INSERT INTO analytics_snapshots (post_id,recorded_at,impressions,likes,replies,reposts,bookmarks) VALUES ('x-${index}',${now-index*1000},${index<4?10_000:100},10,0,0,0)`);
  }
  if(analyticsRecords){
    statements.push(`INSERT INTO analytics_snapshots (post_id,recorded_at,impressions,likes,replies,reposts,bookmarks) VALUES ('x-stale',${now-8*86_400_000},999999,999,0,0,0)`);
    statements.push(`INSERT INTO follower_snapshots (account_id,recorded_at,followers) VALUES ('owner',${now-2*86_400_000},120)`);
    statements.push(`INSERT INTO follower_snapshots (account_id,recorded_at,followers) VALUES ('owner',${now-86_400_000},123)`);
  }
  const sealedSession=await sealFixture({accessToken:"fixture-access-token",...(sessionMode==="expired-no-refresh"?{}:{refreshToken:"fixture-refresh-token"}),clientId:"e2e-x-client",expiresAt:sessionMode==="valid"?now+3_600_000:now-1},sessionSecret);
  statements.push(`INSERT INTO secure_store (key,sealed_value,updated_at) VALUES ('x-session','${sealedSession}',${now})`);
  if(seedCache){const payload=JSON.stringify({source:"live",syncedAt:new Date(now-60_000).toISOString(),account:{id:"owner",name:"Fixture Owner",username:"fixture_owner"},opportunities:[],ideas:[],usage:{}}).replaceAll("'","''");statements.push(`INSERT INTO sync_cache (key,payload,expires_at,updated_at) VALUES ('x-growth-sync','${payload}',${now-1},${now-60_000})`);}
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

async function startInstance({port,stateDir,configured,protectedAccess,analyticsFixture=false,analyticsRecords=true,demoResidue=false,maxWrites,maxResources,aiBaseUrl,aiEnabled=false,schemaLevel="current",sessionMode="valid",seedCache=false,syncDelayMs,syncStatus,sparse=false}) {
  if(schemaLevel==="current")await run(wrangler,["d1","migrations","apply","DB","--local","--config",config,"--persist-to",stateDir],{env:safeEnv()});
  else if(schemaLevel!=="none"){
    const through=schemaLevel==="0000"?0:2;
    for(let index=0;index<=through;index++){const file=["0000_far_blink.sql","0001_woozy_darkstar.sql","0002_clean_proteus.sql"][index];await run(wrangler,["d1","execute","DB","--local","--config",config,"--persist-to",stateDir,"--file",join(root,"drizzle",file)],{env:safeEnv()});}
  }
  if(analyticsFixture)await seedAnalytics(stateDir,analyticsFixtureNow,{sessionMode,seedCache,analyticsRecords});
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
    MAX_DAILY_X_RESOURCES:String(maxResources??(protectedAccess?25:500)),
    MAX_DAILY_X_WRITES:String(maxWrites??(protectedAccess?3:50)),
    OPENX_E2E_X_FIXTURE:protectedAccess?"sync":"",
    OPENX_E2E_SYNC_DELAY_MS:String(syncDelayMs??""),
    OPENX_E2E_SYNC_STATUS:String(syncStatus??""),
    OPENX_E2E_SYNC_SPARSE:sparse?"1":"0",
  });
  const child=spawn(vite,["--host","127.0.0.1","--port",String(port),"--strictPort"],{cwd:root,env,stdio:["ignore","pipe","pipe"]});
  let output="";
  for(const stream of [child.stdout,child.stderr])stream?.on("data",(chunk)=>{output=(output+redact(String(chunk))).slice(-20_000);});
  await waitFor(`${appUrl}/api/x/status`,schemaLevel!=="current"?503:protectedAccess?401:configured?503:200,child,()=>output);
  return {child,appUrl,logs:()=>output};
}

const stateRoot=await mkdtemp(join(tmpdir(),"openx-growth-e2e-"));
const instances=[];
let aiFixture;
try{
  const ports=await Promise.all(Array.from({length:12},()=>freePort()));
  const [demoPort,misconfiguredPort,protectedPort,publisherPort,aiPort,aiFixturePort,missingSchemaPort,outdated0000Port,outdated0002Port,refreshSuccessPort,refreshRejectPort,noRefreshPort]=ports;
  aiFixture=await startAiFixture(aiFixturePort);
  instances.push(await startInstance({port:demoPort,stateDir:join(stateRoot,"demo"),configured:false,protectedAccess:false,demoResidue:true}));
  instances.push(await startInstance({port:misconfiguredPort,stateDir:join(stateRoot,"misconfigured"),configured:true,protectedAccess:false}));
  instances.push(await startInstance({port:protectedPort,stateDir:join(stateRoot,"protected"),configured:true,protectedAccess:true,analyticsFixture:true}));
  instances.push(await startInstance({port:publisherPort,stateDir:join(stateRoot,"publisher"),configured:true,protectedAccess:true,analyticsFixture:true,maxWrites:50}));
  instances.push(await startInstance({port:aiPort,stateDir:join(stateRoot,"ai"),configured:true,protectedAccess:true,analyticsFixture:true,aiBaseUrl:aiFixture.baseUrl,aiEnabled:true}));
  instances.push(await startInstance({port:missingSchemaPort,stateDir:join(stateRoot,"schema-missing"),configured:true,protectedAccess:true,schemaLevel:"none"}));
  instances.push(await startInstance({port:outdated0000Port,stateDir:join(stateRoot,"schema-0000"),configured:true,protectedAccess:true,schemaLevel:"0000"}));
  instances.push(await startInstance({port:outdated0002Port,stateDir:join(stateRoot,"schema-0002"),configured:true,protectedAccess:true,schemaLevel:"0002"}));
  instances.push(await startInstance({port:refreshSuccessPort,stateDir:join(stateRoot,"refresh-success"),configured:true,protectedAccess:true,analyticsFixture:true,sessionMode:"expired-refresh"}));
  instances.push(await startInstance({port:refreshRejectPort,stateDir:join(stateRoot,"refresh-reject"),configured:true,protectedAccess:true,analyticsFixture:true,sessionMode:"expired-refresh",seedCache:true}));
  instances.push(await startInstance({port:noRefreshPort,stateDir:join(stateRoot,"no-refresh"),configured:true,protectedAccess:true,analyticsFixture:true,sessionMode:"expired-no-refresh",seedCache:true}));
  if(process.env.OPENX_E2E_BROWSER_HOLD==="1"){
    const [disconnectedPort,firstSyncPort,cachedRefreshPort,cachedFailurePort,sparsePort,budgetPort]=await Promise.all(Array.from({length:6},()=>freePort()));
    const browserInstances=[
      await startInstance({port:disconnectedPort,stateDir:join(stateRoot,"browser-disconnected"),configured:true,protectedAccess:true}),
      await startInstance({port:firstSyncPort,stateDir:join(stateRoot,"browser-first-sync"),configured:true,protectedAccess:true,analyticsFixture:true,analyticsRecords:false,syncDelayMs:8_000}),
      await startInstance({port:cachedRefreshPort,stateDir:join(stateRoot,"browser-cached-refresh"),configured:true,protectedAccess:true,analyticsFixture:true,seedCache:true,syncDelayMs:8_000}),
      await startInstance({port:cachedFailurePort,stateDir:join(stateRoot,"browser-cached-failure"),configured:true,protectedAccess:true,analyticsFixture:true,seedCache:true,syncStatus:503}),
      await startInstance({port:sparsePort,stateDir:join(stateRoot,"browser-sparse"),configured:true,protectedAccess:true,analyticsFixture:true,analyticsRecords:false,sparse:true}),
      await startInstance({port:budgetPort,stateDir:join(stateRoot,"browser-budget"),configured:true,protectedAccess:true,analyticsFixture:true,maxResources:10}),
    ];
    instances.push(...browserInstances);
    process.stdout.write(`BROWSER_FIXTURES ${JSON.stringify({readyToSync:instances[2].appUrl,aiReady:instances[4].appUrl,schemaMissing:instances[5].appUrl,reconnect:instances[10].appUrl,readyToConnect:browserInstances[0].appUrl,firstSync:browserInstances[1].appUrl,cachedRefresh:browserInstances[2].appUrl,cachedFailure:browserInstances[3].appUrl,sparse:browserInstances[4].appUrl,budget:browserInstances[5].appUrl})}\n`);
    await new Promise((resolveHold)=>{process.once("SIGINT",resolveHold);process.once("SIGTERM",resolveHold);});
  }else{
  await run(process.execPath,["--test","tests/e2e-smoke.test.mjs"],{env:safeEnv({E2E_BASE_URL:instances[0].appUrl})});
  process.stdout.write("E2E demo fixture: passed\n");
  await run(process.execPath,["--test","tests/e2e-misconfigured.test.mjs"],{env:safeEnv({E2E_BASE_URL:instances[1].appUrl})});
  process.stdout.write("E2E misconfigured fixture: passed\n");
  await run(process.execPath,["--test","tests/e2e-configured.test.mjs"],{env:safeEnv({E2E_BASE_URL:instances[2].appUrl,E2E_MISMATCH_BASE_URL:instances[2].appUrl.replace("127.0.0.1","localhost"),E2E_APP_ACCESS_TOKEN:accessToken,E2E_API_TOKEN:"e2e-api-token",E2E_CRON_TOKEN:"e2e-cron-token",E2E_ANALYTICS_FIXTURE_NOW:String(analyticsFixtureNow)})});
  process.stdout.write("E2E protected fixture: passed\n");
  await run(process.execPath,["--test","tests/e2e-publisher-recovery.test.mjs"],{env:safeEnv({E2E_BASE_URL:instances[3].appUrl,E2E_API_TOKEN:"e2e-api-token",E2E_CRON_TOKEN:"e2e-cron-token"})});
  process.stdout.write("E2E publisher recovery fixture: passed\n");
  await run(process.execPath,["--test","tests/e2e-ai.test.mjs"],{env:safeEnv({E2E_BASE_URL:instances[4].appUrl,E2E_APP_ACCESS_TOKEN:accessToken})});
  process.stdout.write("E2E AI fixture: passed\n");
  for(const [instance,expected] of [[instances[5],"LOCAL_DATABASE_NOT_INITIALIZED"],[instances[6],"LOCAL_DATABASE_OUTDATED"],[instances[7],"LOCAL_DATABASE_OUTDATED"]])await run(process.execPath,["--test","tests/e2e-schema-health.test.mjs"],{env:safeEnv({E2E_BASE_URL:instance.appUrl,E2E_EXPECTED_SCHEMA_CODE:expected})});
  process.stdout.write("E2E schema health fixtures: passed\n");
  await run(process.execPath,["--test","tests/e2e-session-health.test.mjs"],{env:safeEnv({E2E_REFRESH_SUCCESS_URL:instances[8].appUrl,E2E_REFRESH_REJECT_URL:instances[9].appUrl,E2E_NO_REFRESH_URL:instances[10].appUrl,E2E_APP_ACCESS_TOKEN:accessToken})});
  process.stdout.write("E2E authorization health fixtures: passed\n");
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
