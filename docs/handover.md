# 引き継ぎ: 本計測（マイルストーン3）再開手順

> 2026-07-04 更新。マイルストーン1（仕様凍結）・2（ハーネス構築 + E2E 検証 3 回による強化）は完了。本計測の直前で停止中であり、ユーザーは再開時に Claude Code を再起動する予定。本書だけで再開できるよう書いてある。設計の正本は [design/DESIGN.md](./design/DESIGN.md)。マイルストーン3 完了後は本書を `docs/archive/` へ移す。

## 現在地

- 課題仕様: `benchmarks/tasks/conveyor-courier/prompt.md`（凍結済み。全モデルに byte 一致で渡す正本。変更禁止）
- リファレンス実装: `benchmarks/tasks/conveyor-courier/reference/`（採点 100/100）
- 隠しテスト: `benchmarks/tasks/conveyor-courier/hidden-tests/run_tests.gd`（33 ケース。ミューテーション 3 種で感度検証済み。子モデルに見せない）
- orchestrator: `src/bench/cli.ts`（run / grade / report、watchdog 内蔵）。`npm run check` / `npm run test`（9 テスト）pass
- delegate skill: **delegate-skills v0.6.0**（observe JSON への usage 記録 / claude backend の stream-json 化 / model*source 対応版。issue #2〜#5 実装済み）をインストール済み。orchestrator は往復ごとの `delegate*\*/` run_dir レイアウトと observe JSON usage の両方に対応済み
- E2E 検証（haiku、ベンチ成績ではない）: rep0 成功（旧 skill、98.18 点）→ rep1/rep2 失敗（親の早期離脱、下記「教訓」参照、修正済み）→ rep3 は子の停滞により 40 分絶対上限での timeout 打ち切り見込み（2026-07-04 16:44 頃）

### 再開時にまず確認すること

1. ~~rep3 の timeout 経路確認~~ → **確認済み**（`outcome: "timeout"`、40 分ちょうどで SIGKILL、残存成果物の採点 78.64 点まで記録。impressions.md 追記済み。**ハーネス検証は完了しており、本計測を開始できる状態**。なお SIGKILL 打ち切りランでは親 usage が取れず `parent_tokens` が null になる — レポートでは N/A 扱い）
2. ユーザーに本計測開始の合図と開始方式（下記）を確認する

## ユーザー決定事項

1. **本計測の開始はユーザーの合図があってから**（タスク #7）。開始方式は未決定: パイロット 1 ラン（推奨）か全ラン一括かを開始時に確認する
2. 天井効果（haiku がほぼ満点 = 品質軸の圧縮）は**対応せずこのまま測る**。品質＋効率の 2 軸報告で差を見る
3. **Sonnet5 は他 5 モデルの 15 ラン完了後、すぐ続けて実行**。ただし Claude 実行系は枠逼迫時に停滞するため（下記）、枠に余裕がある時間帯に流すこと
4. 計測期間中は CLI / skill / Godot のバージョンを固定（claude 2.1.200 / codex 0.142.3 / devin 2026.8.18 / cursor-agent 2026.07.01 / godot 4.4.1 / delegate-skills v0.6.0。claude / codex は package.json の exact 指定で固定）

## 実行手順

```sh
# 1 ラン実行（1 モデル × 1 反復、直列実行のみ。並列不可）
node src/bench/cli.ts run --model <MODEL> --rep <0|1|2>

# 再採点・失敗分析（grade.json の hidden_tests.failed_tests に失敗テスト名が入る）
node src/bench/cli.ts grade --workspace benchmarks/runs/<run-id>/workspace

# 集計レポート（Markdown）
node src/bench/cli.ts report
```

実行順とモデル ID（DESIGN.md §2 が正本）。各モデル rep 0..2 の 3 反復:

| 順  | `--model` 値      | 実行系 | 備考                                                                                                   |
| --- | ----------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| 1   | `gpt-5.5`         | Codex  | ID 実在確認済み                                                                                        |
| 2   | `gpt-5.4-mini`    | Codex  | ID 実在確認済み                                                                                        |
| 3   | `devin-glm-5.2`   | Devin  | プレフィックス必須（素の glm-5.2 は不可）                                                              |
| 4   | `composer-2.5`    | Cursor | ID 実在確認済み                                                                                        |
| 5   | `swe-1.6`         | Devin  | ID 実在確認済み                                                                                        |
| 6   | `claude-sonnet-5` | Claude | フル ID 必須（エイリアス sonnet-5 は CLI 2.1.187 未対応。素の sonnet は 4.6 に解決されるので使わない） |

- 並列実行しない（親が同一 Claude 枠を消費し、負荷で時間計測が歪む）
- 各ラン完了時に `metrics.json` の `outcome` を確認。`stalled` / `timeout` / `failed` のランは 1 回だけ再実行してよいが、失敗ランの run ディレクトリと metrics は破棄せず残す（停滞率・失敗率も報告対象）
- レポート集計時、haiku のラン（rep0〜rep3、ハーネス検証用）はベンチ結果から除外する

