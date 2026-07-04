LLMのプログラミング能力をベンチする目的でGodot+ Typed GDScriptでミニゲームを実装させようと思います。テトリスのような有名ゲームでは学習による測定ノイズが大きくなりそうですが良い題材はありますか？

---

かなり良い発想です。**テトリス、スネーク、ブロック崩し、2048、ローグライク、Sokoban素直版**あたりは実装例が多すぎて、LLMの「Godotで未知仕様を設計して実装する力」より「既視感あるコードを再構成する力」に寄りがちです。

一番おすすめは、**有名ゲームの換骨奪胎ではなく、“小さな状態機械＋Godotらしい入力・UI・アニメーション”を要求する独自仕様のパズル／アクション**です。

Godot + Typed GDScript なら、静的型は変数・定数・関数引数・戻り値などに使え、Godot公式ドキュメントでも実行前のエラー検出、補完、構造化、型が分かる場合の最適化 opcode などの利点が説明されています。つまりベンチの採点軸に「型をちゃんと設計しているか」を入れやすいです。([Godot Engine documentation][1])
また、自動採点まで考えるなら GUT や GdUnit4 のような Godot 4 向けテストフレームワークで GDScript／シーンのテストを組めます。GUT は GDScript で GDScript のテストを書けるツールとして説明されており、GdUnit4 も GDScript・C#・シーンテストをサポートしています。([GUT Documentation][2]) ([GitHub][3])

## いちばん良い題材案：**Conveyor Courier / ベルト仕分け工場**

これはかなりベンチ向きです。ざっくり言うと、**グリッド上を流れる荷物を、回転できるベルトやゲートで正しい出口に運ぶミニゲーム**です。

なぜ良いかというと、既存の有名ゲームそのものではないのに、LLMに要求する力が多面的です。

| 観点             | 測れる能力                                           |
| ---------------- | ---------------------------------------------------- |
| グリッド状態管理 | 座標、配列、辞書、enum、境界処理                     |
| 時間ステップ処理 | tickごとのシミュレーション、Timer、状態遷移          |
| 入力             | マウス選択、クリックで回転、キーボードショートカット |
| UI               | スコア、残り時間、次の荷物、失敗数                   |
| Typed GDScript   | `enum`、`Array[Item]`、戻り値型、nullable処理        |
| Godot設計        | scene分割、signals、Resource/Nodeの使い分け          |
| テスト容易性     | tick関数を純粋ロジックとして隠しテスト可能           |
| 学習汚染耐性     | テトリスほど定番実装がない                           |

仕様例はこうです。

> 8x8 の盤面がある。各セルは Empty / BeltUp / BeltRight / BeltDown / BeltLeft / Splitter / Block / ExitRed / ExitBlue のいずれか。
> 荷物は 1 秒ごとに入口から出現し、各 tick で現在セルの向きに 1 マス進む。
> プレイヤーは空セルにベルトを置くか、既存ベルトをクリックで90度回転できる。
> 赤い荷物は赤出口、青い荷物は青出口へ入ると得点。違う出口、盤外、衝突、詰まりはミス。
> 60秒で終了。20点以上で勝利。
> 乱数は指定 seed を使い、同じ seed なら同じ荷物列になること。

この題材のうまいところは、**見た目はミニゲーム、内部はわりとソフトウェアエンジニアリング**なところです。LLMが雑に作ると、だいたい「衝突順序」「複数荷物の同時移動」「seed固定」「UI更新」「型の甘さ」「sceneとロジックの密結合」で崩れます。ベンチとして、おいしいバグがたくさん出ます。嫌な言い方をすると、LLMの足首をやさしく引っかける床材です。

## 他の良い題材候補

| 題材                 | 内容                                                          | ベンチ適性                                                |
| -------------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| **Magnet Crates**    | 極性つき箱を押す／引くグリッドパズル                          | 純ロジック強め。Sokobanに似すぎないよう極性・連鎖を入れる |
| **Orbit Courier**    | 惑星の重力場を使って荷物を届ける2Dアクション                  | ベクトル計算、物理、入力が測れる。自動採点はやや難しい    |
| **Signal Garden**    | 水・光・風シグナルを反射板で植物に届けるターン制パズル        | 実装は小さいが状態遷移とUIが見える。かなりテストしやすい  |
| **Clockwork Maze**   | 毎ターン回転する壁の迷路でドローンを誘導                      | 経路、時間依存、アニメーションが測れる                    |
| **Bug Farm Defense** | 虫が pheromone 経路に沿って進み、罠を置くタワーディフェンス風 | AI・経路・UI・バランス調整が測れる                        |
| **Echo Runner**      | 5秒前の自分のゴーストと協力してスイッチを押す                 | 状態保存、リプレイ、同期が測れる。難度は高め              |
| **Recipe Reactor**   | 材料トークンを装置に通して注文レシピを作る                    | 型付きデータ構造、イベント、キュー処理が測れる            |

