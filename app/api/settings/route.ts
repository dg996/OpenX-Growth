import { NextRequest, NextResponse } from "next/server";
import { deleteXCache } from "../../../lib/data";
import { getEffectiveConfig, runtimeSettingsInputSchema, runtimeSettingsView, updateManagedSettings } from "../../../lib/runtime-settings";
import { AUTH_COOKIE, authorizeSettingsMutation, authorizeSettingsRead, clearXSession, cookieName, createAppAuthCookie } from "../../../lib/security";
import { deleteXSession, markAuthorizationDisconnected } from "../../../lib/session-store";

const headers={"Cache-Control":"no-store"};

export async function GET(request:NextRequest) {
  const denied=await authorizeSettingsRead(request);if(denied)return denied;
  return NextResponse.json(await runtimeSettingsView(),{headers});
}

export async function PATCH(request:NextRequest) {
  const denied=await authorizeSettingsMutation(request);if(denied)return denied;
  const declared=Number(request.headers.get("content-length")??0);
  if(Number.isFinite(declared)&&declared>16_384)return NextResponse.json({error:"SETTINGS_INPUT_TOO_LARGE"},{status:413,headers});
  let raw:unknown;
  try{
    const text=await request.text();
    if(text.length>16_384)return NextResponse.json({error:"SETTINGS_INPUT_TOO_LARGE"},{status:413,headers});
    raw=JSON.parse(text);
  }catch{return NextResponse.json({error:"INVALID_SETTINGS_INPUT"},{status:400,headers});}
  const parsed=runtimeSettingsInputSchema.safeParse(raw);
  if(!parsed.success)return NextResponse.json({error:"INVALID_SETTINGS_INPUT"},{status:400,headers});
  const previous=await getEffectiveConfig();
  await updateManagedSettings(parsed.data);
  const xChanged=parsed.data.section==="x"&&(parsed.data.clientId!==previous.xClientId||parsed.data.clientSecret!==undefined||parsed.data.clearClientSecret);
  if(xChanged)await Promise.all([deleteXSession(),markAuthorizationDisconnected(),deleteXCache()]);
  const response=NextResponse.json({saved:true,xAuthorizationCleared:xChanged,settings:await runtimeSettingsView()},{headers});
  const secure=request.nextUrl.protocol==="https:";
  if(xChanged)clearXSession(response,secure);
  if(parsed.data.section==="access"){
    response.cookies.set(cookieName(AUTH_COOKIE,secure),await createAppAuthCookie(parsed.data.appAccessToken),{httpOnly:true,secure,sameSite:"strict",path:"/",maxAge:2_592_000});
  }
  return response;
}
