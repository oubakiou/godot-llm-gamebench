import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { runCommand } from './grade.ts'
import { repoRoot, runsRootOf } from './paths.ts'
import { adoptLatestCompletedPerRep, loadRuns, type RunSummary } from './report.ts'
import type { GradeResult, GradeScore } from './types.ts'

interface ExportOptions {
  bench: string
  models: string[] | null
  out: string | null
}

interface GalleryEntry {
  slug: string
  model: string
  runId: string | null
  score: number | null
  reps: number | null
  link: string | null
  status: 'exported' | 'failed' | 'skipped'
  detail: string
}

interface ExportSource {
  slug: string
  model: string
  runId: string | null
  score: number | null
  reps: number | null
  sourceDir: string
  grade: GradeResult | null
}

interface HiddenTestCase {
  category: string
  name: string
  passed: boolean
  detail: string
}

interface ImpressionsSummaryRow {
  slug: string
  label: string
  score: string
  quality: string
  cost: string
  time: string
  note: string
}

interface ImpressionsSummary {
  main: ImpressionsSummaryRow[]
  baseline: ImpressionsSummaryRow[]
  followUps: { heading: string; rows: ImpressionsSummaryRow[] }[]
}

interface ImpressionsHeadings {
  summary: string
  followUpPrefix: string
}

interface UiText {
  lang: 'ja' | 'en'
  htmlLang: string
  galleryTitle: string
  gameTitle: string
  backToList: string
  switchLangLabel: string
  repoLinkLabel: string
  modelHeader: string
  conditionHeader: string
  scoreHeader: string
  qualityHeader: string
  costHeader: string
  timeHeader: string
  noteHeader: string
  intro: string
  summaryCaption: string
  referenceText: string
  referencePlay: string
  tocHeading: string
  summaryHeading: string
  summaryToc: string
  baselineToc: string
  baselineNote: string
  followUpNote: string
  otherEntries: string
  notExported: string
  exportFailed: string
  skipped: string
  scoreTableHeading: string
  scoreTableItemHeader: string
  scoreTableScoreHeader: string
  total: string
  breakdownHeading: string
  functionalityHeading: string
  failedTestsHeading: string
  determinismHeading: string
  typeQualityHeading: string
  healthHeading: string
  itemHeader: string
  resultHeader: string
  testTableCategoryHeader: string
  testTableTestHeader: string
  testTablePassHeader: string
  hiddenTestsParseError: string
  oldFormatFallback: string
  referenceNote: string
  gradeMissingNote: string
  representativeRun: string
  typeQualitySmallWarnings: string
  detailLabel: string
  axisDeterminismDescription: string
  axisTypeQualityDescription: string
  axisImportLabel: string
  axisSmokeLabel: string
  axisContractLabel: string
  categoryLabels: Record<string, string>
  testLabels: Record<string, string>
  scoreAxes: [string, string, number][]
}

const REPO_URL = 'https://github.com/oubakiou/godot-llm-gamebench'
const DEFAULT_EXPORT_ROOT = join(repoRoot, '.temp/bench-export')
const REFERENCE_SOURCE = join(repoRoot, 'benchmarks/tasks/conveyor-courier/reference')
const SHARED_FILES = [
  'index.wasm',
  'index.js',
  'index.audio.worklet.js',
  'index.audio.position.worklet.js',
]
const GAME_FILES = ['index.pck', 'index.png', 'index.icon.png', 'index.apple-touch-icon.png']
const EXPORT_PRESETS = `[preset.0]

name="Web"
platform="Web"
runnable=true
advanced_options=false
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path="index.html"
patches=PackedStringArray()
encryption_include_filters=""
encryption_exclude_filters=""
seed=0
encrypt_pck=false
encrypt_directory=false
script_export_mode=2

[preset.0.options]

custom_template/debug=""
custom_template/release=""
variant/extensions_support=false
variant/thread_support=false
vram_texture_compression/for_desktop=true
vram_texture_compression/for_mobile=false
html/export_icon=true
html/custom_html_shell=""
html/head_include=""
html/canvas_resize_policy=2
html/focus_canvas_on_start=true
html/experimental_virtual_keyboard=false
progressive_web_app/enabled=false
progressive_web_app/ensure_cross_origin_isolation_headers=false
progressive_web_app/offline_page=""
progressive_web_app/display=1
progressive_web_app/orientation=0
progressive_web_app/icon_144x144=""
progressive_web_app/icon_180x180=""
progressive_web_app/icon_512x512=""
progressive_web_app/background_color=Color(0, 0, 0, 1)
`

const CATEGORY_LABELS_JA: Record<string, string> = {
  api: 'API 挙動',
  collision: '衝突・停滞',
  contract: '契約（ロードと API 形状）',
  determinism: '決定性',
  exit_scoring: '搬出と得点',
  movement: '移動',
  spawn_miss: 'スポーンとミス',
  splitter: 'スプリッター',
  view: 'View 挙動',
  win_path: '勝利経路',
}

const CATEGORY_LABELS_EN: Record<string, string> = {
  api: 'API behavior',
  collision: 'Collision / stalls',
  contract: 'Contract (loading & API shape)',
  determinism: 'Determinism',
  exit_scoring: 'Exit & scoring',
  movement: 'Movement',
  spawn_miss: 'Spawn & misses',
  splitter: 'Splitter',
  view: 'View behavior',
  win_path: 'Win path',
}

const TEST_LABELS_JA: Record<string, string> = {
  'acceptance spawn and early movement': '受け入れ例どおりのスポーンと序盤の移動',
  'adjacent pair follows in the same tick': '隣接する 2 個が同一 tick で追従して進む',
  'blocked item misses after five ticks': '5 tick 停滞した荷物はミスになる',
  'blocked spawn consumes id': '入口封鎖時のスポーンでも id は消費される',
  'blocked spawn misses and consumes RNG': '入口封鎖時のスポーンはミスになり乱数を消費する',
  'blocked splitter does not toggle': '送出できなかったスプリッターはトグルしない',
  'exit departure frees previous cell for follower': '出口へ抜けたマスを後続が同一 tick で使える',
  'finish at t=120 freezes future ticks': 't=120 で終了し以降の tick で状態が変化しない',
  'full loop stalls then misses': '満杯のループは停滞し全荷物がミスになる',
  'get_cell ASCII mapping and out of bounds': 'get_cell の ASCII マッピングと盤外の扱い',
  'labels have no missing glyphs': '表示文字がフォントに存在する（豆腐なし）',
  'head-on swap is blocked': '正面からの入れ替わり移動はブロックされる',
  'load / instantiate / API / enums':
    'board_model のロード・インスタンス化・必須 API と enum の存在',
  'matching exit scores and removes item': '色が一致する出口で得点し荷物が消える',
  'merge to same empty cell chooses low id': '同一の空きマスへの合流は小さい id が優先される',
  'mouse click places a belt': 'クリックで空セルにベルトを設置できる',
  'off-board movement misses': '盤外への移動はミスになる',
  'peek_next_kind is stable and matches spawn': 'peek_next_kind が安定し実際のスポーン色と一致する',
  'place_belt rules': 'place_belt の配置可否ルール',
  'rotate_cell rules': 'rotate_cell の回転可否ルール',
  'same seed and operations produce same results': '同一シード・同一操作列で結果が完全一致する',
  'setup initial state': 'setup() 直後の初期状態が仕様どおり',
  'spawn color sequence matches RandomNumberGenerator':
    'スポーン色の系列が RandomNumberGenerator の仕様と一致する',
  'spawn schedule is t=1,4,7': 'スポーンが t=1,4,7… の周期で発生する',
  'spawn_item rules and RNG non-consumption': 'spawn_item の成否ルールと乱数を消費しないこと',
  'splitter alternates right left right': 'スプリッターが右→左→右と交互に振り分ける',
  'splitter right is relative to entry direction': '「右」が進入方向に対する相対方向である',
  'splitter toggles are independent': 'スプリッターごとにトグル状態が独立している',
  'splitter toggles on exit and off-board departure': '出口搬入・盤外退場でもトグルが反転する',
  'standard map simple controller reaches win threshold':
    '標準マップで単純な操作方針により勝利閾値へ到達できる',
  'straight belts move one cell per tick': '直線ベルトで 1 tick に 1 マス進む',
  'stuck counter resets after movement': '移動できると停滞カウンタがリセットされる',
  'three items in loop all advance': 'ループ上の 3 個が全て前進する',
  'tick advances at 0.5s interval': 'tick が実時間 0.5 秒間隔で進む',
  'two items can enter same exit': '同じ出口に同一 tick で 2 個搬入できる',
  'wrong exit misses': '色違いの出口はミスになる',
}

