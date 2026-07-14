import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "../../../../db";
import { feedback, posts } from "../../../../db/schema";
import {
  AI_GENERATION_TIMEOUT_MS,
  normalizeAiContent,
  safeParseAiGenerationResponse,
} from "../../../../lib/ai-content";
import { appConfig } from "../../../../lib/config";
import { authorizeBrowserOrApiMutation } from "../../../../lib/security";

const requestSchema = z
  .object({
    kind: z.enum(["idea", "post", "thread", "reply", "rewrite", "draft"]),
    prompt: z.string().trim().min(1).max(8_000),
    context: z.string().max(8_000).optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  const denied = await authorizeBrowserOrApiMutation(request);
  if (denied) return denied;

  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

  const config = appConfig();
  if (!config.aiApiKey) return NextResponse.json({ error: "AI_NOT_CONFIGURED" }, { status: 503 });
  if (!config.xAiContentApproved) {
    return NextResponse.json({ error: "X_AI_CONTENT_APPROVAL_REQUIRED" }, { status: 403 });
  }
  if (input.kind === "reply" && !config.xAiRepliesApproved) {
    return NextResponse.json({ error: "X_AI_REPLY_APPROVAL_REQUIRED" }, { status: 403 });
  }

  const [history, votes] = await Promise.all([
    getDb().select({ text: posts.text }).from(posts).orderBy(desc(posts.createdAt)).limit(30),
    getDb().select().from(feedback).orderBy(desc(feedback.createdAt)).limit(50),
  ]);

  const system = `You are a writing assistant inside an X growth tool. Never impersonate the user. Produce a suggestion for human review, not an autonomous action. Match the style samples without copying phrases. Avoid clickbait, fabricated facts, engagement bait, unsolicited mentions, harassment, and repetitive replies. Kind: ${input.kind}. Return JSON with keys content (string or string array for threads), rationale, and generated:true.\nSTYLE SAMPLES:\n${history.map((row) => row.text).join("\n---\n")}\nFEEDBACK SIGNALS:\n${votes.map((vote) => `${vote.targetType}:${vote.vote}`).join(",")}`;

  let response: Response;
  try {
    response = await fetch(`${config.aiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.aiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.aiModel,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: `REQUEST:\n${input.prompt}\nCONTEXT:\n${input.context ?? ""}` },
        ],
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(AI_GENERATION_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json({ error: "AI_TIMEOUT" }, { status: 504 });
    }
    throw error;
  }

  if (!response.ok) return NextResponse.json({ error: `AI_PROVIDER_${response.status}` }, { status: 502 });

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) return NextResponse.json({ error: "AI_EMPTY_RESPONSE" }, { status: 502 });

  const validated = safeParseAiGenerationResponse(raw);
  if (validated.ok) {
    return NextResponse.json({
      ...validated.value,
      content: normalizeAiContent(validated.value.content),
    });
  }

  try {
    const fallback = JSON.parse(raw) as { content?: unknown; rationale?: string; generated?: boolean };
    const parts = normalizeAiContent(
      Array.isArray(fallback.content)
        ? (fallback.content as string[])
        : typeof fallback.content === "string"
          ? [fallback.content]
          : [raw],
    );
    if (parts.some((part) => part.length > 280)) {
      return NextResponse.json({ error: "AI_INVALID_RESPONSE" }, { status: 502 });
    }
    return NextResponse.json({
      content: parts.length === 1 ? parts[0] : parts,
      rationale: fallback.rationale ?? "Generated suggestion",
      generated: true as const,
    });
  } catch {
    if (raw.length > 280) return NextResponse.json({ error: "AI_INVALID_RESPONSE" }, { status: 502 });
    return NextResponse.json({ content: raw, rationale: "Generated suggestion", generated: true as const });
  }
}
