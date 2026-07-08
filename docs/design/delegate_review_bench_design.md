# 設計 — delegate-review ベンチ

> 本書は [bench_common_design.md](./bench_common_design.md) の共通基盤と
> [delegate_implement_bench_design.md](./delegate_implement_bench_design.md) の既存ベンチを土台に、
> `delegate-review` skill の性能を測るための設計案をまとめる。

## 1. 目的

LLM のコード・ドキュメントレビュー能力を、**固定された PR 差分に対する根拠付き findings**
を課題として比較測定する。

既存ベンチは「仕様を読んで Godot 実装を完成させる力」を `delegate-implement` で測る。
本ベンチは同じ委譲基盤を使い、次の能力を `delegate-review` で測る。

- 差分に含まれる実害のある問題を見つける力
- benign な変更や意図的なノイズを誤指摘しない力
- severity、影響、修正方針を妥当に校正する力
- 指摘箇所を file / line / diff hunk に結び付ける力
- レビュー結果を採点可能な構造化 findings に落とす力

測定は既存ベンチと同じく品質と効率の 2 軸で行い、両者は合成しない。

- **品質**: 隠しオラクルとの照合による自動採点スコア
- **効率**: 所要時間、委譲往復回数、親側消費トークン、子側消費トークン、換算コスト

## 2. ベンチ構成

