import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { ChildTokens, Metrics, ParentTokens } from './types.ts'

type JsonRecord = Record<string, unknown>

export const backendForModel = (model: string): string => {
  // fable-direct は委譲なしベースライン（親自身が実装）。子プロセスを持たない
  if (model === 'fable-direct') {
    return 'direct'
  }
  if (model.startsWith('gpt')) {
    return 'codex'
  }
  if (model.startsWith('swe') || model.startsWith('devin-')) {
    return 'devin'
  }
  if (model.startsWith('composer') || model.startsWith('cursor-')) {
    return 'cursor'
  }
  return 'claude'
}

export const readJsonlRecords = (path: string): JsonRecord[] => {
  if (!existsSync(path)) {
    return []
  }
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as JsonRecord]
      } catch {
        return []
      }
    })
}

export const countRoundTrips = (metricsJsonl: string): number =>
  readJsonlRecords(metricsJsonl).filter((record) => record.kind === 'prepare').length

const numberFrom = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const nestedNumber = (record: JsonRecord, path: string[]): number => {
  let current: unknown = record
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || !(segment in current)) {
      return 0
    }
    current = (current as JsonRecord)[segment]
  }
  return numberFrom(current)
}

export const extractParentTokens = (parentResult: JsonRecord): ParentTokens => {
  const usage =
    typeof parentResult.usage === 'object' && parentResult.usage !== null
      ? (parentResult.usage as JsonRecord)
      : {}
  return {
    cache_read: numberFrom(usage.cache_read_input_tokens) + numberFrom(usage.cache_read),
    cost_usd: typeof parentResult.total_cost_usd === 'number' ? parentResult.total_cost_usd : null,
    input: numberFrom(usage.input_tokens) + numberFrom(usage.input),
    output: numberFrom(usage.output_tokens) + numberFrom(usage.output),
  }
}

// 子プロセスが一時ファイルを書き捨てる領域を走査するため、
// readdir / stat と削除が競合してエントリが消えることは常に起こり得る（握りつぶして続行する）
const walkFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        return walkFiles(path)
      }
      return [path]
    })
  } catch {
    return []
  }
}

