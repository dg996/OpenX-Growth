import { z } from "zod";

export const MAX_X_POST_LENGTH=280;
export const MAX_THREAD_PARTS=25;

const partSchema=z.string().trim().min(1).max(MAX_X_POST_LENGTH);
const nullableText=(max:number)=>z.string().max(max).nullable().optional();

const createShape=z.object({
  text:partSchema.optional(),
  thread:z.array(partSchema).min(1).max(MAX_THREAD_PARTS).optional(),
  scheduledAt:z.number().int().positive().optional(),
  topic:z.string().trim().min(1).max(200).optional(),
  format:z.enum(["post","thread"]).optional(),
  hook:z.string().trim().min(1).max(1_000).optional(),
  evergreen:z.boolean().optional(),
  evergreenIntervalDays:z.number().int().min(7).max(365).optional(),
  generated:z.boolean().optional(),
}).strict();

function contentParts(text:string|undefined,thread:string[]|undefined,ctx:z.core.ParsePayload<unknown>) {
  const parts=thread??(text?[text]:[]);
  if(parts.length===0)ctx.issues.push({code:"custom",message:"Content is required",path:["text"],input:text});
  if(text&&thread&&text!==thread[0])ctx.issues.push({code:"custom",message:"Text must equal the first thread part",path:["thread",0],input:thread[0]});
  return parts;
}

export function createPostInputSchema(now=Date.now()) {
  return createShape.transform((input,ctx)=>{
    const parts=contentParts(input.text,input.thread,ctx);
    const format=input.format??(parts.length>1?"thread":"post");
    if((format==="post"&&parts.length!==1)||(format==="thread"&&parts.length<2))ctx.issues.push({code:"custom",message:"Format does not match content parts",path:["format"],input:format});
    if(input.scheduledAt!==undefined&&input.scheduledAt<=now)ctx.issues.push({code:"custom",message:"Schedule must be in the future",path:["scheduledAt"],input:input.scheduledAt});
    const evergreen=input.evergreen??false;
    if(!evergreen&&input.evergreenIntervalDays!==undefined)ctx.issues.push({code:"custom",message:"Evergreen interval requires evergreen=true",path:["evergreenIntervalDays"],input:input.evergreenIntervalDays});
    return {
      text:parts[0]??"",
      thread:parts,
      threadJson:parts.length>1?JSON.stringify(parts):null,
      status:input.scheduledAt!==undefined?"scheduled" as const:"draft" as const,
      scheduledAt:input.scheduledAt??null,
      topic:input.topic??null,
      format,
      hook:input.hook??parts[0]?.split("\n")[0]??null,
      generated:input.generated??false,
      evergreen,
      evergreenIntervalDays:evergreen?(input.evergreenIntervalDays??30):30,
    };
  });
}

type EditablePost={
  text:string;threadJson:string|null;format:string;status:string;scheduledAt:number|null;
  evergreen:boolean;evergreenIntervalDays:number;topic?:string|null;hook?:string|null;generated?:boolean;
};

const patchShape=z.object({
  text:partSchema.optional(),
  thread:z.array(partSchema).min(1).max(MAX_THREAD_PARTS).optional(),
  scheduledAt:z.number().int().positive().nullable().optional(),
  status:z.enum(["draft","scheduled"]).optional(),
  evergreen:z.boolean().optional(),
  evergreenIntervalDays:z.number().int().min(7).max(365).optional(),
  topic:z.string().trim().min(1).max(200).nullable().optional(),
  format:z.enum(["post","thread"]).optional(),
  hook:z.string().trim().min(1).max(1_000).nullable().optional(),
  generated:z.boolean().optional(),
}).strict().refine((input)=>Object.keys(input).length>0,{message:"At least one field is required"});

function decodeThread(threadJson:string|null) {
  if(!threadJson)return undefined;
  try{return z.array(partSchema).min(2).max(MAX_THREAD_PARTS).parse(JSON.parse(threadJson));}catch{return undefined;}
}

export function patchPostInputSchema(current:EditablePost,now=Date.now()) {
  return patchShape.transform((input,ctx)=>{
    const existingThread=decodeThread(current.threadJson);
    const nextThread=input.thread??existingThread;
    const nextText=input.text??(input.thread?.[0])??current.text;
    const parts=contentParts(nextText,nextThread,ctx);
    if(input.text!==undefined&&nextThread&&input.thread===undefined&&input.text!==nextThread[0])ctx.issues.push({code:"custom",message:"Text must equal the first thread part",path:["text"],input:input.text});
    const format=input.format??(parts.length>1?"thread":"post");
    if((format==="post"&&parts.length!==1)||(format==="thread"&&parts.length<2))ctx.issues.push({code:"custom",message:"Format does not match content parts",path:["format"],input:format});
    const scheduledAt=input.scheduledAt!==undefined?input.scheduledAt:current.scheduledAt;
    const inferredStatus=input.scheduledAt!==undefined?(scheduledAt===null?"draft":"scheduled"):(current.status==="scheduled"?"scheduled":"draft");
    const status=input.status??inferredStatus;
    if(status==="scheduled"&&(!scheduledAt||scheduledAt<=now))ctx.issues.push({code:"custom",message:"Scheduled posts require a future schedule",path:["scheduledAt"],input:scheduledAt});
    if(status==="draft"&&scheduledAt!==null)ctx.issues.push({code:"custom",message:"Draft posts cannot have a schedule",path:["status"],input:status});
    const evergreen=input.evergreen??current.evergreen;
    const interval=input.evergreenIntervalDays??current.evergreenIntervalDays;
    if(!evergreen&&input.evergreenIntervalDays!==undefined)ctx.issues.push({code:"custom",message:"Evergreen interval requires evergreen=true",path:["evergreenIntervalDays"],input:input.evergreenIntervalDays});
    return {
      text:parts[0]??"",thread:parts,threadJson:parts.length>1?JSON.stringify(parts):null,
      status,scheduledAt,evergreen,evergreenIntervalDays:evergreen?interval:30,
      topic:input.topic!==undefined?input.topic:(current.topic??null),
      format,hook:input.hook!==undefined?input.hook:(current.hook??parts[0]?.split("\n")[0]??null),
      generated:input.generated??current.generated??false,
    };
  });
}

