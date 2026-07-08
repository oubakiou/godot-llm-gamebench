# godot-llm-gamebench

[![MKDN](https://img.shields.io/badge/MKDN-review-red?style=for-the-badge)](https://mkdn.review/?url=https%3A%2F%2Fraw.githubusercontent.com%2Foubakiou%2Fgodot-llm-gamebench%2Frefs%2Fheads%2Fmain%2FREADME.md)

[![English](https://img.shields.io/badge/Language-English-blue?style=for-the-badge)](./README.md)
[![日本語](https://img.shields.io/badge/言語-日本語-lightgrey?style=for-the-badge)](./README_ja.md)

**An LLM benchmark that delegates the same Godot game implementation task to multiple vendors' CLI child models via delegate-skills, and measures the result along two axes: quality and efficiency.**

## Overview

A parent agent (Claude Code) delegates a Godot 4.x + typed GDScript implementation task to child models (Codex / Devin / Cursor / Claude) through the `delegate-implement` skill, one run per model per repetition. Each run is scored by a headless grader against hidden tests, and its wall-clock time, round trips, and token cost are recorded. The goal is to compare "model + execution-harness CLI" combinations under a fixed spec, rather than to rank model weights in isolation.

## The task: Conveyor Courier

The benchmark task is **Conveyor Courier**, a custom tick-driven puzzle where packages flow across a grid and must be routed to the correctly colored exit by placing and rotating conveyor belts. It is an original spec (not a well-known game like Tetris) chosen to reduce contamination from prior training exposure, so that what's actually measured is the ability to read a spec and turn it into a correct implementation. The task prompt handed to child models is frozen at `benchmarks/tasks/conveyor-courier/prompt.md`, and the same byte-identical text is used for every model and every repetition. Hidden tests and the reference implementation are kept out of the child's workspace and are not described here.

## What gets measured

Scoring runs on two independent axes and they are never combined into one number.

- **Quality**: a 100-point rubric, all of it auto-graded headlessly — functional correctness against hidden tests (60), determinism under a fixed seed (10), type-quality warnings (15), and project/scene health such as import and boot smoke tests (15).
- **Efficiency**: wall-clock time, delegation round trips, parent-side tokens, child-side tokens, and cost converted from per-model pricing (reported as N/A where pricing or measurement is unavailable).

See [docs/design/delegate_implement_bench_design.md](docs/design/delegate_implement_bench_design.md) for the full rubric, and [docs/design/bench_common_design.md](docs/design/bench_common_design.md) for the model roster and fairness/anti-cheating design. Results are not published yet; there is no results section here.

## Bench commands

| Command                | Description                                              |
| ---------------------- | -------------------------------------------------------- |
| `npm run bench:run`    | Run one benchmark iteration (one model × one repetition) |
| `npm run bench:grade`  | Re-grade a workspace against the hidden tests            |
| `npm run bench:report` | Aggregate run results into a Markdown report             |

## Directory layout

```text
.
├─ src/bench/                    # Orchestrator: run / grade / report CLI (TypeScript, in-source test)
├─ benchmarks/
│  ├─ impressions.md             # Qualitative notes on each delegated child model
│  ├─ tasks/conveyor-courier/
│  │  ├─ prompt.md               # Frozen task prompt handed to child models
│  │  ├─ reference/              # Reference implementation (Godot project, not shown to children)
│  │  └─ hidden-tests/           # Hidden test runner (not shown to children)
│  └─ runs/                      # Run artifacts (gitignored; only aggregate reports are committed)
├─ docs/
│  ├─ design/bench_common_design.md
│  │                               # Shared benchmark foundation: roster, architecture, measurement, fairness
│  ├─ design/delegate_implement_bench_design.md
│  │                               # Conveyor Courier benchmark: task spec, grading, milestones
│  └─ design/development.md      # Development infrastructure (template-derived)
├─ AGENTS.md / CLAUDE.md          # Agent instructions
└─ package.json
```

## Development commands

| Command               | Description                                                         |
| --------------------- | ------------------------------------------------------------------- |
| `bash local_setup.sh` | Install dependencies, agent CLIs and skills, OS packages, git hooks |
| `npm run check`       | format / lint / type check                                          |
| `npm run check:fix`   | Auto-fixable checks                                                 |
| `npm run test`        | Vitest tests                                                        |
| `npm run build`       | Build into `dist/`                                                  |

The npm-package-template infrastructure this project is built on (agent hooks, devcontainer, pack:check, template-update workflow) is documented in [docs/design/development.md](docs/design/development.md).

## Documentation

- [docs/design/bench_common_design.md](docs/design/bench_common_design.md) — shared benchmark foundation: model roster, execution architecture, measurement, fairness limits
- [docs/design/delegate_implement_bench_design.md](docs/design/delegate_implement_bench_design.md) — Conveyor Courier benchmark: task spec, grading, milestones
- [docs/design/development.md](docs/design/development.md) — development setup, validation commands, agent hooks

## License

MIT
