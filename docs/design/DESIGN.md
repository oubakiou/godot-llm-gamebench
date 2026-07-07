# 設計 — godot-llm-gamebench

> 本書は godot-llm-gamebench の永続的な設計判断をまとめる。題材選定の経緯は `docs/task-selection.md`（公開時に `docs/archive/` へ移す）を参照。個別の機能追加・修正計画は `docs/feature/` / `docs/bug/` / `docs/refactoring/` に起票する。

## 1. 目的

LLM のプログラミング能力を、**Godot 4.x + Typed GDScript による独自仕様ミニゲーム「Conveyor Courier」の実装**を課題として比較測定する。テトリス等の有名ゲームで生じる学習汚染ノイズを避け、「仕様を読んで抽象化・実装する力」を測る。

測定は品質と効率の 2 軸で行う。

- **品質**: 隠しテストを中心とした自動採点スコア
- **効率**: 所要時間、委譲往復回数、親側消費トークン、子側消費トークン、換算コスト

## 2. ベンチ構成

親エージェント Claude Code（Fable）が `delegate-implement` skill で子モデルに実装を委譲する。子モデルは `DELEGATE_IMPLEMENT_MODEL` 環境変数で切り替え、`dispatch.sh` がモデル名プレフィックスで実行系 CLI を選択する（`gpt*` → Codex / `swe*`・`devin-*` → Devin / `composer*`・`cursor-*` → Cursor / それ以外 → Claude）。

### 対象モデル

| 指定名           | `DELEGATE_IMPLEMENT_MODEL` | 実行系 CLI   |
| ---------------- | -------------------------- | ------------ |
| gpt5.5           | `gpt-5.5`                  | Codex        |
| gpt5.4mini       | `gpt-5.4-mini`             | Codex        |
| gpt5.3CodexSpark | `gpt-5.3-codex-spark`      | Codex        |
| glm5.2           | `devin-glm-5.2`            | Devin        |
| DeepSeekV4Pro    | `devin-deepseek-v4-pro`    | Devin        |
| Composer2.5      | `composer-2.5`             | Cursor       |
| Composer2.5Fast  | `composer-2.5-fast`        | Cursor       |
| Gemini3.1Pro     | `cursor-gemini-3.1-pro`    | Cursor       |
| KimiK2.7Code     | `cursor-kimi-k2.7-code`    | Cursor       |
| swe1.6           | `swe-1.6`                  | Devin        |
| Sonnet5          | `claude-sonnet-5`          | Claude       |
| Opus4.8          | `claude-opus-4-8`          | Claude       |
| Haiku4.5         | `claude-haiku-4-5`         | Claude       |
| Fable直接※       | `fable-direct`             | （委譲なし） |

※ `fable-direct` はベースライン条件。親（claude-fable-5）が委譲プロトコルを使わず direct playbook で直接実装・検証する。「子モデル + 実行系 CLI」比較の行とは計測条件が異なるため、同じ表に載せる際は常にその旨を注記する。子トークンは 0（実測）で全消費が親側に計上され、委譲オーバーヘッドと品質上限の参照点になる。

