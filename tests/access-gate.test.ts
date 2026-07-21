import assert from "node:assert/strict";
import test from "node:test";

import { deploymentPosture } from "../lib/config.ts";
import {
  AUTH_COOKIE,
  authorizeBrowserOrApiRead,
  authorizeBrowserRead,
  createAppAuthCookie,
  hasAppAccess,
  seal,
} from "../lib/security.ts";

const ENV_KEYS=["X_CLIENT_ID","SESSION_SECRET","APP_ACCESS_TOKEN","OPENX_API_TOKEN","CRON_SECRET"] as const;

function setEnv(values:Partial<Record<(typeof ENV_KEYS)[number],string>>) {
  for(const key of ENV_KEYS){
    if(values[key]===undefined)delete process.env[key];
    else process.env[key]=values[key];
  }
}

function request(options:{authorization?:string;cookies?:Record<string,string>}={}) {
  return {
    headers:{get:(name:string)=>name.toLowerCase()==="authorization"?(options.authorization??null):null},
    cookies:{get:(name:string)=>options.cookies?.[name]?{value:options.cookies[name]}:undefined},
  } as unknown as import("next/server").NextRequest;
}

test("deployment posture permits public demo only while X is unconfigured", async () => {
  setEnv({});
  assert.equal(deploymentPosture(),"demo");
  assert.equal(await hasAppAccess(request()),true);

  setEnv({X_CLIENT_ID:"client",SESSION_SECRET:"test-session-secret-with-more-than-thirty-two-characters"});
  assert.equal(deploymentPosture(),"misconfigured");
  assert.equal(await hasAppAccess(request()),false);
  const denied=await authorizeBrowserRead(request());
  assert.equal(denied?.status,503);
  assert.equal(((await denied?.json()) as {error:string}).error,"APP_ACCESS_TOKEN_REQUIRED");
  const apiDenied=await authorizeBrowserOrApiRead(request({authorization:"Bearer api-token"}));
  assert.equal(apiDenied?.status,503);
  assert.equal(((await apiDenied?.json()) as {error:string}).error,"APP_ACCESS_TOKEN_REQUIRED");
});

test("configured protected instances keep browser, API, and cron authorities separate", async () => {
  setEnv({
    X_CLIENT_ID:"client",
    SESSION_SECRET:"test-session-secret-with-more-than-thirty-two-characters",
    APP_ACCESS_TOKEN:"app-token",
    OPENX_API_TOKEN:"api-token",
    CRON_SECRET:"cron-token",
  });
  assert.equal(deploymentPosture(),"protected");
  assert.equal((await authorizeBrowserRead(request()))?.status,401);
  assert.equal((await authorizeBrowserRead(request({authorization:"Bearer app-token"})))?.status,401);
  assert.equal((await authorizeBrowserRead(request({authorization:"Bearer api-token"})))?.status,401);
  assert.equal((await authorizeBrowserOrApiRead(request({authorization:"Bearer api-token"}))),null);
  assert.equal((await authorizeBrowserOrApiRead(request({authorization:"Bearer wrong-token"})))?.status,401);
  assert.equal((await authorizeBrowserOrApiRead(request()))?.status,401);
  assert.equal((await authorizeBrowserOrApiRead(request({authorization:"Bearer cron-token"})))?.status,401);
});

test("browser access rejects expired or tampered cookies", async () => {
  setEnv({
    X_CLIENT_ID:"client",
    SESSION_SECRET:"test-session-secret-with-more-than-thirty-two-characters",
    APP_ACCESS_TOKEN:"app-token",
  });
  const valid=await createAppAuthCookie("app-token",Date.now()+60_000);
  const expired=await createAppAuthCookie("app-token",Date.now()-1);
  const stale=await createAppAuthCookie("old-app-token",Date.now()+60_000);
  const legacy=await seal({authorized:true,expiresAt:Date.now()+60_000});
  assert.equal(await hasAppAccess(request({cookies:{[AUTH_COOKIE]:valid}})),true);
  assert.equal(await hasAppAccess(request({cookies:{[AUTH_COOKIE]:expired}})),false);
  assert.equal(await hasAppAccess(request({cookies:{[AUTH_COOKIE]:`${valid}tampered`}})),false);
  assert.equal(await hasAppAccess(request({cookies:{[AUTH_COOKIE]:stale}})),false);
  assert.equal(await hasAppAccess(request({cookies:{[AUTH_COOKIE]:legacy}})),false);
});
