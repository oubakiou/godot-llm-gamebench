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

ルーブリックの詳細は [docs/design/delegate_implement_bench_design.md](docs/design/delegate_implement_bench_design.md)、対象モデル一覧と公平性・カンニング防止の設計は [docs/design/bench_common_design.md](docs/design/bench_common_design.md) を参照。計測結果は「過去に行ったベンチ」セクションを参照。

## 過去に行ったベンチ

### 202607_delegate_implement_bench（2026-07）

結果の正本: [benchmarks/impressions.md](benchmarks/impressions.md)（サマリー表・モデル別所感・計測の経緯・追試・判定者クロスチェック）

| モデル                         | 自動テストによる評価(合算) | コード品質 (sonnet評, sol評)                                                                                  | 親費用+子費用(中央値)            | 所要時間(中央値) | ひとこと                                                                          |
| ------------------------------ | -------------------------: | ------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------: | --------------------------------------------------------------------------------- |
| claude-sonnet-5 (Claude)       |                     285.00 | 3.8 (4.3, 3.3) — rep1 のみ 5、内部の型放棄が 2/3。乖離が大きいため代表値は Fable 裁定（クロスチェック欄参照） | $0.97 + $1.30（計 $2.27、実測）  |           8.6 分 | 品質首位・無事故。型警告ゼロの run を 2 回達成                                    |
| swe-1.7 (Devin)                |                     273.00 | 4.1 (4.0, 4.3) — rep1 のみ無型 Dictionary へ退行                                                              | $1.41 + $0（計 $1.41、込み価格） |          12.5 分 | swe-1.6 から +60.72 の大幅改善。100 点 run 達成                                   |
| gpt-5.5 (Codex)                |                     270.00 | 4.0 (4.3, 3.8) — rep2 のみ 5、`_items` 無型が 2/3                                                             | $1.00 + $2.34（計 $3.48、換算）  |           5.8 分 | 機能は全反復満点・無事故。型警告ゼロは 1/3                                        |
| cursor-grok-4.5 (Cursor)       |                     264.00 | 3.3 (3.2, 3.5) — item が typed class ⇔ 生 Dictionary で振れる                                                 | $1.25 + $0.12（計 $1.38、換算）  |           4.8 分 | 最速級・最少トークン消費。再計測で 2 位タイから後退                               |
| gpt-5.4-mini (Codex)           |                     258.18 | 3.3 (2.8, 3.5) — 反復ごとに型後退（代表値は Fable 裁定）                                                      | $1.01 + $0.84（計 $2.04、換算）  |          11.1 分 | 型警告は最少級だが遅く、決定性落ち・停滞あり                                      |
| devin-deepseek-v4-pro (Devin)  |                     258.00 | 3.4 (3.3, 3.5) — 生 Dictionary 運用、rep2 のみ 4                                                              | $1.53 + $2.05（計 $3.58、推測）  |          11.1 分 | 機能は全反復満点だが最遅級・高コスト                                              |
| composer-2.5 (Cursor)          |                     257.36 | 3.8 (3.8, 3.8) — `_items` 無型 Dictionary が 3 ラン共通                                                       | $1.23 + $0.04（計 $1.29、換算）  |           6.5 分 | 無事故は継続。実測で子費用は全モデル最安と判明                                    |
| composer-2.5-fast (Cursor)     |                     257.36 | 3.7 (3.7, 3.7) — 無型二重配列が 2/3                                                                           | $1.49 + $0.26（計 $1.76、換算）  |           7.8 分 | 無印と同点へ浮上。ただし再計測では無印より遅い                                    |
| gpt-5.6-sol (Codex)            |                     255.00 | 4.2 (4.2, 4.3) — rep0 のみ `_items` 無型                                                                      | $1.50 + $1.77（計 $3.10、換算）  |           7.1 分 | 全反復 85 で安定。terra と同点・同品質で単価は 2 倍                               |
| gpt-5.6-terra (Codex)          |                     255.00 | 4.2 (4.2, 4.3) — 定数化と盤面表現が反復間で揺れる                                                             | $1.21 + $0.91（計 $2.38、換算）  |           6.3 分 | sol と同品質を約半額・より速く。効率面の有力株                                    |
| claude-opus-4-8 (Claude)       |                     255.00 | 3.5 (3.3, 3.7) — View 層まで int 波及が 2/3                                                                   | $0.93 + $1.42（計 $2.35、実測）  |           8.4 分 | 子は毎回機能満点。失敗は全て親・ハーネス側                                        |
| devin-glm-5.2 (Devin)          |                     253.18 | 3.8 (4.0, 3.7) — 3 ラン安定、内部 int 運用が常                                                                | $0.90 + $1.37（計 $2.28、推測）  |           5.9 分 | 速くて機能面は正確。完了報告前の停滞が玉に瑕                                      |
| cursor-gemini-3.1-pro (Cursor) |                     253.18 | 2.5 (2.8, 2.3) — 定数化しない癖が 3 ラン共通・振れ幅最大（代表値は Fable 裁定と一致）                         | $1.55 + $0.58（計 $2.13、換算）  |           8.4 分 | 型警告の振れと停滞癖。トークン消費は Cursor 系最大                                |
| cursor-kimi-k2.7-code (Cursor) |                     253.18 | 4.5 (4.3, 4.7) — rep2 は Dictionary[K,V] 総称まで貫徹                                                         | $1.44 + $0.16（計 $1.60、換算）  |          10.6 分 | スプリッタの癖は非再現。型規律は最上位帯を維持                                    |
| gpt-5.3-codex-spark (Codex)    |                     251.36 | 3.6 (3.8, 3.5) — ぶれ最大（5 / 3 / 3.5）                                                                      | $1.47 + 不明（計 $1.47 以上）    |           4.5 分 | 速いが細部が不安定。入力トークンは gpt-5.5 比 3〜5 倍                             |
| gpt-5.6-luna (Codex)           |                     244.09 | 3.3 (3.3, —) — 生 Dictionary 常用、rep2 のみ class 化                                                         | $1.46 + $0.49（計 $1.95、換算）  |           7.3 分 | スプリッタ退場時反転を全反復で落とす（追試 1 で effort 起因と判明、xhigh で解消） |
| swe-1.6 (Devin)                |                     212.28 | 3.8 (3.7, 4.0) — rep1 のみ型が全落ち                                                                          | $0.95 + $0（計 $0.95、込み価格） |           3.9 分 | 最安（込み価格）だが機能・型とも品質最下位                                        |
| claude-haiku-4-5 (Claude)      |               83.18（n=1） | 2.7 (3.0, 2.5)（n=1） — 契約面も無型                                                                          | $1.87 + $0.66（計 $2.53、実測）  |           9.3 分 | completed 1/7。停滞多発で信頼性最下位                                             |

