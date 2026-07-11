import { NextRequest, NextResponse } from "next/server";
import { clearXSession, hasAppAccess, configuredInstanceResponse, requireCsrf } from "../../../../lib/security";
import { deleteXCache } from "../../../../lib/data";
import { deleteXSession } from "../../../../lib/session-store";
export async function POST(request:NextRequest) {
  const blocked=configuredInstanceResponse(); if(blocked)return blocked;
  if (!await hasAppAccess(request)) return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  try { requireCsrf(request); } catch { return NextResponse.json({error:"INVALID_CSRF"},{status:403}); }
  await Promise.all([deleteXSession(),deleteXCache()]); const response = NextResponse.json({connected:false}); clearXSession(response,request.nextUrl.protocol==="https:"); return response;
}