const TEST_LABELS_EN: Record<string, string> = {
  'acceptance spawn and early movement': 'Acceptance spawn and early movement',
  'adjacent pair follows in the same tick': 'Adjacent pair advances in the same tick',
  'blocked item misses after five ticks': 'Blocked item becomes a miss after five ticks',
  'blocked spawn consumes id': 'Blocked spawn still consumes the id',
  'blocked spawn misses and consumes RNG': 'Blocked spawn becomes a miss and consumes RNG',
  'blocked splitter does not toggle': 'Blocked splitter does not toggle',
  'exit departure frees previous cell for follower':
    'Exit departure frees the previous cell for a follower in the same tick',
  'finish at t=120 freezes future ticks': 'At t=120, future ticks freeze the state',
  'full loop stalls then misses': 'Full loop stalls then all items miss',
  'get_cell ASCII mapping and out of bounds': 'get_cell ASCII mapping and out-of-bounds handling',
  'labels have no missing glyphs': 'Displayed labels have no missing glyphs',
  'head-on swap is blocked': 'Head-on swap is blocked',
  'load / instantiate / API / enums': 'board_model loading, instantiation, required API, and enums',
  'matching exit scores and removes item': 'Matching exit scores and removes the item',
  'merge to same empty cell chooses low id': 'Merge to same empty cell chooses the lowest id',
  'mouse click places a belt': 'Mouse click places a belt',
  'off-board movement misses': 'Off-board movement becomes a miss',
  'peek_next_kind is stable and matches spawn': 'peek_next_kind is stable and matches the spawn',
  'place_belt rules': 'place_belt placement rules',
  'rotate_cell rules': 'rotate_cell rotation rules',
  'same seed and operations produce same results':
    'Same seed and same operation sequence produce identical results',
  'setup initial state': 'setup() initial state is correct',
  'spawn color sequence matches RandomNumberGenerator':
    'Spawn color sequence matches RandomNumberGenerator',
  'spawn schedule is t=1,4,7': 'Spawn schedule is t=1,4,7...',
  'spawn_item rules and RNG non-consumption': 'spawn_item rules and RNG non-consumption',
  'splitter alternates right left right': 'Splitter alternates right-left-right',
  'splitter right is relative to entry direction':
    'Splitter "right" is relative to entry direction',
  'splitter toggles are independent': 'Splitter toggles are independent per splitter',
  'splitter toggles on exit and off-board departure':
    'Splitter toggles on exit and off-board departure',
  'standard map simple controller reaches win threshold':
    'Standard map simple controller reaches the win threshold',
  'straight belts move one cell per tick': 'Straight belts move one cell per tick',
  'stuck counter resets after movement': 'Stuck counter resets after movement',
  'three items in loop all advance': 'Three items in a loop all advance',
  'tick advances at 0.5s interval': 'Tick advances at 0.5s interval',
  'two items can enter same exit': 'Two items can enter the same exit',
  'wrong exit misses': 'Wrong exit becomes a miss',
}

const UI_JA: UiText = {
  lang: 'ja',
  htmlLang: 'ja',
  galleryTitle: 'Conveyor Courier ギャラリー — __BENCH__',
  gameTitle: 'Conveyor Courier — __MODEL__',
  backToList: '← 一覧へ戻る',
  switchLangLabel: 'English',
  repoLinkLabel: 'GitHub リポジトリ',
  modelHeader: 'モデル',
  conditionHeader: '条件',
  scoreHeader: '自動テストによる評価(合算)',
  qualityHeader: 'コード品質 (sonnet評, sol評)',
  costHeader: '親費用+子費用(中央値)',
  timeHeader: '所要時間(中央値)',
  noteHeader: 'ひとこと',
  intro:
    'ベンチで生成された Conveyor Courier 実装の Web エクスポート。モデル名のリンクから代表 run（採用 rep の総合スコア中央値）の実装をブラウザでプレイできる。',
  summaryCaption:
    '表の数値は <code>benchmarks/__BENCH__/impressions.md</code> の本計測サマリー（各モデル 3 反復の採用値）からの転記。指標の定義は同ファイルの脚注を参照。',
  referenceText: '参照実装（採点の基準となるお手本実装）: ',
  referencePlay: 'プレイする',
  tocHeading: '目次',
  summaryHeading: '本計測サマリー',
  summaryToc: '本計測サマリー',
  baselineToc: 'ベースライン条件',
  baselineNote:
    'ベースライン条件（委譲プロトコルを通らない別条件のため参考値。上表とは直接比較しないこと）:',
  followUpNote: '条件付き計測（A/B）のため、本計測サマリーの表とは直接比較しないこと。',
  otherEntries: 'その他のエントリ',
  notExported: '未エクスポート',
  exportFailed: 'エクスポート失敗',
  skipped: 'スキップ',
  scoreTableHeading: '自動採点',
  scoreTableItemHeader: '項目',
  scoreTableScoreHeader: '得点',
  total: '合計',
  breakdownHeading: '採点内訳',
  functionalityHeading: '機能（隠しテスト）',
  failedTestsHeading: '失敗したテスト',
  determinismHeading: '決定性',
  typeQualityHeading: '型品質',
  healthHeading: 'プロジェクト健全性',
  itemHeader: '項目',
  resultHeader: '結果',
  testTableCategoryHeader: 'カテゴリ',
  testTableTestHeader: 'テスト',
  testTablePassHeader: '合否',
  hiddenTestsParseError: '隠しテストの結果を解析できなかったため合否内訳はなし。',
  oldFormatFallback: 'テスト別内訳なし（旧形式の grade.json）。__PASSED__ 成功 / __FAILED__ 失敗',
  referenceNote: '参照実装（採点の基準となるお手本実装）のため自動採点の対象外。',
  gradeMissingNote: '代表 run の grade.json が見つからないため合否内訳を表示できない。',
  representativeRun: '代表 run: __RUN_ID__',
  typeQualitySmallWarnings: '（strict 警告 __TYPE_WARNINGS__ 件）',
  detailLabel: '詳細',
  axisDeterminismDescription:
    '同一 seed・同一操作列で結果が再現する（determinism カテゴリ全テスト成功で満点）',
  axisTypeQualityDescription:
    'strict 型警告（untyped / unsafe を error 昇格した per-file 検査）__TYPE_WARNINGS__ 件 × −2（下限 0）',
  axisImportLabel: 'プロジェクト import（godot --headless --import）',
  axisSmokeLabel: '起動 smoke（main.tscn の headless 起動）',
  axisContractLabel: 'API 契約（BoardModel の Scene 非依存ロードと契約テスト）',
  categoryLabels: CATEGORY_LABELS_JA,
  testLabels: TEST_LABELS_JA,
  scoreAxes: [
    ['functionality', '機能（隠しテスト）', 70],
    ['determinism', '決定性', 10],
    ['type_quality', '型品質', 10],
    ['health', 'プロジェクト健全性', 10],
  ],
}

