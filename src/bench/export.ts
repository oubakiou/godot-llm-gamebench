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
      join(gameDir, 'index.html'),
      rewriteGodotIndexHtml(readFileSync(join(webOutDir, 'index.html'), 'utf8'))
    )
    return
  }
  for (const file of ['index.html', ...SHARED_FILES]) {
    copyFileSync(join(webOutDir, file), join(gameDir, file))
  }
}

const buildGalleryHtml = (entries: GalleryEntry[]): string => {
  const rows = entries
    .map((entry) => {
      const game = entry.link
        ? `<a href="${escapeHtml(entry.link)}">${escapeHtml(entry.slug)}</a>`
        : escapeHtml(entry.slug)
      return `<tr><td>${game}</td><td>${escapeHtml(entry.model)}</td><td>${escapeHtml(entry.runId ?? '-')}</td><td>${entry.score === null ? '-' : entry.score.toFixed(2)}</td><td>${entry.reps === null ? '-' : String(entry.reps)}</td><td>${entry.status === 'exported' ? 'exported' : 'export failed'}</td><td>${escapeHtml(entry.detail)}</td></tr>`
    })
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Godot LLM Gamebench Exports</title>
<style>
body{font-family:system-ui,sans-serif;margin:2rem;color:#1f2933;background:#f7f8fa}
table{border-collapse:collapse;width:100%;background:white}
th,td{border:1px solid #d8dde3;padding:.55rem .7rem;text-align:left}
th{background:#e9edf2}
a{color:#0b63ce}
</style>
</head>
<body>
<h1>Godot LLM Gamebench Exports</h1>
<table>
<thead><tr><th>Game</th><th>Model</th><th>Representative run</th><th>Score</th><th>Rep count</th><th>Status</th><th>Detail</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>
`
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
  writeFileSync(join(siteDir, 'index.html'), buildGalleryHtml(entries))
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
