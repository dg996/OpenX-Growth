import { NextRequest, NextResponse } from "next/server";
import { publicConfig } from "../../../../lib/config";
import { getXSession, hasAppAccess } from "../../../../lib/security";
import { loadXSession } from "../../../../lib/session-store";
export async function GET(request:NextRequest) {
  if (!await hasAppAccess(request)) return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  return NextResponse.json({connected:Boolean(await getXSession(request) ?? await loadXSession()),...publicConfig()},{headers:{"Cache-Control":"no-store"}});
}