const UI_EN: UiText = {
  lang: 'en',
  htmlLang: 'en',
  galleryTitle: 'Conveyor Courier Gallery — __BENCH__',
  gameTitle: 'Conveyor Courier — __MODEL__',
  backToList: '← Back to list',
  switchLangLabel: '日本語',
  repoLinkLabel: 'GitHub repository',
  modelHeader: 'Model',
  conditionHeader: 'Condition',
  scoreHeader: 'Auto-graded score (sum)',
  qualityHeader: 'Code quality (sonnet, sol)',
  costHeader: 'Parent + child cost (median)',
  timeHeader: 'Wall clock (median)',
  noteHeader: 'Note',
  intro:
    'Browser-playable Web exports of the Conveyor Courier implementations generated by the benchmark. Click a model name to play the representative run (median composite score across adopted reps).',
  summaryCaption:
    'Values are copied from <code>benchmarks/__BENCH__/impressions.en.md</code>. See the footnotes in that file for metric definitions.',
  referenceText: 'Reference implementation (the benchmark example): ',
  referencePlay: 'Play',
  tocHeading: 'Contents',
  summaryHeading: 'Summary',
  summaryToc: 'Summary',
  baselineToc: 'Baseline condition',
  baselineNote:
    'Baseline condition (does not go through the delegation protocol; do not compare directly with the table above):',
  followUpNote:
    'Conditional measurement (A/B); do not compare directly with the main summary table.',
  otherEntries: 'Other entries',
  notExported: 'not exported',
  exportFailed: 'export failed',
  skipped: 'skipped',
  scoreTableHeading: 'Auto-graded score',
  scoreTableItemHeader: 'Item',
  scoreTableScoreHeader: 'Score',
  total: 'Total',
  breakdownHeading: 'Score breakdown',
  functionalityHeading: 'Functionality (hidden tests)',
  failedTestsHeading: 'Failed tests',
  determinismHeading: 'Determinism',
  typeQualityHeading: 'Type quality',
  healthHeading: 'Project health',
  itemHeader: 'Item',
  resultHeader: 'Result',
  testTableCategoryHeader: 'Category',
  testTableTestHeader: 'Test',
  testTablePassHeader: 'Pass',
  hiddenTestsParseError: 'Hidden test results could not be parsed; no pass/fail breakdown.',
  oldFormatFallback:
    'No per-test breakdown (legacy grade.json). __PASSED__ passed / __FAILED__ failed',
  referenceNote: 'Reference implementation (the benchmark example) is not auto-graded.',
  gradeMissingNote:
    "The representative run's grade.json was not found, so no pass/fail breakdown is shown.",
  representativeRun: 'Representative run: __RUN_ID__',
  typeQualitySmallWarnings: '(strict warnings: __TYPE_WARNINGS__)',
  detailLabel: 'Details',
  axisDeterminismDescription:
    'Same seed and same operation sequence reproduce identical results (determinism category fully passing)',
  axisTypeQualityDescription:
    'Strict type warnings (per-file untyped/unsafe treated as error): __TYPE_WARNINGS__ × −2 (floor 0)',
  axisImportLabel: 'Project import (godot --headless --import)',
  axisSmokeLabel: 'Boot smoke (headless launch of main.tscn)',
  axisContractLabel: 'API contract (BoardModel scene-independent load and contract tests)',
  categoryLabels: CATEGORY_LABELS_EN,
  testLabels: TEST_LABELS_EN,
  scoreAxes: [
    ['functionality', 'Functionality (hidden tests)', 70],
    ['determinism', 'Determinism', 10],
    ['type_quality', 'Type quality', 10],
    ['health', 'Project health', 10],
  ],
}

const UI: Record<'ja' | 'en', UiText> = { ja: UI_JA, en: UI_EN }

const IMPRESSIONS_HEADINGS: Record<'ja' | 'en', ImpressionsHeadings> = {
  ja: { summary: '本計測サマリー', followUpPrefix: '追試' },
  en: { summary: 'Summary', followUpPrefix: 'Follow-up' },
}

const parseSummaryTable = (rows: string[]): ImpressionsSummaryRow[] =>
  rows
    .slice(2)
    .map((row) =>
      row
        .split('|')
        .map((cell) => cell.trim())
        .slice(1, -1)
    )
    .flatMap((cells) => {
      if (cells.length < 6) {
        return []
      }
      const [label = '', score = '', quality = '', cost = '', time = '', note = ''] = cells
      return [{ cost, label, note, quality, score, slug: label.split(/\s+/)[0] ?? label, time }]
    })

const sectionTables = (lines: string[], start: number, end: number): ImpressionsSummaryRow[][] => {
  const tables: ImpressionsSummaryRow[][] = []
  let current: string[] = []
  for (const line of [...lines.slice(start, end), '']) {
    if (line.trimStart().startsWith('|')) {
      current.push(line.trim())
    } else if (current.length > 0) {
      tables.push(parseSummaryTable(current))
      current = []
    }
  }
  return tables
}

export const parseImpressionsSummary = (
  markdown: string,
  headings: ImpressionsHeadings = IMPRESSIONS_HEADINGS.ja
): ImpressionsSummary | null => {
  const lines = markdown.split('\n')
  const headingLines = lines
    .map((line, index) => ({ index, title: line.startsWith('## ') ? line.slice(3).trim() : null }))
    .filter((entry): entry is { index: number; title: string } => entry.title !== null)
  const sectionsOf = (
    predicate: (title: string) => boolean
  ): { title: string; tables: ImpressionsSummaryRow[][] }[] =>
    headingLines
      .filter((entry) => predicate(entry.title))
      .map((entry) => {
        const next = headingLines.find((candidate) => candidate.index > entry.index)
        return {
          tables: sectionTables(lines, entry.index + 1, next?.index ?? lines.length),
          title: entry.title,
        }
      })
  const summarySection = sectionsOf((title) => title === headings.summary)[0]
  if (summarySection === undefined) {
    return null
  }
  const [main = [], baseline = []] = summarySection.tables
  if (main.length === 0) {
    return null
  }
  const followUps = sectionsOf((title) => title.startsWith(headings.followUpPrefix)).flatMap(
    ({ tables, title }) => {
      const rows = tables[0] ?? []
      return rows.length === 0 ? [] : [{ heading: title, rows }]
    }
  )
  return { baseline, followUps, main }
}

const readJson = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const isSafeSlug = (value: string): boolean => /^[a-zA-Z0-9][a-zA-Z0-9@._-]*$/.test(value)

const parseModelFilter = (models: string[] | null): Set<string> | null =>
  models === null ? null : new Set(models.map((model) => model.trim()).filter(Boolean))

const copyProject = (sourceDir: string, workDir: string): void => {
  rmSync(workDir, { force: true, recursive: true })
  mkdirSync(workDir, { recursive: true })
  cpSync(sourceDir, workDir, { recursive: true })
  writeFileSync(join(workDir, 'export_presets.cfg'), EXPORT_PRESETS)
}

export const selectRepresentativeRun = (runs: RunSummary[]): RunSummary | null => {
  const adopted = adoptLatestCompletedPerRep(runs.filter((run) => run.outcome === 'completed'))
  if (adopted.length === 0) {
    return null
  }
  const sorted = adopted.toSorted(
    (left, right) => left.quality - right.quality || left.runId.localeCompare(right.runId)
  )
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null
}

export const rewriteGodotIndexHtml = (html: string): string =>
  html
    .replaceAll('src="index.js"', 'src="../../shared/index.js"')
    .replaceAll('"executable":"index"', '"executable":"../../shared/index","mainPack":"index.pck"')
    .replaceAll('"index.wasm":', '"../../shared/index.wasm":')

const findRunWorkspace = (bench: string, runId: string): string | null => {
  const runDir = join(runsRootOf(bench), runId)
  const workspace = join(runDir, 'workspace')
  if (existsSync(workspace)) {
    return workspace
  }
  const grade = readJson<GradeResult>(join(runDir, 'grade.json'))
  if (grade?.workspace !== undefined && existsSync(grade.workspace)) {
    return grade.workspace
  }
  return null
}

