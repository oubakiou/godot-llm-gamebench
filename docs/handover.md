# 引き継ぎ: ベンチ結果の公開準備（マイルストーン3 残り）

> 2026-07-10 更新（**ラウンド 3 完了・impressions 反映済み**）。マイルストーン1（仕様凍結）・2（ハーネス構築 + E2E 検証）・3 の計測パートは 2026-07-05〜06 分・2026-07-10 の追加ラウンド 2・ラウンド 3（Cursor 系再計測）まで完了。残るは結果の docs 反映（永続ドキュメント化）と公開準備。設計の正本は共通基盤 [design/bench_common_design.md](./design/bench_common_design.md) と implement 固有設計 [design/delegate_implement_bench_design.md](./design/delegate_implement_bench_design.md)、定量結果の正本は `node src/bench/cli.ts report`、定性評価の正本は [benchmarks/impressions.md](../benchmarks/impressions.md)。残作業の完了後、本書を `docs/archive/` へ移す。

## ラウンド 3 の完了記録（2026-07-10、Cursor 系再計測）

- **結果**: 15 スロット中 14 が measured の completed（composer-2.5 = 257.36、composer-2.5-fast = 257.36、cursor-gemini-3.1-pro = 253.18、cursor-kimi-k2.7-code = 253.18、cursor-grok-4.5 = 264.00）。詳細は impressions.md「ラウンド 3」欄と `node src/bench/cli.ts report`
- **例外（cursor-gemini-3.1-pro rep1）**: ユーザー承認の 3 回目も同一機構（子が quit しない godot acceptance test を自ら起動して待ち続ける。issue #7 の cursor 変種）で stalled（3 回とも残存 85）。ユーザー判断で再計測を断念し、旧ラウンド completed（estimated）をデデュープで継続採用。**原因の深掘り調査は保留中（ユーザー指示）**
- **ラウンド 3 中の再実行**: cursor-grok-4.5 rep1 初回が親（Fable）の最終応答プロトコル逸脱で failed（子は無罪、残存 88）→ 規約内の撃ち直しで completed 94。composer-2.5 rep2 初回はクリーン窓でも親の沈黙で stalled → 撃ち直しで completed
- **impressions.md 反映済み**（2026-07-10）: サマリー表（Cursor 系 5 モデルの合算・費用「不明」→ 換算・時間・コード品質）、脚注 [^cost]、非 completed 詳細、新章「ラウンド 3」、旧ラウンド各欄への再計測注記。コード品質精査は sonnet ワーカーで新規採用 14 workspace + 旧 gemini rep1 を同一アンカーで実施済み

## 現在地

- **計測完了**（2026-07-05〜06）: 本計測 24 ラン採用（7 モデル × 3 反復 + `fable-direct` × 3）+ 追加計測（追加 5 モデル × 3 反復 + `claude-haiku-4-5`、計 22 試行）。失敗・停滞ランも run ディレクトリと metrics を全件保全済み
- **追加ラウンド 2 完了**（2026-07-10）: gpt-5.6-sol / gpt-5.6-terra / gpt-5.6-luna（Codex）、swe-1.7（Devin）、cursor-grok-4.5（Cursor）× 各 3 反復。詳細は impressions.md「追加ラウンド 2」欄。grok は cursor-agent 2026.07.09 の create-chat 停滞（issue #14）で当初 4 試行が stalled になり、上流修正後に 3/3 completed
- **コード品質精査完了**: 全採用ラン（各モデル 3 ラン、claude-haiku-4-5 のみ 1 ラン）を共通較正アンカーの 5 段階で精査済み（sonnet ワーカー、impressions.md サマリー表）。追加ラウンド 2 の 5 モデル分も精査済み
- **指標**: 品質スコアは completed ラン合算（最大 300。反復間の再現性を含めるため 2026-07-06 に中央値から変更）、時間・往復・トークン等の効率指標は completed ラン中央値
- **ラウンド 3 完了**（2026-07-10）: Cursor 系 5 モデル × 3 反復の再計測（上記「ラウンド 3 の完了記録」）。impressions.md へ反映済み
- **未コミット変更あり**: metrics.ts の superseded 対応（+ in-source テスト）、report.ts の (model, rep) デデュープ `adoptLatestCompletedPerRep`（+ in-source テスト）、docs（bench_common_design / handover / impressions）の 2026-07-10 分更新（ラウンド 3 反映を含む）。コミット時は規約どおり delegate-review を先に通す
- 課題資産: `benchmarks/tasks/conveyor-courier/` の prompt.md（凍結・変更禁止）/ reference（採点 100/100）/ hidden-tests（33 ケース、子モデルに見せない）
- orchestrator: `src/bench/cli.ts`（run / grade / report、watchdog 内蔵）。`npm run check` / `npm run test` pass
- delegate skill: delegate-skills（issue #14 / #15 実装版、2026-07-10 導入）
- バージョン固定（追試・再計測時も維持）: claude 2.1.200 / **codex 0.144.1 / devin 3000.1.27 / cursor-agent 2026.07.09** / godot 4.4.1（claude / codex は package.json の exact 指定で固定。2026-07-10 の更新経緯と旧バージョン計測分との比較注意は bench_common_design.md「対象モデル」）

