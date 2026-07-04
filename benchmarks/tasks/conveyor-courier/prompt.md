# 課題: Conveyor Courier

Godot 4.4.1 + Typed GDScript で 2D ミニゲーム「Conveyor Courier」を実装してください。グリッド上を流れる荷物を、ベルトの設置・回転で正しい色の出口へ運ぶ tick 駆動パズルです。

この仕様は網羅的に書かれています。仕様に書かれたとおりに実装してください。曖昧に見える点があっても質問はできないため、本文の定義を唯一の根拠として解釈してください。

## 技術条件

- Godot 4.4.1、言語は GDScript のみ（C# 不可）
- 外部 addon・外部ライブラリの追加は禁止（自己完結すること）
- すべての GDScript は可能な限り静的型付けすること（変数・定数・関数引数・戻り値・`Array[T]`）
- 盤面ロジック `BoardModel` は SceneTree / Node に依存しない純ロジック（`RefCounted` 継承）とし、単体で `load()` してインスタンス化できること
- ファイル配置（固定。これ以外のスクリプト・シーンの追加は自由）:
  - `project.godot`（プロジェクトルート直下。main scene に `res://scenes/main.tscn` を設定）
  - `scenes/main.tscn`
  - `scripts/board_model.gd`（`class_name BoardModel`）

## 用語と座標系

- 盤面は 8x8 のグリッド。座標は `Vector2i(x, y)`。x は列（0..7、左→右）、y は行（0..7、上→下）
- 方向は単位ベクトルで表す: UP = `Vector2i(0, -1)`、RIGHT = `Vector2i(1, 0)`、DOWN = `Vector2i(0, 1)`、LEFT = `Vector2i(-1, 0)`
- 方向 d の「右」は時計回り 90 度 = `Vector2i(-d.y, d.x)`、「左」は反時計回り 90 度 = `Vector2i(d.y, -d.x)`（y 軸下向きの画面座標系）

## セル種別と ASCII マップ記法

| 文字 | CellKind     | 説明                                             |
| ---- | ------------ | ------------------------------------------------ |
| `.`  | `EMPTY`      | 空。荷物は進入できない。ベルト設置可能           |
| `^`  | `BELT_UP`    | 上向きベルト                                     |
| `>`  | `BELT_RIGHT` | 右向きベルト                                     |
| `v`  | `BELT_DOWN`  | 下向きベルト                                     |
| `<`  | `BELT_LEFT`  | 左向きベルト                                     |
| `S`  | `SPLITTER`   | スプリッタ（進入方向に対し左右交互に排出）       |
| `#`  | `BLOCK`      | 障害物。荷物は進入できない。設置も不可           |
| `R`  | `EXIT_RED`   | 赤出口                                           |
| `B`  | `EXIT_BLUE`  | 青出口                                           |
| `I`  | `SPAWN`      | 荷物の入口。移動規則上は `BELT_RIGHT` と同じ扱い |

マップは 8 行 × 各行 8 文字の `PackedStringArray` で与えられる。行 i が y=i、行内の文字 j が x=j に対応する。

「歩行可能セル」= `BELT_UP` / `BELT_RIGHT` / `BELT_DOWN` / `BELT_LEFT` / `SPLITTER` / `SPAWN`。荷物はこれらの上にのみ存在できる（出口は進入と同時に荷物を消費するため、荷物が出口上に留まることはない）。

## ゲームルール

数値パラメータ: 総 tick 数 = 120、スポーン間隔 = 3 tick、詰まり上限 = 5 tick、勝利スコア = 20。

### tick の進行

`step_tick()` を 1 回呼ぶと 1 tick 進む。tick 番号は 1 始まり（`setup()` 直後の `get_tick()` は 0、最初の `step_tick()` 後は 1）。1 tick 内の処理順は厳密に次のとおり。

1. 既に終了済み（`is_finished()` が true）なら、状態を一切変えず `finished = true` の空の `StepResult` を返す（`tick` フィールドは現在の tick 番号）
2. tick 番号を 1 増やす（以下 t とする）
3. **移動フェーズ**（後述）
4. **スポーンフェーズ**: `(t - 1) % 3 == 0` のとき（t = 1, 4, 7, ..., 118）、スポーン処理を 1 回行う（後述）
5. t == 120 なら終了状態にする（盤上に残った荷物はスコアにもミスにも数えない）
6. `StepResult` を返す

