# 設計 — delegate ベンチ共通基盤

本書は 3 つの委譲ベンチ（implement / explore / review）の共通基盤をまとめる。各ベンチ固有の課題仕様、採点ルーブリック、マイルストーンは [delegate_implement_bench_design.md](./delegate_implement_bench_design.md)、[delegate_explore_bench_design.md](./delegate_explore_bench_design.md)、[delegate_review_bench_design.md](./delegate_review_bench_design.md) を参照。

## 1. ベンチ構成

親エージェント Claude Code（Fable）が delegate skill で子モデルに作業を委譲する。子モデルはベンチ種別ごとの `DELEGATE_*_MODEL` 環境変数で切り替え、`dispatch.sh` がモデル名プレフィックスで実行系 CLI を選択する（`gpt*` → Codex / `swe*`・`devin-*` → Devin / `composer*`・`cursor-*` → Cursor / それ以外 → Claude）。

### 対象モデル

| 指定名           | モデル ID                        | 実行系 CLI   |
| ---------------- | -------------------------------- | ------------ |
| gpt5.5           | `gpt-5.5`                        | Codex        |
| gpt5.4mini       | `gpt-5.4-mini`                   | Codex        |
| gpt5.3CodexSpark | `gpt-5.3-codex-spark`            | Codex        |
| glm5.2           | `devin-glm-5.2`                  | Devin        |
| DeepSeekV4Pro    | `devin-deepseek-v4-pro`          | Devin        |
| Composer2.5      | `composer-2.5`                   | Cursor       |
| Composer2.5Fast  | `composer-2.5-fast`              | Cursor       |
| Gemini3.1Pro     | `cursor-gemini-3.1-pro`          | Cursor       |
| KimiK2.7Code     | `cursor-kimi-k2.7-code`          | Cursor       |
| swe1.6           | `swe-1.6`                        | Devin        |
| gpt5.6Sol        | `gpt-5.6-sol`                    | Codex        |
| gpt5.6Terra      | `gpt-5.6-terra`                  | Codex        |
| gpt5.6Luna       | `gpt-5.6-luna`                   | Codex        |
| swe1.7           | `swe-1.7`                        | Devin        |
| Grok4.5          | `cursor-grok-4.5`                | Cursor       |
| Sonnet5          | `claude-sonnet-5`                | Claude       |
| Opus4.8          | `claude-opus-4-8`                | Claude       |
| Haiku4.5         | `claude-haiku-4-5`               | Claude       |
| Fable直接※       | ベンチ種別ごとの direct baseline | （委譲なし） |

※ direct baseline は、親（claude-fable-5）が委譲プロトコルを使わず同じ課題を直接処理する条件。「子モデル + 実行系 CLI」比較の行とは計測条件が異なるため、同じ表に載せる際は常にその旨を注記する。子トークンは 0（実測）で全消費が親側に計上され、委譲オーバーヘッドと品質上限の参照点になる。

