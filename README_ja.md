# godot-llm-gamebench

[![MKDN](https://img.shields.io/badge/MKDN-review-red?style=for-the-badge)](https://mkdn.review/?url=https%3A%2F%2Fraw.githubusercontent.com%2Foubakiou%2Fgodot-llm-gamebench%2Frefs%2Fheads%2Fmain%2FREADME_ja.md)

[![English](https://img.shields.io/badge/Language-English-lightgrey?style=for-the-badge)](./README.md)
[![日本語](https://img.shields.io/badge/言語-日本語-blue?style=for-the-badge)](./README_ja.md)

**複数社の CLI 子モデル（Codex / Devin / Cursor / Claude）に delegate-skills 経由で同一の Godot ゲーム実装課題を委譲し、品質と効率の 2 軸で計測する LLM ベンチマークである。**

## 概要

親エージェント（Claude Code）が `delegate-implement` skill を使い、Godot 4.x + Typed GDScript による実装課題を子モデル（Codex / Devin / Cursor / Claude）へ委譲する。1 ラン = 1 モデル × 1 反復とし、各ランを headless な採点器で隠しテストに対して採点し、所要時間・往復回数・トークンコストを併せて記録する。単体のモデル性能を序列化するのではなく、固定仕様下での「モデル + 実行系 CLI ハーネス」の組み合わせを比較することが目的である。

## 課題: Conveyor Courier

課題は tick 駆動のパズル「Conveyor Courier」である。グリッド上を流れる荷物を、ベルトの設置・回転で正しい色の出口へ運ぶ。テトリスのような有名ゲームではなく独自仕様にすることで学習汚染を軽減し、「仕様を読んで抽象化・実装する力」そのものを測る狙いがある。子モデルへ渡す課題文の正本は `benchmarks/tasks/conveyor-courier/prompt.md` であり、全モデル・全反復で byte 一致のまま渡す。隠しテストとリファレンス実装は子モデルの作業場所には置かれず、本書でも内容には触れない。

## 計測の 2 軸

採点は 2 つの独立した軸で行い、両者を 1 つのスコアに合成しない。

- **品質**: 100 点満点のルーブリックで、全項目を自動採点する。隠しテストに対する機能正当性（60 点）、固定 seed 下の決定性（10 点）、型警告の少なさ（15 点）、import・起動 smoke などのプロジェクト健全性（15 点）
- **効率**: 所要時間、委譲往復回数、親側消費トークン、子側消費トークン、単価表による換算コスト（単価・実測値がない場合は N/A として報告する）

ルーブリックの詳細、対象モデル一覧、公平性・カンニング防止の設計は [docs/design/DESIGN.md](docs/design/DESIGN.md) を参照。計測結果はまだ無いため、本書に結果セクションは無い。

## bench コマンド

| コマンド               | 説明                                           |
| ---------------------- | ---------------------------------------------- |
| `npm run bench:run`    | ベンチを 1 ラン実行する（1 モデル × 1 反復）   |
| `npm run bench:grade`  | workspace を隠しテストで再採点する             |
| `npm run bench:report` | ラン結果を集計して Markdown レポートを生成する |

## ディレクトリ構成

```text
.
├─ src/bench/                    # orchestrator: run / grade / report CLI（TypeScript, in-source test）
├─ benchmarks/
│  ├─ impressions.md             # 委譲先モデルの定性所感
│  ├─ tasks/conveyor-courier/
│  │  ├─ prompt.md               # 子モデルへ渡す課題文の正本（凍結済み）
│  │  ├─ reference/              # リファレンス実装（Godot プロジェクト。子モデルには渡さない）
│  │  └─ hidden-tests/           # 隠しテスト（子モデルには渡さない）
│  └─ runs/                      # ラン成果物（gitignore。集計レポートのみコミット）
├─ docs/
│  ├─ design/DESIGN.md           # ベンチ設計（課題仕様、実行アーキテクチャ、計測・採点）
│  └─ design/development.md      # 開発基盤（テンプレート由来）
├─ AGENTS.md / CLAUDE.md          # エージェント向け指示
└─ package.json
```

## 開発コマンド

| コマンド              | 説明                                                                   |
| --------------------- | ---------------------------------------------------------------------- |
| `bash local_setup.sh` | 依存関係、エージェント CLI・skill、OS package、git hook のセットアップ |
| `npm run check`       | format / lint / type check                                             |
| `npm run check:fix`   | 自動修正付き check                                                     |
| `npm run test`        | Vitest テスト                                                          |
| `npm run build`       | `dist/` へビルド                                                       |

本プロジェクトが基盤とする npm パッケージテンプレート由来の開発基盤（エージェント hook、devcontainer、pack:check、テンプレート更新運用）は [docs/design/development.md](docs/design/development.md) に記載する。

## ドキュメント

- [docs/design/DESIGN.md](docs/design/DESIGN.md) — ベンチ設計の全体（課題仕様、実行アーキテクチャ、計測、採点、公平性の限界）
- [docs/design/development.md](docs/design/development.md) — 開発セットアップ、検証コマンド、エージェント hook

## ライセンス

MIT
