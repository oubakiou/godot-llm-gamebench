# [BUG] 型品質 15 点の警告カウントが常に 0 になり全 run が無条件で満点だった

`grade.ts` の型品質チェックは GDScript 警告を warn レベル (`=1`) で注入して `--import` の stderr を数えていたが、Godot 4.4.1 の警告は warn レベルだとエディタ UI にしか表示されず headless 実行では一切出力されない。結果として `type_warnings` は常に 0 となり、ルーブリックの型品質 15 点が全 run に無条件で付与されていた。リファレンス実装自体も `unsafe_property_access` を 4 件持ったまま満点を出しており、「採点器はリファレンスに満点を出す」前提条件が計測不全によって偶然成立していた。

## 1. 問題の構造

| 場所                           | 状態                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| DESIGN.md ルーブリック         | 型品質 15 点は「型警告 0 で満点、警告数に応じて減点」（1 件 −3）                                              |
| `src/bench/grade.ts`（修正前） | `gdscript/warnings/*=1` を注入した一時プロジェクトで `--import` を実行し、stderr の `/UNTYPED/i` 行をカウント |
| 観測結果                       | Godot 4.4.1 は警告値 1 では headless の stderr に何も出力しない → カウントは常に 0                            |

警告が headless で表面化するのは error 昇格 (`=2`) のときだけで、その場合は
`SCRIPT ERROR: Parse Error: ... (Warning treated as error.)` という行として stderr に出る。
また `--import` は scene から参照されないスクリプトをコンパイルしないため、`=2` にしても
`--import` の stderr だけでは検査漏れが起きる。

## 2. 推定される影響

- 過去の全 run の型品質 15 点が実質無効（全員満点）。修正後の再採点サンプル:
  - `20260704T111107Z-haiku-rep0`: 警告 0→66 件、total 98.18→83.18
  - `20260705T064145Z-claude-sonnet-5-rep0`: 警告 0→20 件、total 100→85
  - `20260705T055641Z-composer-2.5-rep0`: 警告 0→7 件、total 100→85
- silent failure: 「警告 0 件 = 満点」という結果は正常系と区別がつかず、リファレンス実装（当時
  `unsafe_property_access` 4 件保有）まで満点だったため異常に気づけなかった
- impressions.md の型付け徹底度に関する定性観察はスコアに反映されていなかった

## 3. 再現確認手順（修正前）

1. scene から参照されるスクリプトに `var untyped_probe = 42` のような無型宣言を仕込んだ workspace を用意する
2. `project.godot` に `gdscript/warnings/untyped_declaration=1` を追記する
3. `godot --headless --path <workspace> --import` を実行し stderr を確認する
4. 警告が 1 行も出力されないことを確認する（`=2` に変えると `Warning treated as error` として出力される）

```sh
node src/bench/cli.ts grade --workspace benchmarks/tasks/conveyor-courier/reference
# 修正前: type_warnings: 0, total: 100（リファレンスに unsafe_property_access が 4 件あるにもかかわらず）
```

## 4. 修正方針

`src/bench/grade.ts` の型品質チェックを次の 3 点で変更した。

1. `makeTypecheckProject` の注入値を `=1` から `=2`（error 昇格）に変更
2. カウント対象を `/UNTYPED/i` 行から `(Warning treated as error.)` を含む行に変更（`countWarningErrors`）
3. `--import` は class_name キャッシュ構築のためだけに実行し、カウントは全 `.gd` ファイルへの
   per-file `godot --check-only --script res://<path>` で行う（scene 非参照スクリプトも漏れなく、
   重複なく数えるため。`.godot` キャッシュ競合を避けるため逐次実行）

あわせてリファレンス実装 `reference/scripts/main.gd` の `_unhandled_input` にあった
`unsafe_property_access` 4 件（`is` 判定と同一式内での `event.pressed` / `event.echo` /
`event.button_index` アクセス）を、typed local への narrowing に修正し、
「採点器はリファレンスに満点を出す」前提条件を実測で成立させた。

## 5. 受け入れ基準

- `node src/bench/cli.ts grade --workspace benchmarks/tasks/conveyor-courier/reference` が
  `type_warnings: 0` / `total: 100` を返す（修正後に確認済み）
- 修正前のリファレンス（narrowing 修正を戻した状態）に対して同コマンドが `type_warnings: 4` /
  `total: 88` を返す（修正過程で確認済み）
- 無型宣言を含む過去 run の workspace で `type_warnings > 0` になる（§2 の 3 run で確認済み）
- `npm run check` / `npm run test` が通る

## 6. テスト追加方針

- `grade.ts` の in-source test に `countWarningErrors` を追加: warning-as-error 行のみを数え、
  後続の `at:` 行・`Failed to load script` 行・素の Parse Error 行を数えないこと

## 7. 関連

- [DESIGN.md](../design/DESIGN.md) — 採点パイプライン §「型品質チェック」（本修正に合わせて記述更新済み）
- 発見の経緯: gdscript-quality skill の headless 検証スクリプト開発中に、警告値 1 が headless で
  無音であることを実験で特定（`.temp/skill-dev/gdscript-quality/evals/RESULTS.md`）
