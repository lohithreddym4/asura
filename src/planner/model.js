import dotenv from "dotenv";
import Groq from "groq-sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import SYSTEM_PROMPT from "./prompt.js";
import { PlanSchema } from "../validator/plan.schema.js";
import { Mistral } from "@mistralai/mistralai";
import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "../config/store.js";


dotenv.config();
const planCache = new Map();
let callModelInstance = null;

function initializeProvider() {
  if (callModelInstance) return;

  const config = getConfig();

  const provider =
    process.env.AI_PROVIDER?.toLowerCase() ||
    config.provider;
  const allowedProviders = [
    "openai",
    "groq",
    "gemini",
    "mistral",
    "anthropic"
  ];

  if (!allowedProviders.includes(provider)) {
    throw new Error("Invalid provider configuration.");
  }


  if (!provider) {
    throw new Error(
      "No AI provider configured. Run: asura init"
    );
  }

  const keyMap = {
    openai: process.env.OPENAI_API_KEY || config.openaiApiKey,
    groq: process.env.GROQ_API_KEY || config.groqApiKey,
    gemini: process.env.GEMINI_API_KEY || config.geminiApiKey,
    mistral: process.env.MISTRAL_API_KEY || config.mistralApiKey,
    anthropic: process.env.ANTHROPIC_API_KEY || config.anthropicApiKey
  };

  const apiKey = keyMap[provider];

  if (!apiKey) {
    throw new Error(
      `API key not configured for "${provider}". Run: asura init`
    );
  }

  switch (provider) {

    case "openai": {
      const openai = new OpenAI({ apiKey });
      callModelInstance = async (prompt) => {
        const res = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt }
          ]
        });
        return res.choices[0].message.content;
      };
      break;
    }
  
    case "groq": {
      const groq = new Groq({ apiKey });
      callModelInstance = async (prompt) => {
        const res = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          temperature: 0,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt }
          ]
        });
        return res.choices[0].message.content;
      };
      break;
    }
  
    case "gemini": {
      const gemini = new GoogleGenerativeAI(apiKey);
      callModelInstance = async (prompt) => {
        const model = gemini.getGenerativeModel({
          model: "models/gemini-flash-latest"
        });
        const result = await model.generateContent(
          `${SYSTEM_PROMPT}\n\n${prompt}`
        );
        return result.response.text();
      };
      break;
    }
  
    case "mistral": {
      const mistral = new Mistral({ apiKey });
      callModelInstance = async (prompt) => {
        const res = await mistral.chat.complete({
          model: "mistral-large-latest",
          temperature: 0,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt }
          ]
        });
        return res.choices[0].message.content;
      };
      break;
    }
  
    case "anthropic": {
      const anthropic = new Anthropic({ apiKey });
      callModelInstance = async (prompt) => {
        const res = await anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 2048,
          temperature: 0,
          system: SYSTEM_PROMPT,
          messages: [
            { role: "user", content: prompt }
          ]
        });
        return res.content[0].text;
      };
      break;
    }
  
    default:
      throw new Error(
        `Invalid AI provider. Use: openai | groq | gemini | mistral | anthropic`
      );
  }
  
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    "project_type"
  ];

  return Object.fromEntries(
    Object.entries(memory).filter(([k]) => allowed.includes(k))
  );
}


export async function generatePlan(userInput, memory = {}) {
  initializeProvider()
  const filteredMemory = filterMemoryForPlanning(memory);
  const cacheKey = JSON.stringify({ userInput, memory: filteredMemory });

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

User input:
${userInput}
`;

    try {
      const raw = await callModelInstance(prompt);
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
        lastValidationError = err.errors.map(e => e.message).join("; ");
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
