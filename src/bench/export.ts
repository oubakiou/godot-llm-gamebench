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
import type { GradeResult } from './types.ts'

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

export const parseImpressionsSummary = (markdown: string): ImpressionsSummary | null => {
  const lines = markdown.split('\n')
  const headings = lines
    .map((line, index) => ({ index, title: line.startsWith('## ') ? line.slice(3).trim() : null }))
    .filter((entry): entry is { index: number; title: string } => entry.title !== null)
  const sectionsOf = (
    predicate: (title: string) => boolean
  ): { title: string; tables: ImpressionsSummaryRow[][] }[] =>
    headings
      .filter((entry) => predicate(entry.title))
      .map((entry) => {
        const next = headings.find((candidate) => candidate.index > entry.index)
        return {
          tables: sectionTables(lines, entry.index + 1, next?.index ?? lines.length),
          title: entry.title,
        }
      })
  const summarySection = sectionsOf((title) => title === '本計測サマリー')[0]
  if (summarySection === undefined) {
    return null
  }
  const [main = [], baseline = []] = summarySection.tables
  if (main.length === 0) {
    return null
  }
  const followUps = sectionsOf((title) => title.startsWith('追試')).flatMap(({ tables, title }) => {
    const rows = tables[0] ?? []
    return rows.length === 0 ? [] : [{ heading: title, rows }]
  })
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

const SCORE_AXES = [
  ['functionality', '機能（隠しテスト）', 70],
  ['determinism', '決定性', 10],
  ['type_quality', '型品質', 10],
  ['health', 'プロジェクト健全性', 10],
] as const

const formatPoints = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2)

const categoryLabelHtml = (category: string): string => {
  const label = CATEGORY_LABELS_JA[category]
  return label === undefined
    ? escapeHtml(category)
    : `${escapeHtml(label)}<br><small>${escapeHtml(category)}</small>`
}

const testLabelHtml = (test: HiddenTestCase): string => {
  const label = TEST_LABELS_JA[test.name]
  const detail =
    test.passed || test.detail === '' ? '' : `<br><small>詳細: ${escapeHtml(test.detail)}</small>`
  return label === undefined
    ? `${escapeHtml(test.name)}${detail}`
    : `${escapeHtml(label)}<br><small>${escapeHtml(test.name)}</small>${detail}`
}

const testBreakdownRows = (tests: HiddenTestCase[]): string => {
  const groups = new Map<string, HiddenTestCase[]>()
  for (const test of tests) {
    groups.set(test.category, [...(groups.get(test.category) ?? []), test])
  }
  return [...groups.entries()]
    .flatMap(([category, cases]) =>
      cases.map((test, index) => {
        const categoryCell =
          index === 0 ? `<td rowspan="${cases.length}">${categoryLabelHtml(category)}</td>` : ''
        return `<tr>${categoryCell}<td>${testLabelHtml(test)}</td><td>${test.passed ? '✅' : '❌'}</td></tr>`
      })
    )
    .join('\n')
}

const passMark = (ok: boolean): string => (ok ? '✅' : '❌')

const partialMark = (value: number, max: number): string => {
  if (value >= max) {
    return '✅'
  }
  return value <= 0 ? '❌' : '⚠️'
}

const itemTable = (rows: string): string => `<table>
<thead><tr><th>項目</th><th>結果</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`