- glm5.2 は素の `glm-5.2` だと dispatch の既定分岐（Claude 実行系）に落ちるため、プレフィックス付きで指定する。Devin / Cursor の両方で提供されているが、既定は `devin-glm-5.2` とする。`cursor-glm-5.2` を追加ランすると実行系ハーネス差の観察にも使える
- モデル ID の実在確認（2026-07-04 実施）: `gpt-5.5` / `gpt-5.4-mini`（Codex）、`glm-5.2` / `swe-1.6`（Devin）、`composer-2.5`（Cursor）はスモーク呼び出しで応答を確認済み。Sonnet 5 は短縮エイリアス `sonnet-5` が CLI 2.1.187 で未対応だが、**フル ID `claude-sonnet-5` で応答確認済み**。Opus 4.8 は 2026-07-05 に**フル ID `claude-opus-4-8` で応答確認済み**（エイリアス `opus` の解決先は CLI 更新で変わり得るためフル ID で固定する）。CLI バージョンはハーネスの一部として計測期間中は固定する（claude 2.1.200 / codex 0.142.3 / devin 2026.8.18 / cursor-agent 2026.07.01 / godot 4.4.1。claude / codex は `/usr/local/bin` が `node_modules/.bin` への symlink のため、package.json の exact 指定で固定）。`model-token-prices.json` に Sonnet 5 / Opus 4.8 の単価が無い場合も、Claude 実行系は observe usage の実測 `cost_usd` で報告できる（単価表換算は不要）
- 追加 5 モデル（本計測ラウンド完了後にユーザー指示で追加。delegate-skills のサポートモデル拡充に伴う）: `gpt-5.3-codex-spark`（Codex）、`devin-deepseek-v4-pro`（Devin）、`cursor-gemini-3.1-pro` / `cursor-kimi-k2.7-code` / `composer-2.5-fast`（Cursor）。2026-07-05 に 5 モデルすべてスモーク呼び出しで応答確認済み。Claude 実行系を含まないため実行順の枠制約は受けない
- 追加 5 モデル（2026-07-10 にユーザー指示で追加）: `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna`（Codex）、`swe-1.7`（Devin）、`cursor-grok-4.5`（Cursor）。5 モデルすべて 2026-07-10 にスモーク呼び出しで応答確認済み。ただし gpt-5.6 系はサーバ側が旧 CLI を拒否するため codex CLI を 0.142.3 → 0.144.1 へ、swe-1.7 は旧 CLI のモデル一覧に無いため devin CLI を 3000.1.23 → 3000.1.27 へ更新した（codex 0.144.1 は公開から 7 日未満のため `.npmrc` の `min-release-age=7` を当該インストールのみ `--min-release-age=0` で明示的にオーバーライドした）。cursor-agent は自動更新により 2026.07.09-a3815c0 になっていることを同日確認（固定運用から外れていた点に注意）。**このラウンド以降の CLI 固定バージョンは claude 2.1.200 / codex 0.144.1 / devin 3000.1.27 / cursor-agent 2026.07.09 / godot 4.4.1**。旧バージョン（codex 0.142.3 / devin 2026.8.18 系 / cursor-agent 2026.07.01）で計測した既存ランとはハーネスバージョンが異なるため、横並び比較の際はこの差を注記する。Claude 実行系を含まないため実行順の枠制約は受けない。なお cursor-agent 2026.07.09 には `create-chat` が racy に起動途中で停止する退行があり（[delegate-skills issue #14](https://github.com/oubakiou/delegate-skills/issues/14)）、cursor-grok-4.5 の正式 3 ランは vendored delegate-cursor.sh へ timeout + リトライのローカルパッチを当てて取得した（パッチ前の stalled 4 試行は非 completed として記録、原因区分はハーネス側）
- Haiku4.5（追加ラウンド後にユーザー指示でさらに追加）: 正式ランは**フル ID `claude-haiku-4-5`**（2026-07-05 応答確認済み）で実行する。エイリアス `haiku` で実行したハーネス検証ランは引き続き集計から除外し、model 名の違いで区別する。Claude 実行系のため枠制約（親と同一サブスクリプション消費）を受ける
- 子トークンの取得可否（2026-07-05 更新): delegate-skills v0.6.0（[issue #2](https://github.com/oubakiou/delegate-skills/issues/2) 実装）で observe JSON に usage が記録されるようになり、Claude / Codex / Devin は実測（measured）。Cursor は上流調査の結果 CLI が usage JSON を出さないことが判明し、chars/4 推定（estimated）にフォールバックする
- Cursor 子トークンの実測可能化（2026-07-10 判明）: cursor-agent 2026.07.09 は `--output-format json / stream-json` で実測 usage（inputTokens / outputTokens / cacheReadTokens / cacheWriteTokens）を出力するようになった（旧 2026.07.01 時代の「出さない」調査結論は失効）。実現方法を [issue #15](https://github.com/oubakiou/delegate-skills/issues/15) として上流へ提案し、**同日実装・導入済み**（`--output-format stream-json` + observe の `cacheReadTokens` マッピング。ベンチ実環境で measured 化を検証済み）。text モード時代の Cursor 系ラン（2026-07-10 以前）は estimated のままで、ローカルに usage は残らないため遡及計測は不可。measured 化を受けて Cursor 系 5 モデルは 2026-07-10 に 3 反復ずつ再計測した（レポートの採用値は rep ごとの最新 completed で置き換わる）
- 子トークン計測の退行と復旧（2026-07-10）: 2026-07-10 ラウンド（gpt-5.6 系 / swe-1.7）の child tokens が当初 estimated（input=0）に落ちた。当初は CLI 更新起因を疑ったが、真因は delegate-skills 側が [issue #6](https://github.com/oubakiou/delegate-skills/issues/6) の実装で「dispatch されなかった observe」を `phase: "superseded"` にマークするようになったのに対し、orchestrator の usage 全数チェック（metrics.ts）が `prepared` しか除外していなかったこと（dispatch 済み observe の usage 実測は正常に記録されていた）。`superseded` も分母から除外する修正を実施し、影響 12 ランの metrics を保存アーティファクトから再計算して全ラン measured へ復旧済み。cursor-grok-4.5 の 3 ラン（stalled、SIGKILL 打ち切りで usage なし）は estimated のままが正しい
- **実行順の制約**: Claude 実行系の 3 モデル（Sonnet5 / Opus4.8 / Haiku4.5）は全モデルの最後に実施し、direct baseline はさらにその後（親と同じ枠の消費が最大のため）。親（Fable）と同じ Claude サブスクリプションの週間利用枠を消費するため、計測途中で枠に達した場合でも非 Claude 実行系のモデル群の結果が先に揃っているようにする。同じ理由で、これらのランは親側トークンを普段より温存できるタイミング（週の枠リセット直後等）に寄せてよい

### 測定対象の定義

各ベンチが測るのは**「子モデル + その実行系 CLI ハーネス + delegate protocol」の複合性能**であり、モデル単体の性能ではない。Codex / Devin / Cursor / Claude はシステムプロンプト・ツールセット・エージェントループが異なるため、結果の解釈・公表時はこの交絡を明記する。

## 2. 実行アーキテクチャ

orchestrator（TypeScript、`src/bench/`）が 1 ラン = 1 モデル × 1 反復を次の手順で実行する。

```text
orchestrator (TypeScript CLI)
  └─ ランごとに:
      1. 使い捨ての独立 git リポジトリとして workspace を作成
      2. env 設定: DELEGATE_*_MODEL / DELEGATE_METRICS_FILE / DELEGATE_WORK_DIR
      3. 親を headless 起動:
         claude -p <親playbook> --model claude-fable-5 --output-format json
           └─ 親が対象 delegate skill で子へ委譲
      4. メトリクス収集 → 採点パイプライン → benchmarks/runs/<run-id>/ に保存
```

### 親 playbook（固定プロンプト）

親の振る舞いは往復回数・親トークンに直結するため、全ランで同一の playbook に固定する。

- 子へ渡す課題正本を Objective / Acceptance criteria として対象 delegate skill に渡す
- 親自身による成果物の実質的な修正は禁止する
- hidden oracle / hidden tests / 採点用正解は親にも見せない
- direct baseline を除き、作業の主体は子モデルに限定する

### 停滞検知（watchdog）

委譲中の子は response 生成まで無音のため、orchestrator が外側から副作用を観測して停滞を検知する。

- 30〜60 秒ごとにサンプリング: 子プロセスツリーの生存、workspace 最新 mtime、`DELEGATE_WORK_DIR` 配下のログ（セッション JSONL / stderr）のサイズ、子プロセス CPU 時間の増分
- **無進捗タイムアウト**: 全シグナルが N 分間変化しなければ stalled として kill し、往復失敗として記録
- **絶対タイムアウト**: 1 往復あたり M 分で打ち切り
- 単一シグナルでの停止判定はしない（API 待ちで CPU が止まるのは正常。複数シグナルの複合で判定する）
- ランの outcome に completed / failed / stalled / timeout を区別して記録する。モデル別の停滞率はそれ自体を信頼性メトリクスとして報告する
- 子への「進捗を自己申告させる」方式は採らない（不遵守・形骸化しやすい）。delegate スクリプトが捨てている CLI のイベントストリームを保全したい場合も、vendored copy にパッチせず orchestrator 側のラッパで tee する

## 3. 計測メトリクス

| 指標         | 取得方法                                                                                                                                 | 精度                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 所要時間     | orchestrator の壁時計計測 + `claude -p --output-format json` の `duration_ms`。往復単位は request/response ファイルの timestamp 差で近似 | measured             |
| 委譲往復回数 | `DELEGATE_METRICS_FILE`（JSONL）の `kind: "prepare"` 行数                                                                                | measured             |
| 親トークン   | `claude -p --output-format json` の usage（input / cache_read / output）と `total_cost_usd`                                              | measured             |
| 子トークン   | 実行系ごとのアダプタで収集（下記）                                                                                                       | measured / estimated |
| 換算コスト   | `model-token-prices.json` の単価で換算。単価 null のモデルは N/A として報告                                                              | derived              |

### 子トークンの実行系別アダプタ

- **第一ソース（全実行系共通、delegate-skills v0.6.0 以降）**: observe JSON の `usage` フィールド。skill が backend ごとに実測値を抽出して記録する（Claude = stream-json / Codex = JSON 出力 + セッション JSONL / Devin = ATIF export で measured。Cursor = CLI が usage JSON を出さないため chars/4 推定で estimated）
- **フォールバック**: observe usage が無い場合、Codex は隔離 `CODEX_HOME` のセッション JSONL を glob 集計（measured）、それ以外は request/response の `estimated_tokens`（chars/4）推定（estimated）
- 往復間で measured / estimated が混在したランは、実測精度を過大申告しないよう estimated として報告する
- `metrics.json` には必ず `measurement: "measured" | "estimated"` を値と併記し、精度の異なる数値を混同させない

### metrics.json 共通フィールド（例）

```json
{
  "run_id": "20260703-1500-gpt-5.5-rep1",
  "model": "gpt-5.5",
  "backend": "codex",
  "wall_clock_ms": 0,
  "round_trips": 0,
  "parent_tokens": { "input": 0, "cache_read": 0, "output": 0, "cost_usd": 0 },
  "child_tokens": { "input": 0, "output": 0, "measurement": "measured", "cost_usd": null },
  "outcome": "completed"
}
```

## 4. 公平性と妥当性の限界

- **同一入力**: 課題正本、親 playbook、CLI バージョンは全ランで固定。反復は各モデル N=3 とし、品質スコアは completed ラン合算（反復間の再現性を含めて評価）、時間・往復・トークン等の効率指標は completed ラン中央値で報告する
- **親の非決定性**: 親（Fable）の応答ゆらぎが往復回数・親トークンに影響する。playbook 固定と反復で緩和するが、ゼロにはならない
- **ハーネス交絡**: 実行系 CLI の差はモデル差と分離できない。レポートには「モデル + 実行系」の複合である旨を常に併記する
- **計測の非対称**: 子トークンが estimated のモデルと measured のモデルの直接比較には注意する。コスト比較はキャッシュ単価の扱いにも依存する
- **価格欠損**: `model-token-prices.json` に単価がないモデルはコスト N/A とし、トークン数のみで比較する
- **学習汚染**: 独自仕様・固定 pack は汚染の軽減であって排除ではない。公開後または時期をまたぐ再測定では、同一結果の再利用を避けるためベンチ種別ごとのバリアントを新ラウンドとして実施し、スコア比較は同一ラウンド内に限定する

### ラン間・ラウンド間のカンニング防止

過去のベンチ成果物・履歴を子モデルが参照できる経路を、次の層で遮断する。

| 経路                      | 対策                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| workspace 内の過去成果物  | ランごと（モデル × 反復ごと）に workspace を新規作成し、終了後は採点のためのコピーを `runs/` に隔離保存。workspace は使い捨て                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 本リポジトリの秘匿資産    | reference / hidden-tests / hidden oracle / runs は子の視界に入れない（workspace を本リポジトリの worktree にしない）。リポジトリの public 化は計測ラウンド完了後に行い、公開時点でそのラウンドの仕様・テストは「公開済み」扱いとする（以後の再測定はバリアント差し替え）                                                                                                                                                                                                                                                                                      |
| delegate の一時ファイル   | `DELEGATE_WORK_DIR` / `DELEGATE_METRICS_FILE` / request・response の出力先をすべてラン専用ディレクトリに向ける                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 実行系 CLI のローカル状態 | Codex は delegate スクリプトが disposable `CODEX_HOME`（auth のみ持ち込み）を使うため履歴が残らない。Devin / Cursor（2026-07-04 確認）: セッションはディレクトリ単位で保存され、delegate ラッパは resume / continue を使わず毎回新規セッションを開始するため、ラン専用 workspace と組み合わせればローカル分離は成立する。Devin の always-on rules は対象リポジトリの AGENTS.md / CLAUDE.md のみでグローバル知識は未設定。**クラウド側の org knowledge / メモリの不参照は CLI からは検証不能**であり、残余リスクとしてラウンド間バリアント差し替えでカバーする |
| プロバイダ側の学習・記憶  | API 入出力が将来のモデル学習に取り込まれる可能性は制御できない。時期をまたぐ再測定は同一結果の再利用をせず、仕様バリアントを差し替えた新ラウンドとして実施し、スコア比較は同一ラウンド内に限定する                                                                                                                                                                                                                                                                                                                                                            |
| 隠し資産の露出            | 隠しテスト、hidden oracle、採点ログは公表しない。公表が必要になった場合、そのラウンドを最後のラウンドとし、以後はバリアント + 新規テストで実施する                                                                                                                                                                                                                                                                                                                                                                                                            |

## 5. リポジトリ構成

```text
src/                                 # orchestrator / metrics 収集 / 採点ドライバ（TypeScript, in-source test）
benchmarks/
  impressions.md                     # 委譲先モデルの定性所感（委譲のたびに追記）
  tasks/
    <bench-task>/                    # ベンチ種別ごとの課題正本・reference / hidden oracle
  runs/                              # ラン成果物（gitignore。集計レポートのみコミット）
    <run-id>/
      workspace/                     # 使い捨ての独立リポジトリ（子の作業場所）
      delegate/                      # DELEGATE_METRICS_FILE / DELEGATE_WORK_DIR の出力
      metrics.json
      grade.json
```

## 6. 開発基盤（テンプレート由来）

本リポジトリは typescript-agent-package-template を基盤とする。品質ゲートは npm scripts（`check` / `test` / `build` / `pack:check`）に集約し、エージェント hook は `.agents/scripts/*` を安定境界とする薄い wrapper 構成、テンプレート更新は再生成 + diff、テストは in-source testing を用いる。詳細は [development.md](./development.md) を参照。
