import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../db";
import { feedback, posts } from "../../../../db/schema";
import { aiGenerationRequestSchema, AiGenerationError, generateAiSuggestion } from "../../../../lib/ai-generation";
import { appConfig } from "../../../../lib/config";
import { authorizeBrowserOrApiMutation } from "../../../../lib/security";

export async function POST(request:NextRequest){
  const denied=await authorizeBrowserOrApiMutation(request);if(denied)return denied;
  let body:unknown;try{body=await request.json()}catch{return NextResponse.json({error:"INVALID_REQUEST"},{status:400})}
  const parsed=aiGenerationRequestSchema.safeParse(body);if(!parsed.success)return NextResponse.json({error:"INVALID_REQUEST"},{status:400});
  const config=appConfig();const input=parsed.data;
  if(!config.aiApiKey)return NextResponse.json({error:"AI_NOT_CONFIGURED"},{status:503});if(!config.xAiContentApproved)return NextResponse.json({error:"X_AI_CONTENT_APPROVAL_REQUIRED"},{status:403});if(input.kind==="reply"&&!config.xAiRepliesApproved)return NextResponse.json({error:"X_AI_REPLY_APPROVAL_REQUIRED"},{status:403});
  const [history,votes]=await Promise.all([getDb().select({text:posts.text}).from(posts).where(eq(posts.generated,false)).orderBy(desc(posts.createdAt)).limit(12),getDb().select().from(feedback).orderBy(desc(feedback.createdAt)).limit(50)]);
  try{
    const suggestion=await generateAiSuggestion({input,baseUrl:config.aiBaseUrl,apiKey:config.aiApiKey,model:config.aiModel,styleSamples:history.map((row)=>row.text),feedbackSignals:votes.map((vote)=>`${vote.targetType}:${vote.vote}`)});
    return NextResponse.json(suggestion);
  }catch(error){
    const failure=error instanceof AiGenerationError?error:new AiGenerationError("AI_PROVIDER_UNAVAILABLE",502);
    return NextResponse.json({error:failure.code},{status:failure.status});
  }
}