## 残作業

0. （任意・保留中）cursor-gemini-3.1-pro rep1 の停滞原因の深掘り調査（ユーザー指示で保留。上記「ラウンド 3 の完了記録」）
1. **結果を docs へ**: `report` の集計を永続ドキュメント化する（品質スコア合算 + 効率 Pareto + ハーネス交絡・停滞率の注記。共通基盤の「計測メトリクス」「公平性と妥当性の限界」と implement 固有設計の「採点」）
2. 1 の完了後、本書と `docs/task-selection.md`（題材選定の検討ログ）を `docs/archive/` へ移す
3. （任意・マイルストーン4）Web ギャラリー: 各モデル代表ランを Godot Web エクスポートし、**別リポジトリ**の GitHub Pages へ（implement 固有設計の「マイルストーン」内 Web ギャラリー。単一スレッドエクスポート必須、COOP/COEP 不可のため）
4. 本リポジトリの public 化はラウンド完了後（共通基盤の「公平性と妥当性の限界」。公開時点でこのラウンドの仕様・テストは公開済み扱いとなり、以後の再測定はバリアント差し替え）

## 実行手順（追試・再計測用）

```sh
# 1 ラン実行（1 モデル × 1 反復、直列実行のみ。並列不可）
node src/bench/cli.ts run --model <MODEL> --rep <0|1|2>

# 再採点・失敗分析（grade.json の hidden_tests.failed_tests に失敗テスト名が入る）
node src/bench/cli.ts grade --workspace benchmarks/runs/<run-id>/workspace

# 集計レポート（Markdown）
node src/bench/cli.ts report
```

- モデル ID と実行系分岐は [design/bench_common_design.md](./design/bench_common_design.md) の「ベンチ構成」が正本（prefix 規約: `gpt*` → Codex / `swe*`・`devin-*` → Devin / `composer*`・`cursor-*` → Cursor / それ以外 → Claude）
- 並列実行しない（親が同一 Claude 枠を消費し、負荷で時間計測が歪む）
- Claude 実行系の 3 モデル（Sonnet5 / Opus4.8 / Haiku4.5）と `fable-direct` は親と同じ枠を消費するため最後に回し、枠に余裕がある時間帯に流す
- 各ラン完了時に `metrics.json` の `outcome` を確認。`stalled` / `timeout` / `failed` は 1 回だけ再実行してよい（それ以上はユーザー承認）。失敗ランの run ディレクトリと metrics は破棄せず残す（停滞率・失敗率も報告対象）
- エイリアス `haiku` のラン（ハーネス検証用）は集計から自動除外される。Haiku4.5 の正式ランはフル ID `claude-haiku-4-5` を使う
- 委譲のたびに `benchmarks/impressions.md` へ定性所感を追記する（ユーザー依頼による運用）

## ハーネスの重要知見（壊すと計測がやり直しになる）

運用中に発見した事象の全リストは impressions.md の「ハーネス側の注意」欄が正本。特に構造的なものは以下。

