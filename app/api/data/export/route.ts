import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../db";
import { analyticsSnapshots, feedback, posts } from "../../../../db/schema";
import { hasApiAuth, hasAppAccess } from "../../../../lib/security";

export async function GET(request:NextRequest){if(!await hasAppAccess(request)&&!hasApiAuth(request))return NextResponse.json({error:"UNAUTHORIZED"},{status:401});const [postRows,feedbackRows,analyticsRows]=await Promise.all([getDb().select().from(posts),getDb().select().from(feedback),getDb().select().from(analyticsSnapshots)]);return new NextResponse(JSON.stringify({schemaVersion:1,exportedAt:new Date().toISOString(),posts:postRows,feedback:feedbackRows,analytics:analyticsRows},null,2),{headers:{"Content-Type":"application/json","Content-Disposition":`attachment; filename="openx-growth-export-${new Date().toISOString().slice(0,10)}.json"`,"Cache-Control":"no-store"}})}
