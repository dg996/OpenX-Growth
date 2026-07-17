import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("onboarding content keeps the step scrollable inside the fixed-height modal", () => {
  const css = readFileSync(new URL("../app/globals.css",import.meta.url),"utf8");

  assert.match(css,/\.setup-content\{min-height:0;overflow:hidden\}/);
  assert.match(css,/\.setup-step\{min-height:0\}/);
  assert.match(css,/\.setup-step\{[^}]*overflow:auto/);
});

test("disabled actions are visibly disabled instead of retaining the active button treatment", () => {
  const css = readFileSync(new URL("../app/globals.css",import.meta.url),"utf8");

  assert.match(css,/\.primary-btn:disabled/);
  assert.match(css,/cursor:not-allowed/);
  assert.match(css,/filter:saturate\(\.25\)/);
});
