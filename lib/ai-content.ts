import { z } from "zod";
import { MAX_THREAD_PARTS, MAX_X_POST_LENGTH } from "./post-validation.ts";

const partSchema = z.string().trim().min(1).max(MAX_X_POST_LENGTH);

const aiGenerationSchema = z
  .object({
    content: z.union([partSchema, z.array(partSchema).min(1).max(MAX_THREAD_PARTS)]),
    rationale: z.string().max(2_000).optional(),
    generated: z.literal(true),
  })
  .strict();

export type AiGenerationResult = z.infer<typeof aiGenerationSchema>;

export const AI_GENERATION_TIMEOUT_MS = 30_000;

export function normalizeAiContent(content: string | string[]): string[] {
  return (Array.isArray(content) ? content : [content]).map((part) => part.trim()).filter(Boolean);
}

export function parseAiGenerationResponse(raw: unknown): AiGenerationResult {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return aiGenerationSchema.parse(parsed);
}

export function safeParseAiGenerationResponse(raw: unknown) {
  try {
    return { ok: true as const, value: parseAiGenerationResponse(raw) };
  } catch {
    return { ok: false as const };
  }
}

export type AiDraftAvailability = "ready" | "not_configured" | "approval_required";

export function aiDraftAvailability(input: { aiConfigured: boolean; aiContentApproved: boolean }): AiDraftAvailability {
  if (!input.aiConfigured) return "not_configured";
  if (!input.aiContentApproved) return "approval_required";
  return "ready";
}

export function userFacingAiError(code?: string): string {
  switch (code) {
    case "AI_NOT_CONFIGURED":
      return "AI is not configured on this instance. Add AI_API_KEY in your deployment settings.";
    case "X_AI_CONTENT_APPROVAL_REQUIRED":
      return "AI content generation requires explicit approval. Set X_AI_CONTENT_APPROVED=true after reviewing your provider policy.";
    case "X_AI_REPLY_APPROVAL_REQUIRED":
      return "AI reply suggestions require X_AI_REPLIES_APPROVED=true.";
    case "AI_TIMEOUT":
      return "The AI provider took too long to respond. Try again with a shorter prompt.";
    case "AI_EMPTY_RESPONSE":
    case "AI_INVALID_RESPONSE":
      return "The AI provider returned an unusable response. Try again or edit manually.";
    case "INVALID_REQUEST":
      return "That AI request was invalid. Refresh and try again.";
    default:
      if (code?.startsWith("AI_PROVIDER_")) {
        return "The AI provider rejected the request. Check your API key, model and quota.";
      }
      return "AI generation is unavailable right now. Review Settings or try again.";
  }
}