// 機能以外の 3 大項目（決定性・型品質・健全性）を 1 カテゴリ 1 テーブルで出す。
// 決定性は score から、健全性は採点時の commands の exit code と contract カテゴリから復元する
const axisSectionsHtml = (grade: GradeResult): string => {
  const { hidden_tests: hiddenTests, score, type_warnings: typeWarnings } = grade
  const commandOk = (name: string): boolean => {
    const command = grade.commands.find((entry) => entry.name === name)
    return command !== undefined && command.exit_code === 0 && !command.timed_out
  }
  const contract = hiddenTests.categories.contract
  const contractOk = contract !== undefined && contract.failed === 0 && contract.passed > 0
  const importOk = commandOk('import')
  const smokeOk = commandOk('smoke')
  return `<h3>決定性 <span class="pts">${formatPoints(score.determinism)} / 10</span></h3>
${itemTable(`<tr><td>同一 seed・同一操作列で結果が再現する（determinism カテゴリ全テスト成功で満点）</td><td class="res">${passMark(score.determinism === 10)}</td></tr>`)}
<h3>型品質 <span class="pts">${formatPoints(score.type_quality)} / 10</span></h3>
${itemTable(`<tr><td>strict 型警告（untyped / unsafe を error 昇格した per-file 検査）${typeWarnings} 件 × −2（下限 0）</td><td class="res">${partialMark(score.type_quality, 10)}</td></tr>`)}
<h3>プロジェクト健全性 <span class="pts">${formatPoints(score.health)} / 10</span></h3>
${itemTable(
  [
    `<tr><td>プロジェクト import（godot --headless --import）</td><td class="res">${passMark(importOk)} ${importOk ? '3' : '0'} / 3</td></tr>`,
    `<tr><td>起動 smoke（main.tscn の headless 起動）</td><td class="res">${passMark(smokeOk)} ${smokeOk ? '3' : '0'} / 3</td></tr>`,
    `<tr><td>API 契約（BoardModel の Scene 非依存ロードと契約テスト）</td><td class="res">${passMark(contractOk)} ${contractOk ? '4' : '0'} / 4</td></tr>`,
  ].join('\n')
)}`
}

const gradePanelHtml = (source: ExportSource, tests: HiddenTestCase[] | null): string => {
  const heading = `<p><a href="../../index.html">← 一覧へ戻る</a></p>
<h1>${escapeHtml(source.model)}</h1>`
  if (source.grade === null) {
    const note =
      source.model === 'reference'
        ? '参照実装（採点の基準となるお手本実装）のため自動採点の対象外。'
        : '代表 run の grade.json が見つからないため合否内訳を表示できない。'
    return `${heading}
<p>${note}</p>`
  }
  const { hidden_tests: hiddenTests, score, type_warnings: typeWarnings } = source.grade
  const runLine =
    source.runId === null ? '' : `<p><small>代表 run: ${escapeHtml(source.runId)}</small></p>`
  const axisRows = SCORE_AXES.map(([key, label, max]) => {
    const warnings =
      key === 'type_quality' ? `<small>（strict 警告 ${typeWarnings} 件）</small>` : ''
    return `<tr><td>${label}${warnings}</td><td class="num">${formatPoints(score[key])} / ${max}</td></tr>`
  }).join('\n')
  const scoreTable = `<h2>自動採点</h2>
<table>
<thead><tr><th>項目</th><th>得点</th></tr></thead>
<tbody>
${axisRows}
<tr><th>合計</th><td class="num"><strong>${formatPoints(score.total)} / 100</strong></td></tr>
</tbody>
</table>`
  if (!hiddenTests.parsed) {
    return `${heading}
${runLine}
${scoreTable}
<p>隠しテストの結果を解析できなかったため合否内訳はなし。</p>`
  }
  const failedList =
    tests !== null || hiddenTests.failed_tests.length === 0
      ? ''
      : `<h3>失敗したテスト</h3>
<ul>
${hiddenTests.failed_tests
  .map(
    (test) =>
      `<li><code>${escapeHtml(test.category)}/${escapeHtml(test.name)}</code>${test.detail === '' ? '' : `<br><small>${escapeHtml(test.detail)}</small>`}</li>`
  )
  .join('\n')}
</ul>`
  const functionalityBlock =
    tests === null
      ? `<p><small>テスト別内訳なし（旧形式の grade.json）。${hiddenTests.passed} 成功 / ${hiddenTests.failed} 失敗</small></p>`
      : `<table>
<thead><tr><th>カテゴリ</th><th>テスト</th><th>合否</th></tr></thead>
<tbody>
${testBreakdownRows(tests)}
</tbody>
</table>`
  return `${heading}
${runLine}
${scoreTable}
<h2>採点内訳</h2>
<h3>機能（隠しテスト） <span class="pts">${formatPoints(score.functionality)} / 70</span></h3>
${functionalityBlock}
${failedList}
${axisSectionsHtml(source.grade)}`
}