const modelSources = (bench: string, modelFilter: Set<string> | null): ExportSource[] => {
  const byModel = new Map<string, RunSummary[]>()
  for (const run of loadRuns(bench)) {
    byModel.set(run.model, [...(byModel.get(run.model) ?? []), run])
  }
  const sources = [...byModel.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .flatMap(([model, runs]) => {
      if (modelFilter !== null && !modelFilter.has(model)) {
        return []
      }
      if (!isSafeSlug(model)) {
        return []
      }
      const representative = selectRepresentativeRun(runs)
      if (representative === null) {
        return []
      }
      const sourceDir = findRunWorkspace(bench, representative.runId)
      if (sourceDir === null) {
        return []
      }
      return [
        {
          grade: readJson<GradeResult>(join(runsRootOf(bench), representative.runId, 'grade.json')),
          model,
          reps: adoptLatestCompletedPerRep(runs.filter((run) => run.outcome === 'completed'))
            .length,
          runId: representative.runId,
          score: representative.quality,
          slug: model,
          sourceDir,
        },
      ]
    })
  if (modelFilter !== null && !modelFilter.has('reference')) {
    return sources
  }
  return [
    {
      grade: null,
      model: 'reference',
      reps: null,
      runId: null,
      score: null,
      slug: 'reference',
      sourceDir: REFERENCE_SOURCE,
    },
    ...sources,
  ]
}

const filesMatch = (left: string, right: string): boolean =>
  existsSync(left) && existsSync(right) && readFileSync(left).equals(readFileSync(right))

const useSharedEngine = (webOutDir: string, sharedDir: string): boolean => {
  if (!existsSync(join(sharedDir, 'index.wasm'))) {
    mkdirSync(sharedDir, { recursive: true })
    for (const file of SHARED_FILES) {
      copyFileSync(join(webOutDir, file), join(sharedDir, file))
    }
    return true
  }
  return SHARED_FILES.every((file) => filesMatch(join(webOutDir, file), join(sharedDir, file)))
}

const copyGameFiles = (webOutDir: string, gameDir: string, shared: boolean): void => {
  rmSync(gameDir, { force: true, recursive: true })
  mkdirSync(gameDir, { recursive: true })
  for (const file of GAME_FILES) {
    copyFileSync(join(webOutDir, file), join(gameDir, file))
  }
  if (shared) {
    writeFileSync(
      join(gameDir, 'game.html'),
      rewriteGodotIndexHtml(readFileSync(join(webOutDir, 'index.html'), 'utf8'))
    )
    return
  }
  copyFileSync(join(webOutDir, 'index.html'), join(gameDir, 'game.html'))
  for (const file of SHARED_FILES) {
    copyFileSync(join(webOutDir, file), join(gameDir, file))
  }
}

const formatPoints = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2)

const passMark = (ok: boolean): string => (ok ? '✅' : '❌')

const partialMark = (value: number, max: number): string => {
  if (value >= max) {
    return '✅'
  }
  return value <= 0 ? '❌' : '⚠️'
}

const linkForLang = (link: string | null, lang: 'ja' | 'en'): string | null => {
  if (link === null) {
    return null
  }
  if (lang === 'ja') {
    return link
  }
  return `../${link.replace(/\/index\.html$/, '/index.en.html')}`
}

const categoryLabelHtml = (category: string, ui: UiText): string => {
  const label = ui.categoryLabels[category]
  if (label === undefined) {
    return escapeHtml(category)
  }
  if (ui.lang === 'en') {
    return escapeHtml(label)
  }
  return `${escapeHtml(label)}<br><small>${escapeHtml(category)}</small>`
}

const testLabelHtml = (test: HiddenTestCase, ui: UiText): string => {
  const label = ui.testLabels[test.name]
  const detail =
    test.passed || test.detail === ''
      ? ''
      : `<br><small>${ui.detailLabel}: ${escapeHtml(test.detail)}</small>`
  if (label === undefined) {
    return `${escapeHtml(test.name)}${detail}`
  }
  if (ui.lang === 'en') {
    return `${escapeHtml(label)}${detail}`
  }
  return `${escapeHtml(label)}<br><small>${escapeHtml(test.name)}</small>${detail}`
}

const testBreakdownRows = (tests: HiddenTestCase[], ui: UiText): string => {
  const groups = new Map<string, HiddenTestCase[]>()
  for (const test of tests) {
    groups.set(test.category, [...(groups.get(test.category) ?? []), test])
  }
  return [...groups.entries()]
    .flatMap(([category, cases]) =>
      cases.map((test, index) => {
        const categoryCell =
          index === 0 ? `<td rowspan="${cases.length}">${categoryLabelHtml(category, ui)}</td>` : ''
        return `<tr>${categoryCell}<td>${testLabelHtml(test, ui)}</td><td>${test.passed ? '✅' : '❌'}</td></tr>`
      })
    )
    .join('\n')
}

const itemTable = (rows: string, ui: UiText): string => `<table>
<thead><tr><th>${ui.itemHeader}</th><th>${ui.resultHeader}</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`

const axisSectionsHtml = (grade: GradeResult, ui: UiText): string => {
  const { hidden_tests: hiddenTests, score, type_warnings: typeWarnings } = grade
  const commandOk = (name: string): boolean => {
    const command = grade.commands.find((entry) => entry.name === name)
    return command !== undefined && command.exit_code === 0 && !command.timed_out
  }
  const contract = hiddenTests.categories.contract
  const contractOk = contract !== undefined && contract.failed === 0 && contract.passed > 0
  const importOk = commandOk('import')
  const smokeOk = commandOk('smoke')
  return `<h3>${ui.determinismHeading} <span class="pts">${formatPoints(score.determinism)} / 10</span></h3>
${itemTable(`<tr><td>${ui.axisDeterminismDescription}</td><td class="res">${passMark(score.determinism === 10)}</td></tr>`, ui)}
<h3>${ui.typeQualityHeading} <span class="pts">${formatPoints(score.type_quality)} / 10</span></h3>
${itemTable(`<tr><td>${ui.axisTypeQualityDescription.replace('__TYPE_WARNINGS__', String(typeWarnings))}</td><td class="res">${partialMark(score.type_quality, 10)}</td></tr>`, ui)}
<h3>${ui.healthHeading} <span class="pts">${formatPoints(score.health)} / 10</span></h3>
${itemTable(
  [
    `<tr><td>${ui.axisImportLabel}</td><td class="res">${passMark(importOk)} ${importOk ? '3' : '0'} / 3</td></tr>`,
    `<tr><td>${ui.axisSmokeLabel}</td><td class="res">${passMark(smokeOk)} ${smokeOk ? '3' : '0'} / 3</td></tr>`,
    `<tr><td>${ui.axisContractLabel}</td><td class="res">${passMark(contractOk)} ${contractOk ? '4' : '0'} / 4</td></tr>`,
  ].join('\n'),
  ui
)}`
}

