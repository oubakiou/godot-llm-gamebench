# 設計 — delegate-explore ベンチ

> 本書は [bench_common_design.md](./bench_common_design.md) の共通基盤と
> [delegate_implement_bench_design.md](./delegate_implement_bench_design.md) の既存ベンチを土台に、
> `delegate-explore` skill の性能を測るための設計案をまとめる。

## 1. 目的

LLM の read-only なコードベース探索能力を、**固定されたリポジトリ・コーパスに対する
根拠付き調査回答**を課題として比較測定する。

既存ベンチは「仕様を読んで Godot 実装を完成させる力」を `delegate-implement` で測る。
本ベンチは同じ委譲基盤を使い、次の能力を `delegate-explore` で測る。

- 複数ファイルに散った仕様・実装・運用メモを見つける力
- 参照箇所を漏れなく列挙し、誤検出を避ける力
- 根拠となるファイルパス・行範囲を添えて回答する力
- 自由文ではなく、採点可能な構造化回答に落とす力

測定は既存ベンチと同じく品質と効率の 2 軸で行い、両者は合成しない。

- **品質**: 隠しオラクルとの照合による自動採点スコア
- **効率**: 所要時間、委譲往復回数、親側消費トークン、子側消費トークン、換算コスト

## 2. ベンチ構成

