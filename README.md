# Asura Agent

Asura Agent is a schema-validated autonomous CLI automation engine that converts natural language instructions into structured execution plans and safely applies them to your local project.

It enforces strict separation between planning and execution, validates all plans against a schema, and protects your system with guarded shell execution and filesystem safety controls.

---

## What It Does

Asura takes a single instruction:

```
asura "create a Button component in src/components"
```

And executes a controlled pipeline:

1. Scans project structure (once per session)
2. Merges context with scoped memory
3. Generates a strict JSON execution plan via LLM
4. Validates the plan against a schema
5. Shows the plan output
6. Applies filesystem mutations (diff-based)
7. Executes shell commands (risk-gated)
8. Updates internal memory state

No direct free-form execution.
Everything goes through a validated plan.

---

## Core Capabilities

### 1. Structured Planning Engine

* All plans must conform to a strict JSON schema
* Invalid plans are retried automatically
* Clarification loop if intent is ambiguous
* No nested clarification allowed

### 2. Filesystem Safety

* Explicit create / modify / rename / delete actions
* Diff preview before writes
* Delete ambiguity guard
* Confirmation for destructive actions
* Undo support

Undo example:

```
asura undo
```

### 3. Guarded Shell Execution

* Command risk classification (low / medium / high)
* Explicit confirmation for high-risk commands
* Blocks shell chaining (`&&`, `|`, `;`)
* Blocks destructive patterns:

  * rm -rf
  * curl | sh
  * mkfs
  * dd
  * format
  * etc.

### 4. Memory-Scoped Planning

Asura maintains local project memory including:

* known directories
* recent files
* last modified file
* detected framework (heuristic)
* styling conventions

Supports:

```
asura memory list
asura memory clear
```

Implicit references are resolved:

```
asura "modify it"
```

“it” resolves to last_file in memory.

### 5. Clarification Engine

If a request is ambiguous:

```
❓ Clarification needed:
Which file do you want to modify?
```

User response merges with original intent.
Execution is paused until clarified.

---

## Installation

```
npm install -g asura-agent
```

---

## Usage

Basic:

```
asura "create a React component Button"
```

Flags:

```
--dry-run   Preview changes without applying
--yes       Auto-approve safe operations
```

Undo:

```
asura undo
```

Memory management:

```
asura memory list
asura memory clear
```

---

## Architecture Overview

Asura follows a deterministic control pipeline:

User Input
→ Context Merge
→ Project Scan
→ Plan Generation (LLM)
→ Schema Validation (Zod)
→ Clarification Handling
→ Filesystem Executor
→ Command Executor
→ Memory Extraction

The planning engine is the only component allowed to create plans.
Execution never bypasses validation.

---

## Plan Schema

Every instruction is converted into a structured object:

```json
{
  "intent": "string",
  "summary": "string",
  "clarification": null,
  "files": [
    { "action": "create", "path": "file", "content": "..." }
  ],
  "commands": [
    { "cmd": "npm install react", "risk": "medium" }
  ],
  "refusal": null
}
```

Plans that fail validation are retried automatically.

---

## Supported AI Providers

Set via environment variable:

```
AI_PROVIDER=openai
```

Supported:

* openai
* groq
* gemini
* mistral
* anthropic

API keys must be configured in `.env`.

---

## Safety Model

Asura enforces:

* No implicit filesystem mutation
* No shell chaining
* Double-quoted shell arguments
* Explicit confirmation for high-risk commands
* Explicit delete intent validation
* Undo support
* Controlled clarification loop
* Scoped memory persistence

It is designed to constrain probabilistic LLM output inside deterministic guardrails.

---

## Requirements

Node.js 18+

---

## License

MIT

---