const gradePanelHtml = (
  source: ExportSource,
  tests: HiddenTestCase[] | null,
  ui: UiText
): string => {
  const backLink = ui.lang === 'ja' ? '../../index.html' : '../../en/index.html'
  const langSwitch = ui.lang === 'ja' ? 'index.en.html' : 'index.html'
  const heading = `<p><a href="${backLink}">${ui.backToList}</a> | <a href="${langSwitch}">${ui.switchLangLabel}</a></p>
<h1>${escapeHtml(source.model)}</h1>`
  if (source.grade === null) {
    const note = source.model === 'reference' ? ui.referenceNote : ui.gradeMissingNote
    return `${heading}
<p>${note}</p>`
  }
  const { hidden_tests: hiddenTests, score, type_warnings: typeWarnings } = source.grade
  const runLine =
    source.runId === null
      ? ''
      : `<p><small>${ui.representativeRun.replace('__RUN_ID__', escapeHtml(source.runId))}</small></p>`
  const axisRows = ui.scoreAxes
    .map(([key, label, max]) => {
      const warnings =
        key === 'type_quality'
          ? `<small>${ui.typeQualitySmallWarnings.replace('__TYPE_WARNINGS__', String(typeWarnings))}</small>`
          : ''
      return `<tr><td>${label}${warnings}</td><td class="num">${formatPoints(score[key as keyof GradeScore])} / ${max}</td></tr>`
    })
    .join('\n')
  const scoreTable = `<h2>${ui.scoreTableHeading}</h2>
<table>
<thead><tr><th>${ui.scoreTableItemHeader}</th><th>${ui.scoreTableScoreHeader}</th></tr></thead>
<tbody>
${axisRows}
<tr><th>${ui.total}</th><td class="num"><strong>${formatPoints(score.total)} / 100</strong></td></tr>
</tbody>
</table>`
  if (!hiddenTests.parsed) {
    return `${heading}
${runLine}
${scoreTable}
<p>${ui.hiddenTestsParseError}</p>`
  }
  const failedList =
    tests !== null || hiddenTests.failed_tests.length === 0
      ? ''
      : `<h3>${ui.failedTestsHeading}</h3>
<ul>
${hiddenTests.failed_tests
  .map(
    (test) =>
      `<li><code>${escapeHtml(test.category)}/${escapeHtml(test.name)}</code>${test.detail === '' ? '' : `<br><small>${ui.detailLabel}: ${escapeHtml(test.detail)}</small>`}</li>`
  )
  .join('\n')}
</ul>`
  const functionalityBlock =
    tests === null
      ? `<p><small>${ui.oldFormatFallback
          .replace('__PASSED__', String(hiddenTests.passed))
          .replace('__FAILED__', String(hiddenTests.failed))}</small></p>`
      : `<table>
<thead><tr><th>${ui.testTableCategoryHeader}</th><th>${ui.testTableTestHeader}</th><th>${ui.testTablePassHeader}</th></tr></thead>
<tbody>
${testBreakdownRows(tests, ui)}
</tbody>
</table>`
  return `${heading}
${runLine}
${scoreTable}
<h2>${ui.breakdownHeading}</h2>
<h3>${ui.functionalityHeading} <span class="pts">${formatPoints(score.functionality)} / 70</span></h3>
${functionalityBlock}
${failedList}
${axisSectionsHtml(source.grade, ui)}`
}

export const buildGamePageHtml = (
  source: ExportSource,
  tests: HiddenTestCase[] | null,
  lang: 'ja' | 'en' = 'ja'
): string => {
  const ui = UI[lang]
  const title = ui.gameTitle.replace('__MODEL__', source.model)
  return `<!doctype html>
<html lang="${ui.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;font-family:system-ui,sans-serif;display:flex;height:100vh;background:#111;color:#1f2933}
iframe{flex:1;border:0;min-width:0;height:100%}
aside{width:400px;overflow-y:auto;background:#f7f8fa;padding:1.1rem 1.3rem;box-sizing:border-box}
h1{font-size:1.25rem;margin:.4rem 0}
h2{font-size:1rem;margin:1.1rem 0 .4rem}
h3{font-size:.95rem;margin:1rem 0 .3rem}
.pts{font-weight:normal;color:#6b7280;font-size:.85rem}
table{border-collapse:collapse;width:100%;background:white}
th,td{border:1px solid #d8dde3;padding:.4rem .55rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}
td.res{white-space:nowrap}
th{background:#e9edf2}
td.num{text-align:right;white-space:nowrap}
a{color:#0b63ce}
small{color:#6b7280}
code{background:#eef1f4;padding:0 .25em;border-radius:3px}
ul{padding-left:1.2rem}
li{margin:.3rem 0}
@media (max-width: 900px){body{flex-direction:column;height:auto}iframe{flex:none;width:100%;height:70vh}aside{width:100%}}
</style>
</head>
<body>
<iframe src="game.html" title="${escapeHtml(title)}" allow="fullscreen"></iframe>
<aside>
${gradePanelHtml(source, tests, ui)}
</aside>
</body>
</html>
`
}

const inlineCodeHtml = (value: string): string =>
  escapeHtml(value).replace(/`(?<code>[^`]+)`/g, '<code>$<code></code>')

const entryStatusHtml = (entry: GalleryEntry | undefined, ui: UiText): string => {
  if (entry === undefined) {
    return ` <small>(${ui.notExported})</small>`
  }
  if (entry.status === 'exported') {
    return ''
  }
  return ` <small>(${entry.status === 'failed' ? ui.exportFailed : ui.skipped})</small>`
}

// nowrap の数値セルに長い ※ 注釈が入ると列が横に広がりすぎるため、
// 数値は nowrap のまま、注釈は改行して折り返し可能な小文字行に分ける
const scoreCellHtml = (score: string): string => {
  const markIndex = score.indexOf('※')
  if (markIndex === -1) {
    return `<td class="num">${escapeHtml(score)}</td>`
  }
  const value = score.slice(0, markIndex).trim()
  const note = score.slice(markIndex).trim()
  return `<td class="score">${escapeHtml(value)}<br><small>${escapeHtml(note)}</small></td>`
}

const summaryTableHtml = (
  rows: ImpressionsSummaryRow[],
  entriesBySlug: Map<string, GalleryEntry>,
  { headLabel, lang }: { headLabel: string; lang: 'ja' | 'en' }
): string => {
  const ui = UI[lang]
  const body = rows
    .map((row) => {
      const entry = entriesBySlug.get(row.slug)
      const href = linkForLang(entry?.link ?? null, lang)
      const name =
        entry?.status === 'exported' && href !== null
          ? `<a href="${escapeHtml(href)}"${entry.runId === null ? '' : ` title="${ui.representativeRun.replace('__RUN_ID__', escapeHtml(entry.runId))}"`}>${escapeHtml(row.label)}</a>`
          : escapeHtml(row.label)
      return `<tr><td>${name}${entryStatusHtml(entry, ui)}</td>${scoreCellHtml(row.score)}<td>${inlineCodeHtml(row.quality)}</td><td>${escapeHtml(row.cost)}</td><td class="num">${escapeHtml(row.time)}</td><td>${inlineCodeHtml(row.note)}</td></tr>`
    })
    .join('\n')
  return `<div class="tablewrap"><table>
<thead><tr><th>${escapeHtml(headLabel)}</th><th>${ui.scoreHeader}</th><th>${ui.qualityHeader}</th><th>${ui.costHeader}</th><th>${ui.timeHeader}</th><th>${ui.noteHeader}</th></tr></thead>
<tbody>
${body}
</tbody>
</table></div>`
}

const legacyTableHtml = (entries: GalleryEntry[], lang: 'ja' | 'en'): string => {
  const rows = entries
    .map((entry) => {
      const href = linkForLang(entry.link, lang)
      const game = href
        ? `<a href="${escapeHtml(href)}">${escapeHtml(entry.slug)}</a>`
        : escapeHtml(entry.slug)
      return `<tr><td>${game}</td><td>${escapeHtml(entry.model)}</td><td>${escapeHtml(entry.runId ?? '-')}</td><td>${entry.score === null ? '-' : entry.score.toFixed(2)}</td><td>${entry.reps === null ? '-' : String(entry.reps)}</td><td>${entry.status}</td><td>${escapeHtml(entry.detail)}</td></tr>`
    })
    .join('\n')
  return `<div class="tablewrap"><table>
<thead><tr><th>Game</th><th>Model</th><th>Representative run</th><th>Score</th><th>Rep count</th><th>Status</th><th>Detail</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`
}

const pageHtml = (title: string, bodyHtml: string, lang: 'ja' | 'en'): string => {
  const htmlLang = lang === 'en' ? 'en' : 'ja'
  return `<!doctype html>
