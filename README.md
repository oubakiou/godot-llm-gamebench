# typescript-agent-package-template

[![MKDN](https://img.shields.io/badge/MKDN-review-red?style=for-the-badge)](https://mkdn.review/?url=https%3A%2F%2Fraw.githubusercontent.com%2Foubakiou%2Ftypescript-agent-package-template%2Frefs%2Fheads%2Fmain%2FREADME.md)

[![English](https://img.shields.io/badge/Language-English-blue?style=for-the-badge)](./README.md)
[![日本語](https://img.shields.io/badge/言語-日本語-lightgrey?style=for-the-badge)](./README_ja.md)

**A project template for safely building TypeScript / npm packages with Codex and Claude.**

## Overview

This template provides the baseline infrastructure for npm package development: TypeScript configuration, quality checks, tests, builds, agent hooks, a devcontainer, git hooks, and development documentation.

The core ideas are:

- **Centralize quality gates in npm scripts**: `npm run check`, `npm run test`, `npm run build`, and `npm run pack:check`
- **Keep agent hooks behind thin wrappers**: Claude and Codex call `.agents/scripts/check-file.sh`; project-specific validation belongs behind that wrapper
- **Update projects by regenerate + diff**: generate the latest template into `.temp/template-next/`, compare it with the project, and copy only the relevant infrastructure changes

## Features

| Area                       | Description                                      | Main files                                              |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| TypeScript                 | Strict ESM npm package setup                     | `tsconfig.json` / `tsconfig.build.json` / `src/`        |
| format / lint / type check | Unified checks through `vite-plus` and OXC tools | `vite.config.ts` / `npm run check`                      |
| test                       | Vitest in-source tests                           | `src/**/*.ts` / `npm run test`                          |
| build                      | Build declarations and JavaScript into `dist/`   | `npm run build`                                         |
| package preview            | Inspect the tarball before publishing            | `npm run pack:check`                                    |
| Codex hook                 | Per-file check after Edit / Write                | `.codex/hooks.json` / `.codex/hooks/run-check-file.ts`  |
| Claude hook                | Per-file check after Edit / Write                | `.claude/settings.json` / `.claude/hooks/check-file.js` |
| shared wrappers            | Entry points for hooks and manual validation     | `.agents/scripts/*.sh`                                  |
| pre-commit                 | check / test before commit                       | `.githooks/pre-commit`                                  |
| devcontainer               | Node.js / GitHub CLI development environment     | `.devcontainer/devcontainer.json`                       |
| development docs           | Setup, commands, and template update workflow    | `docs/design/development.md`                            |

## Directory Layout

```text
.
├─ .agents/
│  └─ scripts/                 # Validation wrappers shared by Codex, Claude, and humans
├─ .claude/                    # Claude Code hooks and settings
├─ .codex/                     # Codex hooks and config
├─ .devcontainer/              # Development container
├─ .githooks/                  # Git hooks
├─ .vscode/                    # VS Code settings
├─ docs/
│  ├─ archive/                 # Completed lifecycle docs
│  ├─ bug/                     # Bug fix plan template
│  ├─ design/                  # Durable development and design docs
│  ├─ feature/                 # Feature plan template
│  └─ refactoring/             # Refactoring plan template
├─ src/                        # npm package source
├─ .temp/                      # Temporary working files
├─ AGENTS.md                   # Shared agent instructions
├─ CLAUDE.md                   # Claude Code entry point
├─ package.json
├─ tsconfig.json
├─ tsconfig.build.json
└─ vite.config.ts
```

## Commands

| Command               | Description                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `bash local_setup.sh` | Install dependencies, agent CLIs and skills, OS packages, git hooks, and local settings. Requires `sudo`, network, and GitHub auth. |
| `npm run check`       | format / lint / type check                                                                                                          |
| `npm run check:fix`   | Auto-fixable checks                                                                                                                 |
| `npm run test`        | Vitest tests                                                                                                                        |
| `npm run build`       | Build into `dist/`                                                                                                                  |
| `npm run pack:check`  | Run check / test / build / `npm pack --dry-run`                                                                                     |

## Agent Hooks

Claude and Codex hooks do not call `vp` or `tsc` directly after edits. They call a shared wrapper instead.

```text
Claude / Codex
  └─ PostToolUse(Edit|Write)
      └─ .agents/scripts/check-file.sh <file>
          └─ npm run check:fix -- <file>
```

This keeps `.claude/` and `.codex/` stable when project validation changes. Update `.agents/scripts/check-file.sh` instead.

| Wrapper                          | Purpose                            |
| -------------------------------- | ---------------------------------- |
| `.agents/scripts/check-file.sh`  | Fast per-file feedback after edits |
| `.agents/scripts/check-all.sh`   | Full local validation              |
| `.agents/scripts/self-review.sh` | Pre-commit self-review helper      |

## Template Update Workflow

Projects created from this template should use **regenerate + diff** for template updates.

1. Generate the latest template into `.temp/template-next/`.
2. Compare it with the project root.
3. Copy only the relevant changes from `.agents/`, `.codex/`, `.claude/`, `.githooks/`, `docs/`, and similar infrastructure files.
4. Keep project-specific behavior in `.agents/scripts/*`.
5. Run `npm run pack:check`.

The source template is recorded in `.template.json`.

## Requirements

- Node.js >= 23.6
- npm
- Claude Code CLI when using Claude Code
- Codex CLI when using Codex
- Docker and a Dev Containers compatible editor when using the devcontainer

## Development

See [docs/design/development.md](docs/design/development.md) for setup, validation commands, hooks, and the template update workflow.

## License

MIT
