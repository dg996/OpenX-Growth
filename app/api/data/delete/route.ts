import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../db";
import { analyticsSnapshots, apiUsage, feedback, posts, secureStore, syncCache } from "../../../../db/schema";
import { clearXSession, hasAppAccess, requireCsrf } from "../../../../lib/security";

export async function DELETE(request:NextRequest) {
  if (!await hasAppAccess(request)) return NextResponse.json({error:"UNAUTHORIZED"},{status:401});
  try { requireCsrf(request); } catch { return NextResponse.json({error:"INVALID_CSRF"},{status:403}); }
  const db=getDb();
  await db.delete(analyticsSnapshots);
  await db.delete(feedback);
  await db.delete(posts);
  await db.delete(syncCache);
  await db.delete(apiUsage);
  await db.delete(secureStore);
  const response=NextResponse.json({deleted:true},{headers:{"Cache-Control":"no-store"}});
  clearXSession(response,request.nextUrl.protocol==="https:");
  return response;
}
