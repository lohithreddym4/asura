import { applyFileActions } from "../fs/applyFiles.js";
import { buildContext } from "../context/buildContext.js";
import { executeCommands } from "../executor/executeCommands.js";
import { extractMemoryFromPlan } from "../memory/extract.js";
import { buildRagIndex } from "../memory/rag.js";
import { scanProject } from "../memory/scan.js";
import { MemoryStore } from "../memory/store.js";
import { generatePlan } from "../planner/model.js";
import { shouldReplacePendingClarification } from "../clarification/state.js";
import { buildRepairInstruction } from "./repair.js";

function status(message, enabled) {
  if (enabled) {
    console.log(`> ${message}`);
  }
}

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

export async function runInstruction(instruction, options = {}) {
  const {
    dryRun = false,
    yes = false,
    verbose = true,
    exitOnError = false,
    maxRepairAttempts = 2
  } = options;

  try {
    const memory = new MemoryStore();
    const projectRoot = memory.get("project_root") || process.cwd();
    memory.set("project_root", projectRoot);

    status(`Project: ${projectRoot}`, verbose);
    status("Loading memory", verbose);

    let pendingInput = memory.get("pending_input");
    let pendingQuestion = memory.get("pending_question");

    if (pendingQuestion && shouldReplacePendingClarification(instruction)) {
      status("Clearing stale clarification", verbose);
      memory.set("pending_input", "");
      memory.set("pending_question", "");
      pendingInput = "";
      pendingQuestion = "";
    }

    if (pendingInput) {
      status("Merging clarification answer with pending request", verbose);
      instruction = `${pendingInput}. ${instruction}`;
    }

    if (!memory.hasScanned()) {
      status("Scanning project files", verbose);
      const { knownDirs, knownFiles } = scanProject(projectRoot);
      memory.setJSON("known_dirs", knownDirs);
      memory.setJSON("known_files", knownFiles.slice(-50));

      status("Building local RAG index", verbose);
      const documents = buildRagIndex(projectRoot);
      memory.replaceDocuments(documents);
      memory.markScanned();
      status(`Indexed ${documents.length} retrieval chunks`, verbose);
    }

    if (instruction.trim() === "undo") {
      status("Loading last undo action", verbose);
      const undo = memory.getJSON("last_undo", null);
      if (!undo) {
        console.log("Nothing to undo.");
        return { status: "noop" };
      }

      await applyFileActions([undo], { dryRun: false, autoYes: yes });
      memory.setJSON("last_undo", null);
      console.log("Undo applied.");
      return { status: "undone" };
    }

    instruction = resolveImplicitTargets(instruction, memory);

    if (isDeleteIntent(instruction)) {
      const recent = memory.getJSON("recent_files", []);
      const hasExplicitPath = /\.[a-z0-9]+/i.test(instruction);

      if (!hasExplicitPath && recent.length !== 1) {
        console.log("Delete is ambiguous. Please specify the file explicitly.");
        return { status: "blocked" };
      }
    }

    if (looksLikePureCommand(instruction)) {
      memory.set("force_intent", "command");
    }

    status("Retrieving project context from local RAG", verbose);
    const { ragContext, retrieved } = buildContext(instruction, memory);
    status(`Retrieved ${retrieved.length} relevant chunk(s)`, verbose);

    status("Generating plan with AI provider", verbose);
    let plan = await generatePlan(instruction, memory.all(), ragContext);
    status("Plan generated and schema-validated", verbose);

    if (pendingInput && looksLikePureCommand(instruction)) {
      memory.set("pending_input", "");
      memory.set("pending_question", "");
    }

    if (pendingInput && plan.clarification) {
      console.log("Please answer the previous clarification:");
      console.log(pendingQuestion);
      return { status: "clarification_pending" };
    }

    if (plan.clarification) {
      console.log("Clarification needed:");
      console.log(plan.clarification);

      memory.set("pending_input", instruction);
      memory.set("pending_question", plan.clarification);
      return { status: "clarification_requested", plan };
    }

    memory.set("pending_input", "");
    memory.set("pending_question", "");

    const completedPlans = [];
    let executionResult = await executePlanWithRepairs({
      plan,
      originalInstruction: instruction,
      memory,
      ragContext,
      projectRoot,
      dryRun,
      yes,
      verbose,
      maxRepairAttempts
    });

    if (executionResult.status !== "completed") {
      return executionResult;
    }

    plan = executionResult.plan;
    completedPlans.push(...executionResult.completedPlans);

    status("Updating memory", verbose);
    for (const completedPlan of completedPlans) {
      const extracted = extractMemoryFromPlan(completedPlan);
      for (const [key, value] of Object.entries(extracted)) {
        if (!memory.get(key)) {
          memory.set(key, value);
        }
      }
    }

    status("Done", verbose);
    return { status: "completed", plan };
  } catch (err) {
    console.error("Error:", err.message);
    if (exitOnError) {
      process.exit(1);
    }
    return { status: "error", error: err };
  }
}

async function executePlanWithRepairs({
  plan,
  originalInstruction,
  memory,
  ragContext,
  projectRoot,
  dryRun,
  yes,
  verbose,
  maxRepairAttempts
}) {
  const completedPlans = [];

  for (let attempt = 0; attempt <= maxRepairAttempts; attempt++) {
    if (attempt > 0) {
      status(`Trying repaired plan (${attempt}/${maxRepairAttempts})`, verbose);
    }

    console.log(JSON.stringify(plan, null, 2));

    try {
      await executePlan(plan, {
        projectRoot,
        dryRun,
        yes,
        verbose
      });
      completedPlans.push(plan);
      return { status: "completed", plan, completedPlans };
    } catch (err) {
      status(`Execution failed: ${err.message}`, verbose);

      if (attempt >= maxRepairAttempts) {
        console.error("Execution could not be repaired automatically.");
        return { status: "error", error: err, plan, completedPlans };
      }

      const repairInstruction = buildRepairInstruction({
        originalInstruction,
        failedPlan: plan,
        error: err,
        attempt: attempt + 1,
        maxAttempts: maxRepairAttempts
      });

      status("Sending execution error back to planner for repair", verbose);
      plan = await generatePlan(repairInstruction, memory.all(), ragContext);
      status("Repair plan generated and schema-validated", verbose);

      if (plan.clarification) {
        console.log("Clarification needed:");
        console.log(plan.clarification);
        memory.set("pending_input", originalInstruction);
        memory.set("pending_question", plan.clarification);
        return { status: "clarification_requested", plan, completedPlans };
      }
    }
  }

  return { status: "error", plan, completedPlans };
}

async function executePlan(plan, { projectRoot, dryRun, yes, verbose }) {
  if (plan.files.length > 0) {
    status(`Applying ${plan.files.length} file action(s)`, verbose);
    await applyFileActions(plan.files, {
      dryRun,
      autoYes: yes
    });

    if (!dryRun) {
      status("Refreshing local RAG index after file changes", verbose);
      const documents = buildRagIndex(projectRoot);
      const memory = new MemoryStore();
      memory.replaceDocuments(documents);
      status(`Indexed ${documents.length} retrieval chunks`, verbose);
    }
  }

  if (plan.commands.length > 0) {
    status(`Executing ${plan.commands.length} command(s)`, verbose);
    await executeCommands(plan.commands, { dryRun, autoYes: yes });
  }
}
