import { NextRequest, NextResponse } from "next/server";
import { deploymentPosture, protectedConfigSummary, publicConfig } from "../../../../lib/config";
import { authorizeBrowserRead, getXSession } from "../../../../lib/security";
import { loadXSession } from "../../../../lib/session-store";
export async function GET(request:NextRequest) {
  const denied=await authorizeBrowserRead(request);if(denied)return denied;
  const connected=deploymentPosture()==="demo"?false:Boolean(await getXSession(request)??await loadXSession());
  return NextResponse.json({connected,...publicConfig(),...protectedConfigSummary()},{headers:{"Cache-Control":"no-store"}});
}
