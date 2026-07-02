#!/usr/bin/env node

import { Command } from "commander";
import { generatePlan } from "../src/planner/model.js";
import { executeCommands } from "../src/executor/executeCommands.js";
import { applyFileActions } from "../src/fs/applyFiles.js";
import { MemoryStore } from "../src/memory/store.js";
import { extractMemoryFromPlan } from "../src/memory/extract.js";
import { setConfig } from "../src/config/store.js";
import { scanProject } from "../src/memory/scan.js";
import { buildContext } from "../src/context/buildContext.js";
import { buildRagIndex, formatRetrievedContext, retrieveDocuments } from "../src/memory/rag.js";
import inquirer from "inquirer";



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

memoryCmd
  .command("rebuild")
  .description("Rebuild local RAG index")
  .action(() => {
    const memory = new MemoryStore();
    const projectRoot = memory.get("project_root") || process.cwd();
    const documents = buildRagIndex(projectRoot);
    memory.replaceDocuments(documents);
    console.log(`Indexed ${documents.length} project chunks for retrieval.`);
  });

memoryCmd
  .command("search <query>")
  .description("Search the local RAG index")
  .option("-n, --limit <number>", "Maximum results", "6")
  .action((query, options) => {
    const memory = new MemoryStore();
    const limit = Number.parseInt(options.limit, 10);
    const results = retrieveDocuments(query, memory.allDocuments(), {
      limit: Number.isFinite(limit) ? limit : 6
    });

    console.log(formatRetrievedContext(results));
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
        memory.replaceDocuments(buildRagIndex(projectRoot));
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

      const { ragContext } = buildContext(instruction, memory);
      const plan = await generatePlan(instruction, memory.all(), ragContext);


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
  program
  .command("config")
  .description("Manage Asura configuration")
  .command("set <key> <value>")
  .description("Set configuration value")
  .action((key, value) => {
    setConfig(key, value);
    console.log(`✅ Config updated: ${key}`);
  });


program
  .command("init")
  .description("Initialize Asura configuration")
  .action(async () => {
    console.log("Welcome to Asura! Let's set up your AI provider.");
    console.log("Asura supports AI providers like OpenAI, Groq, Gemini, Mistral, and Anthropic.");
    const { provider, apiKey } = await inquirer.prompt([
      {
        type: "list",
        name: "provider",
        message: "Select AI provider:",
        choices: [
          { name: "OpenAI", value: "openai" },
          { name: "Groq", value: "groq" },
          { name: "Gemini", value: "gemini" },
          { name: "Mistral", value: "mistral" },
          { name: "Anthropic", value: "anthropic" }
        ]
      },
      {
        type: "password",
        name: "apiKey",
        message: "Enter your API key:",
        mask: "*",
        validate: (input) => {
          if (!input || input.trim() === "") {
            return "API key cannot be empty.";
          }
          return true;
        }
      }
    ]);

    const keyMap = {
      openai: "openaiApiKey",
      groq: "groqApiKey",
      gemini: "geminiApiKey",
      mistral: "mistralApiKey",
      anthropic: "anthropicApiKey"
    };

    if (!keyMap[provider]) {
      console.error("Invalid provider selection.");
      return;
    }

    setConfig("provider", provider);
    setConfig(keyMap[provider], apiKey);

    console.log(`✅ Asura initialized successfully with ${provider}.`);
  });

  program
  .command("provider")
  .description("Change AI provider")
  .action(async () => {
    console.log("Change to AI providers like OpenAI, Groq, Gemini, Mistral, and Anthropic.");
    console.log("Note: Make sure you have the API key for the selected provider configured through 'asura init'.");
    const { provider } = await inquirer.prompt([
      {
        type: "list",
        name: "provider",
        message: "Select AI provider:",
        choices: [
          { name: "OpenAI", value: "openai" },
          { name: "Groq", value: "groq" },
          { name: "Gemini", value: "gemini" },
          { name: "Mistral", value: "mistral" },
          { name: "Anthropic", value: "anthropic" }
        ]
      }
    ]);

    setConfig("provider", provider);
    console.log(`✅ Provider set to ${provider}`);
  });


function looksLikePureCommand(input) {
  return /\b(git|npm|npx|pnpm|yarn|docker)\b/i.test(input);
}


program.parse(process.argv);
