import dotenv from "dotenv";
import Groq from "groq-sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import SYSTEM_PROMPT from "./prompt.js";
import { PlanSchema } from "../validator/plan.schema.js";
import { Mistral } from "@mistralai/mistralai";
import Anthropic from "@anthropic-ai/sdk";


dotenv.config();

const provider = process.env.AI_PROVIDER?.toLowerCase();
console.log(`Using AI provider: ${provider}`);

const planCache = new Map();


let groq, gemini, openai, mistral, anthropic;

switch (provider) {
  case "groq":
    groq = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });
    break;

  case "gemini":
    gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    break;

  case "openai":
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    break;

  case "mistral":
    mistral = new Mistral({
      apiKey: process.env.MISTRAL_API_KEY
    });
    break;
  case "anthropic":
    anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
    break;

  default:
    throw new Error(
      "Invalid AI_PROVIDER. Use 'groq', 'gemini', 'openai', or 'mistral'."
    );
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


async function callModel(prompt) {


  if (provider === "groq") {
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ]
    });

    return res.choices[0].message.content;
  }


  if (provider === "gemini") {
    const model = gemini.getGenerativeModel({
      model: "models/gemini-flash-latest"
    });

    const result = await model.generateContent(
      `${SYSTEM_PROMPT}\n\n${prompt}`
    );

    return result.response.text();
  }


  if (provider === "openai") {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // fast + cheap + very good at JSON
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ]
    });

    return completion.choices[0].message.content;
  }

  if (provider === "mistral") {

    const res = await mistral.chat.complete({
      model: "mistral-large-latest",
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ]
    });

    return res.choices[0].message.content;
  }

  if (provider === "anthropic") {

    const res = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 2048,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    });

    return res.content[0].text;
  }

}


export async function generatePlan(userInput, memory = {}) {

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

      const raw = await callModel(prompt);
      const jsonOnly = extractJSON(raw);
      const parsed = JSON.parse(jsonOnly);

      const plan = PlanSchema.parse(parsed);

      planCache.set(cacheKey, plan);
      return plan;

    } catch (err) {

      lastError = err;

      if (err.errors) {
        lastValidationError = err.errors.map(e => e.message).join("; ");
      } else {
        lastValidationError = err.message;
      }

      console.warn(`Attempt ${attempt} failed...`);

      if (err.message?.includes("429")) {
        console.log("Rate limited. Sleeping 60s...");
        await sleep(60000);
        continue;
      }

      await sleep(500 * attempt);
    }
  }

  throw lastError;
}
