# 設計 — delegate-implement ベンチ（Conveyor Courier）

> 本書は `delegate-implement` skill の性能を測る Conveyor Courier ベンチ固有の設計をまとめる。モデル roster、実行アーキテクチャ、計測メトリクス、公平性・カンニング防止、共通リポジトリ構成、開発基盤は [bench_common_design.md](./bench_common_design.md) を参照。

## 1. 目的

LLM のプログラミング能力を、**Godot 4.x + Typed GDScript による独自仕様ミニゲーム「Conveyor Courier」の実装**を課題として比較測定する。テトリス等の有名ゲームで生じる学習汚染ノイズを避け、「仕様を読んで抽象化・実装する力」を測る。

測定は品質と効率の 2 軸で行う。

- **品質**: 隠しテストを中心とした自動採点スコア
- **効率**: 所要時間、委譲往復回数、親側消費トークン、子側消費トークン、換算コスト

## 2. 課題仕様: Conveyor Courier

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

## 3. 実行差分

`delegate-implement` ベンチでは、共通実行アーキテクチャに対して次の差分を持つ。

- workspace には `prompt.md` と delegate skill の実行に必要な最小ファイルのみを配置し、reference / hidden-tests は子から見える状態にしない
- env は `DELEGATE_IMPLEMENT_MODEL` / `DELEGATE_METRICS_FILE` / `DELEGATE_WORK_DIR` を設定する
- 親は `prompt.md` を Objective / Acceptance criteria として delegate-implement に渡す
- 子の報告後、親は**公開受け入れ基準のみ**で検証する（隠しテストには親もアクセスしない）
- 検証失敗時は失敗内容を伝えて再委譲する。**親自身によるコード修正は禁止**（子の能力測定が汚染されるため）
- 最大 5 往復で打ち切り、その時点の成果物を採点対象とする

## 4. 採点

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
|   15 | 型品質             | 型警告 0 で満点、警告 1 件につき −3（下限 0）                                |
|   15 | プロジェクト健全性 | import / 起動 smoke / `BoardModel` の Scene 非依存ロード                     |

- 効率指標（時間・往復・トークン・コスト）は品質スコアに**合成しない**。品質 × コストの散布図（Pareto）として別軸で報告する
- 採点器はリファレンス実装に対して満点を出すことを CI 相当の前提条件とする（採点器自体の回帰検出を兼ねる）

## 5. 公平性の implement 固有注記

共通の公平性・妥当性の限界は [bench_common_design.md](./bench_common_design.md#4-公平性と妥当性の限界) に従う。

- **同一入力**: `prompt.md`・盤面・seed・親 playbook は全ランで固定する
- **インフラ作成者との重複**: リファレンス実装・隠しテストとも gpt-5.5 が作成しており（隠しテストは sonnet が停滞したため振替）、ベンチ対象と重なる。セッションは分離され成果物（reference / hidden-tests）は正式ランの子から見えないため実質的な優位は生じないと判断するが、交絡の可能性として記録しておく。同一作者ゆえの相関誤読リスクは、親（Fable）による仕様突き合わせレビュー・RNG 列の独立再計算・ミューテーションテスト（既知の誤実装 3 種を全検出）で緩和した

## 6. リポジトリ構成

```text
benchmarks/
  tasks/conveyor-courier/
    prompt.md                        # 子モデルへ渡す課題文の正本（API 契約含む）
    variants/                        # 学習汚染対策の仕様バリアント
    reference/                       # リファレンス実装（Godot プロジェクト）
    hidden-tests/                    # 隠しテスト（自己完結ランナー）。子モデルには渡さない
  202607_delegate_implement_bench/
    runs/
      <run-id>/
        workspace/                   # 使い捨ての独立リポジトリ（子の作業場所）
        delegate/                    # DELEGATE_METRICS_FILE / DELEGATE_WORK_DIR の出力
        metrics.json
        grade.json
```

## 7. マイルストーン

1. **仕様凍結**: `prompt.md` 完全版（API 契約・ルールの曖昧さゼロ化）、リファレンス実装、隠しテスト。完了条件: リファレンスが採点満点、決定性テスト pass、勝利条件を満たす操作列の存在確認
2. **ハーネス構築**: orchestrator、メトリクス収集、採点パイプライン。完了条件: `DELEGATE_IMPLEMENT_MODEL=haiku` での E2E ドライラン成功（Sonnet5 が計測対象に入ったため、ドライランは対象外の haiku を使う）、対象 6 モデルの ID 実在確認、Devin / Cursor の usage 取得可否確定、Devin / Cursor のセッション・knowledge がラン間で分離されることの確認
3. **本計測**: 7 モデル × 3 反復 + ベースライン `fable-direct` × 3 反復（計 24 ラン採用）+ レポート生成（品質スコア合算 [各モデル completed 3 ラン計・最大 300。反復間の再現性を評価に含めるため中央値から変更]、効率 Pareto、ハーネス交絡の注記）。実行順は Sonnet5 → Opus4.8 → fable-direct を最後にする（共通基盤の実行順制約。Opus4.8 と fable-direct は本計測ラウンド中にユーザー指示で追加）。完了後、delegate-skills のサポートモデル拡充に伴い追加 5 モデル × 3 反復（計 15 ラン）を同一手順・同一 CLI バージョンで追加計測（共通基盤の追加 5 モデル）。さらに Haiku4.5 × 3 反復を同条件で追加
4. **Web ギャラリー（GitHub Pages）**: 各ランの成果物を Godot Web エクスポートでブラウザプレイ可能にし、スコア付き一覧ページを生成する
   - Pages はカスタムレスポンスヘッダを設定できないため、thread support 無効の単一スレッドエクスポートを使う（COOP/COEP 不要）
   - **公開先は本リポジトリとは別の公開専用リポジトリにする**。無料プランの Pages は public リポジトリを要求するため、本リポジトリから直接配信すると hidden-tests / reference / prompt.md がすべて露出する。ギャラリーリポジトリにはエクスポート済み成果物と一覧ページのみを置く
   - `export_presets.cfg` は採点器側から全モデル同一のものを注入する。エクスポート失敗（起動不能な成果物）はその事実を表示する
   - サイズ配慮: Web エクスポートは 1 件あたり数十 MB（wasm 同梱）になるため、既定では各モデルの代表ラン（品質スコアが中央のラン）のみ公開し、Pages のリポジトリ上限（1GB）内に収める
   - エクスポート物からスクリプトが抽出可能なため、公開後は共通基盤の「隠し資産の露出」と同じラウンド運用（公開ラウンドを最後とし、以後はバリアント差し替え）に従う