export const buildGamePageHtml = (source: ExportSource, tests: HiddenTestCase[] | null): string => {
  const title = `Conveyor Courier — ${source.model}`
  return `<!doctype html>
<html lang="ja">
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
@media (max-width: 900px){body{flex-direction:column;height:auto}iframe{width:100%;height:70vh}aside{width:100%}}
</style>
</head>
<body>
<iframe src="game.html" title="${escapeHtml(title)}" allow="fullscreen"></iframe>
<aside>
${gradePanelHtml(source, tests)}
</aside>
</body>
</html>
`
}

const inlineCodeHtml = (value: string): string =>
  escapeHtml(value).replace(/`(?<code>[^`]+)`/g, '<code>$<code></code>')

const entryStatusHtml = (entry: GalleryEntry | undefined): string => {
  if (entry === undefined) {
    return ' <small>(未エクスポート)</small>'
  }
  if (entry.status === 'exported') {
    return ''
  }
  return ` <small>(${entry.status === 'failed' ? 'export failed' : 'skipped'})</small>`
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
  headLabel: string
): string => {
  const body = rows
    .map((row) => {
      const entry = entriesBySlug.get(row.slug)
      const name =
        entry?.status === 'exported' && entry.link !== null
          ? `<a href="${escapeHtml(entry.link)}"${entry.runId === null ? '' : ` title="代表 run: ${escapeHtml(entry.runId)}"`}>${escapeHtml(row.label)}</a>`
          : escapeHtml(row.label)
      return `<tr><td>${name}${entryStatusHtml(entry)}</td>${scoreCellHtml(row.score)}<td>${inlineCodeHtml(row.quality)}</td><td>${escapeHtml(row.cost)}</td><td class="num">${escapeHtml(row.time)}</td><td>${inlineCodeHtml(row.note)}</td></tr>`
    })
    .join('\n')
  return `<table>
<thead><tr><th>${escapeHtml(headLabel)}</th><th>自動テストによる評価(合算)</th><th>コード品質 (sonnet評, sol評)</th><th>親費用+子費用(中央値)</th><th>所要時間(中央値)</th><th>ひとこと</th></tr></thead>
<tbody>
${body}
</tbody>
</table>`
}

const legacyTableHtml = (entries: GalleryEntry[]): string => {
  const rows = entries
    .map((entry) => {
      const game = entry.link
        ? `<a href="${escapeHtml(entry.link)}">${escapeHtml(entry.slug)}</a>`
        : escapeHtml(entry.slug)
      return `<tr><td>${game}</td><td>${escapeHtml(entry.model)}</td><td>${escapeHtml(entry.runId ?? '-')}</td><td>${entry.score === null ? '-' : entry.score.toFixed(2)}</td><td>${entry.reps === null ? '-' : String(entry.reps)}</td><td>${entry.status}</td><td>${escapeHtml(entry.detail)}</td></tr>`
    })
    .join('\n')
  return `<table>
