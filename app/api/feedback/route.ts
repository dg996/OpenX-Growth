import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../db";
import { feedback } from "../../../db/schema";
import { deploymentPosture } from "../../../lib/config";
import { getEffectiveConfig } from "../../../lib/runtime-settings";
import { authorizeBrowserOrApiMutation, authorizeBrowserOrApiRead } from "../../../lib/security";

export async function GET(request:NextRequest){const denied=await authorizeBrowserOrApiRead(request);if(denied)return denied;if(deploymentPosture(await getEffectiveConfig())==="demo")return NextResponse.json({feedback:[]});return NextResponse.json({feedback:await getDb().select().from(feedback).orderBy(desc(feedback.createdAt)).limit(500)})}
export async function POST(request:NextRequest){const denied=await authorizeBrowserOrApiMutation(request);if(denied)return denied;const input=await request.json() as {targetType?:"idea"|"reply";targetId?:string;vote?:number;context?:unknown};if(!input.targetType||!input.targetId||![1,-1].includes(input.vote??0))return NextResponse.json({error:"INVALID_FEEDBACK"},{status:400});const row={id:crypto.randomUUID(),targetType:input.targetType,targetId:input.targetId,vote:input.vote!,contextJson:input.context?JSON.stringify(input.context):null,createdAt:Date.now()};await getDb().insert(feedback).values(row);return NextResponse.json({feedback:row},{status:201})}
