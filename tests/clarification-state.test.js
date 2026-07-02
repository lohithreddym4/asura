import assert from "node:assert/strict";
import test from "node:test";
import {
  looksLikeClarificationAnswer,
  shouldReplacePendingClarification
} from "../src/clarification/state.js";

test("fresh task replaces a pending clarification", () => {
  assert.equal(
    shouldReplacePendingClarification("create a basic rag implementation here, with mongodb, langchain, langraph and voyage ai for embeddings"),
    true
  );
});

test("short clarification answer continues the pending request", () => {
  assert.equal(
    looksLikeClarificationAnswer("JavaScript, node:test, src/validator/plan.schema.js"),
    true
  );
  assert.equal(
    shouldReplacePendingClarification("JavaScript, node:test, src/validator/plan.schema.js"),
    false
  );
});

test("command-domain input replaces a pending clarification", () => {
  assert.equal(shouldReplacePendingClarification("git status"), true);
});
