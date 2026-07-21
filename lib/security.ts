import type { NextRequest, NextResponse } from "next/server";
import { deploymentPosture, instanceConfigured } from "./config.ts";
import { getEffectiveConfig } from "./runtime-settings.ts";
import { seal, unseal } from "./sealed.ts";

export { seal, unseal } from "./sealed.ts";

export const SESSION_COOKIE = "__Host-openx_session";
export const OAUTH_COOKIE = "__Host-openx_oauth";
export const CSRF_COOKIE = "__Host-openx_csrf";
export const AUTH_COOKIE = "__Host-openx_auth";

export type XSession = { accessToken:string; refreshToken?:string; clientId:string; expiresAt:number };
type AppAuthSession = { authorized:boolean; expiresAt:number; accessTokenBinding:string };

export function cookieName(name:string,secure:boolean) { return secure ? name : name.replace(/^__Host-/,""); }
export function readCookie(request:NextRequest,name:string) { return request.cookies.get(name)?.value ?? request.cookies.get(cookieName(name,false))?.value; }
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");

export async function getXSession(request:NextRequest) { return unseal<XSession>(readCookie(request,SESSION_COOKIE)); }

export async function setXSession(response:NextResponse,session:XSession,secure=true) {
  response.cookies.set(cookieName(SESSION_COOKIE,secure),await seal(session),{httpOnly:true,secure,sameSite:"lax",path:"/",maxAge:2_592_000});
}

export function clearXSession(response:NextResponse,secure=true) {
  response.cookies.set(cookieName(SESSION_COOKIE,secure),"",{httpOnly:true,secure,sameSite:"lax",path:"/",maxAge:0});
  if(secure) response.cookies.set(cookieName(SESSION_COOKIE,false),"",{httpOnly:true,secure:false,sameSite:"lax",path:"/",maxAge:0});
}

export function randomToken(bytes=24) { return encode(crypto.getRandomValues(new Uint8Array(bytes))); }

export async function safeEqual(left:string,right:string) {
  const [a,b] = await Promise.all([left,right].map((value)=>crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))));
  const aa=new Uint8Array(a),bb=new Uint8Array(b);let difference=0;
  for(let index=0;index<aa.length;index++)difference|=aa[index]^bb[index];
  return difference===0;
}

export async function hasBearerAuth(request:Pick<NextRequest,"headers">,expected:string|undefined) {
  const match=/^Bearer ([^\s]+)$/.exec(request.headers.get("authorization")??"");
  return Boolean(expected&&match&&await safeEqual(match[1],expected));
}

export async function appAccessBinding(appAccessToken:string) {
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`openx-app-access:${appAccessToken}`));
  return encode(new Uint8Array(digest));
}

export async function createAppAuthCookie(appAccessToken:string,expiresAt=Date.now()+2_592_000_000) {
  return seal({authorized:true,expiresAt,accessTokenBinding:await appAccessBinding(appAccessToken)} satisfies AppAuthSession);
}

export function requireCsrf(request:NextRequest) {
  const cookie = readCookie(request,CSRF_COOKIE);
  const header = request.headers.get("x-csrf-token");
  if (!cookie || !header || cookie !== header) throw new Error("CSRF_VALIDATION_FAILED");
}

export async function hasApiAuth(request:NextRequest) {
  const token=(await getEffectiveConfig()).apiToken;
  return hasBearerAuth(request,token);
}

export async function isAccessProtected() {
  return Boolean((await getEffectiveConfig()).appAccessToken);
}

export async function hasAppAccess(request:NextRequest) {
  const config=await getEffectiveConfig();
  const posture=deploymentPosture(config);
  if(posture==="demo")return true;
  if(posture==="misconfigured")return false;
  if(!config.appAccessToken)return false;
  const auth = await unseal<Partial<AppAuthSession>>(readCookie(request,AUTH_COOKIE));
  const expiresAt=auth?.expiresAt;
  const accessTokenBinding=auth?.accessTokenBinding;
  return auth?.authorized===true
    &&typeof expiresAt==="number"
    &&Number.isFinite(expiresAt)
    &&expiresAt>Date.now()
    &&typeof accessTokenBinding==="string"
    &&await safeEqual(accessTokenBinding,await appAccessBinding(config.appAccessToken));
}

async function postureResponse() {
  return deploymentPosture(await getEffectiveConfig())==="misconfigured"
    ? Response.json({error:"APP_ACCESS_TOKEN_REQUIRED",message:"Configured instances must set APP_ACCESS_TOKEN before any application data is exposed."},{status:503,headers:{"Cache-Control":"no-store"}})
    : null;
}

export async function configuredAccessGateResponse(){return postureResponse();}

const unauthorizedResponse=()=>Response.json({error:"UNAUTHORIZED"},{status:401,headers:{"Cache-Control":"no-store"}});

export async function authorizeBrowserRead(request:NextRequest) {
  const blocked=await postureResponse();
  if(blocked)return blocked;
  return await hasAppAccess(request)?null:unauthorizedResponse();
}

export async function authorizeBrowserOrApiRead(request:NextRequest) {
  const blocked=await postureResponse();
  if(blocked)return blocked;
  if(await hasApiAuth(request))return null;
  return await hasAppAccess(request)?null:unauthorizedResponse();
}

export async function authorizeBrowserMutation(request:NextRequest) {
  const unconfigured=await configuredInstanceResponse();
  if(unconfigured)return unconfigured;
  const denied=await authorizeBrowserRead(request);
  if(denied)return denied;
  try{requireCsrf(request);return null;}catch{return Response.json({error:"INVALID_CSRF"},{status:403});}
}

export async function authorizeBrowserOrApiMutation(request:NextRequest) {
  const unconfigured=await configuredInstanceResponse();
  if(unconfigured)return unconfigured;
  const denied=await authorizeBrowserOrApiRead(request);
  if(denied)return denied;
  if(await hasApiAuth(request))return null;
  try{requireCsrf(request);return null;}catch{return Response.json({error:"INVALID_CSRF"},{status:403});}
}

export async function configuredInstanceResponse() {
  if(instanceConfigured(await getEffectiveConfig()))return null;
  return Response.json({error:"INSTANCE_NOT_CONFIGURED",message:"Configure X_CLIENT_ID and SESSION_SECRET in your environment to enable this action."},{status:503});
}

export async function authorizeSettingsMutation(request:NextRequest) {
  const config=await getEffectiveConfig();
  if(!config.appAccessToken)return Response.json({error:"APP_ACCESS_TOKEN_REQUIRED"},{status:503,headers:{"Cache-Control":"no-store"}});
  const denied=await authorizeBrowserRead(request);if(denied)return denied;
  try{requireCsrf(request);return null;}catch{return Response.json({error:"INVALID_CSRF"},{status:403,headers:{"Cache-Control":"no-store"}});}
}

export async function authorizeSettingsRead(request:NextRequest) {
  if(!(await getEffectiveConfig()).appAccessToken)return Response.json({error:"APP_ACCESS_TOKEN_REQUIRED"},{status:503,headers:{"Cache-Control":"no-store"}});
  return authorizeBrowserRead(request);
}
