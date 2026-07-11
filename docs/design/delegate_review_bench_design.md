# 設計 — delegate-review ベンチ

> 本書は [bench_common_design.md](./bench_common_design.md) の共通基盤と
> [delegate_implement_bench_design.md](./delegate_implement_bench_design.md) の既存ベンチを土台に、
> `delegate-review` skill の性能を測るための設計案をまとめる。

## 1. 目的

LLM の大規模・設計寄りレビュー能力を、**変更とリポジトリ内の既存資産（設計文書・実装・契約）との
整合性検出**を課題として比較測定する。

既存ベンチは「仕様を読んで Godot 実装を完成させる力」を `delegate-implement` で測る。
小規模な実装レビュー（数行〜1 ファイルの diff 内バグ検出）は、この実装能力との重複が大きいと
判断してベンチ対象にしない。`delegate-review` skill 自体も「大きめの diff、複数ファイルに
またがる変更」を適用対象としており、本ベンチは skill が実際に使われる領域を測る。

本ベンチが測る能力は次の通り。

- 変更が diff 外の既存資産と矛盾・衝突する箇所を、リポジトリを横断して発見する力
- 設計文書の主張と実装の前提の食い違いを検出する力
- 変更の影響を受ける既存資産への考慮漏れ（省略）を指摘する力
- benign な変更や意図的なノイズを誤指摘せず、限られた findings 枠で取捨選択する力
- 指摘を「矛盾する 2 点」として資産に結び付け、採点可能な構造化 findings に落とす力

**スコープ外**も明示する。本ベンチが測るのは設計**整合性の検出**能力であり、
「より良い設計を提案するセンス」は deterministic に採点できないため対象にしない。

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
- diff 外資産の探索が課題の中心になるため、差分閲覧・ファイル検索・履歴参照の CLI 挙動差は
  implement ベンチより交絡が大きい。共通基盤のハーネス交絡として必ず報告する
- effort / reasoning 設定は全モデルで各実行系 CLI の**デフォルト**を使う。親 playbook・
  `REVIEW_TASK.md`・env のいずれでも effort を指定せず、モデルごとのチューニングも行わない。
  デフォルト値はベンダー間で不均一だが、これはベンダーの出荷判断として
  「子モデル + 実行系 CLI」複合性能（共通基盤 §1）に含めて解釈する。CLI バージョンを
  固定するため、デフォルト値も計測期間中は固定される

### 対象モデル

本ベンチは共通 roster の全モデルではなく、次のサブセットを対象とする（各モデル 3 反復）。

| モデル ID             | 実行系 CLI   |
| --------------------- | ------------ |
| `gpt-5.5`             | Codex        |
| `gpt-5.6-sol`         | Codex        |
| `gpt-5.6-terra`       | Codex        |
| `swe-1.7`             | Devin        |
| `devin-glm-5.2`       | Devin        |
| `composer-2.5`        | Cursor       |
| `cursor-grok-4.5`     | Cursor       |
| `claude-sonnet-5`     | Claude       |
| `claude-opus-4-8`     | Claude       |
| `fable-direct-review` | （委譲なし） |

実行順は共通基盤の制約に従い、Claude 実行系の 2 モデル（Sonnet5 / Opus4.8）を全モデルの
最後に、`fable-direct-review` をさらにその後に実施する。

## 3. 課題仕様: Design Review Pack

課題は、固定された base snapshot に対して candidate change を適用した workspace をレビューし、
**変更と snapshot 内の既存資産との不整合**を findings として返す **Design Review Pack** とする。
レビュー範囲は changed line 内に限定しない。「この変更はリポジトリ内のどの資産と矛盾するか」が
問いであり、findings の根拠は diff 側と既存資産側の両方に anchor する。

### Review Corpus

正式ラウンドでは、現在のリポジトリから作る凍結スナップショットを base とする。
設計文書（`docs/design/*.md`）、実装（`src/bench/*.ts`）、README、課題資材が相互参照し合う
本リポジトリ自体が、整合性検出の題材として適している。ただし review 対象は本番の開発作業では
なく、採点しやすい synthetic change として管理する。

candidate change は 1 つの大きめ PR 相当とし、設計文書の改訂と実装変更の両方を含める
（RFC + 部分実装のイメージ）。base snapshot と change は `benchmarks/tasks/design-review-pack/`
に固定し、正式計測中は変更しない。live workspace を直接 review 対象にしない。差分が開発作業で
揺れると、採点オラクルとの対応がずれるためである。