1. **親（claude -p）はバックグラウンド委譲不可**: 非対話モードではターン終了＝セッション終了で、バックグラウンドタスクの完了通知で再起動されない。playbook（`src/bench/run.ts` の `parentPlaybook`）の「フォアグラウンド dispatch + timeout 2400000ms」指示と、orchestrator が親 env へ注入する `BASH_DEFAULT_TIMEOUT_MS` / `BASH_MAX_TIMEOUT_MS = 2400000` を**変更しないこと**
2. **プロトコル違反検出**: 親の最終応答が completed / failed の一語でない、または observe JSON に `state.phase == "running"` の委譲が残っている場合、`violatesParentProtocol()` が outcome を failed に落とす
3. **watchdog**: 30 秒間隔サンプリング。無進捗判定は workspace mtime + delegate ログサイズのみ（CPU は生存確認専用）。10 分無進捗で stalled、40 分で timeout、SIGKILL 打ち切り。SIGKILL 打ち切りでは親 usage が取れず `parent_tokens` は null（レポートでは N/A）
4. **Claude 実行系の子は停滞リスクが恒常的にある**: 主機構は「子が自作した終了しないサブプロセス（godot 等）を待ち続ける」（claude-haiku-4-5 で 5/7 試行。issue #7 で上流へ復帰策を提案済み）。枠逼迫時の沈黙型停滞（sonnet 4.6）も別途ある
5. **子トークンの計測精度**: 第一ソースは observe JSON の `usage`（Claude / Codex / Devin = measured、Cursor = CLI が usage JSON を出さないため estimated）。dispatch されなかった observe（`phase: "prepared"` または新しい delegate-skills では `"superseded"`）は集計の分母に含めない（metrics.ts 対処済み、issue #6）。`metrics.json` の `measurement` フィールドで区別される
6. **`DELEGATE_IMPLEMENT_MODEL` 等の種別 env はシェルに残留することがある**: 手動で delegate skill を使う場合は毎回明示指定する（prepare 出力の `model_source` で env 由来を検出できる）
7. observe JSON（`<run>/delegate/work/*_observe.json`）は失敗調査の一次情報。`state.phase` / `state.exit_code` / `streams.stderr.content`、Claude backend なら stream capture の末尾を jq で読む

## コミット規約

コミット時は AGENTS.md の規約どおり delegate-review を先に通す。`benchmarks/runs/` は gitignore 済み（session id 等を含む生データのため。集計のみコミット）。

## 関連資料

- 設計正本: `docs/design/bench_common_design.md`（対象モデル・計測・公平性・カンニング防止）と `docs/design/delegate_implement_bench_design.md`（Conveyor Courier 課題仕様・採点・マイルストーン）
- 定性メモ: `benchmarks/impressions.md`（公開文書になる前提で表現に注意）
- 上流への貢献（delegate-skills）:
  - [issue #1](https://github.com/oubakiou/delegate-skills/issues/1) 観測性の提案（v0.5.0 で実装済み。レビュー済み文書: docs/feature/delegate-worker-observability.md）
  - [issue #2](https://github.com/oubakiou/delegate-skills/issues/2)〜[#5](https://github.com/oubakiou/delegate-skills/issues/5) usage 実測・stall 検出・model_source・非対話親の制約明記（**すべて v0.6.0 で実装済み・本プロジェクトへ導入済み**）
  - [issue #6](https://github.com/oubakiou/delegate-skills/issues/6) dispatch されずに残留する prepared フェーズの observe JSON の扱い（上流実装済み: `superseded` マーキング。2026-07-10 に利用側の全数チェックを superseded 対応へ更新し、消費者向け移行注意の文書化を[コメントで提案](https://github.com/oubakiou/delegate-skills/issues/6#issuecomment-4931795333)）
  - [issue #7](https://github.com/oubakiou/delegate-skills/issues/7) claude backend の子が自作のハングするサブプロセスを待って停滞する問題への復帰策（claude-haiku-4-5 計測で 5/7 試行の停滞から特定。上流未実装。次ラウンドがあるなら Bash timeout 注入の導入を推奨）
  - [issue #8](https://github.com/oubakiou/delegate-skills/issues/8) cursor backend の共有 `~/.cursor/cli-config.json` が並列 dispatch で競合し得る（codex の CODEX_HOME 隔離に相当する対策の提案。上流未実装）
  - [issue #9](https://github.com/oubakiou/delegate-skills/issues/9)〜[#11](https://github.com/oubakiou/delegate-skills/issues/11) 計測の意味論・利便性の改善提案（cursor estimated が下限値である旨の明示 / codex への cost_usd_estimated 併記 / codex run_dir の prune オプション。いずれも上流未実装）
  - [issue #15](https://github.com/oubakiou/delegate-skills/issues/15) cursor backend の子トークン measured 化（`--output-format stream-json` + observe の `cacheReadTokens` マッピング。**上流実装済み・2026-07-10 導入・ベンチ実環境で measured 化を検証済み**）
  - [issue #14](https://github.com/oubakiou/delegate-skills/issues/14) cursor backend の `agent create-chat` が racy に起動途中で停止する問題（cursor-agent 2026.07.09 で発生。`</dev/null` のみの初回修正では再発したが、timeout 45 秒 + リトライの併用が**上流実装済み・2026-07-10 導入・検証済み**。ローカルパッチは不要になった）