export const publishablePostSchema=z.object({
  text:partSchema,
  threadJson:z.string().max(100_000).nullable(),
  format:z.enum(["post","thread"]),
  evergreen:z.boolean(),
  evergreenIntervalDays:z.number().int().min(7).max(365),
}).strict().transform((input,ctx)=>{
  let parts=[input.text];
  if(input.threadJson!==null){
    try{parts=z.array(partSchema).min(2).max(MAX_THREAD_PARTS).parse(JSON.parse(input.threadJson));}
    catch{ctx.issues.push({code:"custom",message:"Malformed thread",path:["threadJson"],input:input.threadJson});}
  }
  if(parts[0]!==input.text)ctx.issues.push({code:"custom",message:"Text must equal the first thread part",path:["threadJson"],input:input.threadJson});
  if((input.format==="post"&&parts.length!==1)||(input.format==="thread"&&parts.length<2))ctx.issues.push({code:"custom",message:"Format does not match content parts",path:["format"],input:input.format});
  return {...input,parts};
});

const portablePostShape=z.object({
  id:z.string().uuid().optional(),text:z.string().trim().min(1).max(25_000),threadJson:nullableText(100_000),
  status:z.enum(["draft","scheduled","publishing","published","failed"]).default("draft"),scheduledAt:z.number().int().nonnegative().nullable().optional(),
  publishedAt:z.number().int().nonnegative().nullable().optional(),xPostId:nullableText(100),publishedIdsJson:nullableText(10_000),topic:nullableText(200),
  format:z.enum(["post","thread","article"]).default("post"),hook:nullableText(1_000),generated:z.boolean().default(false),
  evergreen:z.boolean().default(false),evergreenIntervalDays:z.number().int().min(7).max(365).default(30),attempts:z.number().int().min(0).max(20).default(0),
  lastError:nullableText(1_000),createdAt:z.number().int().nonnegative(),updatedAt:z.number().int().nonnegative(),
}).strict();

const feedbackSchema=z.object({id:z.string().uuid().optional(),targetType:z.enum(["idea","reply"]),targetId:z.string().min(1).max(200),vote:z.union([z.literal(1),z.literal(-1)]),contextJson:nullableText(10_000),createdAt:z.number().int().nonnegative()}).strict();
const analyticsSchema=z.object({id:z.number().int().positive().optional(),postId:z.string().min(1).max(100),recordedAt:z.number().int().nonnegative(),impressions:z.number().int().nonnegative().default(0),likes:z.number().int().nonnegative().default(0),replies:z.number().int().nonnegative().default(0),reposts:z.number().int().nonnegative().default(0),bookmarks:z.number().int().nonnegative().default(0)}).strict();

export function importPayloadSchema(now=Date.now()) {
  const postSchema=portablePostShape.transform((input,ctx)=>{
    if(input.format==="article"){
      if(input.threadJson!==null&&input.threadJson!==undefined)ctx.addIssue({code:"custom",message:"Legacy articles cannot contain thread parts",path:["threadJson"]});
    }else{
      const publishable=publishablePostSchema.safeParse({text:input.text,threadJson:input.threadJson??null,format:input.format,evergreen:input.evergreen,evergreenIntervalDays:input.evergreenIntervalDays});
      if(!publishable.success)for(const issue of publishable.error.issues)ctx.addIssue({code:"custom",message:issue.message,path:issue.path});
    }
    if(input.status==="scheduled"&&(!input.scheduledAt||input.scheduledAt<=now))ctx.issues.push({code:"custom",message:"Scheduled imports require a future schedule",path:["scheduledAt"],input:input.scheduledAt});
    if(input.status==="published"&&(!input.publishedAt||!input.xPostId))ctx.issues.push({code:"custom",message:"Published import state is inconsistent",path:["status"],input:input.status});
    return input;
  });
  return z.object({schemaVersion:z.literal(1),exportedAt:z.string().datetime().optional(),posts:z.array(postSchema).max(1_000).default([]),feedback:z.array(feedbackSchema).max(5_000).default([]),analytics:z.array(analyticsSchema).max(10_000).default([])}).strict();
}

export const replyInputSchema=z.object({postId:z.string().trim().min(1).max(100),text:partSchema,generated:z.boolean().default(false)}).strict();

const publishActionSchema=z.object({action:z.literal("publish").default("publish")}).strict();
const reconcileAcceptedSchema=z.object({action:z.literal("reconcile"),resolution:z.literal("accepted"),xPostIds:z.array(z.string().trim().min(1).max(100)).min(1).max(MAX_THREAD_PARTS).refine((ids)=>new Set(ids).size===ids.length,{message:"X post IDs must be unique"})}).strict();
const reconcileRejectedSchema=z.object({action:z.literal("reconcile"),resolution:z.literal("not_accepted")}).strict();
export const publishCommandSchema=z.union([publishActionSchema,reconcileAcceptedSchema,reconcileRejectedSchema]);

export function validationIssues(error:z.ZodError) {
  return error.issues.slice(0,20).map((issue)=>({path:issue.path.join("."),message:issue.message}));
}