## ハーネスの重要知見（E2E 3 回の失敗から学んだもの。壊すと計測がやり直しになる）

1. **親（claude -p）はバックグラウンド委譲不可**: 非対話モードではターン終了＝セッション終了で、バックグラウンドタスクの完了通知で再起動されない。親が先に死ぬと子ツリーが SIGTERM され委譲が壊れる。このため playbook（`src/bench/run.ts` の `parentPlaybook`）は「フォアグラウンド dispatch + timeout 2400000ms、バックグラウンド禁止」を指示し、orchestrator が親 env に `BASH_DEFAULT_TIMEOUT_MS` / `BASH_MAX_TIMEOUT_MS = 2400000` を注入している。**この 2 点を変更しないこと**
2. **プロトコル違反検出**: 親の最終応答が completed / failed の一語でない、または observe JSON に `state.phase == "running"` の委譲が残っている場合、`violatesParentProtocol()` が outcome を failed に落とす
3. **watchdog**: 30 秒間隔サンプリング。無進捗判定は workspace mtime + delegate ログサイズのみ（CPU は生存確認専用。進捗判定に入れると親の CPU 微増で stalled が永久に発火しない）。10 分無進捗で stalled、40 分で timeout、SIGKILL 打ち切り
4. **Claude 実行系の子は枠逼迫時に停滞する**: sonnet（4.6）と haiku で計 3 回観測。プロセス生存・heartbeat 更新のままファイルを書かなくなる。レート制限解除直後でも起きた。Sonnet5 ランはこのリスクを織り込み、失敗時は再実行 + metrics 保全で対応
5. **子トークンの計測精度**（v0.6.0 時点）: 第一ソースは observe JSON の `usage`（skill が記録。Claude / Codex / Devin = measured、Cursor = CLI が usage JSON を出さないため estimated）。observe usage が無い旧ランは codex-home セッション JSONL（Codex）→ chars/4 推定の順にフォールバック。往復間で measured / estimated が混在したランは estimated に落とす。`metrics.json` の `measurement` フィールドで区別される
6. **`DELEGATE_IMPLEMENT_MODEL` がシェルに残留することがある**: orchestrator 経由なら env 明示設定で安全。手動で delegate skill を使う場合は毎回明示指定する
7. observe JSON（`<run>/delegate/work/*_observe.json`）は失敗調査の一次情報。`state.phase` / `state.exit_code` / `events` / `streams.stderr.content` を jq で読む

## 再開後の残作業

1. 本計測 18 ラン（上記順、Sonnet5 最後）→ `report` で集計 → 結果を docs へ（品質スコア中央値 + 効率 Pareto + ハーネス交絡・停滞率の注記。DESIGN.md §5〜§7）
2. 委譲のたびに `benchmarks/impressions.md` へ定性所感を追記する（ユーザー依頼による運用）
3. （任意・マイルストーン4）Web ギャラリー: 各モデル代表ランを Godot Web エクスポートし、**別リポジトリ**の GitHub Pages へ（DESIGN.md §9-4。単一スレッドエクスポート必須、COOP/COEP 不可のため）
4. 本リポジトリの public 化はラウンド完了後（DESIGN.md §7。公開時点でこのラウンドの仕様・テストは公開済み扱いとなり、以後の再測定はバリアント差し替え）

## コミット状況

成果物一式は GPT-5.5 の delegate-review を通した上でコミット済み（ハーネス一式 `5dd56e2`、README・パッケージ名修正 `a639c64`。いずれも未 push）。以後もコミット時は AGENTS.md の規約どおり delegate-review を先に通すこと。`docs/task-selection.md`（旧 plan.md、題材選定の検討ログ）は公開時に `docs/archive/` へ移す。`benchmarks/runs/` は gitignore 済み（session id 等を含む生データのため。集計のみコミット）。

## 関連資料

- 設計正本: `docs/design/DESIGN.md`（対象モデル・計測・採点・公平性・カンニング防止のすべて）
- 定性メモ: `benchmarks/impressions.md`（公開文書になる前提で表現に注意）
- 上流への貢献: delegate-skills [issue #1](https://github.com/oubakiou/delegate-skills/issues/1)（観測性の提案 → v0.5.0 で実装済み。レビュー済み文書: docs/feature/delegate-worker-observability.md）
- 上流への貢献（ハーネス知見 #5/#4/#6/#1 由来。**すべて v0.6.0 で実装済み・本プロジェクトへ導入済み**）:
  - [issue #2](https://github.com/oubakiou/delegate-skills/issues/2) 子ワーカーの token usage 実測値を observe JSON へ（claude / cursor / devin backend）
  - [issue #3](https://github.com/oubakiou/delegate-skills/issues/3) claude backend で stall 検出が機能しない（stream-json 化の提案）
  - [issue #4](https://github.com/oubakiou/delegate-skills/issues/4) resolve-model.sh の解決由来（env / default）の可視化
  - [issue #5](https://github.com/oubakiou/delegate-skills/issues/5) SKILL.md へ非対話親（claude -p）の利用制約を明記