この中で、**汎用ベンチとしては Conveyor Courier が一番バランス良い**です。
純粋なアルゴリズム能力を見たいなら **Signal Garden**。
Godotの物理・手触りまで見たいなら **Orbit Courier**。
状態保存や設計力を強めに見るなら **Echo Runner** が良いです。

## ベンチとしてのおすすめ設計

題材そのものより重要なのは、**仕様をテスト可能に切ること**です。

おすすめは、実装要件をこう分けることです。

1. **Core simulation**

   - `BoardState`
   - `ItemState`
   - `GameRules`
   - `step(delta_or_tick)`
     ここはシーンに依存させない。

2. **Godot presentation**

   - `Main.tscn`
   - `BoardView.gd`
   - `ItemView.gd`
   - `Hud.gd`

3. **Input/controller**

   - クリックでセル選択
   - 右クリックまたはキーで回転
   - 一時停止／リスタート

4. **Test hooks**

   - seed指定
   - 盤面を文字列からロード
   - tickを手動で進める
   - 現在スコア、荷物位置、ミス数を取得

LLMへのプロンプトでは、**「見た目を作れ」だけではなく「テスト可能なAPIを必ず作れ」**と書くと差が出ます。

例えばこんな感じです。

```text
Godot 4.x + Typed GDScriptで、Conveyor Courierという2Dミニゲームを実装してください。

必須条件:
- すべてのGDScriptは可能な限り静的型付けすること。
- 盤面ロジックはScene描画から分離し、BoardModel.gdに実装すること。
- BoardModelは以下のメソッドを持つこと:
  - load_from_ascii(map: PackedStringArray) -> void
  - spawn_item(kind: ItemKind, at: Vector2i) -> bool
  - step_tick() -> StepResult
  - rotate_cell(pos: Vector2i) -> bool
  - get_score() -> int
  - get_misses() -> int
- 同じseedでは同じ荷物列になること。
- Main.tscnからゲームとして遊べること。
- UIにスコア、ミス数、残り時間、次の荷物を表示すること。
- ベルト、出口、荷物は簡単なColorRectやSprite2Dでよい。
```

## 採点ルーブリック案

100点満点なら、こんな配分が使いやすいです。

| 配点 | 評価項目                                                                    |
| ---: | --------------------------------------------------------------------------- |
|   20 | 起動して遊べる。クラッシュしない。Godotプロジェクト構成が正しい             |
|   20 | 盤面ロジックが仕様通り。移動、出口、衝突、詰まり、盤外処理                  |
|   15 | Typed GDScriptの品質。戻り値型、enum、型付き配列、不要なVariant乱用の少なさ |
|   15 | Godot設計。Scene分割、signal、Timer、UI更新、Node参照の安全性               |
|   10 | 決定性。seed固定、手動tick、隠しテスト対応                                  |
|   10 | UX。操作しやすい、視覚的に状態が分かる、リスタート可能                      |
|   10 | コード品質。責務分離、命名、重複の少なさ、拡張しやすさ                      |

LLM比較では、**プレイ感の美しさよりも「仕様の穴に落ちないか」を重く見る**のがいいです。派手なエフェクトを作れるモデルより、同時移動の衝突を正しく処理できるモデルのほうが、プログラミング能力ベンチではたぶん強い。

## 学習汚染をさらに減らす工夫

同じ「Conveyor Courier」でも、毎回少し仕様を変えると良いです。

例えば：

- 出口の種類を Red/Blue から Shape/Circle/Square に変える
- ベルトを「押す」ではなく「風向きタイル」にする
- 盤面サイズを 8x8 / 10x6 / 12x8 に変える
- Splitter の仕様を seed による交互分岐にする
- 荷物に重さを入れ、重い荷物は2tickに1回だけ進む
- 同時移動の衝突ルールを明文化して差し替える

これで「既存の典型解を暗記していた」モデルより、「仕様を読んで抽象化できる」モデルが有利になります。

## 個人的なおすすめセット

ベンチを複数問にするなら、この3問構成がかなり良いです。

1. **Conveyor Courier**
   総合力。Godot、Typed GDScript、状態管理、UI。

2. **Signal Garden**
   純粋ロジック寄り。盤面更新、ルール実装、テスト容易性。

3. **Orbit Courier**
   Godotらしい2D操作・物理・ベクトル処理。

1問だけなら、**Conveyor Courier** を推します。
「ゲームとして成立する」「有名すぎない」「バグが表面化しやすい」「自動採点しやすい」の4つをかなり満たしています。

[1]: https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/static_typing.html 'Static typing in GDScript — Godot Engine (stable) documentation in English'
[2]: https://gut.readthedocs.io/ 'Gut 9.6.0 (Godot 4.6) — GUT 9.6.0 documentation'
[3]: https://github.com/godot-gdunit-labs/gdUnit4 'GitHub - godot-gdunit-labs/gdUnit4: Embedded unit testing framework for Godot 4 supporting GDScript and C#. Features test-driven development, embedded test inspector, extensive assertions, mocking, scene testing. · GitHub'
