import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { applyFileActions } from "../fs/applyFiles.js";
import { buildContext } from "../context/buildContext.js";
import { executeCommands } from "../executor/executeCommands.js";
import { extractMemoryFromPlan } from "../memory/extract.js";
import { buildRagIndex } from "../memory/rag.js";
import { scanProject } from "../memory/scan.js";
import { MemoryStore } from "../memory/store.js";
import { generatePlan } from "../planner/model.js";
import { getExecutionPolicy } from "../policy/executionPolicy.js";
import { detectProjectProfile, validationCommandsForFiles } from "../project/profile.js";
import { shouldReplacePendingClarification } from "../clarification/state.js";
import { addRunEvent, finishRunHistory, startRunHistory } from "./history.js";
import { printPlan } from "./planView.js";
import { buildRepairInstruction } from "./repair.js";
import { status } from "./status.js";

export const ASURA_GRAPH_NODES = [
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
];

function resolveImplicitTargets(input, memory) {
  const lastFile = memory.get("last_file");
  if (!lastFile) return input;

  return input.replace(
    /\b(it|that file|same file|previous file)\b/gi,
    lastFile
  );
}

function isDeleteIntent(input) {
  return /\bdelete\b/i.test(input);
}

function looksLikePureCommand(input) {
  return /\b(git|npm|npx|pnpm|yarn|docker)\b/i.test(input);
}

function mergeState(state, patch) {
  return {
    ...state,
    ...patch
  };
}

export async function invokeAsuraGraph(initialState) {
  const state = {
    dryRun: false,
    yes: false,
    verbose: true,
    maxRepairAttempts: 2,
    completedPlans: [],
    ...initialState
  };

  const graph = createAsuraLangGraph();
  const finalState = await graph.invoke(state);
  return finalState.result;
}

export function createAsuraLangGraph() {
  const nodes = createAsuraGraphNodes();
  const graph = new StateGraph(createAsuraStateAnnotation());

  for (const nodeName of ASURA_GRAPH_NODES) {
    graph.addNode(nodeName, guardTerminal(nodes[nodeName]));
  }

  graph.addEdge(START, "initialize");
  for (let i = 0; i < ASURA_GRAPH_NODES.length - 1; i++) {
    graph.addEdge(ASURA_GRAPH_NODES[i], ASURA_GRAPH_NODES[i + 1]);
  }
  graph.addEdge("updateMemory", END);

  return graph.compile();
}

function guardTerminal(node) {
  return async (state) => {
    if (state.terminal) return {};
    return node(state);
  };
}

function createAsuraStateAnnotation() {
  const replace = () => Annotation({
    reducer: (_current, value) => value,
    default: () => undefined
  });
  const replaceArray = () => Annotation({
    reducer: (_current, value) => value,
    default: () => []
  });
  const replaceBool = () => Annotation({
    reducer: (_current, value) => value,
    default: () => false
  });

  return Annotation.Root({
    instruction: replace(),
    dryRun: replaceBool(),
    yes: replaceBool(),
    json: replaceBool(),
    policy: replace(),
    executionPolicy: replace(),
    profile: replace(),
    history: replace(),
    verbose: Annotation({
      reducer: (_current, value) => value,
      default: () => true
    }),
    maxRepairAttempts: Annotation({
      reducer: (_current, value) => value,
      default: () => 2
    }),
    memory: replace(),
    projectRoot: replace(),
    pendingInput: replace(),
    pendingQuestion: replace(),
    ragContext: replace(),
    retrieved: replaceArray(),
    plan: replace(),
    completedPlans: replaceArray(),
    terminal: replaceBool(),
    result: replace()
  });
}

export async function invokeAsuraFallbackGraph(initialState) {
  let state = {
    dryRun: false,
    yes: false,
    verbose: true,
    maxRepairAttempts: 2,
    completedPlans: [],
    ...initialState
  };

  const nodes = createAsuraGraphNodes();

  state = mergeState(state, await nodes.initialize(state));
  state = mergeState(state, await nodes.prepareInstruction(state));
  state = mergeState(state, await nodes.ensureProjectIndex(state));
  state = mergeState(state, await nodes.handleUndo(state));
  if (state.terminal) return state.result;

  state = mergeState(state, await nodes.guardIntent(state));
  if (state.terminal) return state.result;

  state = mergeState(state, await nodes.retrieveContext(state));
  state = mergeState(state, await nodes.generatePlan(state));
  state = mergeState(state, await nodes.handleClarification(state));
  if (state.terminal) return state.result;

  state = mergeState(state, await nodes.executeWithRepair(state));
  if (state.terminal) return state.result;

  state = mergeState(state, await nodes.updateMemory(state));
  return state.result;
}

