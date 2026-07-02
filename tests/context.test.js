import assert from "node:assert/strict";
import test from "node:test";
import { buildContext } from "../src/context/buildContext.js";

test("buildContext returns retrieved chunks and formatted RAG context", () => {
  const memory = {
    allDocuments() {
      return [
        {
          id: "src/planner/model.js:1-2",
          path: "src/planner/model.js",
          startLine: 1,
          endLine: 2,
          content: "export function generatePlan() {}",
          tokens: ["src/planner/model.js", "generateplan", "planner"],
          updatedAt: Date.now()
        }
      ];
    }
  };

  const context = buildContext("planner generatePlan", memory);

  assert.equal(context.retrieved.length, 1);
  assert.match(context.ragContext, /src\/planner\/model\.js:1-2/);
});
