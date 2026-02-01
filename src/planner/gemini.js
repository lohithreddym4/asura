import { GoogleGenerativeAI } from "@google/generative-ai";
import { PlanSchema } from "../validator/plan.schema.js";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const planCache = new Map();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `
You are a planning engine for a CLI automation tool.

CRITICAL RULES:
- Tool-specific verbs (e.g. "git add", "git commit", "git push", "npm install") are COMMAND intents, not filesystem intents.
- The word "add" does NOT imply file creation or modification unless a file path is explicitly named for content change.
- Git operations MUST be modeled as shell commands.
- For create and modify intents, you MUST produce file actions with content.
- For rename and delete intents, you MUST produce filesystem actions only.
- Filesystem mutations MUST use file actions, not shell commands.
- NEVER return an empty files array for create or modify intents.
- If intent cannot be fulfilled unambiguously, set "clarification".
- Follow existing project conventions from Known context strictly.
- Do NOT infer frameworks, languages, or tools unless explicitly stated.
- All shell commands MUST use double quotes for string arguments. Never use single quotes.







OUTPUT RULES:
- Output ONLY valid JSON
- No explanations
- No markdown
- No comments

Schema:
{
  "intent": string,
  "summary": string,
  "clarification": string | null,
  "files": [
    { "action": "create", "path": string, "content": string }
    | { "action": "modify", "path": string, "content": string }
    | { "action": "rename", "path": string, "to": string }
    | { "action": "delete", "path": string }
  ],
  "commands": [
    { "cmd": string, "risk": "low" | "medium" | "high" }
  ],
  "refusal": string | null
}

`;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
function extractJSON(text) {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
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
  const filteredMemory = filterMemoryForPlanning(memory);
  const cacheKey = JSON.stringify({ userInput, memory: filteredMemory });

  if (planCache.has(cacheKey)) {
    return planCache.get(cacheKey);
  }

  const model = genAI.getGenerativeModel({
    model: "models/gemini-flash-latest"
  });

  const memoryContext = Object.entries(filteredMemory)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  let lastValidationError = null;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const prompt = `
${SYSTEM_PROMPT}

${lastValidationError ? `
VALIDATION ERROR:
${lastValidationError}
Fix the plan to satisfy the rules above.
` : ""}

Known context:
${memoryContext || "(none)"}

User input:
${userInput}
`;

    try {
      const result = await model.generateContent(prompt);
      const raw = result.response.text();
      const jsonOnly = extractJSON(raw);
      const parsed = JSON.parse(jsonOnly);

      const plan = PlanSchema.parse(parsed);
      planCache.set(cacheKey, plan);
      return plan;

    } catch (err) {
      lastError = err;

      // 🔑 THIS IS THE KEY FIX
      if (err.errors) {
        // Zod validation error
        lastValidationError = err.errors
          .map(e => e.message)
          .join("; ");
      } else {
        lastValidationError = err.message;
      }

      console.warn(`⚠️ Attempt ${attempt} failed. Retrying...`);

      if (err.message.includes("429")) {
        console.log("⏳ Rate limited. Waiting 60s before retry...");
        await sleep(60_000);
        continue;
      }

      await sleep(500 * attempt);
    }
  }

  throw lastError;
}