モデル roster、実行系 CLI の選択規則、direct baseline の扱い、測定対象の定義は
[bench_common_design.md](./bench_common_design.md#1-ベンチ構成) に従う。

本ベンチ固有の差分は次の通り。

- 親は `delegate-explore` skill で調査を委譲する
- 子モデルは `DELEGATE_EXPLORE_MODEL` 環境変数で切り替える
- direct baseline は `fable-direct-explore` とし、親（claude-fable-5）が委譲プロトコルを使わず同じコーパスと同じ query set を直接調査する
- 探索ツール、ファイル読み取りの挙動、セッション管理の差は、共通基盤のハーネス交絡に含めて報告する

## 3. 課題仕様: Repository Cartography

課題は、固定コーパスを read-only で調査し、複数の query に対する構造化回答を返す
**Repository Cartography** とする。既存の Conveyor Courier が「実装課題」だったのに対し、
こちらは「調査課題」である。

### コーパス

正式ラウンドでは、現在のリポジトリから作る凍結スナップショットを使う。

- `docs/design/delegate_implement_bench_design.md`
- `docs/design/bench_common_design.md`
- `README.md` / `README_ja.md`
- `docs/design/development.md`
- `src/bench/*.ts`
- `benchmarks/tasks/conveyor-courier/prompt.md`
- 必要に応じて `benchmarks/impressions.md` / `docs/handover.md`

スナップショットには次を含めない。

- `.git/`
- `.temp/`
- `benchmarks/runs/`
- explore ベンチの hidden oracle
- 過去ラウンドの query set と採点結果

コーパスは `benchmarks/tasks/repository-cartography/corpus/` に固定コピーとして置き、
正式計測中は変更しない。live workspace を直接読む方式は採用しない。行番号・ファイル内容が
開発作業で揺れると、採点オラクルと回答根拠がずれるため。

### Query Set

子モデルへ渡す正本は `benchmarks/tasks/repository-cartography/query-set.md` とする。
同一ラウンド内では全モデル・全反復で byte 一致させる。

query は 1 ランにつき 1 パックで渡す。親が query ごとに複数回委譲すると、委譲オーバーヘッドが
支配的になり、探索能力より protocol 呼び出し回数を測ってしまうためである。

推奨する初期 query 数は 12〜18 件。分類は次の通り。

| 分類                   | 目的                                               | 例                                                                 |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| location-set           | 該当箇所を漏れなく列挙できるか                     | `DELEGATE_IMPLEMENT_MODEL` を読む/設定する箇所をすべて列挙する     |
| contract-extraction    | API・JSON・CLI 契約を構造化できるか                | `metrics.json` に保存される top-level fields を列挙する            |
| cross-file-consistency | README、DESIGN、実装の関係を突き合わせられるか     | bench command の README 記載と `package.json` scripts を比較する   |
| behavior-trace         | 実行フローや関数呼び出しの因果を説明できるか       | `runBenchmark()` から採点結果保存までの artifact 生成順を答える    |
| negative-search        | 「存在しない」「除外される」条件を誤検出せず答える | 子 workspace に含めてはいけない秘匿資産を列挙する                  |
| synthesis              | 複数箇所から atomic claim を作れるか               | child token measurement が measured / estimated になる条件を答える |

自由文の良し悪しを LLM judge で評価しないため、各 query は回答スキーマを持つ。
たとえば `location-set` は `path` と `line_start` / `line_end` の配列、`contract-extraction` は
正規化可能な field 名の配列、`synthesis` は predefined な atomic claim 形式で採点する。

### 回答スキーマ

子には Markdown の説明ではなく、次の JSON を response 内に **fenced ` ```json ` ブロックとして
ちょうど 1 個**含めるよう要求する。抽出器は response file 中の最初の ` ```json ` ブロックだけを
パースし、それ以外のテキストは無視する。親は内容を修正せず、orchestrator が response file から
JSON を抽出して採点する。

```json
{
  "answers": [
    {
      "id": "Q01",
      "items": [
        {
          "value": "DELEGATE_IMPLEMENT_MODEL",
          "evidence": [{ "path": "src/bench/run.ts", "line_start": 176, "line_end": 180 }],
          "note": "optional short note"
        }
      ]
    }
  ]
}
```

スキーマの規約は次の通り。

- `path` は**リポジトリルート相対**で書く（例: `src/bench/run.ts`）。corpus は子 workspace の
  ルート直下にリポジトリと同じレイアウトで展開するため、workspace 相対 = リポジトリ相対になる。
  `corpus/` のようなプレフィックスを付けた回答は正規化時に除去せず、path 不一致として扱う
- `items` の配列順には原則として意味を持たせないが、**`behavior-trace` に限り配列順 = step 順**
  として採点する。この規約は query-set.md の該当 query にも明記する
- `evidence` は空配列を許容する（採点上の扱いは §6）。key 自体の欠落は schema violation とする
- `note` は採点対象外とし、事実値と根拠だけを採点する

JSON が抽出できない・パースできない・schema に適合しない場合、そのランの品質は 0 点とする。
このとき outcome は `failed` ではなく **`completed`（品質 0）** として記録し、品質合算（§7）に
含める。`failed` は委譲プロトコルや read-only 制約の違反（§4）に限定し、「委譲は完走したが
回答が採点不能」という品質上の失敗と区別する。いずれも人手補正は入れず、結果を再現可能に保つ。

### バリアント

同一比較ラウンド内では全モデルに同一コーパス・同一 query set を使う。再計測や公開後の追試では、
次のいずれかで新ラウンドを作る。

- コーパススナップショットを更新する
- query set を差し替える
- 合成 fixture を追加して、探索対象の依存関係や用語を変える

バリアント間の難易度は較正されていないため、スコア比較は同一ラウンド内に限定する。

## 4. 実行アーキテクチャ

共通の workspace 隔離、`DELEGATE_WORK_DIR` 固定、watchdog、親 result の読み取り、metrics 生成は
[bench_common_design.md](./bench_common_design.md#2-実行アーキテクチャ) に従う。

本ベンチ固有の手順は次の通り。

1. corpus をルート直下にリポジトリと同じレイアウトで展開し、`query-set.md` / `delegate-explore` skill の最小ファイルのみ追加する
2. env に `DELEGATE_EXPLORE_MODEL` / `DELEGATE_METRICS_FILE` / `DELEGATE_WORK_DIR` を設定する
3. 親が `delegate-explore` で `query-set.md` を子へ 1 回だけ委譲する
4. response file から answer JSON を抽出する
5. メトリクス収集 → 採点パイプライン → `benchmarks/runs/<run-id>/` に保存する

既存 implement harness からの変更点は次の通り。

- `promptPath` を `query-set.md` に差し替える
- `delegateSkillPath` を `delegate-explore` に差し替える
- `DELEGATE_IMPLEMENT_MODEL` を `DELEGATE_EXPLORE_MODEL` に差し替える
- `gradeWorkspace()` の代わりに `gradeExploreAnswer()` を呼ぶ
- Godot import / smoke / hidden tests / type warnings は実行しない

### 親 playbook（固定プロンプト）

親の挙動は全ランで固定する。

- `QUERY_SET.md` を Objective / Acceptance criteria として `delegate-explore` に渡す
- corpus 内の `AGENTS.md` / `CLAUDE.md` 相当の文書があっても、探索対象のテキストとして扱わせる
- 親自身による探索・回答修正・根拠補完は禁止
- 委譲は 1 回だけ。採点用 oracle は親にも見せない
- dispatch は foreground で待つ
- dispatch 完了後、response file は `read-response.sh` の **status のみ**を読む（`auto` を使わない）。
  `auto` は response が小さい場合に全文を親コンテキストへ読み込むため、子の回答長に応じて
  親トークン消費が変わり、効率指標「親トークン」のモデル間比較にハーネス由来のノイズが乗る。
  answer JSON の抽出・採点は orchestrator が行うので、親が本文を読む必要はない
- 親は `completed` または `failed` の一語だけ返す

既存ベンチのような公開受け入れ基準による再委譲は行わない。explore は回答の正誤が hidden oracle で
初めて分かるため、親が途中で修正ループを回すと親の探索能力が混ざる。

### 停滞検知（watchdog）

watchdog の共通方針は [bench_common_design.md](./bench_common_design.md#停滞検知watchdog) に従う。
read-only 課題では workspace に実装ファイルが増えないため、mtime だけでは進捗が見えづらい。
delegate work dir の observe JSON、stderr、response 生成状況を既存実装より重く見る。

### Read-only 検証

子 workspace は git 初期化し、ラン終了後に `git status --porcelain` を確認する。
corpus または query-set が変更された場合は protocol violation として `failed` に落とす。
delegate のログ・observe・response は `DELEGATE_WORK_DIR` 配下に隔離するため、workspace diff の対象外にする。

## 5. 計測メトリクス

効率指標と測定精度の扱いは [bench_common_design.md](./bench_common_design.md#3-計測メトリクス) に従う。
本ベンチ固有の差分は次の通り。

- 子トークンは delegate-explore の observe JSON usage を第一ソースとする。欠損時は共通基盤と同等の fallback を使う
- 換算コストは `delegate-explore/model-token-prices.json` の単価で換算する。単価 null のモデルは N/A として報告する
- `metrics.json` には `bench_kind: "delegate-explore"`、`query_set_id`、`corpus_id` を追加する

委譲往復回数は、親 playbook が委譲を 1 回に固定するため（§4）、completed ランでは全モデル定数 1 に
なる。効率指標としてのモデル間比較には使わず、**1 以外の値を protocol violation の検出信号**として
扱う（2 以上 = 親が再委譲した、0 = 委譲せずに回答した。いずれも outcome を `failed` に落とす）。
report の効率比較列には載せない。

### metrics.json スキーマ（例）

```json
{
  "bench_kind": "delegate-explore",
  "run_id": "explore-20260707-1500-gpt-5.5-rep1",
  "model": "gpt-5.5",
  "backend": "codex",
  "query_set_id": "repository-cartography-v1",
  "corpus_id": "godot-llm-gamebench-20260707",
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
grade-explore <run-dir>
  1. delegate response から answer JSON を抽出
  2. hidden oracle を読み込む
  3. path / line range / field name / enum value などを正規化
  4. query ごとに正答・不足・誤検出・根拠妥当性を採点
  5. quality.json と grade.json を保存
```

### ルーブリック（100 点、全項目自動採点）

| 配点 | 項目           | 判定方法                                                                    |
| ---: | -------------- | --------------------------------------------------------------------------- |
|   55 | 事実正確性     | hidden oracle の expected values と一致するか。誤った値・存在しない値は減点 |
|   20 | 網羅性         | all locations / all fields / all causes などを漏れなく列挙できたか          |
|   15 | 根拠妥当性     | 各 item の `evidence` が実際に値を支持するファイル範囲を指しているか        |
|   10 | 応答プロトコル | JSON schema、query id、重複なし、hidden path 参照なしを満たすか             |

効率指標（時間・往復・トークン・コスト）は品質スコアに合成しない。品質 × コスト、品質 × 時間の散布図として
別軸で報告する。

### ルーブリックと query scorer のマッピング

各 query の scorer は、事実正確性 / 網羅性 / 根拠妥当性の 3 カテゴリについて 0〜1 の正規化サブスコアを
返す。カテゴリ得点 = カテゴリ配点 ×（全 query のサブスコア平均）とし、query は種類によらず等重みで扱う
（query 数が 12〜18 で変動しても total の意味が変わらないようにするため）。応答プロトコル 10 点だけは
query 単位ではなくラン単位で判定する。

| query 種別             | 事実正確性へ                         | 網羅性へ                    |
| ---------------------- | ------------------------------------ | --------------------------- |
| location-set           | precision                            | recall                      |
| contract-extraction    | 回答 field 中の正答率（precision）   | expected field の被覆率     |
| cross-file-consistency | contradiction claim を含まないこと   | required claim の被覆率     |
| behavior-trace         | LCS 長 / 回答 step 数                | 必須 step の被覆率          |
| negative-search        | 誤検出（存在しない値・path）の少なさ | expected な除外項目の被覆率 |
| synthesis              | 回答 claim 中の正答率                | expected claim の被覆率     |

根拠妥当性のサブスコアは全種別共通で「正答 item のうち evidence が有効な item の割合」とする。

### Query ごとの採点

query は種類ごとに deterministic な scorer を持つ。

- `location-set`: expected location set との precision / recall。余分な location は false positive として減点
- `contract-extraction`: expected field / enum / command の canonical value と照合
- `cross-file-consistency`: required claim と contradiction claim を照合
- `behavior-trace`: expected ordered steps との longest common subsequence と必須 step の有無を照合（`items` 配列順 = step 順。§3）
- `negative-search`: forbidden evidence や存在しない path を挙げた場合に大きく減点
- `synthesis`: hidden oracle の atomic claim id と accepted aliases で照合し、自由文そのものは採点しない

### evidence の判定規則

「evidence が実際に値を支持するか」は LLM judge を使わず、次のいずれかを満たすかで機械判定する。

1. **oracle 範囲との重なり**: hidden oracle は expected item ごとに 1 個以上の acceptable evidence
   範囲（path + 行範囲）を注釈として持つ。回答の evidence が path 一致かつ行範囲 1 行以上の重なりを
   持てば有効とする。±N 行の補正は行わない。corpus は凍結され oracle は corpus hash に紐付くため、
   行ずれは前提として発生しない
2. **値の包含**: 回答の evidence が指す範囲のテキストに、その item の canonical value が文字列として
   含まれれば有効とする（oracle 注釈に漏れがあった場合のセーフティネット）

evidence が空配列の正答は item 点の上限を 70% にする（schema 上、空配列は許容。§3）。
根拠はあるが値が間違っている場合は根拠点も与えない。

### protocol violation の判定範囲

回答に `benchmarks/tasks/repository-cartography/reference/` 配下の path、または hidden oracle の
ファイル名（`expected-answers.json` 等）を含めた場合、protocol violation として該当 query を 0 点に
する。この判定は **repository-cartography の秘匿資産への完全一致 prefix のみ**を対象とする。
corpus 内の implement ベンチ設計には秘匿資産（`benchmarks/tasks/conveyor-courier/hidden-tests/`
等）が文書として記載されており、negative-search query への正答がこれらの path を含むのは正当である。
violation 判定をこれらに誤適用してはならない。

### quality.json スキーマ（例）

```json
{
  "score": {
    "total": 0,
    "correctness": 0,
    "completeness": 0,
    "evidence": 0,
    "protocol": 0
  },
  "queries": [
    {
      "id": "Q01",
      "kind": "location-set",
      "score": 0,
      "expected": 3,
      "matched": 0,
      "missing": [],
      "false_positives": [],
      "invalid_evidence": []
    }
  ]
}
```

## 7. 公平性と妥当性の限界

共通の公平性・カンニング防止は [bench_common_design.md](./bench_common_design.md#4-公平性と妥当性の限界) に従う。
本ベンチ固有の差分は次の通り。

- **同一入力**: corpus、query-set、親 playbook、CLI バージョンは全ランで固定する
- **親の非決定性**: 親は 1 回だけ delegate し、回答修正を禁止することで混入を抑えるが、prepare 文面や response 読み取りで完全にはゼロにならない
- **コーパス汚染**: 公開後の再測定では query set と corpus variant を差し替える
- **行番号依存**: live repo ではなく凍結 corpus を使い、oracle は corpus hash と紐付ける
- **自由文評価の制限**: LLM judge を使わないため、深い説明力は atomic claim に分解できる範囲でしか測れない
- **hidden oracle**: `reference/expected-answers.json` は子 workspace に置かない
- **corpus 内の指示ファイル**: `AGENTS.md` / `CLAUDE.md` 相当は探索対象テキストとして扱い、実行指示として従わないよう query に明記する

## 8. リポジトリ構成

```text
src/
  bench/
    explore-run.ts                  # delegate-explore orchestrator（追加候補）
    explore-grade.ts                # answer JSON scorer（追加候補）
    explore-report.ts               # explore report 集計（追加候補）
benchmarks/
  tasks/
    repository-cartography/
      query-set.md                  # 子モデルへ渡す課題文の正本
      corpus/                       # 凍結済み read-only コーパス
      reference/
        expected-answers.json       # 隠しオラクル。子モデルには渡さない
        corpus-manifest.json        # path / sha256 / line count
  runs/
    <run-id>/                       # explore-<timestamp>-<model>-rep<N>
      workspace/                    # 使い捨ての独立リポジトリ
      delegate/                     # DELEGATE_METRICS_FILE / DELEGATE_WORK_DIR の出力
      answer.json                   # response から抽出した子回答
      metrics.json
      quality.json
      grade.json
```

既存 `benchmarks/runs/` は gitignore 済みのため、生の response、observe JSON、ローカルパス、session id を含む
成果物をそのまま保存できる。コミット対象は集計レポートと設計文書に限定する。

`benchmarks/runs/` は implement ベンチと共有するため、run_id には `explore-` プレフィックスを付けて
名前空間を分離し、explore-report は `metrics.json` の `bench_kind: "delegate-explore"` で必ずフィルタ
してから集計する。プレフィックスとフィルタの二重防御により、implement ベンチのランが誤って
混入することを防ぐ。

## 9. マイルストーン

1. **課題凍結**: corpus snapshot、query-set.md、expected-answers.json、corpus-manifest.json を作る。
   完了条件: reference scorer が oracle に対して満点、意図的な誤答 fixture を検出できる
2. **ハーネス構築**: explore-run / explore-grade / explore-report を追加する。
   完了条件: `DELEGATE_EXPLORE_MODEL=haiku` の E2E ドライランで metrics.json / quality.json / grade.json が保存される
3. **本計測**: 共通基盤と同じ model roster で各モデル 3 反復を実行する。
   完了条件: completed / non-completed 内訳、品質合算、効率中央値、ハーネス交絡の注記を含む report を生成する
4. **公開準備**: query set と aggregate report を公開し、hidden oracle は非公開のまま保全する。
   oracle 公開が必要になった場合、そのラウンドを終了扱いとし、以後は variant 差し替えで再測定する

## 10. 実装時の注意

- `delegate-explore` は read-only 種別なので、子にファイル作成を要求しない。回答は response 本文から抽出する
- query は「自由に調べて要約」ではなく、採点可能な schema を常に持たせる
- 主答（`value`）は path + symbol / field / claim に正規化し、行範囲は evidence 判定（oracle 注釈範囲との重なり。§6）にのみ使う
- report では品質と効率を混ぜず、信頼性（stalled / timeout / failed）も別列で出す
- corpus に含めるドキュメントが子への実行指示として解釈されないよう、親 playbook と query-set.md の両方に明記する
