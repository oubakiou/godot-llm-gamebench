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

const walkFiles = (dir: string): string[] => {
  if (!existsSync(dir)) {
    return []
  }
  const entries = readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return walkFiles(path)
    }
    return [path]
  })
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

export const collectChildTokens = (
  delegateWorkDir: string,
  delegateMetricsJsonl: string,
  backend: string
): ChildTokens => {
  if (backend !== 'codex') {
    return estimatedTokensFromDelegate(delegateMetricsJsonl)
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
    return estimatedTokensFromDelegate(delegateMetricsJsonl)
  }
  return { cost_usd: null, input: totals.input, measurement: 'measured', output: totals.output }
}

export const latestMtimeMs = (dir: string): number => {
  if (!existsSync(dir)) {
    return 0
  }
  const self = statSync(dir).mtimeMs
  return Math.max(self, ...walkFiles(dir).map((file) => statSync(file).mtimeMs))
}

export const sumFileSizes = (dir: string): number => {
  if (!existsSync(dir)) {
    return 0
  }
  return walkFiles(dir).reduce((sum, file) => sum + statSync(file).size, 0)
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
    })
  })
}