<thead><tr><th>Game</th><th>Model</th><th>Representative run</th><th>Score</th><th>Rep count</th><th>Status</th><th>Detail</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`
}

const pageHtml = (title: string, bodyHtml: string): string => `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,sans-serif;margin:2rem;color:#1f2933;background:#f7f8fa}
table{border-collapse:collapse;width:100%;background:white}
th,td{border:1px solid #d8dde3;padding:.55rem .7rem;text-align:left;vertical-align:top}
th{background:#e9edf2}
td.num{text-align:right;white-space:nowrap}
td.score{text-align:right}
a{color:#0b63ce}
small{color:#6b7280}
code{background:#eef1f4;padding:0 .25em;border-radius:3px}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`

export const buildGalleryHtml = (
  entries: GalleryEntry[],
  summary: ImpressionsSummary | null,
  bench: string
): string => {
  if (summary === null) {
    return pageHtml(
      'Godot LLM Gamebench Exports',
      `<h1>Godot LLM Gamebench Exports</h1>
${legacyTableHtml(entries)}`
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
  const referenceHtml =
    reference?.status === 'exported' && reference.link !== null
      ? `<p>参照実装（採点の基準となるお手本実装）: <a href="${escapeHtml(reference.link)}">プレイする</a></p>`
      : ''
  const leftovers = entries.filter((entry) => !summarySlugs.has(entry.slug))
  const leftoversHtml =
    leftovers.length === 0
      ? ''
      : `<h2 id="others">その他のエントリ</h2>
${legacyTableHtml(leftovers)}`
  const baselineHtml =
    summary.baseline.length === 0
      ? ''
      : `<p id="baseline">ベースライン条件（委譲プロトコルを通らない別条件のため参考値。上表とは直接比較しないこと）:</p>
${summaryTableHtml(summary.baseline, entriesBySlug, '条件')}`
  const followUpsHtml = summary.followUps
    .map(
      (section, index) => `<h2 id="followup-${index + 1}">${escapeHtml(section.heading)}</h2>
<p>条件付き計測（A/B）のため、本計測サマリーの表とは直接比較しないこと。</p>
${summaryTableHtml(section.rows, entriesBySlug, '条件')}`
    )
    .join('\n')
  const tocItems = [
    '<li><a href="#summary">本計測サマリー</a></li>',
    ...(summary.baseline.length > 0 ? ['<li><a href="#baseline">ベースライン条件</a></li>'] : []),
    ...summary.followUps.map(
      (section, index) =>
        `<li><a href="#followup-${index + 1}">${escapeHtml(section.heading)}</a></li>`
    ),
    ...(leftovers.length > 0 ? ['<li><a href="#others">その他のエントリ</a></li>'] : []),
  ]
  const tocHtml = `<nav>
<h2>目次</h2>
<ul>
${tocItems.join('\n')}
</ul>
</nav>`
  const title = `Conveyor Courier ギャラリー — ${bench}`
  return pageHtml(
    title,
    `<h1>${escapeHtml(title)}</h1>
<p>ベンチで生成された Conveyor Courier 実装の Web エクスポート。モデル名のリンクから代表 run（採用 rep の総合スコア中央値）の実装をブラウザでプレイできる。</p>
${referenceHtml}
${tocHtml}
<h2 id="summary">本計測サマリー</h2>
<p>表の数値は <code>benchmarks/${escapeHtml(bench)}/impressions.md</code> の本計測サマリー（各モデル 3 反復の採用値）からの転記。指標の定義は同ファイルの脚注を参照。</p>
${summaryTableHtml(summary.main, entriesBySlug, 'モデル')}
${baselineHtml}
${followUpsHtml}
${leftoversHtml}`
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
  writeFileSync(
    join(gameDir, 'index.html'),
    buildGamePageHtml(source, canonicalTests.length > 0 ? canonicalTests : null)
  )
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
  writeFileSync(join(siteDir, 'index.html'), buildGalleryHtml(entries, summary, options.bench))
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
        '202607_delegate_implement_bench'
      )
      expect(html).toContain(
        '<a href="games/claude-sonnet-5/index.html" title="代表 run: 20260701T000000Z-claude-sonnet-5-rep1">claude-sonnet-5 (Claude)</a>'
      )
      expect(html).toContain('<code>_items</code>')
      expect(html).toContain('swe-1.7 (Devin) <small>(未エクスポート)</small>')
      expect(html).not.toContain('その他のエントリ')
    })

    it('falls back to the legacy table without a summary', () => {
      const html = buildGalleryHtml([entry], null, 'bench')
      expect(html).toContain('<th>Representative run</th>')
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