### 移動フェーズ

各荷物は現在いるセルの種別から「希望移動先」を 1 つ持つ。

- `BELT_*` / `SPAWN`: セルの向き（`SPAWN` は RIGHT）に 1 マス先
- `SPLITTER`: 荷物の進入方向（その荷物の `dir` = 最後に移動した方向）に対し、スプリッタ固有のトグルが示す側（右 or 左）に 1 マス先。トグルの初期値は「右」。トグルは**荷物がスプリッタのセルから離れることに成功したとき**（移動成功・出口進入・盤外退場のいずれでも）に反転する。ブロックされて留まった場合は反転せず、次 tick も同じ側を試みる

解決は次の順で行う。

1. **退場処理（同時）**: 希望移動先が盤外の荷物 → ミスとして除去。希望移動先が `EXIT_RED` / `EXIT_BLUE` の荷物 → 除去し、荷物の色と出口の色が一致なら得点 +1（`delivered`）、不一致ならミス +1（`missed`）。出口の容量は無制限で、同一 tick に複数の荷物が同じ出口へ入ってよい
2. **移動処理（不動点反復）**: 以下を「1 パスで 1 つも移動が起きなくなるまで」繰り返す。パス内では荷物 id 昇順に走査し、まだこの tick で移動していない荷物について、希望移動先が (a) 盤内の歩行可能セル、かつ (b) 現時点で他の荷物に占有されていない、なら移動を確定する（位置を更新し、`dir` を移動方向に更新。スプリッタから離れた場合はトグル反転）
   - この規則により、正面衝突のスワップや循環（互いの位置への同時移動）は起きない（空きセルが生じないため全員留まる）。前が動けば後ろも同一 tick 内に追従できる（後続パスで解決）
   - 同一の空きセルへ複数の荷物が向かう場合、id が小さい荷物が勝ち、負けた荷物は留まる
3. **詰まり処理**: この tick で移動も退場もしなかった荷物は `stuck_count` を +1 する（移動した荷物は 0 にリセット）。`stuck_count` が 5 に達した荷物はミスとして除去する（`missed`）

### スポーンフェーズ

1. RNG から色を 1 回引く（後述の決定性ルール）。荷物 id を 1 つ採番する（id は 0 始まりの連番。スポーン試行ごとに必ず消費される）
2. `SPAWN` セルが他の荷物に占有されていなければ、そこに新しい荷物を置く（`dir` の初期値は RIGHT）。`StepResult.spawned` に id を入れる
3. 占有されていれば荷物は生成されず、その id はミスとして数える（`StepResult.missed` に入れ、ミス +1）

マップにはちょうど 1 個の `SPAWN` セルが存在すると仮定してよい。

### プレイヤー操作

操作は tick と tick の間（`step_tick()` 呼び出しの外）でのみ適用される。

- `place_belt(pos, kind)`: `pos` が盤内の `EMPTY` かつ `kind` が `BELT_*` 4 種のいずれかなら設置して true。それ以外は状態を変えず false
- `rotate_cell(pos)`: `pos` が盤内の `BELT_*` セルなら時計回りに 90 度回転（UP→RIGHT→DOWN→LEFT→UP）して true。それ以外（`SPLITTER` 含む）は false。荷物が乗っているセルも回転してよい（次 tick から新しい向きが適用される）
- 設置数・回転数に制限はない

### 決定性

- RNG は `RandomNumberGenerator` を用い、`setup()` で `rng.seed = rng_seed` を設定する
- 色の決定は「スポーン試行 1 回につき `rng.randi()` を 1 回」呼び、`% 2 == 0` なら `RED`、それ以外は `BLUE`。スポーンが塞がれていた場合も消費する（盤面状態が RNG 列に影響しないこと）
- これ以外の目的で RNG を消費してはならない
- 同一 seed + 同一操作列（適用タイミング含む）→ `StepResult` の列と最終状態が完全一致すること

## BoardModel API 契約（変更禁止）

`scripts/board_model.gd` に次のとおり実装すること。シグネチャ・enum 値の名前と順序・内部クラスのフィールドは厳密に一致させること（隠しテストがこの契約に直接リンクする）。

