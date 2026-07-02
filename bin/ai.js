#!/usr/bin/env node

import { Command } from "commander";
import inquirer from "inquirer";
import readline from "readline/promises";
import { setConfig } from "../src/config/store.js";
import { buildRagIndex, formatRetrievedContext, retrieveDocuments } from "../src/memory/rag.js";
import { MemoryStore } from "../src/memory/store.js";
import { runInstruction } from "../src/runtime/runInstruction.js";

const program = new Command();

const providerChoices = [
  { name: "OpenAI", value: "openai" },
  { name: "Groq", value: "groq" },
  { name: "Gemini", value: "gemini" },
  { name: "Mistral", value: "mistral" },
  { name: "Anthropic", value: "anthropic" }
];

const keyMap = {
  openai: "openaiApiKey",
  groq: "groqApiKey",
  gemini: "geminiApiKey",
  mistral: "mistralApiKey",
  anthropic: "anthropicApiKey"
};

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
      console.log("Memory is empty.");
      return;
    }

    console.log("Agent memory:");
    for (const [key, value] of Object.entries(data)) {
      console.log(`- ${key}: ${value}`);
    }
  });

memoryCmd
  .command("clear")
  .description("Clear all agent memory")
  .action(() => {
    const memory = new MemoryStore();
    memory.clear();
    console.log("Agent memory cleared.");
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

program
  .name("asura")
  .description("Schema-validated autonomous CLI agent with local RAG")
  .option("--dry-run", "Preview changes without applying")
  .option("--yes", "Auto-approve safe operations")
  .argument("[instruction]")
  .action(async (instruction, options) => {
    if (!instruction) {
      program.help();
      return;
    }

    await runInstruction(instruction, {
      dryRun: options.dryRun,
      yes: options.yes,
      verbose: true,
      exitOnError: true
    });
  });

program
  .command("activate")
  .description("Start an interactive Asura prompt session")
  .option("--dry-run", "Preview changes without applying")
  .option("--yes", "Auto-approve safe operations")
  .action(async (options) => {
    console.log("Asura activated. Type your request directly.");
    console.log("Use /exit or Ctrl+C to leave. Use /help for session commands.");

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    try {
      while (true) {
        const input = (await rl.question("\nasura> ")).trim();
        if (!input) continue;

        if (input === "/exit" || input === "exit" || input === "quit") {
          console.log("Asura session closed.");
          break;
        }

        if (input === "/help") {
          console.log("Session commands:");
          console.log("- /help: show this help");
          console.log("- /memory: list memory");
          console.log("- /rebuild: rebuild local RAG index");
          console.log("- /exit: leave the session");
          continue;
        }

        if (input === "/memory") {
          const memory = new MemoryStore();
          const data = memory.all();
          if (Object.keys(data).length === 0) {
            console.log("Memory is empty.");
          } else {
            console.log("Agent memory:");
            for (const [key, value] of Object.entries(data)) {
              console.log(`- ${key}: ${value}`);
            }
          }
          continue;
        }

        if (input === "/rebuild") {
          const memory = new MemoryStore();
          const projectRoot = memory.get("project_root") || process.cwd();
          const documents = buildRagIndex(projectRoot);
          memory.replaceDocuments(documents);
          console.log(`Indexed ${documents.length} project chunks for retrieval.`);
          continue;
        }

        await runInstruction(input, {
          dryRun: options.dryRun,
          yes: options.yes,
          verbose: true,
          exitOnError: false
        });
      }
    } finally {
      rl.close();
    }
  });

program
  .command("config")
  .description("Manage Asura configuration")
  .command("set <key> <value>")
  .description("Set configuration value")
  .action((key, value) => {
    setConfig(key, value);
    console.log(`Config updated: ${key}`);
  });

program
  .command("init")
  .description("Initialize Asura configuration")
  .action(async () => {
    console.log("Welcome to Asura. Let's set up your AI provider.");
    const { provider, apiKey } = await inquirer.prompt([
      {
        type: "list",
        name: "provider",
        message: "Select AI provider:",
        choices: providerChoices
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

    if (!keyMap[provider]) {
      console.error("Invalid provider selection.");
      return;
    }

    setConfig("provider", provider);
    setConfig(keyMap[provider], apiKey);
    console.log(`Asura initialized successfully with ${provider}.`);
  });

program
  .command("provider")
  .description("Change AI provider")
  .action(async () => {
    const { provider } = await inquirer.prompt([
      {
        type: "list",
        name: "provider",
        message: "Select AI provider:",
        choices: providerChoices
      }
    ]);

    setConfig("provider", provider);
    console.log(`Provider set to ${provider}.`);
  });

program.parse(process.argv);