ベースライン条件（委譲プロトコルを通らない別条件のため参考値。上表とは直接比較しないこと）:

| 条件                    | 自動テストによる評価(合算) | コード品質 (sonnet評, sol評)              | 親費用+子費用(中央値)        | 所要時間(中央値) | ひとこと                          |
| ----------------------- | -------------------------: | ----------------------------------------- | ---------------------------- | ---------------: | --------------------------------- |
| fable-direct (委譲なし) |                     300.00 | 4.6 (4.7, 4.5) — 3 ラン安定・型規律最上位 | $2.62 + $0（計 $2.62、実測） |           5.7 分 | ベースライン: 親 Fable の直接実装 |

各指標の定義（採点ルーブリック、費用の算定方法、コード品質の判定体制と代表値の規則）と、追試 1（reasoning effort A/B）・追試 2（gdscript-quality skill A/B）・判定者クロスチェックの結果は [benchmarks/impressions.md](benchmarks/impressions.md) を参照。

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
│  ├─ design/bench_common_design.md
│  │                               # 共通基盤（対象モデル、実行アーキテクチャ、計測、公平性）
│  ├─ design/delegate_implement_bench_design.md
│  │                               # Conveyor Courier ベンチ（課題仕様、採点、マイルストーン）
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

- [docs/design/bench_common_design.md](docs/design/bench_common_design.md) — 共通基盤（対象モデル、実行アーキテクチャ、計測、公平性の限界）
- [docs/design/delegate_implement_bench_design.md](docs/design/delegate_implement_bench_design.md) — Conveyor Courier ベンチ（課題仕様、採点、マイルストーン）
- [docs/design/development.md](docs/design/development.md) — 開発セットアップ、検証コマンド、エージェント hook

## ライセンス

MIT
