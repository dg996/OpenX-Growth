import assert from "node:assert/strict";
import test from "node:test";
import {
  aiDraftAvailability,
  normalizeAiContent,
  parseAiGenerationResponse,
  safeParseAiGenerationResponse,
  userFacingAiError,
} from "../lib/ai-content.ts";

test("parseAiGenerationResponse accepts bounded post and thread payloads", () => {
  const post = parseAiGenerationResponse({ content: "Hello world", generated: true });
  assert.equal(post.content, "Hello world");
  const thread = parseAiGenerationResponse({
    content: ["Part one", "Part two"],
    rationale: "Thread draft",
    generated: true,
  });
  assert.deepEqual(thread.content, ["Part one", "Part two"]);
});

test("parseAiGenerationResponse rejects empty or oversized content", () => {
  assert.throws(() => parseAiGenerationResponse({ content: "", generated: true }));
  assert.throws(() =>
    parseAiGenerationResponse({ content: "x".repeat(281), generated: true }),
  );
  assert.throws(() =>
    parseAiGenerationResponse({
      content: Array.from({ length: 26 }, () => "ok"),
      generated: true,
    }),
  );
});

test("safeParseAiGenerationResponse returns a soft failure for malformed payloads", () => {
  assert.equal(safeParseAiGenerationResponse({ generated: true }).ok, false);
});

test("normalizeAiContent trims parts and drops blanks", () => {
  assert.deepEqual(normalizeAiContent(["  one  ", "", "two"]), ["one", "two"]);
});

test("aiDraftAvailability reflects provider configuration and approval gates", () => {
  assert.equal(aiDraftAvailability({ aiConfigured: false, aiContentApproved: false }), "not_configured");
  assert.equal(aiDraftAvailability({ aiConfigured: true, aiContentApproved: false }), "approval_required");
  assert.equal(aiDraftAvailability({ aiConfigured: true, aiContentApproved: true }), "ready");
});

test("userFacingAiError hides internal provider codes from UI copy", () => {
  assert.match(userFacingAiError("AI_NOT_CONFIGURED"), /not configured/i);
  assert.match(userFacingAiError("X_AI_CONTENT_APPROVAL_REQUIRED"), /approval/i);
  assert.match(userFacingAiError("AI_PROVIDER_429"), /provider/i);
  assert.doesNotMatch(userFacingAiError("AI_NOT_CONFIGURED"), /AI_NOT_CONFIGURED/);
});
