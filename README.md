# Asura Agent

Asura Agent is a LangGraph-powered autonomous CLI agent for local developer automation. It converts natural language instructions into structured plans, enriches planning with local project retrieval, validates every plan, previews file changes, and gates risky shell commands.

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

Start an interactive session:

```bash
asura activate
```

Inside the session, type prompts directly:

```text
asura> create a basic RAG implementation here
asura> add tests for it
asura> undo
```

Session commands:

- `/help`: show session commands
- `/memory`: list memory
- `/rebuild`: rebuild the local RAG index
- `/exit`: leave the session

Preview without writing files or running commands:

```bash
asura --dry-run "modify src/planner/model.js to improve validation errors"
```

Show raw JSON plans instead of the human plan view:

```bash
asura --json "add validation for config"
```

Auto-approve safe create/modify file actions:

```bash
asura --yes "add a README section for memory search"
```

Undo the last filesystem change:

```bash
asura undo
```

Rollback files to the last multi-file checkpoint:

```bash
asura rollback
```

Set execution policy:

```bash
asura policy safe
asura policy dev
asura policy auto
```

Policy modes:

- `safe`: never auto-run dependency install commands
- `dev`: ask before medium/high risk commands
- `auto`: run low/medium risk commands, ask for high risk

Inspect run history:

```bash
asura runs list
asura runs show <run-id>
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

Retrieval uses lexical tokens plus metadata signals such as path matches, extracted symbols, file extension, and recency. The design leaves room for embedding providers later without requiring network or embedding costs by default.

## How It Works

```text
User instruction
  -> LangGraph runtime
  -> initialize
  -> prepareInstruction
  -> ensureProjectIndex
  -> handleUndo
  -> guardIntent
  -> retrieveContext
  -> generatePlan
  -> handleClarification
  -> executeWithRepair
  -> updateMemory
```

The runtime graph lives in `src/runtime/asuraGraph.js`. Each node owns one stage of the agent lifecycle, which makes the control flow explicit and easier to extend with routing, repair policies, tool nodes, and future LangChain components.

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
- Execution policies: safe, dev, auto
- Python installs are routed through a project `.venv` by default
- Node installs prefer local project installation and global installs are high risk
- Command chaining blocked
- Dangerous patterns blocked, including `rm -rf`, `curl | sh`, `mkfs`, `dd`, `format`, `reboot`, and `shutdown`
- Filesystem mutations must use file actions, not shell commands
- Commands run in a separate terminal on Windows and write logs under `.ai/runs`

Validation controls:

- JavaScript files are checked with `node --check`
- Python files are checked with `py_compile`
- Validation failures feed into the repair loop

History and rollback:

- Run records are stored under `.ai/runs`
- File checkpoints are stored under `.ai/checkpoints`
- `asura rollback` restores the last checkpoint

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
