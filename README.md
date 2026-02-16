# Asura Agent

Asura Agent is a schema-validated autonomous CLI automation engine that converts natural language instructions into structured execution plans and safely applies them to your local project.

It separates planning from execution, enforces strict JSON validation, and protects your system with guarded filesystem and shell command controls.

Asura is designed to constrain probabilistic LLM output inside deterministic guardrails.

---

## 🚀 Installation

Install globally:

npm install -g asura-agent

---

## ⚙️ Initial Setup

Before using Asura, initialize your AI provider:

asura init

You will be prompted to:

- Select an AI provider (OpenAI, Groq, Gemini, Mistral, Anthropic)
- Enter your API key (secure input)

You can later switch providers using:

asura provider

Configuration is stored locally in your system user directory.

---

## 🧠 How It Works

When you run:

asura "create a React component Button"

Asura executes a controlled pipeline:

1. Loads project memory
2. Scans project structure (first run only)
3. Resolves implicit file references (e.g., “it”, “that file”)
4. Generates a structured JSON plan via LLM
5. Validates the plan against a strict schema
6. Handles clarification if needed
7. Applies filesystem changes (diff-based)
8. Executes shell commands (risk-gated)
9. Updates internal memory state

All actions must pass validation before execution.

No direct free-form execution is allowed.

---

## 📌 Basic Usage

Run an instruction:

asura "create a file test.js with a hello world function"

Preview without applying changes:

asura --dry-run "modify index.js"

Auto-approve safe operations:

asura --yes "install express"

Undo the last filesystem change:

asura undo

---

## 🧠 Memory System

Asura maintains project-scoped memory, including:

- known directories
- recent files
- last modified file
- framework heuristics
- styling heuristics

List stored memory:

asura memory list

Clear memory:

asura memory clear

Implicit references are supported:

asura "modify it"

“it” resolves to the last modified file.

---

## 🔐 Safety Model

Asura enforces strict execution controls:

### Filesystem Safety
- Explicit create / modify / rename / delete actions
- Diff preview before writes
- Delete ambiguity guard
- Confirmation required for destructive actions
- Undo support

### Shell Execution Safety
- Command risk classification (low / medium / high)
- Confirmation required for high-risk commands
- Blocks command chaining (&&, |, ;)
- Blocks destructive patterns such as:
  - rm -rf
  - curl | sh
  - mkfs
  - dd
  - format
  - reboot / shutdown

### Clarification Engine
If an instruction is ambiguous:

❓ Clarification needed:
Which file do you want to modify?

Execution pauses until clarified.
Nested clarification is prevented.

---

## 🏗 Architecture Overview

Asura follows a deterministic control flow:

User Input  
→ Memory Context Merge  
→ Project Scan  
→ Plan Generation (LLM)  
→ Schema Validation (Zod)  
→ Clarification Handling  
→ Filesystem Executor  
→ Command Executor  
→ Memory Extraction  

The planning engine is the only component allowed to generate execution plans.

Execution never bypasses validation.

---

## 📦 Plan Schema (Example)

Every instruction becomes structured JSON:

{
  "intent": "create_file",
  "summary": "Create test.js file",
  "clarification": null,
  "files": [
    {
      "action": "create",
      "path": "test.js",
      "content": "console.log('Hello world');"
    }
  ],
  "commands": [],
  "refusal": null
}

Plans that fail schema validation are retried automatically.

---

## 🛠 Configuration Commands

Initialize provider:

asura init

Change provider:

asura provider

Manual config (advanced):

asura config set <key> <value>

---

## 🌐 Supported AI Providers

- OpenAI
- Groq
- Gemini
- Mistral
- Anthropic

Provider and API keys are stored locally after initialization.

---

## 🧪 Advanced Flags

--dry-run  
Preview file and command changes without executing them.

--yes  
Auto-approve safe operations.

---

## 🖥 Requirements

Node.js 18+

---

## 🔍 Design Principles

- Deterministic validation before execution
- Explicit separation between planning and mutation
- Memory-scoped contextual planning
- Controlled command execution
- Defensive error handling
- No implicit destructive operations

Asura is built to reduce unsafe automation while preserving developer velocity.

---

## 📜 License

MIT
