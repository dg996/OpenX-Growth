import { z } from "zod";

export type DeliveryState="idle"|"sending"|"accepted"|"confirmed"|"ambiguous";
export type PublishClaimState="available"|"active"|"recoverable"|"needs_review";

export const publishReceiptSchema=z.object({
  partIndex:z.number().int().nonnegative(),
  xPostId:z.string().trim().min(1).max(100),
  acceptedAt:z.number().int().nonnegative(),
  confirmedAt:z.number().int().nonnegative(),
}).strict().refine((receipt)=>receipt.confirmedAt>=receipt.acceptedAt,{message:"Confirmation cannot precede acceptance",path:["confirmedAt"]});

export const publishReceiptsSchema=z.array(publishReceiptSchema).max(25).superRefine((receipts,ctx)=>{
  receipts.forEach((receipt,index)=>{
    if(receipt.partIndex!==index)ctx.addIssue({code:"custom",message:"Receipts must be consecutive and ordered",path:[index,"partIndex"]});
  });
});

export type PublishReceipt=z.infer<typeof publishReceiptSchema>;

export function parsePublishReceipts(value:string|null|undefined):PublishReceipt[] {
  if(!value)return [];
  try{return publishReceiptsSchema.parse(JSON.parse(value));}catch{throw new Error("INVALID_PUBLISH_RECEIPTS");}
}

export function classifyPublishClaim(
  record:{status:string;claimExpiresAt:number|null;deliveryState:DeliveryState},
  now:number,
):PublishClaimState {
  if(record.status==="needs_review")return "needs_review";
  if(record.status!=="publishing")return "available";
  if(record.claimExpiresAt!==null&&record.claimExpiresAt>now)return "active";
  if(record.claimExpiresAt===null)return "needs_review";
  return record.deliveryState==="idle"||record.deliveryState==="confirmed"?"recoverable":"needs_review";
}

const SAFE_DETAIL_CODES=[
  /^X_PUBLISH_\d{3}$/,
  /^DAILY_X_(?:WRITE|RESOURCE)_(?:CAP|LIMIT)_REACHED$/,
  /^(?:AI_CONTENT_APPROVAL_REQUIRED|X_NOT_CONNECTED|X_RECONNECT_REQUIRED|X_PUBLISH_NO_ID|INVALID_PUBLISH_RECEIPTS|PUBLISH_PREFLIGHT_FAILED|POST_ALREADY_BEING_PUBLISHED|PUBLISH_NEEDS_REVIEW)$/,
];

export function redactPublishDetail(error:unknown) {
  const message=error instanceof Error?error.message:String(error);
  return SAFE_DETAIL_CODES.some((pattern)=>pattern.test(message))?message:"PUBLISH_FAILED";
}
