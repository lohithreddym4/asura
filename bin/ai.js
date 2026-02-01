#!/usr/bin/env node

import { Command } from "commander";
import { generatePlan } from "../src/planner/gemini.js";
import { executeCommands } from "../src/executor/executeCommands.js";
import { applyFileActions } from "../src/fs/applyFiles.js";
import { MemoryStore } from "../src/memory/store.js";
import { extractMemoryFromPlan } from "../src/memory/extract.js";
import { scanProject } from "../src/memory/scan.js";



const program = new Command();

const memoryCmd = program
  .command("memory")
  .description("Inspect or manage agent memory");

memoryCmd
  .command("list")
  .description("List stored agent memory")
  .action(() => {
    const memory = new MemoryStore();
    const data = memory.all();

    if (Object.keys(data).length === 0) {
      console.log("🧠 Memory is empty.");
      return;
    }

    console.log("🧠 Agent memory:");
    for (const [k, v] of Object.entries(data)) {
      console.log(`- ${k}: ${v}`);
    }
  });

memoryCmd
  .command("clear")
  .description("Clear all agent memory")
  .action(() => {
    const memory = new MemoryStore();
    memory.clear();
    console.log("🧹 Agent memory cleared.");
  });

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
function isCommandDomain(input) {
  return /\b(git|npm|npx|pnpm|yarn|docker|kubectl)\b/i.test(input.trim());
}

program
  .name("ai")
  .option("--dry-run", "Preview changes without applying")
  .option("--yes", "Auto-approve safe operations")
  .argument("<instruction>")
  .action(async (instruction, options) => {
    try {
      const memory = new MemoryStore();
      const projectRoot = memory.get("project_root") || process.cwd();
      memory.set("project_root", projectRoot);

      // 1️⃣ Load pending clarification state
      const pendingInput = memory.get("pending_input");
      const pendingQuestion = memory.get("pending_question");
      // 🔥 HARD RESET clarification if user switches to command domain
      if (pendingQuestion && isCommandDomain(instruction)) {
        memory.set("pending_input", "");
        memory.set("pending_question", "");
      }

      // 2️⃣ Merge follow-up answer into original intent
      if (pendingInput) {
        instruction = `${pendingInput}. ${instruction}`;
      }
      if (!memory.hasScanned()) {
        const { knownDirs, knownFiles } = scanProject(projectRoot);
        memory.setJSON("known_dirs", knownDirs);
        memory.setJSON("known_files", knownFiles.slice(-50));
        memory.markScanned();
      }
      if (instruction.trim() === "undo") {
        const undo = memory.getJSON("last_undo", null);
        if (!undo) {
          console.log("❌ Nothing to undo.");
          return;
        }

        await applyFileActions([undo], { dryRun: false, autoYes: options.yes });
        memory.setJSON("last_undo", null);
        console.log("↩️ Undo applied.");
        return;
      }


      // 3️⃣ Generate plan (ONLY place plan is created)
      instruction = resolveImplicitTargets(instruction, memory);

      // 🔒 DELETE SAFETY
      if (isDeleteIntent(instruction)) {
        const recent = memory.getJSON("recent_files", []);
        const hasExplicitPath = /\.[a-z0-9]+/i.test(instruction);

        if (!hasExplicitPath && recent.length !== 1) {
          console.log("❌ Delete is ambiguous. Please specify the file explicitly.");
          return;
        }
      }
      if (looksLikePureCommand(instruction)) {
        memory.set("force_intent", "command");
      }

      const plan = await generatePlan(instruction, memory.all());


      // 🧹 Auto-clear clarification if user intent clearly changed
      if (pendingInput && looksLikePureCommand(instruction)) {
        memory.set("pending_input", "");
        memory.set("pending_question", "");
      }

      // 4️⃣ Guard: do not allow nested clarification
      if (pendingInput && plan.clarification) {
        console.log("❗ Please answer the previous clarification:");
        console.log(pendingQuestion);
        return;
      }

      // 5️⃣ Handle clarification
      if (plan.clarification) {
        console.log("❓ Clarification needed:");
        console.log(plan.clarification);

        memory.set("pending_input", instruction);
        memory.set("pending_question", plan.clarification);
        return; // ⛔ STOP execution
      }

      // 6️⃣ Clear clarification state (success path)
      memory.set("pending_input", "");
      memory.set("pending_question", "");

      // 7️⃣ Print plan ONCE
      console.log(JSON.stringify(plan, null, 2));

      // 8️⃣ Apply filesystem changes
      if (plan.files.length > 0) {
        await applyFileActions(plan.files, {
          dryRun: options.dryRun,
          autoYes: options.yes
        });

      }

      // 9️⃣ Execute commands
      if (plan.commands.length > 0) {
        await executeCommands(plan.commands, { dryRun: options.dryRun, autoYes: options.yes });
      }

      // 🔟 Extract & persist memory
      const extracted = extractMemoryFromPlan(plan);
      for (const [key, value] of Object.entries(extracted)) {
        if (!memory.get(key)) {
          memory.set(key, value);
        }
      }

    } catch (err) {
      console.error("❌", err.message);
      process.exit(1);
    }
  });
function looksLikePureCommand(input) {
  return /\b(git|npm|npx|pnpm|yarn|docker)\b/i.test(input);
}


program.parse(process.argv);