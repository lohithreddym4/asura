import assert from "node:assert/strict";
import test from "node:test";
import {
  ASURA_GRAPH_NODES,
  createAsuraGraphNodes,
  createAsuraLangGraph
} from "../src/runtime/asuraGraph.js";

test("Asura runtime is organized as explicit graph nodes", () => {
  assert.deepEqual(ASURA_GRAPH_NODES, [
    "initialize",
    "prepareInstruction",
    "ensureProjectIndex",
    "handleUndo",
    "guardIntent",
    "retrieveContext",
    "generatePlan",
    "handleClarification",
    "executeWithRepair",
    "updateMemory"
  ]);
});

test("createAsuraGraphNodes exposes every declared node", () => {
  const nodes = createAsuraGraphNodes();

  for (const nodeName of ASURA_GRAPH_NODES) {
    assert.equal(typeof nodes[nodeName], "function");
  }
});

test("createAsuraLangGraph compiles a LangGraph runtime", () => {
  const graph = createAsuraLangGraph();

  assert.equal(typeof graph.invoke, "function");
});