<html lang="${htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,sans-serif;margin:2rem;color:#1f2933;background:#f7f8fa}
h1,code{overflow-wrap:anywhere}
.tablewrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;background:white}
th,td{border:1px solid #d8dde3;padding:.55rem .7rem;text-align:left;vertical-align:top}
th{background:#e9edf2}
td.num{text-align:right;white-space:nowrap}
td.score{text-align:right}
a{color:#0b63ce}
small{color:#6b7280}
code{background:#eef1f4;padding:0 .25em;border-radius:3px}
@media (max-width: 700px){body{margin:1rem}}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`
}

export const buildGalleryHtml = (
  entries: GalleryEntry[],
  summary: ImpressionsSummary | null,
  { bench, lang = 'ja' }: { bench: string; lang?: 'ja' | 'en' }
): string => {
  const ui = UI[lang]
  const langSwitchLink = lang === 'ja' ? 'en/' : '../'
  const langSwitchHtml = `<p class="lang-switch"><a href="${REPO_URL}">${ui.repoLinkLabel}</a> | <a href="${escapeHtml(langSwitchLink)}">${ui.switchLangLabel}</a></p>`
  if (summary === null) {
    const title = ui.galleryTitle.replace('__BENCH__', bench)
    return pageHtml(
      title,
      `${langSwitchHtml}
<h1>${escapeHtml(title)}</h1>
${legacyTableHtml(entries, lang)}`,
      lang
    )
  }
  const entriesBySlug = new Map(entries.map((entry) => [entry.slug, entry]))
  const summarySlugs = new Set([
    'reference',
    ...[
      ...summary.main,
      ...summary.baseline,
      ...summary.followUps.flatMap((section) => section.rows),
    ].map((row) => row.slug),
  ])
  const reference = entriesBySlug.get('reference')
  const referenceLink = linkForLang(reference?.link ?? null, lang)
  const referenceHtml =
    reference?.status === 'exported' && referenceLink !== null
      ? `<p>${ui.referenceText}<a href="${escapeHtml(referenceLink)}">${ui.referencePlay}</a></p>`
      : ''
  const leftovers = entries.filter((entry) => !summarySlugs.has(entry.slug))
  const leftoversHtml =
    leftovers.length === 0
      ? ''
      : `<h2 id="others">${ui.otherEntries}</h2>
${legacyTableHtml(leftovers, lang)}`
  const baselineHtml =
    summary.baseline.length === 0
      ? ''
      : `<p id="baseline">${ui.baselineNote}</p>
${summaryTableHtml(summary.baseline, entriesBySlug, { headLabel: ui.conditionHeader, lang })}`
  const followUpsHtml = summary.followUps
    .map(
      (section, index) =>
        `<h2 id="followup-${index + 1}">${escapeHtml(section.heading)}</h2>
<p>${ui.followUpNote}</p>
${summaryTableHtml(section.rows, entriesBySlug, { headLabel: ui.conditionHeader, lang })}`
    )
    .join('\n')
  const tocItems = [
    `<li><a href="#summary">${ui.summaryToc}</a></li>`,
    ...(summary.baseline.length > 0 ? [`<li><a href="#baseline">${ui.baselineToc}</a></li>`] : []),
    ...summary.followUps.map(
      (section, index) =>
        `<li><a href="#followup-${index + 1}">${escapeHtml(section.heading)}</a></li>`
    ),
    ...(leftovers.length > 0 ? [`<li><a href="#others">${ui.otherEntries}</a></li>`] : []),
  ]
  const tocHtml = `<nav>
<h2>${ui.tocHeading}</h2>
<ul>
${tocItems.join('\n')}
</ul>
</nav>`
  const title = ui.galleryTitle.replace('__BENCH__', bench)
  return pageHtml(
    title,
    `${langSwitchHtml}
<h1>${escapeHtml(title)}</h1>
<p>${ui.intro}</p>
${referenceHtml}
${tocHtml}
<h2 id="summary">${ui.summaryHeading}</h2>
<p>${ui.summaryCaption.replace('__BENCH__', escapeHtml(bench))}</p>
${summaryTableHtml(summary.main, entriesBySlug, { headLabel: ui.modelHeader, lang })}
${baselineHtml}
${followUpsHtml}
${leftoversHtml}`,
    lang
  )
}

const exportOne = async (
  source: ExportSource,
  dirs: { siteDir: string; workRoot: string }
): Promise<GalleryEntry> => {
  const workDir = join(dirs.workRoot, source.slug)
  const webOutDir = join(workDir, 'web-out')
  const gameDir = join(dirs.siteDir, 'games', source.slug)
  copyProject(source.sourceDir, workDir)
  mkdirSync(webOutDir, { recursive: true })
  const importResult = await runCommand('godot', ['--headless', '--path', workDir, '--import'], {
    timeoutMs: 120_000,
  })
  const exportResult = await runCommand(
    'godot',
    ['--headless', '--path', workDir, '--export-release', 'Web', join(webOutDir, 'index.html')],
    { timeoutMs: 180_000 }
  )
  const htmlPath = join(webOutDir, 'index.html')
  const wasmPath = join(webOutDir, 'index.wasm')
  if (exportResult.exitCode !== 0 || !existsSync(htmlPath) || !existsSync(wasmPath)) {
    return {
      detail: `import=${String(importResult.exitCode)} export=${String(exportResult.exitCode)}`,
      link: null,
      model: source.model,
      reps: source.reps,
      runId: source.runId,
      score: source.score,
      slug: source.slug,
      status: 'failed' as const,
    }
  }
  const shared = useSharedEngine(webOutDir, join(dirs.siteDir, 'shared'))
  copyGameFiles(webOutDir, gameDir, shared)
  // 旧 grade.json は全テストの配列を持たない（failed_tests のみ）ため、その場合は
  // テスト別表を出さず従来の失敗リスト表示へフォールバックする
  const canonicalTests = source.grade?.hidden_tests.tests ?? []
  for (const lang of ['ja', 'en'] as const) {
    writeFileSync(
      join(gameDir, lang === 'ja' ? 'index.html' : 'index.en.html'),
      buildGamePageHtml(source, canonicalTests.length > 0 ? canonicalTests : null, lang)
    )
  }
  return {
    detail: shared ? 'shared engine' : 'self-contained engine',
    link: `games/${source.slug}/index.html`,
    model: source.model,
    reps: source.reps,
    runId: source.runId,
    score: source.score,
    slug: source.slug,
    status: 'exported' as const,
  }
}

export const exportBenchGallery = async (options: ExportOptions): Promise<GalleryEntry[]> => {
  const modelFilter = parseModelFilter(options.models)
  const siteDir = options.out === null ? join(DEFAULT_EXPORT_ROOT, 'site') : resolve(options.out)
  const workRoot = join(DEFAULT_EXPORT_ROOT, 'work')
  rmSync(siteDir, { force: true, recursive: true })
  rmSync(workRoot, { force: true, recursive: true })
  mkdirSync(join(siteDir, 'games'), { recursive: true })
  mkdirSync(workRoot, { recursive: true })
  const sources = modelSources(options.bench, modelFilter)
  const entries: GalleryEntry[] = []
  await sources.reduce(async (previous, source) => {
    await previous
    try {
      entries.push(await exportOne(source, { siteDir, workRoot }))
    } catch (error) {
      entries.push({
        detail: error instanceof Error ? error.message : String(error),
        link: null,
        model: source.model,
        reps: source.reps,
        runId: source.runId,
        score: source.score,
        slug: source.slug,
        status: 'failed',
      })
    }
  }, Promise.resolve())
  if (modelFilter !== null) {
    const exported = new Set(sources.map((source) => source.slug))
    for (const slug of [...modelFilter].filter((model) => !exported.has(model))) {
      entries.push({
        detail: 'no completed run or source workspace found',
        link: null,
        model: slug,
        reps: null,
        runId: null,
        score: null,
        slug,
        status: 'skipped',
      })
    }
  }
  const impressionsPath = join(repoRoot, 'benchmarks', options.bench, 'impressions.md')
  const summary = existsSync(impressionsPath)
    ? parseImpressionsSummary(readFileSync(impressionsPath, 'utf8'))
    : null
  writeFileSync(
    join(siteDir, 'index.html'),
    buildGalleryHtml(entries, summary, { bench: options.bench, lang: 'ja' })
  )
  const enImpressionsPath = join(repoRoot, 'benchmarks', options.bench, 'impressions.en.md')
  if (existsSync(enImpressionsPath)) {
    const enSummary = parseImpressionsSummary(
      readFileSync(enImpressionsPath, 'utf8'),
      IMPRESSIONS_HEADINGS.en
    )
    mkdirSync(join(siteDir, 'en'), { recursive: true })
    writeFileSync(
      join(siteDir, 'en', 'index.html'),
      buildGalleryHtml(entries, enSummary, { bench: options.bench, lang: 'en' })
    )
  } else {
    console.warn(`English impressions not found at ${enImpressionsPath}; skipping en/index.html`)
  }
  for (const entry of entries) {
    console.log(`${entry.slug}: ${entry.status} ${entry.detail}`)
  }
  console.log(`site: ${siteDir}`)
  console.log(`work: ${workRoot}`)
  return entries
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  const baseRun: Omit<RunSummary, 'quality' | 'runId'> = {
    childTokens: 0,
    model: 'm',
    outcome: 'completed',
    roundTrips: 0,
    totalCostUsd: null,
    wallClockMs: 0,
  }

  describe('selectRepresentativeRun', () => {
    it('selects the lower median by score after latest completed rep adoption', () => {
      const selected = selectRepresentativeRun([
        { ...baseRun, quality: 70, runId: '20260701T000000Z-m-rep0' },
        { ...baseRun, quality: 95, runId: '20260702T000000Z-m-rep0' },
        { ...baseRun, quality: 80, runId: '20260701T000000Z-m-rep1' },
        { ...baseRun, quality: 90, runId: '20260701T000000Z-m-rep2' },
        { ...baseRun, quality: 60, runId: '20260701T000000Z-m-rep3' },
      ])
      expect(selected?.runId).toBe('20260701T000000Z-m-rep1')
    })

    it('breaks equal-score ties by run id', () => {
      const selected = selectRepresentativeRun([
        { ...baseRun, quality: 80, runId: '20260702T000000Z-m-rep0' },
        { ...baseRun, quality: 80, runId: '20260701T000000Z-m-rep1' },
      ])
      expect(selected?.runId).toBe('20260701T000000Z-m-rep1')
    })
  })

  describe('parseImpressionsSummary', () => {
    const markdown = [
      '# impressions',
      '',
      '## 本計測サマリー',
      '',
      '前置き。',
      '',
      '| モデル | 評価[^score] | 品質[^quality] | 費用[^cost] | 時間[^time] | ひとこと |',
      '| ------ | -----------: | -------------- | ----------- | ----------: | -------- |',
      '| claude-sonnet-5 (Claude) | 285.00 | 3.8 (4.3, 3.3) — `_items` 無型 | $0.97 + $1.30 | 8.6 分 | 品質首位 |',
      '| swe-1.7 (Devin) | 273.00 | 4.1 (4.0, 4.3) | $1.41 + $0 | 12.5 分 | 大幅改善 |',
      '',
      'ベースライン条件:',
      '',
      '| 条件 | 評価 | 品質 | 費用 | 時間 | ひとこと |',
      '| ---- | ---: | ---- | ---- | ---: | -------- |',
      '| fable-direct (委譲なし) | 300.00 | 4.6 (4.7, 4.5) | $2.62 + $0 | 5.7 分 | ベースライン |',
      '',
      '[^score]: 脚注。',
      '',
      '## 次のセクション',
      '',
      '| 無関係 | 表 |',
      '| ------ | -- |',
      '| a | b |',
      '',
      '## 追試（effort A/B）',
      '',
      '| 条件 | 評価 | 品質 | 費用 | 時間 | ひとこと |',
      '| ---- | ---: | ---- | ---- | ---: | -------- |',
      '| gpt-5.6-luna@xhigh | 285.00 | 3.8 | $1.34 + $1.75 | 13.0 分 | 機能満点 |',
      '',
      '## 番外編',
      '',
      '| モデル | 評価 |',
      '| ------ | ---: |',
      '| sonnet | 9 |',
    ].join('\n')

    it('parses main and baseline tables within the summary section only', () => {
      const summary = parseImpressionsSummary(markdown)
      expect(summary?.main.map((row) => row.slug)).toEqual(['claude-sonnet-5', 'swe-1.7'])
      expect(summary?.baseline.map((row) => row.slug)).toEqual(['fable-direct'])
      expect(summary?.followUps).toEqual([
        {
          heading: '追試（effort A/B）',
          rows: [
            {
              cost: '$1.34 + $1.75',
              label: 'gpt-5.6-luna@xhigh',
              note: '機能満点',
              quality: '3.8',
              score: '285.00',
              slug: 'gpt-5.6-luna@xhigh',
              time: '13.0 分',
            },
          ],
        },
      ])
      expect(summary?.main[0]).toEqual({
        cost: '$0.97 + $1.30',
        label: 'claude-sonnet-5 (Claude)',
        note: '品質首位',
        quality: '3.8 (4.3, 3.3) — `_items` 無型',
        score: '285.00',
        slug: 'claude-sonnet-5',
        time: '8.6 分',
      })
    })

    it('returns null when the summary section is missing', () => {
      expect(parseImpressionsSummary('# impressions\n\n## 別セクション\n')).toBeNull()
    })

    it('parses the real impressions.en.md', () => {
      const enFile = readFileSync(
        join(repoRoot, 'benchmarks/202607_delegate_implement_bench/impressions.en.md'),
        'utf8'
      )
      const summary = parseImpressionsSummary(enFile, IMPRESSIONS_HEADINGS.en)
      expect(summary).not.toBeNull()
      expect(summary?.main.length).toBe(18)
      expect(summary?.baseline.length).toBe(1)
      expect(summary?.followUps.length).toBe(3)
    })

    it('parses English Summary and Follow-up sections', () => {
      const enMarkdown = [
        '# impressions',
        '',
        '## Summary',
        '',
        '| Model | Score | Quality | Cost | Time | Note |',
        '| ----- | ----: | ------- | ---- | ---: | ---- |',
        '| claude-sonnet-5 (Claude) | 285.00 | 3.8 | $0.97 + $1.30 | 8.6 min | leader |',
        '',
        'Baseline condition:',
        '',
        '| Condition | Score | Quality | Cost | Time | Note |',
        '| --------- | ----: | ------- | ---- | ---: | ---- |',
        '| fable-direct (no delegation) | 300.00 | 4.6 | $2.62 + $0 | 5.7 min | baseline |',
        '',
        '## Follow-up 1 (effort A/B)',
        '',
        '| Condition | Score | Quality | Cost | Time | Note |',
        '| --------- | ----: | ------- | ---- | ---: | ---- |',
        '| gpt-5.6-luna@xhigh | 285.00 | 3.8 | $1.34 + $1.75 | 13.0 min | perfect |',
      ].join('\n')
      const summary = parseImpressionsSummary(enMarkdown, IMPRESSIONS_HEADINGS.en)
      expect(summary?.main.map((row) => row.slug)).toEqual(['claude-sonnet-5'])
      expect(summary?.baseline.map((row) => row.slug)).toEqual(['fable-direct'])
      expect(summary?.followUps).toEqual([
        {
          heading: 'Follow-up 1 (effort A/B)',
          rows: [
            {
              cost: '$1.34 + $1.75',
              label: 'gpt-5.6-luna@xhigh',
              note: 'perfect',
              quality: '3.8',
              score: '285.00',
              slug: 'gpt-5.6-luna@xhigh',
              time: '13.0 min',
            },
          ],
        },
      ])
    })
  })

  describe('buildGalleryHtml', () => {
    const entry: GalleryEntry = {
      detail: 'shared engine',
      link: 'games/claude-sonnet-5/index.html',
      model: 'claude-sonnet-5',
      reps: 3,
      runId: '20260701T000000Z-claude-sonnet-5-rep1',
      score: 100,
      slug: 'claude-sonnet-5',
      status: 'exported',
    }

    it('links summary rows to exported games and marks missing exports', () => {
      const html = buildGalleryHtml(
        [entry],
        {
          baseline: [],
          followUps: [],
          main: [
            {
              cost: '$0.97 + $1.30',
              label: 'claude-sonnet-5 (Claude)',
              note: '品質首位',
              quality: '3.8 — `_items` 無型',
              score: '285.00',
              slug: 'claude-sonnet-5',
              time: '8.6 分',
            },
            {
              cost: '$1.41 + $0',
              label: 'swe-1.7 (Devin)',
              note: '大幅改善',
              quality: '4.1',
              score: '273.00',
              slug: 'swe-1.7',
              time: '12.5 分',
            },
          ],
        },
        { bench: '202607_delegate_implement_bench' }
      )
      expect(html).toContain(
        '<a href="games/claude-sonnet-5/index.html" title="代表 run: 20260701T000000Z-claude-sonnet-5-rep1">claude-sonnet-5 (Claude)</a>'
      )
      expect(html).toContain('<code>_items</code>')
      expect(html).toContain('swe-1.7 (Devin) <small>(未エクスポート)</small>')
      expect(html).not.toContain('その他のエントリ')
      expect(html).toContain('<div class="tablewrap"><table>')
      expect(html).toContain('.tablewrap{overflow-x:auto}')
    })

    it('falls back to the legacy table without a summary', () => {
      const html = buildGalleryHtml([entry], null, { bench: 'bench' })
      expect(html).toContain('<th>Representative run</th>')
    })

    it('renders English index with translated links and labels', () => {
      const html = buildGalleryHtml(
        [entry],
        {
          baseline: [],
          followUps: [],
          main: [
            {
              cost: '$0.97 + $1.30',
              label: 'claude-sonnet-5 (Claude)',
              note: 'Quality leader',
              quality: '3.8 — untyped `_items`',
              score: '285.00',
              slug: 'claude-sonnet-5',
              time: '8.6 min',
            },
            {
              cost: '$1.41 + $0',
              label: 'swe-1.7 (Devin)',
              note: 'Large improvement',
              quality: '4.1',
              score: '273.00',
              slug: 'swe-1.7',
              time: '12.5 min',
            },
          ],
        },
        { bench: '202607_delegate_implement_bench', lang: 'en' }
      )
      expect(html).toContain('<html lang="en">')
      expect(html).toContain('Conveyor Courier Gallery')
      expect(html).toContain('<a href="../">日本語</a>')
      expect(html).toContain(
        '<a href="../games/claude-sonnet-5/index.en.html" title="Representative run: 20260701T000000Z-claude-sonnet-5-rep1">claude-sonnet-5 (Claude)</a>'
      )
      expect(html).toContain('<th>Auto-graded score (sum)</th>')
      expect(html).toContain('swe-1.7 (Devin) <small>(not exported)</small>')
    })

    it('links the Japanese index to the English index', () => {
      const html = buildGalleryHtml([entry], null, { bench: 'bench', lang: 'ja' })
      expect(html).toContain('<a href="en/">English</a>')
    })
  })

  describe('buildGamePageHtml', () => {
    const source: ExportSource = {
      grade: {
        commands: [
          { command: 'godot --import', exit_code: 0, name: 'import', timed_out: false },
          { command: 'godot --quit-after 30', exit_code: 1, name: 'smoke', timed_out: false },
        ],
        hidden_tests: {
          categories: {
            collision: { failed: 1, passed: 3 },
            win_path: { failed: 0, passed: 5 },
          },
          failed_tests: [{ category: 'collision', detail: 'items overlap', name: 'two_items' }],
          failed: 1,
          parsed: true,
          passed: 8,
          tests: [],
        },
        score: {
          determinism: 10,
          functionality: 53.18,
          health: 10,
          total: 81.18,
          type_quality: 8,
        },
        type_warnings: 1,
        workspace: '/w',
      },
      model: 'claude-haiku-4-5',
      reps: 1,
      runId: '20260701T000000Z-claude-haiku-4-5-rep0',
      score: 90.18,
      slug: 'claude-haiku-4-5',
      sourceDir: '/s',
    }

    it('embeds the game and renders the grade breakdown', () => {
      const html = buildGamePageHtml(source, null)
      expect(html).toContain('<iframe src="game.html"')
      expect(html).toContain('<td class="num">53.18 / 70</td>')
      expect(html).toContain('strict 警告 1 件')
      expect(html).not.toContain('隠しテスト内訳')
      expect(html).toContain('<h2>採点内訳</h2>')
      expect(html).toContain('<h3>機能（隠しテスト） <span class="pts">53.18 / 70</span></h3>')
      expect(html).toContain('テスト別内訳なし（旧形式の grade.json）。8 成功 / 1 失敗')
      expect(html).toContain('<h3>決定性 <span class="pts">10 / 10</span></h3>')
      expect(html).toContain('<h3>型品質 <span class="pts">8 / 10</span></h3>')
      expect(html).toContain(
        'strict 型警告（untyped / unsafe を error 昇格した per-file 検査）1 件 × −2（下限 0）</td><td class="res">⚠️</td>'
      )
      expect(html).toContain('<h3>プロジェクト健全性 <span class="pts">10 / 10</span></h3>')
      expect(html).toContain(
        'プロジェクト import（godot --headless --import）</td><td class="res">✅ 3 / 3'
      )
      expect(html).toContain(
        '起動 smoke（main.tscn の headless 起動）</td><td class="res">❌ 0 / 3'
      )
      expect(html).toContain(
        'API 契約（BoardModel の Scene 非依存ロードと契約テスト）</td><td class="res">❌ 0 / 4'
      )
      expect(html).toContain('<code>collision/two_items</code>')
      expect(html).toContain('items overlap')
      expect(html).toContain('<a href="index.en.html">English</a>')
    })

    it('notes the reference implementation instead of a grade table', () => {
      const html = buildGamePageHtml(
        {
          ...source,
          grade: null,
          model: 'reference',
          runId: null,
          slug: 'reference',
        },
        null
      )
      expect(html).toContain('自動採点の対象外')
      expect(html).not.toContain('<h2>自動採点</h2>')
    })

    it('renders the per-test breakdown with Japanese labels when verified cases exist', () => {
      const html = buildGamePageHtml(source, [
        {
          category: 'splitter',
          detail: '',
          name: 'splitter alternates right left right',
          passed: true,
        },
        {
          category: 'splitter',
          detail: 'exit_case=false',
          name: 'splitter toggles on exit and off-board departure',
          passed: false,
        },
        { category: 'win_path', detail: '', name: 'unknown new test', passed: true },
      ])
      expect(html).toContain('<h2>採点内訳</h2>')
      expect(html).toContain('<td rowspan="2">スプリッター<br><small>splitter</small></td>')
      expect(html).toContain('スプリッターが右→左→右と交互に振り分ける')
      expect(html).toContain('詳細: exit_case=false')
      expect(html).toContain('<td>unknown new test</td>')
      expect(html).toContain('<h3>プロジェクト健全性 <span class="pts">10 / 10</span></h3>')
      expect(html).not.toContain('失敗したテスト')
    })

    it('renders English page with translated labels and language switch', () => {
      const html = buildGamePageHtml(source, null, 'en')
      expect(html).toContain('<html lang="en">')
      expect(html).toContain('<a href="../../en/index.html">← Back to list</a>')
      expect(html).toContain('<a href="index.html">日本語</a>')
      expect(html).toContain('<h2>Auto-graded score</h2>')
      expect(html).toContain(
        '<h3>Functionality (hidden tests) <span class="pts">53.18 / 70</span></h3>'
      )
      expect(html).toContain(
        'Strict type warnings (per-file untyped/unsafe treated as error): 1 × −2 (floor 0)'
      )
      expect(html).toContain('Project import (godot --headless --import)')
      expect(html).toContain('Boot smoke (headless launch of main.tscn)')
      expect(html).toContain('API contract (BoardModel scene-independent load and contract tests)')
    })

    it('fixes the mobile CSS so the iframe does not collapse in column layout', () => {
      const html = buildGamePageHtml(source, null, 'en')
      expect(html).toContain(
        '@media (max-width: 900px){body{flex-direction:column;height:auto}iframe{flex:none;width:100%;height:70vh}aside{width:100%}}'
      )
    })
  })

  describe('rewriteGodotIndexHtml', () => {
    it('points Godot loader files at the shared engine and local pack', () => {
      const html =
        '<script src="index.js"></script>{"executable":"index","fileSizes":{"index.wasm":1}}'
      expect(rewriteGodotIndexHtml(html)).toBe(
        '<script src="../../shared/index.js"></script>{"executable":"../../shared/index","mainPack":"index.pck","fileSizes":{"../../shared/index.wasm":1}}'
      )
    })
  })
}
