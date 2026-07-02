# Asura Agent

Asura Agent is a schema-validated autonomous CLI agent for local developer automation. It converts natural language instructions into structured plans, enriches planning with local project retrieval, validates every plan, previews file changes, and gates risky shell commands.

The goal is simple: let an AI assistant work inside a codebase with enough memory, retrieval, and guardrails to be useful without becoming reckless.

## Installation

```bash
npm install -g asura-agent
```

## Initial Setup

```bash
asura init
```

You will be prompted for:

- AI provider: OpenAI, Groq, Gemini, Mistral, or Anthropic
- API key for that provider

Switch providers later:

```bash
asura provider
```

Configuration is stored in your user directory at `~/.asura/config.json`.

## Usage

Run an instruction:

```bash
asura "create a test helper for the planner schema"
```

Preview without writing files or running commands:

```bash
asura --dry-run "modify src/planner/model.js to improve validation errors"
```

Auto-approve safe create/modify file actions:

```bash
asura --yes "add a README section for memory search"
```

Undo the last filesystem change:

```bash
asura undo
```

## RAG And Memory

Asura keeps project-scoped memory in `.ai/memory.db`. The memory layer stores recent files, inferred project facts, and a local retrieval index made from safe text files in the current project.

On first run, Asura scans the project and builds the local retrieval index automatically. The planner receives the most relevant snippets for each instruction so it can follow existing conventions instead of inventing structure.

Rebuild the local RAG index:

```bash
asura memory rebuild
```

Search the local RAG index:

```bash
asura memory search "planner schema validation"
```

List stored memory:

```bash
asura memory list
```

Clear memory:

```bash
asura memory clear
```

The index intentionally skips `.env`, hidden runtime memory, `node_modules`, build output, and large lockfiles.

## How It Works

```text
User instruction
  -> Project memory lookup
  -> Local RAG retrieval
  -> Plan generation through configured AI provider
  -> Zod schema validation
  -> Clarification handling
  -> Diff preview for file actions
  -> Guarded command execution
  -> Memory update and undo record
```

The planning engine is the only component allowed to generate execution plans. Execution never bypasses validation.

## Plan Shape

Every instruction becomes JSON that matches the plan schema:

```json
{
  "intent": "create_file",
  "summary": "Create a test helper",
  "clarification": null,
  "files": [
    {
      "action": "create",
      "path": "test.js",
      "content": "console.log(\"Hello world\");"
    }
  ],
  "commands": [],
  "refusal": null
}
```

If the model returns invalid JSON or fails schema validation, Asura retries with the validation error.

## Safety Model

Filesystem controls:

- Explicit create, modify, rename, and delete actions
- Project-root path containment at validation and execution time
- Diff preview before writes
- Delete ambiguity guard
- Confirmation required for destructive operations
- Undo support for the last filesystem change

Shell controls:

- Command risk classification: low, medium, high
- Confirmation required for high-risk commands
- Command chaining blocked
- Dangerous patterns blocked, including `rm -rf`, `curl | sh`, `mkfs`, `dd`, `format`, `reboot`, and `shutdown`
- Filesystem mutations must use file actions, not shell commands

Clarification controls:

- Ambiguous requests produce a clarification instead of an unsafe guess
- Follow-up answers are merged into the original instruction
- Nested clarification loops are blocked

## Supported Providers

- OpenAI
- Groq
- Gemini
- Mistral
- Anthropic

## Requirements

- Node.js 18+
- A configured API key for one supported AI provider

## Design Principles

- Validate probabilistic model output before doing anything real
- Use local project retrieval to ground the planner
- Keep secrets out of memory and retrieval
- Prefer explicit file actions over shell mutations
- Require confirmation for destructive behavior
- Make dry runs and undo normal parts of the workflow

## License

MIT
