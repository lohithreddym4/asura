import assert from "node:assert/strict";
import test from "node:test";
import { PlanSchema } from "../src/validator/plan.schema.js";

test("PlanSchema accepts exclusive refusal plans", () => {
  const plan = PlanSchema.parse({
    intent: "refusal",
    summary: "Refuse unsafe request",
    clarification: null,
    files: [],
    commands: [],
    refusal: "I cannot perform that action."
  });

  assert.equal(plan.refusal, "I cannot perform that action.");
});

test("PlanSchema rejects file paths outside the project", () => {
  assert.throws(() => PlanSchema.parse({
    intent: "modify",
    summary: "Unsafe path",
    clarification: null,
    files: [
      {
        action: "modify",
        path: "../outside.js",
        content: "console.log(\"nope\");"
      }
    ],
    commands: [],
    refusal: null
  }), /Unsafe file path/);
});
