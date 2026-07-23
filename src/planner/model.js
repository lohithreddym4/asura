import dotenv from "dotenv";
dotenv.config({ quiet: true });
import Groq from "groq-sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { SimpleChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Mistral } from "@mistralai/mistralai";
import Anthropic from "@anthropic-ai/sdk";
import SYSTEM_PROMPT from "./prompt.js";
import { PlanSchema } from "../validator/plan.schema.js";
import { getConfig } from "../config/store.js";

const planCache = new Map();
let chatModelInstance = null;

class OpenAIPlannerModel extends SimpleChatModel {
  constructor(apiKey, model) {
    super({});
    this.model = model;
    this.openai = new OpenAI({ apiKey });
  }

  _llmType() {
    return "asura-openai-planner";
  }

  async _call(messages) {
    const res = await this.openai.chat.completions.create({
      model: this.model,
      temperature: 0,
      messages: toOpenAIMessages(messages)
    });

    return res.choices[0].message.content;
  }
}

class GroqPlannerModel extends SimpleChatModel {
  constructor(apiKey, model) {
    super({});
    this.model = model;
    this.groq = new Groq({ apiKey });
  }

  _llmType() {
    return "asura-groq-planner";
  }

  async _call(messages) {
    const res = await this.groq.chat.completions.create({
      model: this.model,
      temperature: 0,
      messages: toOpenAIMessages(messages)
    });

    return res.choices[0].message.content;
  }
}

class GeminiPlannerModel extends SimpleChatModel {
  constructor(apiKey, model) {
    super({});
    this.model = model;
    this.gemini = new GoogleGenerativeAI(apiKey);
  }

  _llmType() {
    return "asura-gemini-planner";
  }

  async _call(messages) {
    const model = this.gemini.getGenerativeModel({
      model: this.model
    });

    const result = await model.generateContent(messagesToText(messages));
    return result.response.text();
  }
}

class MistralPlannerModel extends SimpleChatModel {
  constructor(apiKey, model) {
    super({});
    this.model = model;
    this.mistral = new Mistral({ apiKey });
  }

  _llmType() {
    return "asura-mistral-planner";
  }

  async _call(messages) {
    const res = await this.mistral.chat.complete({
      model: this.model,
      temperature: 0,
      messages: toOpenAIMessages(messages)
    });

    return res.choices[0].message.content;
  }
}

class AnthropicPlannerModel extends SimpleChatModel {
  constructor(apiKey, model) {
    super({});
    this.model = model;
    this.anthropic = new Anthropic({ apiKey });
  }

  _llmType() {
    return "asura-anthropic-planner";
  }

  async _call(messages) {
    const system = messages
      .filter(message => message._getType() === "system")
      .map(message => messageContentToString(message.content))
      .join("\n\n");

    const userContent = messages
      .filter(message => message._getType() !== "system")
      .map(message => messageContentToString(message.content))
      .join("\n\n");

    const res = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 2048,
      temperature: 0,
      system,
      messages: [
        {
          role: "user",
          content: userContent
        }
      ]
    });

    return res.content[0].text;
  }
}

function initializeProvider() {
  if (chatModelInstance) return;

  const config = getConfig();
  const provider = config.provider;

  if (!provider) {
    throw new Error("No AI provider configured. Run: asura init");
  }

  const providers = {
    openai: {
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      create: (key, model) => new OpenAIPlannerModel(key, model),
    },
    groq: {
      apiKey: config.groqApiKey,
      model: config.groqModel,
      create: (key, model) => new GroqPlannerModel(key, model),
    },
    gemini: {
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
      create: (key, model) => new GeminiPlannerModel(key, model),
    },
    mistral: {
      apiKey: config.mistralApiKey,
      model: config.mistralModel,
      create: (key, model) => new MistralPlannerModel(key, model),
    },
    anthropic: {
      apiKey: config.anthropicApiKey,
      model: config.anthropicModel,
      create: (key, model) => new AnthropicPlannerModel(key, model),
    },
  };

  const selected = providers[provider];

  if (!selected) {
    throw new Error(`Invalid provider "${provider}".`);
  }

  if (!selected.apiKey) {
    throw new Error(
      `API key not configured for "${provider}". Run: asura init`
    );
  }

  if (!selected.model) {
    throw new Error(`No model configured for "${provider}".`);
  }

  chatModelInstance = selected.create(selected.apiKey, selected.model);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function toOpenAIMessages(messages) {
  return messages.map(message => ({
    role: toChatRole(message),
    content: messageContentToString(message.content)
  }));
}

function toChatRole(message) {
  const type = message._getType();
  if (type === "system") return "system";
  if (type === "ai") return "assistant";
  return "user";
}

function messagesToText(messages) {
  return messages
    .map(message => `${toChatRole(message).toUpperCase()}:\n${messageContentToString(message.content)}`)
    .join("\n\n");
}

function messageContentToString(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === "string") return part;
        if (part?.text) return part.text;
        return JSON.stringify(part);
      })
      .join("\n");
  }
  return String(content ?? "");
}

function extractJSON(text) {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");

  if (first === -1 || last === -1) {
    throw new Error("Model did not return valid JSON");
  }

  return text.slice(first, last + 1);
}

function filterMemoryForPlanning(memory) {
  const allowed = [
    "known_dirs",
    "recent_files",
    "last_file",
    "framework",
    "styling",
    "project_type",
    "project_profile",
    "rag_document_count",
    "rag_indexed_at"
  ];

  return Object.fromEntries(
    Object.entries(memory).filter(([k]) => allowed.includes(k))
  );
}

export async function generatePlan(userInput, memory = {}, ragContext = "(none)") {
  initializeProvider();
  const filteredMemory = filterMemoryForPlanning(memory);
  const cacheKey = JSON.stringify({ userInput, memory: filteredMemory, ragContext });

  if (planCache.has(cacheKey)) {
    return planCache.get(cacheKey);
  }

  const memoryContext = Object.entries(filteredMemory)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  let lastValidationError = null;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const prompt = `
${lastValidationError ? `
VALIDATION ERROR:
${lastValidationError}
Fix the plan.
` : ""}

Known context:
${memoryContext || "(none)"}

Execution environment:
- platform: ${process.platform}
- cwd: ${process.cwd()}
- shell: ${process.platform === "win32" ? "Windows shell / PowerShell-compatible commands" : "POSIX-compatible shell"}
- python venv path: ${process.platform === "win32" ? ".venv\\Scripts\\python.exe and .venv\\Scripts\\pip.exe" : ".venv/bin/python and .venv/bin/pip"}

Retrieved project context:
${ragContext}

User input:
${userInput}
`;

    try {
      const raw = await callPlannerModel(prompt);
      const jsonOnly = extractJSON(raw);

      let parsed;
      try {
        parsed = JSON.parse(jsonOnly);
      } catch {
        throw new Error("Model returned invalid JSON");
      }

      const plan = PlanSchema.parse(parsed);
      planCache.set(cacheKey, plan);
      return plan;
    } catch (err) {
      lastError = err;

      if (err.name === "ZodError") {
        lastValidationError = (err.issues || err.errors)
          .map(e => e.message)
          .join("; ");
      } else {
        lastValidationError = err.message;
      }

      console.warn(`Attempt ${attempt} failed...`);

      if (err.status === 429 || err.message?.includes("429")) {
        console.log("Rate limited. Sleeping 60s...");
        await sleep(60000);
        continue;
      }

      await sleep(500 * attempt);
    }
  }

  throw lastError;
}

async function callPlannerModel(prompt) {
  const response = await chatModelInstance.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(prompt)
  ]);
  return messageContentToString(response.content);
}
