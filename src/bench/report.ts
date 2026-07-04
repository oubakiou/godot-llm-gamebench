import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GradeResult, Metrics } from './types.ts'

interface PriceRow {
  model?: string
  input?: number | null
  cached_input?: number | null
  output?: number | null
}

interface RunSummary {
  model: string
  quality: number
  wallClockMs: number
  roundTrips: number
  childTokens: number
  totalCostUsd: number | null
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const runsRoot = join(repoRoot, 'benchmarks/runs')
const pricesPath = join(repoRoot, '.claude/skills/delegate-implement/model-token-prices.json')

const median = (values: number[]): number | null => {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null
  }
  const left = sorted[middle - 1]
  const right = sorted[middle]
  if (left === undefined || right === undefined) {
    return null
  }
  return (left + right) / 2
}

const fmt = (value: number | null, digits = 2): string =>
  value === null ? 'N/A' : value.toFixed(digits)

const readJson = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

const loadPrices = (): Map<string, PriceRow> => {
  const parsed = readJson<{ models?: PriceRow[] }>(pricesPath)
  const prices = new Map<string, PriceRow>()
  for (const row of parsed?.models ?? []) {
    if (row.model !== undefined) {
      prices.set(row.model, row)
    }
  }
  return prices
}

const calculateChildCost = (metrics: Metrics, prices: Map<string, PriceRow>): number | null => {
  if (metrics.child_tokens.cost_usd !== null) {
    return metrics.child_tokens.cost_usd
  }
  const price = prices.get(metrics.model)
  if (
    price?.input === undefined ||
    price.input === null ||
    price.output === undefined ||
    price.output === null
  ) {
    return null
  }
  return (
    (metrics.child_tokens.input * price.input + metrics.child_tokens.output * price.output) /
    1_000_000
  )
}

const loadRuns = (): RunSummary[] => {
  if (!existsSync(runsRoot)) {
    return []
  }
  const prices = loadPrices()
  return readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const runDir = join(runsRoot, entry.name)
      const metrics = readJson<Metrics>(join(runDir, 'metrics.json'))
      const grade = readJson<GradeResult>(join(runDir, 'grade.json'))
      if (metrics === null || grade === null) {
        return []
      }
      const childCost = calculateChildCost(metrics, prices)
      const parentCost = metrics.parent_tokens.cost_usd
      return [
        {
          childTokens: metrics.child_tokens.input + metrics.child_tokens.output,
          model: metrics.model,
          quality: grade.score.total,
          roundTrips: metrics.round_trips,
          totalCostUsd: childCost === null || parentCost === null ? null : childCost + parentCost,
          wallClockMs: metrics.wall_clock_ms,
        },
      ]
    })
}

export const buildReportMarkdown = (runs: RunSummary[] = loadRuns()): string => {
  const byModel = new Map<string, RunSummary[]>()
  for (const run of runs) {
    byModel.set(run.model, [...(byModel.get(run.model) ?? []), run])
  }
  const rows = [...byModel.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([model, modelRuns]) => {
      const costs = modelRuns.map((run) => run.totalCostUsd).filter((value) => value !== null)
      const costMedian = costs.length === modelRuns.length ? median(costs) : null
      return [
        model,
        String(modelRuns.length),
        fmt(median(modelRuns.map((run) => run.quality))),
        fmt(median(modelRuns.map((run) => run.wallClockMs / 1000)), 1),
        fmt(median(modelRuns.map((run) => run.roundTrips)), 1),
        fmt(median(modelRuns.map((run) => run.childTokens)), 0),
        fmt(costMedian, 4),
      ]
    })
  return [
    '| Model | Runs | Quality median | Seconds median | Round trips median | Child tokens median | Cost median USD |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('report aggregation', () => {
    it('prints model medians as markdown', () => {
      const markdown = buildReportMarkdown([
        {
          childTokens: 100,
          model: 'b',
          quality: 10,
          roundTrips: 1,
          totalCostUsd: 0.1,
          wallClockMs: 1000,
        },
        {
          childTokens: 300,
          model: 'b',
          quality: 30,
          roundTrips: 3,
          totalCostUsd: 0.3,
          wallClockMs: 3000,
        },
        {
          childTokens: 200,
          model: 'a',
          quality: 20,
          roundTrips: 2,
          totalCostUsd: null,
          wallClockMs: 2000,
        },
      ])
      expect(markdown).toContain('| a | 1 | 20.00 | 2.0 | 2.0 | 200 | N/A |')
      expect(markdown).toContain('| b | 2 | 20.00 | 2.0 | 2.0 | 200 | 0.2000 |')
    })
  })
}
