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

- **Quality**: a 100-point rubric, all of it auto-graded headlessly — functional correctness against hidden tests including view-behavior checks such as tick rate, mouse placement, and font-glyph coverage (70), determinism under a fixed seed (10), type-quality warnings (10), and project/scene health such as import and boot smoke tests (10).
- **Efficiency**: wall-clock time, delegation round trips, parent-side tokens, child-side tokens, and cost converted from per-model pricing (reported as N/A where pricing or measurement is unavailable).

See [docs/design/delegate_implement_bench_design.md](docs/design/delegate_implement_bench_design.md) for the full rubric, and [docs/design/bench_common_design.md](docs/design/bench_common_design.md) for the model roster and fairness/anti-cheating design. Measured results are listed under "Past benchmarks" below.

## Past benchmarks

### 202607_delegate_implement_bench (July 2026)

Canonical results: [benchmarks/202607_delegate_implement_bench/impressions.md](benchmarks/202607_delegate_implement_bench/impressions.md) (Japanese — summary table, per-model notes, measurement history, follow-up A/Bs, and the judge cross-check).

| Model                          |                              Auto-graded score (sum) | Code quality (sonnet, sol)                                                                                                             | Parent + child cost (median)           | Wall clock (median) | Note                                                                                                          |
| ------------------------------ | ---------------------------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------: | ------------------------------------------------------------------------------------------------------------- |
| claude-sonnet-5 (Claude)       |                                               290.00 | 3.8 (4.3, 3.3) — only rep1 reaches 5, internal type abandonment in 2/3; large judge divergence, representative = operator adjudication | $0.97 + $1.30 (total $2.27, measured)  |             8.6 min | Quality leader, incident-free. Two zero-warning runs                                                          |
| swe-1.7 (Devin)                |                                               280.06 | 4.1 (4.0, 4.3) — only rep1 regresses to untyped Dictionary                                                                             | $1.41 + $0 (total $1.41, bundled)      |            12.5 min | +57.00 over swe-1.6. Its former 100-point run fell to 98.06 on the view click check                           |
| gpt-5.5 (Codex)                |                                               280.00 | 4.0 (4.3, 3.8) — only rep2 reaches 5, untyped `_items` in 2/3                                                                          | $1.00 + $2.34 (total $3.48, converted) |             5.8 min | Perfect functional score in every rep, incident-free. Zero warnings in 1/3                                    |
| cursor-grok-4.5 (Cursor)       |                                               276.00 | 3.3 (3.2, 3.5) — item swings between typed class and raw Dictionary                                                                    | $1.25 + $0.12 (total $1.38, converted) |             4.8 min | Fastest tier, fewest tokens. No view deductions — rose to 4th in the re-grade                                 |
| devin-deepseek-v4-pro (Devin)  |                                               270.06 | 3.4 (3.3, 3.5) — raw Dictionary internals, only rep2 reaches 4                                                                         | $1.53 + $2.05 (total $3.58, estimated) |            11.1 min | Perfect functional score in every rep, but slowest tier and pricey                                            |
| claude-opus-4-8 (Claude)       |                                               270.00 | 3.5 (3.3, 3.7) — int usage leaks into the View layer in 2/3                                                                            | $0.93 + $1.42 (total $2.35, measured)  |             8.4 min | Child aces functional tests every time. All failures were parent/harness side                                 |
| gpt-5.6-sol (Codex)            |                                               268.06 | 4.2 (4.2, 4.3) — untyped `_items` only in rep0                                                                                         | $1.50 + $1.77 (total $3.10, converted) |             7.1 min | A stable 88–90 in every rep. Roughly ties terra with the same quality at twice the unit price                 |
| cursor-gemini-3.1-pro (Cursor) |                                               268.06 | 2.5 (2.8, 2.3) — never introduces constants, largest variance (representative = operator adjudication)                                 | $1.55 + $0.58 (total $2.13, converted) |             8.4 min | Warning-count swings and a stall habit. Highest token use among Cursor models                                 |
| cursor-kimi-k2.7-code (Cursor) |                                               268.06 | 4.5 (4.3, 4.7) — rep2 carries typed Dictionary[K,V] generics throughout                                                                | $1.44 + $0.16 (total $1.60, converted) |            10.6 min | Splitter quirk did not reproduce. Type discipline stays top-tier                                              |
| gpt-5.4-mini (Codex)           |                266.12 (rep view defect: black board) | 3.3 (2.8, 3.5) — typing regresses across reps (representative = operator adjudication)                                                 | $1.01 + $0.84 (total $2.04, converted) |            11.1 min | Fewest type warnings but slow, with a determinism drop and stalls                                             |
| gpt-5.6-terra (Codex)          |                266.12 (rep view defect: tofu arrows) | 4.2 (4.2, 4.3) — constant usage and board representation vary across reps                                                              | $1.21 + $0.91 (total $2.38, converted) |             6.3 min | Matches sol at roughly half the cost and faster — the efficiency pick                                         |
| devin-glm-5.2 (Devin)          | 266.12 (rep view defect: no belt arrows, mouse dead) | 3.8 (4.0, 3.7) — stable across runs, int internals throughout                                                                          | $0.90 + $1.37 (total $2.28, estimated) |             5.9 min | Fast and functionally accurate. Pre-completion stalls are the one flaw                                        |
| composer-2.5 (Cursor)          |         264.28 (view defect: mouse dead in all reps) | 3.8 (3.8, 3.8) — untyped `_items` Dictionary in all 3 runs                                                                             | $1.23 + $0.04 (total $1.29, converted) |             6.5 min | Still incident-free. Measured child cost is the lowest of all models                                          |
| composer-2.5-fast (Cursor)     |         264.28 (view defect: mouse dead in all reps) | 3.7 (3.7, 3.7) — untyped nested arrays in 2/3                                                                                          | $1.49 + $0.26 (total $1.76, converted) |             7.8 min | Rose to a tie with the base model, but slower than it after re-measurement                                    |
| gpt-5.3-codex-spark (Codex)    |                                               264.17 | 3.6 (3.8, 3.5) — largest per-rep swing (5 / 3 / 3.5)                                                                                   | $1.47 + unknown (total ≥ $1.47)        |             4.5 min | Fast but unstable on details. 3–5× the input tokens of gpt-5.5                                                |
| gpt-5.6-luna (Codex)           |                                               250.55 | 3.3 (3.3, —) — raw Dictionaries throughout, only rep2 uses a class                                                                     | $1.46 + $0.49 (total $1.95, converted) |             7.3 min | Failed the splitter exit-toggle test in every rep (follow-up 1 traced it to reasoning effort; fixed at xhigh) |
| swe-1.6 (Devin)                |                223.06 (rep view defect: tofu arrows) | 3.8 (3.7, 4.0) — only rep1 drops typing entirely                                                                                       | $0.95 + $0 (total $0.95, bundled)      |             3.9 min | Cheapest (bundled pricing) but lowest quality on both axes                                                    |
| claude-haiku-4-5 (Claude)      |            86.11 (n=1) (rep view defect: mouse dead) | 2.7 (3.0, 2.5) (n=1) — untyped even at the API contract                                                                                | $1.87 + $0.66 (total $2.53, measured)  |             9.3 min | Completed 1/7. Frequent stalls, least reliable                                                                |