### Review Pack

1 ランでは子に 1 review pack を渡し、`delegate-review` を 1 回だけ呼ぶ。

初期 pack は **4〜6 件の seeded issue** を weight 重めに埋め込み、同程度以上の benign change を
混ぜる。小規模実装レビューのような高密度の issue 配置にはしない。大規模レビューの実態は
「疎に存在する重い問題を掘り当てる」作業であり、issue 密度もそれに合わせる。
benign change を混ぜるのは、見逃しだけでなく誤指摘耐性も測るためである。

seeded issue はすべて「**side A（変更側）と side B（既存資産側）の矛盾ペア**」として構成する。
片側だけでは成立しない issue にすることで、当て推量やキーワード詰め込みでは match しない構造を
採点側に与える（§6）。

| 分類                    | 目的                                                     | 例                                                                                             |
| ----------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| spec-impl-contradiction | 設計文書の主張と実装の挙動・前提の矛盾を検出できるか     | 設計文書は「品質と効率を合成しない」と主張したまま、report 実装に合成スコア列を追加する        |
| doc-doc-contradiction   | 設計文書間・README との矛盾を検出できるか                | 共通基盤の roster 規則を改訂しつつ、README と個別ベンチ文書の記述を旧規則のまま残す            |
| invariant-break         | 変更が diff 外の既存 invariant を壊すことを検出できるか  | 凍結 prompt を動的生成に変えるが、公平性設計は byte-identical 前提のまま残る                   |
| contract-break          | 公開契約（schema / CLI）と利用側の不整合を検出できるか   | `metrics.json` の field 名を変更するが、diff 外の grader 側は旧名で読み続ける                  |
| neglected-impact        | 変更の影響を受ける diff 外資産への考慮漏れを指摘できるか | run artifacts のレイアウトを変えたのに、それを前提とする集計側と設計文書のスキーマ記述が未更新 |
| benign-change           | 問題のない整形・改稿・同値リファクタを誤指摘しないか     | 変数名整理、説明文の明確化、同値な helper 抽出、設計文書の文言改善                             |

同一比較ラウンド内では全モデルに同一 review pack を使う。再計測や公開後の追試では、change variant を
差し替えた新ラウンドとして実施する。

### 子に渡す情報

子 workspace には次を置く。

- base snapshot に candidate change を適用した git repository
- `REVIEW_TASK.md`: PR description、レビュー範囲（snapshot 全資産との整合性）、回答形式、findings 上限
- `.claude/skills/delegate-review/`: skill 実行に必要な最小ファイル