export function createAsuraGraphNodes() {
  return {
    async initialize(state) {
      const memory = new MemoryStore();
      const projectRoot = memory.get("project_root") || process.cwd();
      memory.set("project_root", projectRoot);
      const executionPolicy = getExecutionPolicy(state.policy);
      const history = startRunHistory(projectRoot, state.instruction, {
        dryRun: state.dryRun,
        yes: state.yes,
        json: state.json,
        policy: executionPolicy
      });

      status(state, "memory", `project ${projectRoot}`);
      status(state, "executor", `policy ${executionPolicy}`);
      addRunEvent(history, "initialize", { projectRoot, executionPolicy });

      return {
        memory,
        projectRoot,
        executionPolicy,
        history
      };
    },

    async prepareInstruction(state) {
      let instruction = state.instruction;
      let pendingInput = state.memory.get("pending_input");
      let pendingQuestion = state.memory.get("pending_question");

      if (pendingQuestion && shouldReplacePendingClarification(instruction)) {
        status(state, "memory", "clearing stale clarification");
        state.memory.set("pending_input", "");
        state.memory.set("pending_question", "");
        pendingInput = "";
        pendingQuestion = "";
      }

      if (pendingInput) {
        status(state, "memory", "merging clarification answer");
        instruction = `${pendingInput}. ${instruction}`;
      }

      return {
        instruction,
        pendingInput,
        pendingQuestion
      };
    },

    async ensureProjectIndex(state) {
      const profile = detectProjectProfile(state.projectRoot);
      state.memory.setJSON("project_profile", profile);
      status(state, "profile", `${profile.languages.join(",") || "unknown"} project`);
      addRunEvent(state.history, "profile", { profile });

      if (state.memory.hasScanned()) {
        return { profile };
      }

      status(state, "memory", "scanning project files");
      const { knownDirs, knownFiles } = scanProject(state.projectRoot);
      state.memory.setJSON("known_dirs", knownDirs);
      state.memory.setJSON("known_files", knownFiles.slice(-50));

      status(state, "rag", "building local index");
      const documents = buildRagIndex(state.projectRoot);
      state.memory.replaceDocuments(documents);
      state.memory.markScanned();
      status(state, "rag", `${documents.length} chunks indexed`);
      addRunEvent(state.history, "rag_indexed", { chunks: documents.length });

      return { profile };
    },

    async handleUndo(state) {
      if (state.instruction.trim() !== "undo") {
        return {};
      }

      status(state, "executor", "loading last undo action");
      const undo = state.memory.getJSON("last_undo", null);
      if (!undo) {
        console.log("Nothing to undo.");
        finishRunHistory(state.history, "noop");
        return {
          terminal: true,
          result: { status: "noop" }
        };
      }

      await applyFileActions([undo], { dryRun: false, autoYes: state.yes });
      state.memory.setJSON("last_undo", null);
      console.log("Undo applied.");
      finishRunHistory(state.history, "undone");

      return {
        terminal: true,
        result: { status: "undone" }
      };
    },

    async guardIntent(state) {
      const instruction = resolveImplicitTargets(state.instruction, state.memory);

      if (isDeleteIntent(instruction)) {
        const recent = state.memory.getJSON("recent_files", []);
        const hasExplicitPath = /\.[a-z0-9]+/i.test(instruction);

        if (!hasExplicitPath && recent.length !== 1) {
          console.log("Delete is ambiguous. Please specify the file explicitly.");
          return {
            instruction,
            terminal: true,
            result: { status: "blocked" }
          };
        }
      }

      if (looksLikePureCommand(instruction)) {
        state.memory.set("force_intent", "command");
      }

      return { instruction };
    },

    async retrieveContext(state) {
      status(state, "rag", "retrieving project context");
      const { ragContext, retrieved } = buildContext(state.instruction, state.memory);
      status(state, "rag", `${retrieved.length} chunks`);
      addRunEvent(state.history, "retrieved", {
        chunks: retrieved.map(doc => ({
          path: doc.path,
          startLine: doc.startLine,
          endLine: doc.endLine,
          score: doc.score
        }))
      });

      return {
        ragContext,
        retrieved
      };
    },

    async generatePlan(state) {
      status(state, "planner", "generating plan");
      const plan = await generatePlan(state.instruction, state.memory.all(), state.ragContext);
      status(state, "planner", "schema validated");
      addRunEvent(state.history, "plan", { plan });

      return { plan };
    },

    async handleClarification(state) {
      if (state.pendingInput && looksLikePureCommand(state.instruction)) {
        state.memory.set("pending_input", "");
        state.memory.set("pending_question", "");
      }

      if (state.pendingInput && state.plan.clarification) {
        console.log("Please answer the previous clarification:");
        console.log(state.pendingQuestion);
        finishRunHistory(state.history, "clarification_pending");
        return {
          terminal: true,
          result: { status: "clarification_pending" }
        };
      }

      if (state.plan.clarification) {
        console.log("Clarification needed:");
        console.log(state.plan.clarification);

        state.memory.set("pending_input", state.instruction);
        state.memory.set("pending_question", state.plan.clarification);
        finishRunHistory(state.history, "clarification_requested", { plan: state.plan });
        return {
          terminal: true,
          result: { status: "clarification_requested", plan: state.plan }
        };
      }

      state.memory.set("pending_input", "");
      state.memory.set("pending_question", "");
      return {};
    },

    async executeWithRepair(state) {
      const executionResult = await executePlanWithRepairs({
        plan: state.plan,
        originalInstruction: state.instruction,
        memory: state.memory,
        history: state.history,
        ragContext: state.ragContext,
        projectRoot: state.projectRoot,
        profile: state.profile,
        executionPolicy: state.executionPolicy,
        json: state.json,
        dryRun: state.dryRun,
        yes: state.yes,
        verbose: state.verbose,
        maxRepairAttempts: state.maxRepairAttempts
      });

      if (executionResult.status !== "completed") {
        return {
          terminal: true,
          result: executionResult
        };
      }

      return {
        plan: executionResult.plan,
        completedPlans: executionResult.completedPlans
      };
    },

    async updateMemory(state) {
      status(state, "memory", "updating memory");
      for (const completedPlan of state.completedPlans) {
        const extracted = extractMemoryFromPlan(completedPlan);
        for (const [key, value] of Object.entries(extracted)) {
          if (!state.memory.get(key)) {
            state.memory.set(key, value);
          }
        }
      }

      status(state, "memory", "done");
      finishRunHistory(state.history, "completed", { plan: state.plan });
      return {
        terminal: true,
        result: { status: "completed", plan: state.plan }
      };
    }
  };
}

