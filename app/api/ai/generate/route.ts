import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../db";
import { feedback, posts } from "../../../../db/schema";
import { appConfig } from "../../../../lib/config";
import { hasApiAuth, hasAppAccess, configuredInstanceResponse, requireCsrf } from "../../../../lib/security";

export async function POST(request:NextRequest){
  const blocked=configuredInstanceResponse(); if(blocked)return blocked;
  const api=hasApiAuth(request);if(!await hasAppAccess(request)&&!api)return NextResponse.json({error:"UNAUTHORIZED"},{status:401});if(!api)try{requireCsrf(request)}catch{return NextResponse.json({error:"INVALID_CSRF"},{status:403})}
  const config=appConfig();const input=await request.json() as {kind?:"idea"|"post"|"thread"|"reply"|"rewrite";prompt?:string;context?:string};if(!input.kind||!input.prompt)return NextResponse.json({error:"INVALID_REQUEST"},{status:400});
  if(!config.aiApiKey)return NextResponse.json({error:"AI_NOT_CONFIGURED"},{status:503});if(!config.xAiContentApproved)return NextResponse.json({error:"X_AI_CONTENT_APPROVAL_REQUIRED"},{status:403});if(input.kind==="reply"&&!config.xAiRepliesApproved)return NextResponse.json({error:"X_AI_REPLY_APPROVAL_REQUIRED"},{status:403});
  const [history,votes]=await Promise.all([getDb().select({text:posts.text}).from(posts).orderBy(desc(posts.createdAt)).limit(30),getDb().select().from(feedback).orderBy(desc(feedback.createdAt)).limit(50)]);
  const system=`You are a writing assistant inside an X growth tool. Never impersonate the user. Produce a suggestion for human review, not an autonomous action. Match the style samples without copying phrases. Avoid clickbait, fabricated facts, engagement bait, unsolicited mentions, harassment, and repetitive replies. Kind: ${input.kind}. Return JSON with keys content (string or string array for threads), rationale, and generated:true.\nSTYLE SAMPLES:\n${history.map((row)=>row.text).join("\n---\n")}\nFEEDBACK SIGNALS:\n${votes.map((vote)=>`${vote.targetType}:${vote.vote}`).join(",")}`;
  const response=await fetch(`${config.aiBaseUrl.replace(/\/$/,"")}/chat/completions`,{method:"POST",headers:{Authorization:`Bearer ${config.aiApiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:config.aiModel,response_format:{type:"json_object"},messages:[{role:"system",content:system},{role:"user",content:`REQUEST:\n${input.prompt}\nCONTEXT:\n${input.context??""}`}],temperature:.7})});
  if(!response.ok)return NextResponse.json({error:`AI_PROVIDER_${response.status}`},{status:502});const payload=await response.json() as {choices?:Array<{message?:{content?:string}}>} ;const raw=payload.choices?.[0]?.message?.content;if(!raw)return NextResponse.json({error:"AI_EMPTY_RESPONSE"},{status:502});try{return NextResponse.json(JSON.parse(raw))}catch{return NextResponse.json({content:raw,rationale:"Generated suggestion",generated:true})}
}