子には hidden oracle、seeded issue id、expected findings、過去ラン結果を置かない。
レビュー起点は `git diff HEAD --` の working tree diff だが、findings の根拠として snapshot 内の
全資産を参照してよい。履歴探索は base commit 内に限定する。

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
      "category": "spec-impl-contradiction",
      "anchors": [
        {
          "path": "docs/design/bench_common_design.md",
          "claim": "The design doc states quality and efficiency are never combined into one number."
        },
        {
          "path": "src/bench/report.ts",
          "claim": "The patched report adds a composite score column that merges quality and cost."
        }
      ],
      "summary": "The patch introduces a composite score the design doc explicitly forbids.",
      "impact": "Published reports would contradict the stated measurement policy.",
      "recommendation": "Drop the composite column or revise the design doc first."
    }
  ]
}
```

スキーマの規約は次の通り。

- `severity` は `critical` / `major` / `minor` / `nit` の 4 段階に固定する
- `category` は seeded issue の分類と同じ enum
  （`spec-impl-contradiction` / `doc-doc-contradiction` / `invariant-break` /
  `contract-break` / `neglected-impact`）に固定する。`benign-change` は pack 構成上の分類であり
  finding の category としては無効とする
- `anchors` は**ちょうど 2 件**とし、順不同。各 anchor は workspace ルート相対の `path` と、
  その資産が何を主張・前提しているかの `claim`（英語 1〜2 文）を持つ。行番号は要求しない。
  設計 issue は行に安定して anchor できないため、照合は path + claim 語彙で行う（§6）
- `neglected-impact` のような省略型 issue は「存在しない対応」自体に位置がないため、
  side A に考慮を欠いたまま変更された箇所、side B に見落とされた既存資産を anchor する
- `claim` / `summary` / `impact` / `recommendation` は英語で書くよう `REVIEW_TASK.md` で固定する。
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
2. base snapshot を commit し、candidate change を working tree に適用する
3. env に `DELEGATE_REVIEW_MODEL` / `DELEGATE_METRICS_FILE` / `DELEGATE_WORK_DIR` を設定する
4. 親が `delegate-review` で current diff を子へ 1 回だけ委譲する
5. response file から findings JSON を抽出する
6. メトリクス収集 → 採点パイプライン → `benchmarks/runs/<run-id>/` に保存する

既存 implement harness からの変更点は次の通り。

- `promptPath` を `REVIEW_TASK.md` に差し替える
- `delegateSkillPath` を `delegate-review` に差し替える
- `DELEGATE_IMPLEMENT_MODEL` を `DELEGATE_REVIEW_MODEL` に差し替える
- Godot workspace 採点の代わりに `gradeReviewFindings()` を呼ぶ
- change 適用後の working tree diff をレビュー対象として保存する

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
事前に適用した candidate change と一致することを確認する。差分が変わっていた場合は protocol violation
として `failed` に落とす。delegate のログ・observe・response は `DELEGATE_WORK_DIR` 配下に隔離するため、
workspace diff の対象外にする。

`git diff HEAD --` だけでは untracked ファイル生成を検出できないため、read-only 検証では次の両方を
確認する。

- tracked diff が事前に適用した candidate change と byte 一致する
- `git status --porcelain` に candidate change 由来ではない untracked / modified entry が残っていない

### 停滞検知（watchdog）

watchdog の共通方針は [bench_common_design.md](./bench_common_design.md#停滞検知watchdog) に従う。
review 課題では workspace は原則変更されず、しかも子は snapshot 探索に長時間を使うため、
mtime だけでは進捗が見えづらい。delegate work dir の observe JSON、stderr、response 生成状況を
既存実装より重く見る。

## 5. 計測メトリクス

効率指標と測定精度の扱いは [bench_common_design.md](./bench_common_design.md#3-計測メトリクス) に従う。
本ベンチ固有の差分は次の通り。

- 子トークンは delegate-review の observe JSON usage を第一ソースとする。欠損時は共通基盤と同等の fallback を使う
- 換算コストは `delegate-review/model-token-prices.json` の単価で換算する。単価 null のモデルは N/A として報告する
- `metrics.json` には `bench_kind: "delegate-review"`、`review_pack_id`、`base_id`、`change_id` を追加する
- snapshot 探索量はモデルの戦略差そのものなので、子トークンの多寡は品質と並べた散布図で解釈する。
  探索を打ち切って安く済ませたランと、広く読んで高品質なランを、効率単独で優劣付けしない

委譲往復回数は、親 playbook が委譲を 1 回に固定するため（§4）、completed ランでは全モデル定数 1 に
なる。効率指標としてのモデル間比較には使わず、**1 以外の値を protocol violation の検出信号**として
扱う（2 以上 = 親が再委譲した、0 = 委譲せずに回答した。いずれも outcome を `failed` に落とす）。
report の効率比較列には載せない。

### metrics.json スキーマ（例）

```json
{
  "bench_kind": "delegate-review",
  "run_id": "review-20260711-1500-gpt-5.5-rep1",
  "model": "gpt-5.5",
  "backend": "codex",
  "review_pack_id": "design-review-pack-v1",
  "base_id": "godot-llm-gamebench-review-base-20260711",
  "change_id": "design-review-pack-v1-pr001",
  "wall_clock_ms": 0,
  "round_trips": 0,
  "parent_tokens": { "input": 0, "cache_read": 0, "output": 0, "cost_usd": 0 },
  "child_tokens": { "input": 0, "output": 0, "measurement": "measured", "cost_usd": null },
  "outcome": "completed"
}
```

## 6. 採点

採点は headless で完結させ、人手・LLM judge への依存を避ける。設計レビューの findings は
自由文の質に依存しやすく LLM judge を使いたくなるが、judge は roster モデルの同族が審判になる
自己審判の循環、饒舌さ・断定調への加点バイアス、judge モデル自体の deprecate による追試不能を
持ち込む。代わりに、**意味の照合負担を採点器ではなく issue の構造（矛盾ペア）に移す**（§3）。

```text
grade-review <run-dir>
  1. delegate response から findings JSON を抽出
  2. hidden oracle を読み込む
  3. anchors / severity / category を正規化
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
      "weight": 10,
      "severity": "critical",
      "category": "spec-impl-contradiction",
      "sides": [
        {
          "paths": ["docs/design/bench_common_design.md", "README.md"],
          "required_terms": [["quality"], ["efficiency"], ["combine", "merge", "composite"]]
        },
        {
          "paths": ["src/bench/report.ts"],
          "required_terms": [["score"], ["column", "field"]]
        }
      ],
      "accepted_categories": ["spec-impl-contradiction", "doc-doc-contradiction"],
      "accepted_severities": ["critical", "major"]
    }
  ]
}
```

- `sides` は矛盾ペアの 2 側面。各 side の `paths` は「その側面の根拠として認める資産」の
  候補リストで、同じ矛盾が複数文書に現れる場合はいずれか 1 つへの anchor で足りる
- `required_terms` は term slot の配列で、各 slot は accepted aliases 配列
  （`["combine", "merge", "composite"]` のような同義語リスト。slot 内はいずれか 1 語で可）。
  照合は case-insensitive の部分文字列一致とし、finding 側は**対応する anchor の `claim`
  のみ**に対して行う。summary / impact / recommendation は finding 全体で共有されるため
  照合対象に含めない。含めると side A の slot を side B の語彙で満たせてしまい、
  side ごとの根拠付けという矛盾ペア方式の前提が崩れるためである。共有フィールドは
  人間向けの監査補助としてのみ保存する
- 語彙は 2 段階の強度で使う: **matching 条件（§Matching）では各 side 1 slot 以上**、
  **evidence quality（§ルーブリック）では両 side の全 slot** を要求する。言い回しの違いで
  match 自体が落ちて「見逃し + 誤指摘」の二重減点になるのを避けつつ、説明の質は
  evidence quality で測るための分離である。findings を英語に固定する制約（§3）と合わせて、
  語彙照合を言語・表記ゆれに対して安定させる

行番号は oracle に持たない。設計 issue の位置は文書改訂で容易にずれ、行 mapping の維持コストが
採点の安定性に見合わないためである。path 単位の anchoring に claim 語彙照合を重ねることで、
「正しいファイル対を、正しい理由で」結び付けた finding だけが match する。

### Matching

candidate finding は、次の条件をすべて満たす oracle issue に match する。

1. finding の 2 anchor の `path` が、oracle の side A / side B の `paths` に**それぞれ 1 対 1**で
   対応する（順不同。両 anchor が同一 side に落ちる場合は match しない）
2. 各 anchor の `claim` が、対応する side の `required_terms` の **1 slot 以上**を満たす
   （照合対象は claim のみ。§Hidden Oracle）
3. `category` が `accepted_categories` に含まれる

割り当ては決定的に行う。findings を response 記載順に処理し、各 finding は match 条件を満たす
未割り当て issue のうち **oracle 定義順で最初の 1 件**にのみ割り当てる。同じ issue に後続の finding が
match した場合、その finding は issue に割り当てず duplicate として false positive 扱いにする
（「最も点が高い 1 件を選ぶ」方式は採らない。選択が finding の得点計算に依存すると採点器の実装順で
結果が変わり得るため、記載順 greedy に固定する）。

もっともらしい指摘を数で押す戦略を抑止するため、findings 数には上限を設ける。初期値は
**seeded issue 数 + 2 件**とし、子には具体的な上限値を `REVIEW_TASK.md` で明示する。上限を
小規模ベンチ案より意図的にきつくするのは、大規模レビューでは「どれを報告しないか」の取捨選択
自体が測定対象だからである。上限を超えた場合は、response に記載された順で先頭 N 件だけを
採点対象にし、超過分は protocol error として記録する。採点器側で severity 順などへの並べ替えは
行わない。

snapshot 内の実在する未登録 issue を指摘した場合でも、hidden oracle に登録されていなければ
unmatched finding として扱う。当該ラウンドのスコアは変えず、監査（§7）で正当性を確認して
次ラウンドの pack 改訂に反映する。

### ルーブリック（100 点、全項目自動採点）

| 配点 | 項目                   | 判定方法                                                               |
| ---: | ---------------------- | ---------------------------------------------------------------------- |
|   40 | issue recall           | hidden oracle の weighted issue をどれだけ検出したか                   |
|   25 | false positive control | unmatched finding、duplicate、benign change への指摘をどれだけ抑えたか |
|   15 | evidence quality       | 両 side の required terms をすべて満たす精密な根拠付けができているか   |
|   10 | severity calibration   | matched issue の severity が accepted range に入っているか             |
|   10 | response protocol      | JSON schema、severity/category enum、anchors 数、findings 上限遵守     |

小規模実装レビュー案から配点を組み替えている。レビュー範囲が snapshot 全体に広がると
もっともらしい誤指摘の候補面積も広がるため false positive control を重くし、claim の完全性が
意味理解の主要な代理指標になるため evidence quality を重くする。issue 数が少なく severity の
統計的な解像度が下がるため severity calibration は軽くする。

各項目の計算式は次の通り定義し、採点器の実装とともに固定する。

- **issue recall** = 40 ×（matched issue の weight 合計 ÷ 全 issue の weight 合計）
- **false positive control** = 25 × max(0, 1 −（unmatched finding + duplicate）÷ findings 上限 N)。
  benign change への指摘は unmatched に含まれ、quality.json では区別して記録する
- **evidence quality** = 15 ×（evidence_ok な matched の件数 ÷ matched 件数）。matched が 0 件の
  場合は 0 点。evidence_ok = 両 side の `required_terms` の**全 slot** を満たすこと
- **severity calibration** = 10 ×（severity が accepted range に入る matched の件数 ÷ matched 件数）。
  matched が 0 件の場合は 0 点
- **response protocol** = 10 点からラン単位で減点（schema 不適合な finding、enum 外の値、
  必須フィールド欠落、anchors が 2 件でない finding、findings 上限超過を各減点）。
  read-only 制約はここでは扱わない。違反は採点ではなく outcome `failed` で処理する（§4）

効率指標（時間・往復・トークン・コスト）は品質スコアに合成しない。品質 × コスト、品質 × 時間の散布図として
別軸で報告する。

### 採点方式の fallback

矛盾ペア + claim 語彙照合で良否を判別できるかは、実装前に spike で検証する（§9）。
判別できない場合の対応は次の優先順位で行い、順序を先に固定しておく。

1. issue 種別を、より照合可能な矛盾検出型（spec-impl / doc-doc / contract-break）に絞る。
   測定範囲が狭まることは限界（§7）に明記する
2. それでも不足する場合に限り LLM judge を導入するが、**100 点スコアには合成しない別列**として
   報告する。judge は固定 model + 固定 prompt + temperature 0 とし、roster との同族関係と
   self-preference bias の注記を必ず付ける
3. スコア本体への judge 合成は行わない

### quality.json スキーマ（例）

```json
{
  "score": {
    "total": 0,
    "recall": 0,
    "false_positive_control": 0,
    "evidence_quality": 0,
    "severity_calibration": 0,
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

- **同一入力**: base snapshot、candidate change、PR description、親 playbook、CLI バージョンは全ランで固定する
- **effort 設定**: 全モデルで実行系 CLI のデフォルト effort / reasoning を使う（§2）。デフォルトは
  ベンダー間で不均一だが、per-model チューニング済みの比較ではなく出荷既定同士の比較である
  ことを report に明記する
- **親の非決定性**: 親は 1 回だけ delegate し、findings 修正を禁止することで混入を抑えるが、prepare 文面や response 読み取りで完全にはゼロにならない
- **oracle の不完全性**: レビュー範囲を snapshot 全体に広げたため、seeded issue 以外の正当な指摘が
  混入するリスクは小規模 diff 案より大きい。これが本ベンチ最大の妥当性リスクである。抑止は
  3 層で行う: (1) candidate change を小さく制御された synthetic change に保つ、(2) oracle 作成時に
  複数モデル + 親レビューで未登録 issue を潰す、(3) 計測後に unmatched findings を LLM で
  フラグ付けして人間が監査し、正当だったものは次ラウンドの pack 改訂に反映する（当該ラウンドの
  スコアは変えない）。LLM の利用は oracle 構築と事後監査というスコア経路の外に限定する
- **測定範囲の解釈**: スコアは「設計整合性の検出能力」であり、設計提案の質や汎用的なコード監査
  能力ではない。oracle 未登録の正当な指摘が false positive になり得る点も含め、この解釈を
  report に明記する
- **ハーネス交絡**: 大規模レビューでは snapshot の探索・ナビゲーション戦略が結果を支配しやすく、
  CLI の検索・閲覧ツール差による交絡が implement ベンチより大きい。本ベンチの結果は
  「モデル + 実行系 CLI」の組み合わせ性能として解釈し、モデル単体の順位として読まない
- **自由文評価の制限**: LLM judge をスコアに使わないため、説明の説得力は claim 構造と
  required terms で近似する（§6 の設計判断と fallback を参照）
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
    design-review-pack/
      REVIEW_TASK.md               # 子モデルへ渡すレビュー依頼の正本
      base/                        # 凍結済み base snapshot
      changes/
        pr001.patch                # candidate change
        pr001-description.md       # PR description
      reference/
        expected-findings.json     # 隠しオラクル。子モデルには渡さない
        change-manifest.json       # base sha256 / change sha256
      variants/
        v2/
  runs/
    <run-id>/                      # review-<timestamp>-<model>-rep<N>
      workspace/                   # base + candidate change を適用した使い捨て repo
      delegate/                    # DELEGATE_METRICS_FILE / DELEGATE_WORK_DIR の出力
      reviewed.diff                # 実際にレビューされた diff
      findings.json                # response から抽出した子 findings
      metrics.json
      quality.json
      grade.json
```

既存 `benchmarks/runs/` は gitignore 済みのため、生の response、observe JSON、ローカルパス、session id を含む
成果物をそのまま保存できる。コミット対象は集計レポートと設計文書に限定する。

`benchmarks/runs/` は implement ベンチと共有するため、run_id には `review-` プレフィックスを
付けて名前空間を分離し、review-report は `metrics.json` の `bench_kind: "delegate-review"` で必ず
フィルタしてから集計する。プレフィックスとフィルタの二重防御により、他ベンチのランが誤って
混入することを防ぐ。

## 9. マイルストーン

1. **採点 spike（go / no-go）**: ハーネスより先に、採点方式が設計 issue で成立するかだけを検証する。
   矛盾ペア 2〜3 件のミニ pack、hidden oracle、scorer 試作を作り、次の fixture を判別できることを
   確認する。判別できない場合は §6 の fallback 順で方式を確定してから先へ進む
   - 良い参照レビュー（全 issue を両 side anchor 付きで指摘）が満点になる
   - 意図的な悪答（片 side だけの当て推量、キーワード詰め込み、benign への誤指摘、
     severity 誤り、path は正しいが claim が無関係）がそれぞれ減点される
2. **課題凍結**: base snapshot、candidate change、REVIEW_TASK.md、expected-findings.json、
   change-manifest.json を作る。oracle 作成時は複数モデルによる snapshot レビューで未登録 issue を
   列挙して潰す。完了条件: oracle scorer が reference findings に対して満点、spike の悪答 fixture 群で
   見逃し・誤指摘・evidence 不足を検出できる
3. **ハーネス構築**: review-run / review-grade / review-report を追加する。
   完了条件: `DELEGATE_REVIEW_MODEL=haiku` の E2E ドライランで metrics.json / quality.json / grade.json が保存される
4. **本計測**: 対象モデル（§2）の 9 モデル × 3 反復 + `fable-direct-review` × 3 反復（計 30 ラン採用）を
   実行する。Claude 実行系の 2 モデルと `fable-direct-review` は最後に実行する。完了条件: completed /
   non-completed 内訳、品質合算、効率中央値、ハーネス交絡の注記を含む report を生成する
5. **公開準備**: review pack と aggregate report を公開し、hidden oracle は非公開のまま保全する。
   公開前に unmatched findings の監査（§7）を実施し、pack 改訂の要否を記録する。oracle 公開が
   必要になった場合、そのラウンドを終了扱いとし、以後は change variant 差し替えで再測定する

## 10. 実装時の注意

- `delegate-review` は read-only 種別なので、子に修正を要求しない。回答は response 本文から抽出する
- review pack は「全変更が怪しい」状態にしない。benign change を混ぜ、false positive control を測る
- seeded issue は必ず矛盾ペアとして成立させる。片側の資産だけ読めば分かる issue は、
  小規模実装レビューに退化するため採用しない
- severity は品質の一部だが、issue recall より重くしない。重大 issue の見逃しが主指標である
- report では品質と効率を混ぜず、信頼性（stalled / timeout / failed）も別列で出す
- oracle は seeded issue の正解表であり、レビュー本文の正本ではない。採点器の matching 仕様も固定して保存する
- LLM は oracle 構築と事後監査に使ってよいが、スコア算出経路には入れない