const statSizeOrZero = (file: string): number => {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

const statMtimeOrZero = (file: string): number => {
  try {
    return statSync(file).mtimeMs
  } catch {
    return 0
  }
}

const estimatedTokensFromDelegate = (delegateMetricsJsonl: string): ChildTokens => {
  const records = readJsonlRecords(delegateMetricsJsonl)
  const total = records.reduce<{ input: number; output: number }>(
    (acc, record) => {
      acc.input +=
        nestedNumber(record, ['request', 'estimated_tokens']) +
        nestedNumber(record, ['request_estimated_tokens'])
      acc.output +=
        nestedNumber(record, ['response', 'estimated_tokens']) +
        nestedNumber(record, ['response_estimated_tokens'])
      return acc
    },
    { input: 0, output: 0 }
  )
  return { cost_usd: null, input: total.input, measurement: 'estimated', output: total.output }
}

// observe JSON の usage は delegate-skills v0.6.0 以降のみ存在する。
// 旧レイアウトのランや usage 欠損ランでは従来のフォールバックが効く
const usageFromObserveFiles = (delegateWorkDir: string): ChildTokens | null => {
  const observeFiles = walkFiles(delegateWorkDir).filter((file) => file.endsWith('_observe.json'))
  // dispatch されず子プロセスを持たない observe（親が request を作り直したケース）は
  // usage の全数チェックの分母に含めない。delegate-skills はこれを prepared のまま残すか、
  // 新しい版では superseded にマークする
  let unreadable = 0
  const dispatched: JsonRecord[] = []
  for (const file of observeFiles) {
    try {
      const record = JSON.parse(readFileSync(file, 'utf8')) as JsonRecord
      const state = typeof record.state === 'object' && record.state !== null ? record.state : {}
      const phase = (state as JsonRecord).phase
      if (phase !== 'prepared' && phase !== 'superseded') {
        dispatched.push(record)
      }
    } catch {
      unreadable += 1
    }
  }
  const usages = dispatched.flatMap((record) => {
    const usage = record.usage
    return typeof usage === 'object' && usage !== null ? [usage as JsonRecord] : []
  })
  // 一部の往復だけ usage が欠けたラン（SIGKILL 打ち切り等）で部分和を実測と申告しないよう、
  // 全往復分が揃わない場合は observe usage を使わずフォールバックに任せる
  if (usages.length === 0 || unreadable > 0 || usages.length < dispatched.length) {
    return null
  }
  const costs = usages.map((usage) => usage.cost_usd)
  const allCostsFinite = costs.every(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  )
  return {
    // 1 往復でもコスト不明があれば部分和を総コストとして誤読させず N/A（単価表換算）へ委ねる
    cost_usd: allCostsFinite ? costs.reduce((sum, value) => sum + value, 0) : null,
    input: usages.reduce((sum, usage) => sum + numberFrom(usage.input_tokens), 0),
    // 往復間で measured / estimated が混在するランは、実測精度を過大申告しないよう estimated に落とす
    measurement: usages.every((usage) => usage.measurement === 'measured')
      ? 'measured'
      : 'estimated',
    output: usages.reduce((sum, usage) => sum + numberFrom(usage.output_tokens), 0),
  }
}

export const collectChildTokens = (
  delegateWorkDir: string,
  delegateMetricsJsonl: string,
  backend: string
): ChildTokens => {
  if (backend === 'direct') {
    // 子が存在しない条件なので 0 は真の実測値（全消費は parent_tokens 側に計上される）
    return { cost_usd: 0, input: 0, measurement: 'measured', output: 0 }
  }
  const observeUsage = usageFromObserveFiles(delegateWorkDir)
  if (observeUsage !== null && observeUsage.measurement === 'measured') {
    return observeUsage
  }
  if (backend !== 'codex') {
    return observeUsage ?? estimatedTokensFromDelegate(delegateMetricsJsonl)
  }
  // codex-home の位置は delegate-skills のレイアウト（work 直下 or 往復ごとの run_dir 配下）
  // に依存するため、固定パスではなくパス一致で全往復分を集計する
  const sessionMarker = join('codex-home', 'sessions')
  const tokenEvents = walkFiles(delegateWorkDir)
    .filter((file) => file.includes(sessionMarker) && file.endsWith('.jsonl'))
    .flatMap((file) => readJsonlRecords(file))
    .filter((record) => record.type === 'token_count' || record.event === 'token_count')
  const totals = tokenEvents.reduce<{ input: number; output: number }>(
    (acc, record) => {
      acc.input += nestedNumber(record, ['usage', 'input_tokens']) + numberFrom(record.input_tokens)
      acc.output +=
        nestedNumber(record, ['usage', 'output_tokens']) + numberFrom(record.output_tokens)
      return acc
    },
    { input: 0, output: 0 }
  )
  if (totals.input === 0 && totals.output === 0) {
    return observeUsage ?? estimatedTokensFromDelegate(delegateMetricsJsonl)
  }
  return { cost_usd: null, input: totals.input, measurement: 'measured', output: totals.output }
}

export const latestMtimeMs = (dir: string): number => {
  if (!existsSync(dir)) {
    return 0
  }
  return Math.max(statMtimeOrZero(dir), ...walkFiles(dir).map(statMtimeOrZero))
}

export const sumFileSizes = (dir: string): number => {
  if (!existsSync(dir)) {
    return 0
  }
  return walkFiles(dir).reduce((sum, file) => sum + statSizeOrZero(file), 0)
}

export const buildMetrics = (args: {
  runId: string
  model: string
  wallClockMs: number
  outcome: Metrics['outcome']
  parentResult: JsonRecord
  delegateMetricsJsonl: string
  delegateWorkDir: string
}): Metrics => {
  const backend = backendForModel(args.model)
  return {
    backend,
    child_tokens: collectChildTokens(args.delegateWorkDir, args.delegateMetricsJsonl, backend),
    model: args.model,
    outcome: args.outcome,
    parent_tokens: extractParentTokens(args.parentResult),
    round_trips: countRoundTrips(args.delegateMetricsJsonl),
    run_id: args.runId,
    wall_clock_ms: args.wallClockMs,
  }
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('metrics collection', () => {
    it('counts prepare events and ignores malformed jsonl lines', () => {
      const dir = '.temp/vitest-metrics'
      const file = `${dir}/metrics.jsonl`
      mkdirSync(dir, { recursive: true })
      writeFileSync(file, '{"kind":"prepare"}\nnot-json\n{"kind":"done"}\n{"kind":"prepare"}\n')
      expect(countRoundTrips(file)).toBe(2)
      rmSync(dir, { force: true, recursive: true })
    })

    it('detects backends from model prefixes', () => {
      expect(backendForModel('gpt-5.5')).toBe('codex')
      expect(backendForModel('devin-glm-5.2')).toBe('devin')
      expect(backendForModel('composer-2.5')).toBe('cursor')
      expect(backendForModel('sonnet-5')).toBe('claude')
      expect(backendForModel('fable-direct')).toBe('direct')
    })

    it('reports zero measured child tokens for the direct baseline', () => {
      expect(collectChildTokens('/nonexistent', '/nonexistent.jsonl', 'direct')).toEqual({
        cost_usd: 0,
        input: 0,
        measurement: 'measured',
        output: 0,
      })
    })

    it('prefers measured usage from observe json and sums round trips', () => {
      const dir = '.temp/vitest-observe-usage'
      mkdirSync(`${dir}/delegate_a`, { recursive: true })
      writeFileSync(
        `${dir}/delegate_a_observe.json`,
        JSON.stringify({
          usage: { cost_usd: 0.5, input_tokens: 100, measurement: 'measured', output_tokens: 20 },
        })
      )
      writeFileSync(
        `${dir}/delegate_b_observe.json`,
        JSON.stringify({
          usage: { cost_usd: 0.25, input_tokens: 30, measurement: 'measured', output_tokens: 5 },
        })
      )
      expect(collectChildTokens(dir, `${dir}/none.jsonl`, 'claude')).toEqual({
        cost_usd: 0.75,
        input: 130,
        measurement: 'measured',
        output: 25,
      })
      rmSync(dir, { force: true, recursive: true })
    })

    it('excludes never-dispatched observes from the usage completeness check', () => {
      const dir = '.temp/vitest-observe-superseded'
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        `${dir}/delegate_a_observe.json`,
        JSON.stringify({
          state: { phase: 'superseded' },
        })
      )
      writeFileSync(
        `${dir}/delegate_b_observe.json`,
        JSON.stringify({
          state: { phase: 'prepared' },
        })
      )
      writeFileSync(
        `${dir}/delegate_c_observe.json`,
        JSON.stringify({
          state: { phase: 'ended' },
          usage: { cost_usd: 0.5, input_tokens: 100, measurement: 'measured', output_tokens: 20 },
        })
      )
      expect(collectChildTokens(dir, `${dir}/none.jsonl`, 'claude')).toEqual({
        cost_usd: 0.5,
        input: 100,
        measurement: 'measured',
        output: 20,
      })
      rmSync(dir, { force: true, recursive: true })
    })

    it('nulls total cost when any round trip has unknown cost', () => {
      const dir = '.temp/vitest-observe-partial-cost'
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        `${dir}/delegate_a_observe.json`,
        JSON.stringify({
          usage: { cost_usd: 0.5, input_tokens: 100, measurement: 'measured', output_tokens: 20 },
        })
      )
      writeFileSync(
        `${dir}/delegate_b_observe.json`,
        JSON.stringify({
          usage: { cost_usd: null, input_tokens: 30, measurement: 'measured', output_tokens: 5 },
        })
      )
      expect(collectChildTokens(dir, `${dir}/none.jsonl`, 'claude')).toEqual({
        cost_usd: null,
        input: 130,
        measurement: 'measured',
        output: 25,
      })
      rmSync(dir, { force: true, recursive: true })
    })

    it('ignores prepared-only observe files that never dispatched a child', () => {
      const dir = '.temp/vitest-observe-prepared'
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        `${dir}/delegate_a_observe.json`,
        JSON.stringify({ state: { phase: 'prepared' } })
      )
      writeFileSync(
        `${dir}/delegate_b_observe.json`,
        JSON.stringify({
          state: { phase: 'ended' },
          usage: { cost_usd: 0.5, input_tokens: 100, measurement: 'measured', output_tokens: 20 },
        })
      )
      expect(collectChildTokens(dir, `${dir}/none.jsonl`, 'codex')).toEqual({
        cost_usd: 0.5,
        input: 100,
        measurement: 'measured',
        output: 20,
      })
      rmSync(dir, { force: true, recursive: true })
    })

    it('falls back entirely when usage is missing for a subset of round trips', () => {
      const dir = '.temp/vitest-observe-partial-usage'
      const jsonl = `${dir}/metrics.jsonl`
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        `${dir}/delegate_a_observe.json`,
        JSON.stringify({
          usage: { cost_usd: 0.5, input_tokens: 100, measurement: 'measured', output_tokens: 20 },
        })
      )
      writeFileSync(`${dir}/delegate_b_observe.json`, JSON.stringify({ state: { phase: 'ended' } }))
      writeFileSync(
        jsonl,
        `${JSON.stringify({ kind: 'prepare', request: { estimated_tokens: 40 }, response: { estimated_tokens: 10 } })}\n`
      )
      expect(collectChildTokens(dir, jsonl, 'claude')).toEqual({
        cost_usd: null,
        input: 40,
        measurement: 'estimated',
        output: 10,
      })
      rmSync(dir, { force: true, recursive: true })
    })

    it('downgrades to estimated when round trips mix measured and estimated usage', () => {
      const dir = '.temp/vitest-observe-mixed'
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        `${dir}/delegate_a_observe.json`,
        JSON.stringify({
          usage: { input_tokens: 100, measurement: 'measured', output_tokens: 20 },
        })
      )
      writeFileSync(
        `${dir}/delegate_b_observe.json`,
        JSON.stringify({
          usage: { input_tokens: 40, measurement: 'estimated', output_tokens: 8 },
        })
      )
      expect(collectChildTokens(dir, `${dir}/none.jsonl`, 'cursor')).toEqual({
        cost_usd: null,
        input: 140,
        measurement: 'estimated',
        output: 28,
      })
      rmSync(dir, { force: true, recursive: true })
    })

    it('falls back to delegate metrics estimates when observe usage is absent', () => {
      const dir = '.temp/vitest-observe-absent'
      const jsonl = `${dir}/metrics.jsonl`
      mkdirSync(dir, { recursive: true })
      writeFileSync(`${dir}/delegate_a_observe.json`, JSON.stringify({ state: { phase: 'ended' } }))
      writeFileSync(
        jsonl,
        `${JSON.stringify({ kind: 'prepare', request: { estimated_tokens: 12 }, response: { estimated_tokens: 3 } })}\n`
      )
      expect(collectChildTokens(dir, jsonl, 'devin')).toEqual({
        cost_usd: null,
        input: 12,
        measurement: 'estimated',
        output: 3,
      })
      rmSync(dir, { force: true, recursive: true })
    })
  })
}