- glm5.2 は素の `glm-5.2` だと dispatch の既定分岐（Claude 実行系）に落ちるため、プレフィックス付きで指定する。Devin / Cursor の両方で提供されているが、既定は `devin-glm-5.2` とする。`cursor-glm-5.2` を追加ランすると実行系ハーネス差の観察にも使える
- モデル ID の実在確認（2026-07-04 実施）: `gpt-5.5` / `gpt-5.4-mini`（Codex）、`glm-5.2` / `swe-1.6`（Devin）、`composer-2.5`（Cursor）はスモーク呼び出しで応答を確認済み。Sonnet 5 は短縮エイリアス `sonnet-5` が CLI 2.1.187 で未対応だが、**フル ID `claude-sonnet-5` で応答確認済み**。Opus 4.8 は 2026-07-05 に**フル ID `claude-opus-4-8` で応答確認済み**（エイリアス `opus` の解決先は CLI 更新で変わり得るためフル ID で固定する）。CLI バージョンはハーネスの一部として計測期間中は固定する（claude 2.1.200 / codex 0.142.3 / devin 2026.8.18 / cursor-agent 2026.07.01 / godot 4.4.1。claude / codex は `/usr/local/bin` が `node_modules/.bin` への symlink のため、package.json の exact 指定で固定）。`model-token-prices.json` に Sonnet 5 / Opus 4.8 の単価が無い場合も、Claude 実行系は observe usage の実測 `cost_usd` で報告できる（単価表換算は不要）
- 追加 5 モデル（本計測ラウンド完了後にユーザー指示で追加。delegate-skills のサポートモデル拡充に伴う）: `gpt-5.3-codex-spark`（Codex）、`devin-deepseek-v4-pro`（Devin）、`cursor-gemini-3.1-pro` / `cursor-kimi-k2.7-code` / `composer-2.5-fast`（Cursor）。2026-07-05 に 5 モデルすべてスモーク呼び出しで応答確認済み。Claude 実行系を含まないため実行順の枠制約は受けない
- Haiku4.5（追加ラウンド後にユーザー指示でさらに追加）: 正式ランは**フル ID `claude-haiku-4-5`**（2026-07-05 応答確認済み）で実行する。エイリアス `haiku` で実行したハーネス検証ラン（E2E rep0〜4、§8）は引き続き集計から除外し、model 名の違いで区別する。Claude 実行系のため枠制約（親と同一サブスクリプション消費）を受ける
- 子トークンの取得可否（2026-07-05 更新): delegate-skills v0.6.0（[issue #2](https://github.com/oubakiou/delegate-skills/issues/2) 実装）で observe JSON に usage が記録されるようになり、Claude / Codex / Devin は実測（measured）。Cursor は上流調査の結果 CLI が usage JSON を出さないことが判明し、chars/4 推定（estimated）にフォールバックする
- **実行順の制約**: Claude 実行系の 3 モデル（Sonnet5 / Opus4.8 / Haiku4.5）は全モデルの最後に実施し、ベースライン `fable-direct` はさらにその後（親と同じ枠の消費が最大のため）。親（Fable）と同じ Claude サブスクリプションの週間利用枠を消費するため、計測途中で枠に達した場合でも非 Claude 実行系のモデル群の結果が先に揃っているようにする。同じ理由で、これらのランは親側トークンを普段より温存できるタイミング（週の枠リセット直後等）に寄せてよい

### 測定対象の定義

本ベンチが測るのは**「子モデル + その実行系 CLI ハーネス」の複合性能**であり、モデル単体の性能ではない。Codex / Devin / Cursor はシステムプロンプト・ツールセット・エージェントループが異なるため、結果の解釈・公表時はこの交絡を明記する（§7）。

## 3. 課題仕様: Conveyor Courier

グリッド上を流れる荷物を、ベルトの設置・回転で正しい色の出口へ運ぶ tick 駆動パズル。子モデルに渡す課題文の正本は `benchmarks/tasks/conveyor-courier/prompt.md` とし、**全モデル・全反復で byte 一致**させる。以下はその設計判断（確定ルール）。数値パラメータ（8x8 盤面・120 tick・スポーン間隔 3・詰まり上限 5・勝利スコア 20・seed 12345）は、リファレンス実装 + 隠しテストで妥当性検証済みとして**凍結済み**（単純コントローラで score 20 以上・ミス 0 を達成できることをテストで確認）。

### 確定ルール

- 盤面は 8x8。セル種別は `EMPTY` / `BELT_UP` / `BELT_RIGHT` / `BELT_DOWN` / `BELT_LEFT` / `SPLITTER` / `BLOCK` / `EXIT_RED` / `EXIT_BLUE` / `SPAWN`
- ゲームは **tick 数ベース**（120 tick で終了）。実時間・Timer は View 層の演出であり、ルールには一切登場しない
- 荷物は 3 tick ごとに `SPAWN` セルへ出現する。色（RED / BLUE）は指定 seed の RNG で決まり、同一 seed なら同一の荷物列になる
- 移動は**二相解決**: 全荷物の移動先を確定してから一括適用する。競合（同一セルへの合流）は荷物 ID（出現順）昇順で優先し、負けた荷物は待機。相互スワップは禁止（両者待機）
- 進行先が `BLOCK` / `EMPTY` / 他荷物なら待機。**5 tick 連続で待機した荷物は「詰まり」としてミス除去**
- 進行先が盤外ならミス除去。異色の出口に入ったらミス、同色の出口なら +1 点
- `SPAWN` セルが塞がっていて出現できない場合、その荷物はミスとして数える
- `SPLITTER` は進入方向に対して左右交互に排出する。初回は右、スプリッタごとに独立したトグルで、seed に依存しない
- プレイヤー操作は tick と tick の間にのみ適用: `EMPTY` へのベルト設置、既存ベルトの 90 度時計回り回転（荷物が乗っていても可）
- 勝利条件: 終了時スコア 20 以上（達成可能性はリファレンス実装の操作列で保証する）
- 決定性: 同一 seed + 同一操作列（適用 tick 含む）→ 同一のイベント列・最終状態

### API 契約

隠しテストがそのままリンクできるよう、Core simulation の API は課題文で完全指定する（メソッドシグネチャ、enum 値、`StepResult` / `ItemSnapshot` の全フィールド、ASCII マップ記法 `. ^ > v < S # R B I`）。骨子:

```gdscript
class_name BoardModel

enum CellKind { EMPTY, BELT_UP, BELT_RIGHT, BELT_DOWN, BELT_LEFT, SPLITTER, BLOCK, EXIT_RED, EXIT_BLUE, SPAWN }
enum ItemKind { RED, BLUE }

func setup(map: PackedStringArray, rng_seed: int) -> void
func step_tick() -> StepResult
func place_belt(pos: Vector2i, kind: CellKind) -> bool
func rotate_cell(pos: Vector2i) -> bool
func get_cell(pos: Vector2i) -> CellKind
func get_items() -> Array[ItemSnapshot]
func get_score() -> int
func get_misses() -> int
func get_tick() -> int
func is_finished() -> bool
```

- `BoardModel` は SceneTree / Node に依存しない純ロジックとし、headless でクラス単体ロード可能であること（これ自体を隠しテストで検証する）
- View（`Main.tscn`、盤面描画、HUD、マウス・キーボード入力）はゲームとして遊べる最低限を要求するが、実装方針は子モデルの裁量とする

API を固定するため、本ベンチが測るのは「固定契約下の仕様実装力」であり、アーキテクチャ設計力は View 層の裁量部分でしか測れない。これは自動採点の再現性を優先した意図的なトレードオフである。

### 学習汚染対策（バリアント）

出口種別・盤面サイズ・スプリッタ規則などを差し替えたバリアントを `variants/` に用意できる構造にする。ただし**同一比較ラウンド内では全モデルに同一バリアント**を使う（バリアント間の難易度は較正されていないため、ラウンドをまたいだスコア比較はしない）。

## 4. 実行アーキテクチャ

orchestrator（TypeScript、`src/`）が 1 ラン = 1 モデル × 1 反復を次の手順で実行する。

```text
orchestrator (TypeScript CLI)
  └─ ランごとに:
      1. 使い捨ての独立 git リポジトリとして workspace を作成
         （本リポジトリの worktree にはしない。reference / hidden-tests が
          子から見える状態は汚染になるため、workspace には prompt.md と
          delegate skill の実行に必要な最小ファイルのみを配置する）
      2. env 設定: DELEGATE_IMPLEMENT_MODEL / DELEGATE_METRICS_FILE / DELEGATE_WORK_DIR
      3. 親を headless 起動:
         claude -p <親playbook> --model claude-fable-5 --output-format json
           └─ 親が delegate-implement で prompt.md を子へ委譲（実装往復）
      4. メトリクス収集 → 採点パイプライン → benchmarks/runs/<run-id>/ に保存
```

### 親 playbook（固定プロンプト）

親の振る舞いは往復回数・親トークンに直結するため、全ランで同一の playbook に固定する。

- `prompt.md` を Objective / Acceptance criteria として delegate-implement に渡す
- 子の報告後、親は**公開受け入れ基準のみ**で検証する（隠しテストには親もアクセスしない）
- 検証失敗時は失敗内容を伝えて再委譲する。**親自身によるコード修正は禁止**（子の能力測定が汚染されるため）
- 最大 5 往復で打ち切り、その時点の成果物を採点対象とする

### 停滞検知（watchdog）

委譲中の子は response 生成まで無音のため、orchestrator が外側から副作用を観測して停滞を検知する。

- 30〜60 秒ごとにサンプリング: 子プロセスツリーの生存、workspace 最新 mtime、`DELEGATE_WORK_DIR` 配下のログ（セッション JSONL / stderr）のサイズ、子プロセス CPU 時間の増分
- **無進捗タイムアウト**: 全シグナルが N 分間変化しなければ stalled として kill し、往復失敗として記録
- **絶対タイムアウト**: 1 往復あたり M 分で打ち切り
- 単一シグナルでの停止判定はしない（API 待ちで CPU が止まるのは正常。複数シグナルの複合で判定する）
- ランの outcome に completed / failed / stalled / timeout を区別して記録する。モデル別の停滞率はそれ自体を信頼性メトリクスとして報告する
- 子への「進捗を自己申告させる」方式は採らない（不遵守・形骸化しやすい）。delegate スクリプトが捨てている CLI のイベントストリームを保全したい場合も、vendored copy にパッチせず orchestrator 側のラッパで tee する

## 5. 計測メトリクス

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

### metrics.json スキーマ（例）

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

## 6. 採点

採点は headless で完結させ、人手・LLM judge への依存を最小化する。

```text
grade.sh <workspace>
  1. godot --headless --import         # プロジェクトが import できるか
  2. 起動 smoke                         # Main.tscn がエラーなくロードできるか
  3. 隠しテスト実行                      # BoardModel API 契約に対する機能テスト
                                        # （addon 非依存の自己完結 GDScript ランナー。
                                        #   任意の workspace に注入して headless 実行する）
  4. 決定性テスト                        # 同一 seed + 同一操作列を 2 回実行し結果一致
  5. 型品質チェック                      # untyped_declaration 等を error に昇格 (=2) した
                                        # 一時プロジェクトで全 .gd を per-file --check-only し、
                                        # "Warning treated as error" 行をカウント
                                        # （警告値 1 は headless 実行では無音のため 2 が必須）
```

### ルーブリック（100 点、全項目自動採点）

| 配点 | 項目               | 判定方法                                                                     |
| ---: | ------------------ | ---------------------------------------------------------------------------- |
|   60 | 機能正当性         | 隠しテストの重み付き pass 率（移動・衝突・スプリッタ・出口・ミス処理・境界） |
|   10 | 決定性             | seed 再現テストの成否                                                        |
|   15 | 型品質             | 型警告 0 で満点、警告数に応じて減点                                          |
|   15 | プロジェクト健全性 | import / 起動 smoke / `BoardModel` の Scene 非依存ロード                     |

- 効率指標（時間・往復・トークン・コスト）は品質スコアに**合成しない**。品質 × コストの散布図（Pareto）として別軸で報告する
- 採点器はリファレンス実装に対して満点を出すことを CI 相当の前提条件とする（採点器自体の回帰検出を兼ねる）

## 7. 公平性と妥当性の限界

- **同一入力**: `prompt.md`・盤面・seed・親 playbook は全ランで固定。反復は各モデル N=3 とし、品質スコアは completed ラン合算（最大 300。反復間の再現性を含めて評価）、時間・往復・トークン等の効率指標は completed ラン中央値で報告する
- **親の非決定性**: 親（Fable）の応答ゆらぎが往復回数・親トークンに影響する。playbook 固定と反復で緩和するが、ゼロにはならない
- **ハーネス交絡**: 実行系 CLI の差はモデル差と分離できない。レポートには「モデル + 実行系」の複合である旨を常に併記する
- **計測の非対称**: 子トークンが estimated のモデルと measured のモデルの直接比較には注意する。コスト比較はキャッシュ単価の扱いにも依存する
- **価格欠損**: `model-token-prices.json` に単価がないモデルはコスト N/A とし、トークン数のみで比較する
- **学習汚染**: 独自仕様は汚染の軽減であって排除ではない。仕様変更に対する頑健性を見たい場合はバリアントを新ラウンドとして実施する
- **インフラ作成者との重複**: リファレンス実装・隠しテストとも gpt-5.5 が作成しており（隠しテストは sonnet が停滞したため振替）、ベンチ対象と重なる。セッションは分離され成果物（reference / hidden-tests）は正式ランの子から見えないため実質的な優位は生じないと判断するが、交絡の可能性として記録しておく。同一作者ゆえの相関誤読リスクは、親（Fable）による仕様突き合わせレビュー・RNG 列の独立再計算・ミューテーションテスト（既知の誤実装 3 種を全検出）で緩和した

### ラン間・ラウンド間のカンニング防止

過去のベンチ成果物・履歴を子モデルが参照できる経路を、次の層で遮断する。

| 経路                      | 対策                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| workspace 内の過去成果物  | ランごと（モデル × 反復ごと）に workspace を新規作成し、終了後は採点のためのコピーを `runs/` に隔離保存。workspace は使い捨て                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 本リポジトリの秘匿資産    | reference / hidden-tests / runs は子の視界に入れない（workspace を本リポジトリの worktree にしない）。リポジトリの public 化は計測ラウンド完了後に行い、公開時点でそのラウンドの仕様・テストは「公開済み」扱いとする（以後の再測定はバリアント差し替え）                                                                                                                                                                                                                                                                                                            |
| delegate の一時ファイル   | `DELEGATE_WORK_DIR` / `DELEGATE_METRICS_FILE` / request・response の出力先をすべてラン専用ディレクトリに向ける                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 実行系 CLI のローカル状態 | Codex は delegate スクリプトが disposable `CODEX_HOME`（auth のみ持ち込み）を使うため履歴が残らない。Devin / Cursor（2026-07-04 確認）: セッションはディレクトリ単位で保存され、delegate ラッパは resume / continue を使わず毎回新規セッションを開始するため、ラン専用 workspace と組み合わせればローカル分離は成立する。Devin の always-on rules は対象リポジトリの AGENTS.md / CLAUDE.md のみでグローバル知識は未設定。**クラウド側の org knowledge / メモリの不参照は CLI からは検証不能**であり、残余リスクとしてラウンド間バリアント差し替え（§3）でカバーする |
| プロバイダ側の学習・記憶  | API 入出力が将来のモデル学習に取り込まれる可能性は制御できない。時期をまたぐ再測定は同一結果の再利用をせず、仕様バリアントを差し替えた新ラウンドとして実施し、スコア比較は同一ラウンド内に限定する（§3）                                                                                                                                                                                                                                                                                                                                                            |
| 隠しテストの露出          | 隠しテストと採点ログは公表しない。公表が必要になった場合、そのラウンドを最後のラウンドとし、以後はバリアント + 新規テストで実施する                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## 8. リポジトリ構成

```text
src/                                 # orchestrator / metrics 収集 / 採点ドライバ（TypeScript, in-source test）
benchmarks/
  impressions.md                     # 委譲先モデルの定性所感（委譲のたびに追記）
  tasks/conveyor-courier/
    prompt.md                        # 子モデルへ渡す課題文の正本（API 契約含む）
    variants/                        # 学習汚染対策の仕様バリアント
    reference/                       # リファレンス実装（Godot プロジェクト）
    hidden-tests/                    # 隠しテスト（自己完結ランナー）。子モデルには渡さない
  runs/                              # ラン成果物（gitignore。集計レポートのみコミット）
    <run-id>/
      workspace/                     # 使い捨ての独立リポジトリ（子の作業場所）
      delegate/                      # DELEGATE_METRICS_FILE / DELEGATE_WORK_DIR の出力
      metrics.json
      grade.json
```

## 9. マイルストーン

1. **仕様凍結**: `prompt.md` 完全版（API 契約・ルールの曖昧さゼロ化）、リファレンス実装、隠しテスト。完了条件: リファレンスが採点満点、決定性テスト pass、勝利条件を満たす操作列の存在確認
2. **ハーネス構築**: orchestrator、メトリクス収集、採点パイプライン。完了条件: `DELEGATE_IMPLEMENT_MODEL=haiku` での E2E ドライラン成功（Sonnet5 が計測対象に入ったため、ドライランは対象外の haiku を使う）、対象 6 モデルの ID 実在確認、Devin / Cursor の usage 取得可否確定、Devin / Cursor のセッション・knowledge がラン間で分離されることの確認
3. **本計測**: 7 モデル × 3 反復 + ベースライン `fable-direct` × 3 反復（計 24 ラン採用）+ レポート生成（品質スコア合算 [各モデル completed 3 ラン計・最大 300。反復間の再現性を評価に含めるため中央値から変更]、効率 Pareto、ハーネス交絡の注記）。実行順は Sonnet5 → Opus4.8 → fable-direct を最後にする（§2 実行順の制約。Opus4.8 と fable-direct は本計測ラウンド中にユーザー指示で追加）。完了後、delegate-skills のサポートモデル拡充に伴い追加 5 モデル × 3 反復（計 15 ラン）を同一手順・同一 CLI バージョンで追加計測（§2 追加 5 モデル）。さらに Haiku4.5 × 3 反復を同条件で追加（§2 Haiku4.5）
4. **Web ギャラリー（GitHub Pages）**: 各ランの成果物を Godot Web エクスポートでブラウザプレイ可能にし、スコア付き一覧ページを生成する
   - Pages はカスタムレスポンスヘッダを設定できないため、thread support 無効の単一スレッドエクスポートを使う（COOP/COEP 不要）
   - **公開先は本リポジトリとは別の公開専用リポジトリにする**。無料プランの Pages は public リポジトリを要求するため、本リポジトリから直接配信すると hidden-tests / reference / prompt.md がすべて露出する。ギャラリーリポジトリにはエクスポート済み成果物と一覧ページのみを置く
   - `export_presets.cfg` は採点器側から全モデル同一のものを注入する。エクスポート失敗（起動不能な成果物）はその事実を表示する
   - サイズ配慮: Web エクスポートは 1 件あたり数十 MB（wasm 同梱）になるため、既定では各モデルの代表ラン（品質スコアが中央のラン）のみ公開し、Pages のリポジトリ上限（1GB）内に収める
   - エクスポート物からスクリプトが抽出可能なため、公開後は §7 の「隠しテストの露出」と同じラウンド運用（公開ラウンドを最後とし、以後はバリアント差し替え）に従う

## 10. 開発基盤（テンプレート由来）

本リポジトリは typescript-agent-package-template を基盤とする。品質ゲートは npm scripts（`check` / `test` / `build` / `pack:check`）に集約し、エージェント hook は `.agents/scripts/*` を安定境界とする薄い wrapper 構成、テンプレート更新は再生成 + diff、テストは in-source testing を用いる。詳細は [development.md](./development.md) を参照。