Baseline condition (does not go through the delegation protocol; do not compare directly with the table above):

| Condition                    | Auto-graded score (sum) | Code quality (sonnet, sol)                               | Parent + child cost (median)       | Wall clock (median) | Note                                             |
| ---------------------------- | ----------------------: | -------------------------------------------------------- | ---------------------------------- | ------------------: | ------------------------------------------------ |
| fable-direct (no delegation) |                  300.00 | 4.6 (4.7, 4.5) — stable across runs, top type discipline | $2.62 + $0 (total $2.62, measured) |             5.7 min | Baseline: the parent (Fable) implements directly |

Metric definitions (grading rubric, cost accounting, and the two-judge + operator-adjudication scheme behind the code-quality column), plus follow-up 1 (reasoning effort A/B), follow-up 2 (gdscript-quality skill A/B), follow-up 3 (the same skill on a Cursor-harness child), and the judge cross-check, are all in [benchmarks/202607_delegate_implement_bench/impressions.md](benchmarks/202607_delegate_implement_bench/impressions.md).

## Bench commands

| Command                 | Description                                                            |
| ----------------------- | ---------------------------------------------------------------------- |
| `npm run bench:run`     | Run one benchmark iteration (one model × one repetition)               |
| `npm run bench:grade`   | Re-grade a workspace against the hidden tests                          |
| `npm run bench:regrade` | Re-grade every run in a round and rewrite its grade.json               |
| `npm run bench:report`  | Aggregate run results into a Markdown report                           |
| `npm run bench:export`  | Export each model's game to Web and build the browser-playable gallery |

## Directory layout

```text
.
├─ src/bench/                    # Orchestrator: run / grade / report CLI (TypeScript, in-source test)
├─ benchmarks/
│  ├─ tasks/                     # Shared task sources across rounds
│  │  └─ conveyor-courier/
│  │     ├─ prompt.md            # Frozen task prompt handed to child models
│  │     ├─ reference/           # Reference implementation (Godot project, not shown to children)
│  │     └─ hidden-tests/        # Hidden test runner (not shown to children)
│  └─ 202607_delegate_implement_bench/
│     ├─ impressions.md          # Qualitative notes on each delegated child model
│     └─ runs/                   # Run artifacts (gitignored; only aggregate reports are committed)
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