async function executePlanWithRepairs({
  plan,
  originalInstruction,
  memory,
  history,
  ragContext,
  projectRoot,
  profile,
  executionPolicy,
  json,
  dryRun,
  yes,
  verbose,
  maxRepairAttempts
}) {
  const completedPlans = [];

  for (let attempt = 0; attempt <= maxRepairAttempts; attempt++) {
    if (attempt > 0) {
      status({ verbose }, "repair", `attempt ${attempt}/${maxRepairAttempts}`);
    }

    printPlan(plan, { json });
    addRunEvent(history, attempt === 0 ? "execute_plan" : "execute_repair_plan", { attempt, plan });

    try {
      await executePlan(plan, {
        projectRoot,
        profile,
        executionPolicy,
        dryRun,
        yes,
        verbose
      });
      completedPlans.push(plan);
      return { status: "completed", plan, completedPlans };
    } catch (err) {
      status({ verbose }, "repair", `execution failed: ${err.message}`);
      addRunEvent(history, "execution_error", {
        attempt,
        message: err.message,
        output: err.output || ""
      });

      if (attempt >= maxRepairAttempts) {
        console.error("Execution could not be repaired automatically.");
        finishRunHistory(history, "error", { error: err.message, plan });
        return { status: "error", error: err, plan, completedPlans };
      }

      const repairInstruction = buildRepairInstruction({
        originalInstruction,
        failedPlan: plan,
        error: err,
        attempt: attempt + 1,
        maxAttempts: maxRepairAttempts
      });

      status({ verbose }, "repair", "sending error back to planner");
      plan = await generatePlan(repairInstruction, memory.all(), ragContext);
      status({ verbose }, "repair", "repair plan schema validated");

      if (plan.clarification) {
        console.log("Clarification needed:");
        console.log(plan.clarification);
        memory.set("pending_input", originalInstruction);
        memory.set("pending_question", plan.clarification);
        finishRunHistory(history, "clarification_requested", { plan });
        return { status: "clarification_requested", plan, completedPlans };
      }
    }
  }

  return { status: "error", plan, completedPlans };
}

async function executePlan(plan, { projectRoot, profile, executionPolicy, dryRun, yes, verbose }) {
  if (plan.files.length > 0) {
    status({ verbose }, "executor", `applying ${plan.files.length} file action(s)`);
    await applyFileActions(plan.files, {
      dryRun,
      autoYes: yes
    });

    if (!dryRun) {
      status({ verbose }, "rag", "refreshing index after file changes");
      const documents = buildRagIndex(projectRoot);
      const memory = new MemoryStore();
      memory.replaceDocuments(documents);
      status({ verbose }, "rag", `${documents.length} chunks indexed`);

      const validationCommands = validationCommandsForFiles(plan.files, profile, projectRoot);
      if (validationCommands.length > 0) {
        status({ verbose }, "validate", `${validationCommands.length} check(s)`);
        await executeCommands(validationCommands, {
          dryRun,
          autoYes: true,
          policy: "auto",
          profile,
          projectRoot
        });
      }
    }
  }

  if (plan.commands.length > 0) {
    status({ verbose }, "executor", `running ${plan.commands.length} command(s)`);
    await executeCommands(plan.commands, {
      dryRun,
      autoYes: yes,
      policy: executionPolicy,
      profile,
      projectRoot
    });
  }
}