モデル roster、実行系 CLI の選択規則、direct baseline の扱い、測定対象の定義は
[bench_common_design.md](./bench_common_design.md#1-ベンチ構成) に従う。

本ベンチ固有の差分は次の通り。

- 親は `delegate-review` skill で差分レビューを委譲する
- 子モデルは `DELEGATE_REVIEW_MODEL` 環境変数で切り替える
- direct baseline は `fable-direct-review` とし、親（claude-fable-5）が委譲プロトコルを使わず同じ review pack を直接レビューする
- 差分閲覧、ファイル検索、履歴参照の挙動差は、共通基盤のハーネス交絡に含めて報告する

## 3. 課題仕様: Patch Review Pack

課題は、固定された base snapshot に対して candidate patch を適用した workspace をレビューし、
diff 内の問題を findings として返す **Patch Review Pack** とする。

### Review Corpus

正式ラウンドでは、現在のリポジトリから作る凍結スナップショットを base とする。
ただし review 対象は本番コードそのものではなく、採点しやすい synthetic PR として管理する。

- `src/bench/*.ts` から派生した TypeScript harness 断片
- `docs/design/*.md` から派生した設計ドキュメント断片
- `benchmarks/tasks/conveyor-courier/prompt.md` から派生した仕様断片
- 必要に応じて小さな fixture を追加し、既知の review issue を埋め込む

base snapshot と patch は `benchmarks/tasks/patch-review-pack/` に固定し、正式計測中は変更しない。
live workspace を直接 review 対象にしない。差分が開発作業で揺れると、採点オラクルと line mapping が
ずれるためである。

### Review Pack

review pack は 1 つの PR 相当の差分として作る。1 ランでは子に 1 review pack を渡し、
`delegate-review` を 1 回だけ呼ぶ。

初期 pack は 8〜12 件の seeded issue と、同程度の benign change を含める。
benign change を混ぜるのは、見逃しだけでなく誤指摘耐性も測るためである。

| 分類               | 目的                                             | 例                                                                |
| ------------------ | ------------------------------------------------ | ----------------------------------------------------------------- |
| functional-bug     | 実行時に結果を壊す差分を検出できるか             | timeout 判定の境界を反転し、正常ランを stalled 扱いにする         |
| metrics-regression | 計測値の意味論を壊す差分を検出できるか           | estimated token を measured として報告してしまう                  |
| isolation-leak     | hidden asset や過去成果物の露出を検出するか      | child workspace に reference / hidden-tests をコピーする          |
| protocol-break     | delegate protocol の破綻を検出できるか           | foreground dispatch を background 実行に変える                    |
| doc-contradiction  | docs と実装・README の矛盾を検出できるか         | DESIGN の品質合算方針と report aggregation の記述を食い違わせる   |
| schema-break       | JSON schema / CLI contract の破壊を検出するか    | `metrics.json` の required field を条件付きで省略する             |
| missing-test       | 重要ロジック変更に対するテスト欠落を指摘できるか | scorer の matching logic を変えたのに in-source test を更新しない |
| benign-refactor    | 問題のない整形・リネームを誤指摘しないか         | 変数名整理、説明文の明確化、同値な helper 抽出                    |

同一比較ラウンド内では全モデルに同一 review pack を使う。再計測や公開後の追試では、patch variant を
差し替えた新ラウンドとして実施する。

### 子に渡す情報

子 workspace には次を置く。

- base snapshot に candidate patch を適用した git repository
- `REVIEW_TASK.md`: PR description、レビュー範囲、回答形式
- `.claude/skills/delegate-review/`: skill 実行に必要な最小ファイル

子には hidden oracle、seeded issue id、expected findings、過去ラン結果を置かない。
レビュー対象は `git diff HEAD --` の working tree diff とし、履歴探索は base commit 内に限定する。

### 回答スキーマ

`delegate-review` の人間向け Findings section は維持しつつ、採点用に response 内へ
**fenced ` ```json ` ブロックとしてちょうど 1 個**の JSON を含める。抽出器は response file 中の
最初の ` ```json ` ブロックだけをパースし、それ以外のテキストは無視する。親は内容を修正せず、
orchestrator が response file から JSON を抽出して採点する。

```json
{
  "findings": [
    {
      "severity": "major",
      "category": "isolation-leak",
      "path": "src/bench/run.ts",
      "line_start": 42,
      "line_end": 47,
      "summary": "The child workspace now includes hidden grading assets.",
      "impact": "A child model can inspect the oracle and inflate quality scores.",
      "recommendation": "Only copy public task files into the child workspace."
    }
  ]
}
```

スキーマの規約は次の通り。

- `severity` は `critical` / `major` / `minor` / `nit` の 4 段階に固定する
- `category` は seeded issue の分類と同じ enum
  （`functional-bug` / `metrics-regression` / `isolation-leak` / `protocol-break` /
  `doc-contradiction` / `schema-break` / `missing-test`）に固定する。`benign-refactor` は
  pack 構成上の分類であり finding の category としては無効とする
- `path` は workspace ルート相対（= base リポジトリ相対）で書く
- `summary` / `impact` / `recommendation` は英語で書くよう `REVIEW_TASK.md` で固定する。
  `required_terms` 照合（§6）が回答言語によって揺れないようにするための制約である

採点対象は JSON であり、Markdown prose は監査補助としてのみ保存する。

JSON が抽出できない・パースできない・schema に適合しない場合、そのランの品質は 0 点とする。
このとき outcome は `failed` ではなく **`completed`（品質 0）** として記録し、品質合算（§7）に
含める。`failed` は委譲プロトコルや read-only 制約の違反（§4）に限定し、「委譲は完走したが
回答が採点不能」という品質上の失敗と区別する。いずれも人手補正は入れず、結果を再現可能に保つ。

## 4. 実行アーキテクチャ

共通の workspace 隔離、`DELEGATE_WORK_DIR` 固定、watchdog、親 result の読み取り、metrics 生成は
[bench_common_design.md](./bench_common_design.md#2-実行アーキテクチャ) に従う。

本ベンチ固有の手順は次の通り。

1. 使い捨ての独立 git リポジトリとして workspace を作成する
2. base snapshot を commit し、candidate patch を working tree に適用する
3. env に `DELEGATE_REVIEW_MODEL` / `DELEGATE_METRICS_FILE` / `DELEGATE_WORK_DIR` を設定する
4. 親が `delegate-review` で current diff を子へ 1 回だけ委譲する
5. response file から findings JSON を抽出する
6. メトリクス収集 → 採点パイプライン → `benchmarks/runs/<run-id>/` に保存する

既存 implement harness からの変更点は次の通り。

- `promptPath` を `REVIEW_TASK.md` に差し替える
- `delegateSkillPath` を `delegate-review` に差し替える
- `DELEGATE_IMPLEMENT_MODEL` を `DELEGATE_REVIEW_MODEL` に差し替える
- Godot workspace 採点の代わりに `gradeReviewFindings()` を呼ぶ
- patch 適用後の working tree diff をレビュー対象として保存する

### 親 playbook（固定プロンプト）

親の挙動は全ランで固定する。

- `REVIEW_TASK.md` と `git diff HEAD --` の範囲を `delegate-review` に渡す
- 親自身による diff review、findings 追加、severity 修正は禁止
- 委譲は 1 回だけ。hidden oracle は親にも見せない
- 子にコード修正を依頼しない。`delegate-review` は read-only とする
- dispatch は foreground で待つ
- dispatch 完了後、response file は `read-response.sh` の **status のみ**を読む（`auto` を使わない）。
  `auto` は response が小さい場合に全文を親コンテキストへ読み込むため、子の findings 量に応じて
  親トークン消費が変わり、効率指標「親トークン」のモデル間比較にハーネス由来のノイズが乗る。
  findings JSON の抽出・採点は orchestrator が行うので、親が本文を読む必要はない
- 親は `completed` または `failed` の一語だけ返す

既存 `delegate-implement` ベンチのような修正再委譲は行わない。review の正誤は hidden oracle で初めて
分かるため、親が途中で修正ループを回すと親のレビュー能力が混ざる。

### Read-only 検証

`delegate-review` は read-only 種別であるため、ラン終了後に `git diff HEAD --` を保存し、
事前に適用した candidate patch と一致することを確認する。差分が変わっていた場合は protocol violation
として `failed` に落とす。delegate のログ・observe・response は `DELEGATE_WORK_DIR` 配下に隔離するため、
workspace diff の対象外にする。

`git diff HEAD --` だけでは untracked ファイル生成を検出できないため、read-only 検証では次の両方を
確認する。

- tracked diff が事前に適用した candidate patch と byte 一致する
- `git status --porcelain` に candidate patch 由来ではない untracked / modified entry が残っていない

### 停滞検知（watchdog）

watchdog の共通方針は [bench_common_design.md](./bench_common_design.md#停滞検知watchdog) に従う。
review 課題では workspace は原則変更されないため、mtime だけでは進捗が見えづらい。
delegate work dir の observe JSON、stderr、response 生成状況を既存実装より重く見る。

## 5. 計測メトリクス

効率指標と測定精度の扱いは [bench_common_design.md](./bench_common_design.md#3-計測メトリクス) に従う。
本ベンチ固有の差分は次の通り。

- 子トークンは delegate-review の observe JSON usage を第一ソースとする。欠損時は共通基盤と同等の fallback を使う
- 換算コストは `delegate-review/model-token-prices.json` の単価で換算する。単価 null のモデルは N/A として報告する
- `metrics.json` には `bench_kind: "delegate-review"`、`review_pack_id`、`base_id`、`patch_id` を追加する

委譲往復回数は、親 playbook が委譲を 1 回に固定するため（§4）、completed ランでは全モデル定数 1 に
なる。効率指標としてのモデル間比較には使わず、**1 以外の値を protocol violation の検出信号**として
扱う（2 以上 = 親が再委譲した、0 = 委譲せずに回答した。いずれも outcome を `failed` に落とす）。
report の効率比較列には載せない。

### metrics.json スキーマ（例）

```json
{
  "bench_kind": "delegate-review",
  "run_id": "review-20260707-1500-gpt-5.5-rep1",
  "model": "gpt-5.5",
  "backend": "codex",
  "review_pack_id": "patch-review-pack-v1",
  "base_id": "godot-llm-gamebench-review-base-20260707",
  "patch_id": "review-pack-v1-pr001",
  "wall_clock_ms": 0,
  "round_trips": 0,
  "parent_tokens": { "input": 0, "cache_read": 0, "output": 0, "cost_usd": 0 },
  "child_tokens": { "input": 0, "output": 0, "measurement": "measured", "cost_usd": null },
  "outcome": "completed"
}
```

## 6. 採点

採点は headless で完結させ、人手・LLM judge への依存を避ける。

```text
grade-review <run-dir>
  1. delegate response から findings JSON を抽出
  2. hidden oracle を読み込む
  3. path / line range / severity / category を正規化
  4. oracle issue と candidate finding を matching する
  5. 見逃し・誤指摘・severity calibration・根拠妥当性を採点
  6. quality.json と grade.json を保存
```

### Hidden Oracle

hidden oracle は seeded issue ごとに次を持つ。

```json
{
  "issues": [
    {
      "id": "ISSUE-001",
      "weight": 8,
      "severity": "critical",
      "category": "isolation-leak",
      "locations": [{ "path": "src/bench/run.ts", "line_start": 42, "line_end": 47 }],
      "accepted_categories": ["isolation-leak", "protocol-break"],
      "accepted_severities": ["critical", "major"],
      "required_terms": ["hidden", "reference", "child workspace"]
    }
  ],
  "benign_ranges": [{ "path": "src/bench/report.ts", "line_start": 10, "line_end": 20 }]
}
```

oracle の `locations` は、子が見る post-patch working tree の行番号で保存する。base 行番号との対応は
`patch-manifest.json` に line mapping として保存し、grader は post-patch 座標に正規化してから matching する。

`required_terms` は summary / impact / recommendation の連結テキストと照合する最小語彙であり、
長文の質を LLM judge で評価しないための deterministic な近似である。照合は case-insensitive の
部分文字列一致とし、各 term は同義語を `["hidden", "secret"]` のような accepted aliases 配列で
持てる（配列内はいずれか 1 語で可）。語彙は 2 段階の強度で使う: **matching 条件（§Matching）では
1 term 以上**、**evidence quality（§ルーブリック）では全 term** を要求する。言い回しの違いで
match 自体が落ちて「見逃し + 誤指摘」の二重減点になるのを避けつつ、説明の質は evidence quality で
測るための分離である。findings を英語に固定する制約（§3）と合わせて、語彙照合を言語・表記ゆれに
対して安定させる。

`missing-test` の issue は「存在しないテスト」自体に行番号がないため、`locations` にはテスト更新を
欠いたまま変更されたロジック行（post-patch 座標）を指定する。finding もその変更行に anchor する。

### Matching

candidate finding は、次の条件をすべて満たす oracle issue に match する。

1. `path` が一致する
2. `line_start` / `line_end` が oracle の location のいずれかと 1 行以上 overlap する
3. `category` が `accepted_categories` に含まれる
4. summary / impact / recommendation の連結テキストが `required_terms` の **1 term 以上**を満たす
   （各 term は accepted aliases のいずれか 1 語で可。§Hidden Oracle）

割り当ては決定的に行う。findings を response 記載順に処理し、各 finding は match 条件を満たす
未割り当て issue のうち **oracle 定義順で最初の 1 件**にのみ割り当てる。同じ issue に後続の finding が
match した場合、その finding は issue に割り当てず duplicate として false positive 扱いにする
（「最も点が高い 1 件を選ぶ」方式は採らない。選択が finding の得点計算に依存すると採点器の実装順で
結果が変わり得るため、記載順 greedy に固定する）。changed line を網羅的に列挙する戦略を抑止するため、findings 数には
上限を設ける。初期値は seeded issue 数 + 4 件とし、子には具体的な上限値を `REVIEW_TASK.md` で明示する。
上限を超えた場合は、response に記載された順で先頭 N 件だけを採点対象にし、超過分は protocol error として
記録する。採点器側で severity 順などへの並べ替えは行わない。

採点対象は原則として changed line または diff hunk から直接根拠付けられる finding に限定する。
diff 外の実在バグを指摘した場合でも、hidden oracle に登録されていなければ unmatched finding として扱う。
これは PR review の差分集中能力を測るための制約であり、汎用的なコード監査能力の評価ではない。

### ルーブリック（100 点、全項目自動採点）

| 配点 | 項目                   | 判定方法                                                               |
| ---: | ---------------------- | ---------------------------------------------------------------------- |
|   45 | issue recall           | hidden oracle の weighted issue をどれだけ検出したか                   |
|   20 | false positive control | unmatched finding、duplicate、benign range への指摘をどれだけ抑えたか  |
|   15 | severity calibration   | matched issue の severity が accepted range に入っているか             |
|   10 | evidence quality       | 行範囲が根拠 hunk に収まり、required terms をすべて満たしているか      |
|   10 | response protocol      | JSON schema、severity/category enum、必須フィールド、findings 上限遵守 |

各項目の計算式は次の通り定義し、採点器の実装とともに固定する。

- **issue recall** = 45 ×（matched issue の weight 合計 ÷ 全 issue の weight 合計）
- **false positive control** = 20 × max(0, 1 −（unmatched finding + duplicate）÷ findings 上限 N)。
  benign range への指摘は unmatched に含まれ、quality.json では区別して記録する
- **severity calibration** = 15 ×（severity が accepted range に入る matched の件数 ÷ matched 件数）。
  matched が 0 件の場合は 0 点
- **evidence quality** = 10 ×（evidence_ok な matched の件数 ÷ matched 件数）。matched が 0 件の
  場合は 0 点。evidence_ok = 行範囲が oracle location を含む diff hunk の範囲内に収まり
  （ファイル全体指定や複数 hunk をまたぐ粗い anchor を減点）、かつ `required_terms` を
  **すべて**満たすこと
- **response protocol** = 10 点からラン単位で減点（schema 不適合な finding、enum 外の値、
  必須フィールド欠落、findings 上限超過を各減点）。read-only 制約はここでは扱わない。
  違反は採点ではなく outcome `failed` で処理する（§4）

効率指標（時間・往復・トークン・コスト）は品質スコアに合成しない。品質 × コスト、品質 × 時間の散布図として
別軸で報告する。

### quality.json スキーマ（例）

```json
{
  "score": {
    "total": 0,
    "recall": 0,
    "false_positive_control": 0,
    "severity_calibration": 0,
    "evidence_quality": 0,
    "protocol": 0
  },
  "matched_issues": [
    {
      "issue_id": "ISSUE-001",
      "finding_index": 0,
      "score": 0,
      "severity_ok": true,
      "evidence_ok": true
    }
  ],
  "missed_issues": [],
  "false_positives": [],
  "duplicates": [],
  "protocol_errors": []
}
```

## 7. 公平性と妥当性の限界

共通の公平性・カンニング防止は [bench_common_design.md](./bench_common_design.md#4-公平性と妥当性の限界) に従う。
本ベンチ固有の差分は次の通り。

- **同一入力**: base snapshot、candidate patch、PR description、親 playbook、CLI バージョンは全ランで固定する
- **親の非決定性**: 親は 1 回だけ delegate し、findings 修正を禁止することで混入を抑えるが、prepare 文面や response 読み取りで完全にはゼロにならない
- **oracle の不完全性**: seeded issue 以外の正当な指摘があり得る。これを抑えるため、base と patch は小さく制御された synthetic PR とし、oracle 作成時に別モデル・親レビューで未登録 issue を潰す
- **diff 集中の制約**: changed line 外の正当な指摘は原則として false positive になる。スコアは汎用監査ではなく「与えられた PR 差分をレビューする能力」として解釈する
- **line number 依存**: live repo ではなく凍結 patch を使い、oracle は base hash と patch hash に紐付ける
- **自由文評価の制限**: LLM judge を使わないため、説明の説得力は required terms と必須フィールドで近似する
- **hidden oracle**: `reference/expected-findings.json` は子 workspace に置かない
- **過去 review 結果**: aggregate report 公開後は同一 review pack を再測定に使わず、variant を差し替える

## 8. リポジトリ構成

```text
src/
  bench/
    review-run.ts                  # delegate-review orchestrator（追加候補）
    review-grade.ts                # findings JSON scorer（追加候補）
    review-report.ts               # review report 集計（追加候補）
benchmarks/
  tasks/
    patch-review-pack/
      REVIEW_TASK.md               # 子モデルへ渡すレビュー依頼の正本
      base/                        # 凍結済み base snapshot
      patches/
        pr001.patch                # candidate patch
        pr001-description.md       # PR description
      reference/
        expected-findings.json     # 隠しオラクル。子モデルには渡さない
        patch-manifest.json        # base sha256 / patch sha256 / line mapping
      variants/
        v2/
  runs/
    <run-id>/                      # review-<timestamp>-<model>-rep<N>
      workspace/                   # base + candidate patch を適用した使い捨て repo
      delegate/                    # DELEGATE_METRICS_FILE / DELEGATE_WORK_DIR の出力
      reviewed.diff                # 実際にレビューされた diff
      findings.json                # response から抽出した子 findings
      metrics.json
      quality.json
      grade.json
```

既存 `benchmarks/runs/` は gitignore 済みのため、生の response、observe JSON、ローカルパス、session id を含む
成果物をそのまま保存できる。コミット対象は集計レポートと設計文書に限定する。

`benchmarks/runs/` は implement / explore ベンチと共有するため、run_id には `review-` プレフィックスを
付けて名前空間を分離し、review-report は `metrics.json` の `bench_kind: "delegate-review"` で必ず
フィルタしてから集計する。プレフィックスとフィルタの二重防御により、他ベンチのランが誤って
混入することを防ぐ。

## 9. マイルストーン

1. **課題凍結**: base snapshot、candidate patch、REVIEW_TASK.md、expected-findings.json、
   patch-manifest.json を作る。完了条件: oracle scorer が reference findings に対して満点、
   意図的な誤答 fixture で見逃し・誤指摘・severity error を検出できる
2. **ハーネス構築**: review-run / review-grade / review-report を追加する。
   完了条件: `DELEGATE_REVIEW_MODEL=haiku` の E2E ドライランで metrics.json / quality.json / grade.json が保存される
3. **本計測**: 共通基盤と同じ model roster で各モデル 3 反復を実行する。
   Claude 実行系の 3 モデルと `fable-direct-review` は最後に実行する。完了条件: completed / non-completed
   内訳、品質合算、効率中央値、ハーネス交絡の注記を含む report を生成する
4. **公開準備**: review pack と aggregate report を公開し、hidden oracle は非公開のまま保全する。
   oracle 公開が必要になった場合、そのラウンドを終了扱いとし、以後は patch variant 差し替えで再測定する

## 10. 実装時の注意

- `delegate-review` は read-only 種別なので、子に修正を要求しない。回答は response 本文から抽出する
- review pack は「全変更が怪しい」状態にしない。benign change を混ぜ、false positive control を測る
- severity は品質の一部だが、issue recall より重くしない。重大 issue の見逃しが主指標である
- report では品質と効率を混ぜず、信頼性（stalled / timeout / failed）も別列で出す
- oracle は seeded issue の正解表であり、レビュー本文の正本ではない。採点器の matching 仕様も固定して保存する
