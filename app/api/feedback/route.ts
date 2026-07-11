import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../db";
import { feedback } from "../../../db/schema";
import { hasApiAuth, hasAppAccess, requireCsrf } from "../../../lib/security";

export async function GET(request:NextRequest){if(!await hasAppAccess(request)&&!hasApiAuth(request))return NextResponse.json({error:"UNAUTHORIZED"},{status:401});return NextResponse.json({feedback:await getDb().select().from(feedback).orderBy(desc(feedback.createdAt)).limit(500)})}
export async function POST(request:NextRequest){const api=hasApiAuth(request);if(!await hasAppAccess(request)&&!api)return NextResponse.json({error:"UNAUTHORIZED"},{status:401});if(!api)try{requireCsrf(request)}catch{return NextResponse.json({error:"INVALID_CSRF"},{status:403})}const input=await request.json() as {targetType?:"idea"|"reply";targetId?:string;vote?:number;context?:unknown};if(!input.targetType||!input.targetId||![1,-1].includes(input.vote??0))return NextResponse.json({error:"INVALID_FEEDBACK"},{status:400});const row={id:crypto.randomUUID(),targetType:input.targetType,targetId:input.targetId,vote:input.vote!,contextJson:input.context?JSON.stringify(input.context):null,createdAt:Date.now()};await getDb().insert(feedback).values(row);return NextResponse.json({feedback:row},{status:201})}