```gdscript
class_name BoardModel
extends RefCounted

enum CellKind { EMPTY, BELT_UP, BELT_RIGHT, BELT_DOWN, BELT_LEFT, SPLITTER, BLOCK, EXIT_RED, EXIT_BLUE, SPAWN }
enum ItemKind { RED, BLUE }

class ItemSnapshot:
    extends RefCounted
    var id: int
    var kind: BoardModel.ItemKind
    var pos: Vector2i
    var dir: Vector2i

class StepResult:
    extends RefCounted
    var tick: int
    var spawned: Array[int]      # この tick に盤上へ出現した荷物 id（昇順）
    var delivered: Array[int]    # 正しい出口へ届いた荷物 id（昇順）
    var missed: Array[int]       # ミスとして消えた荷物 id（昇順。塞がれスポーン含む）
    var finished: bool

func setup(map: PackedStringArray, rng_seed: int) -> void
    # 盤面・スコア・ミス・tick・荷物・id 採番・RNG・スプリッタトグルをすべて初期化する

func step_tick() -> StepResult
func place_belt(pos: Vector2i, kind: CellKind) -> bool
func rotate_cell(pos: Vector2i) -> bool

func spawn_item(kind: ItemKind, pos: Vector2i, dir: Vector2i) -> int
    # テスト用の直接配置。pos が盤内の歩行可能セルで未占有、dir が 4 方向単位ベクトルのとき
    # 荷物を置いて採番した id を返す。それ以外は状態を変えず -1。RNG は消費しない

func peek_next_kind() -> ItemKind
    # 次のスポーン試行で引かれる色を、RNG を消費せずに返す

func get_cell(pos: Vector2i) -> CellKind   # 盤外は EMPTY を返す
func get_items() -> Array[ItemSnapshot]    # 盤上の荷物を id 昇順で返す
func get_score() -> int
func get_misses() -> int
func get_tick() -> int
func is_finished() -> bool
```

## View 要件（ゲームとして遊べること）

- `res://scenes/main.tscn` を実行するとゲームが自動で開始する
- 標準マップ（下記）と seed = 12345 を使う
- 0.5 秒ごとに 1 tick 自動で進む（120 tick = 60 秒）
- 左クリック: `EMPTY` セルなら選択中のベルト種を設置、`BELT_*` セルなら回転
- キー 1 / 2 / 3 / 4 で設置するベルト種を選択（順に UP / RIGHT / DOWN / LEFT）
- キー R でリスタート（同一 seed）
- HUD に表示: スコア、ミス数、残り tick、次の荷物の色（`peek_next_kind()`）、選択中のベルト種
- 終了時に WIN（スコア 20 以上）/ LOSE と最終スコアを表示
- 見た目は `ColorRect` や簡単な `Polygon2D` / `Label` で十分。荷物の色（赤/青）とセル種別・向きが視覚的に区別できること

標準マップ:

```text
........
I>>>>v..
.....v..
.....v>R
.....v..
.....>>B
........
........
```

## 受け入れ基準（この例が通ること）

標準マップ・seed 12345 で `BoardModel` を `setup()` した直後から:

1. `get_tick() == 0`、`get_items().is_empty()`、`is_finished() == false`
2. 1 回目の `step_tick()`: 戻り値の `tick == 1`、`spawned == [0]`、盤上の荷物は 1 個で `pos == Vector2i(0, 1)`、`dir == Vector2i(1, 0)`
3. 2 回目の `step_tick()`: 荷物 0 の `pos == Vector2i(1, 1)`（スポーンは t=4 まで無い）
4. `place_belt(Vector2i(0, 0), CellKind.BELT_UP) == true`、`place_belt(Vector2i(0, 1), CellKind.BELT_UP) == false`（SPAWN には置けない）
5. `rotate_cell(Vector2i(5, 3))` を 3 回呼ぶと `get_cell(Vector2i(5, 3)) == CellKind.BELT_RIGHT`（DOWN→LEFT→UP→RIGHT）
6. `godot --headless` でプロジェクトが import・起動エラーなしであること

## 成果物

上記ファイル配置のとおりの Godot プロジェクト一式。README やテストの提出は不要（書いても構わない）。
