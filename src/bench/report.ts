import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot, runsRootOf } from './paths.ts'
import type { GradeResult, Metrics } from './types.ts'

interface PriceRow {
  model?: string
  input?: number | null
  cached_input?: number | null
  output?: number | null
}

export interface RunSummary {
  runId: string
  model: string
  outcome: Metrics['outcome']
  quality: number
  wallClockMs: number
  roundTrips: number
  childTokens: number
  totalCostUsd: number | null
}

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

// 同一 (model, rep) の再計測で旧ラウンドの completed が二重計上されないよう、
// rep ごとに run_id（先頭がゼロ埋め UTC タイムスタンプで辞書順 = 時系列）最大の
// completed だけを採用する。rep が読めない run_id は安全側で全件採用する
export const adoptLatestCompletedPerRep = (completed: RunSummary[]): RunSummary[] => {
  const latestByRep = new Map<number, RunSummary>()
  const unparsable: RunSummary[] = []
  for (const run of completed) {
    const rep = /-rep(?<rep>\d+)$/.exec(run.runId)?.groups?.rep
    if (rep === undefined) {
      unparsable.push(run)
    } else {
      const current = latestByRep.get(Number(rep))
      if (current === undefined || run.runId > current.runId) {
        latestByRep.set(Number(rep), run)
      }
    }
  }
  return [...latestByRep.values(), ...unparsable].toSorted((a, b) => a.runId.localeCompare(b.runId))
}

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

// devin-* / cursor-* prefix は実行系 CLI の振り分け用、@<effort> suffix は
// reasoning effort 条件の集計キー分離用で、価格表のキーは素のモデル名のため剥離してから引き直す
export const lookupPrice = (model: string, prices: Map<string, PriceRow>): PriceRow | undefined => {
  const base = model.replace(/@[^@]*$/, '')
  return prices.get(model) ?? prices.get(base) ?? prices.get(base.replace(/^(?:devin|cursor)-/, ''))
}

const calculateChildCost = (metrics: Metrics, prices: Map<string, PriceRow>): number | null => {
  if (metrics.child_tokens.cost_usd !== null) {
    return metrics.child_tokens.cost_usd
  }
  const price = lookupPrice(metrics.model, prices)
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

export const loadRuns = (bench: string): RunSummary[] => {
  const runsRoot = runsRootOf(bench)
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
      // エイリアス haiku のランはハーネス検証専用で集計から除外する。
      // 正式ランはフル ID claude-haiku-4-5 で実行され、この除外に当たらない
      if (metrics.model === 'haiku') {
        return []
      }
      const childCost = calculateChildCost(metrics, prices)
      const parentCost = metrics.parent_tokens.cost_usd
      return [
        {
          childTokens: metrics.child_tokens.input + metrics.child_tokens.output,
          model: metrics.model,
          outcome: metrics.outcome,
          quality: grade.score.total,
          roundTrips: metrics.round_trips,
          runId: metrics.run_id,
          totalCostUsd: childCost === null || parentCost === null ? null : childCost + parentCost,
          wallClockMs: metrics.wall_clock_ms,
        },
      ]
    })
}

export const buildReportMarkdown = (runs: RunSummary[]): string => {
  const byModel = new Map<string, RunSummary[]>()
  for (const run of runs) {
    byModel.set(run.model, [...(byModel.get(run.model) ?? []), run])
  }
  const rows = [...byModel.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([model, modelRuns]) => {
      // 中央値は completed ランのみで計算する（打ち切りランの残存値や null を混ぜない）。
      // 非 completed は試行数と内訳（信頼性メトリクス）として別列で報告する
      const completed = adoptLatestCompletedPerRep(
        modelRuns.filter((run) => run.outcome === 'completed')
      )
      const nonCompleted = modelRuns.filter((run) => run.outcome !== 'completed')
      const breakdown =
        nonCompleted.length === 0
          ? '-'
          : ['stalled', 'timeout', 'failed']
              .map((outcome) => [outcome, nonCompleted.filter((run) => run.outcome === outcome)])
              .filter(
                (pair): pair is [string, RunSummary[]] => (pair[1] as RunSummary[]).length > 0
              )
              .map(([outcome, runsOf]) => `${String(runsOf.length)} ${outcome}`)
              .join(', ')
      const costs = completed.map((run) => run.totalCostUsd).filter((value) => value !== null)
      const costMedian = costs.length === completed.length ? median(costs) : null
      return [
        model,
        // Completed は採用ラン数（rep ごとに最新 completed のみ）、Attempts は
        // 再計測で置き換えられた completed も含む全試行数
        `${String(completed.length)}/${String(modelRuns.length)}`,
        // 品質は採用ラン合計（各モデル 3 反復で最大 300）。反復間の再現性を
        // 評価へ含めるための合算で、completed 不足は 0 埋めせず Completed/Attempts 列で読む
        fmt(completed.reduce((sum, run) => sum + run.quality, 0)),
        fmt(median(completed.map((run) => run.wallClockMs / 1000)), 1),
        fmt(median(completed.map((run) => run.roundTrips)), 1),
        fmt(median(completed.map((run) => run.childTokens)), 0),
        fmt(costMedian, 4),
        breakdown,
      ]
    })
  return [
    '| Model | Completed/Attempts | Quality sum (max 300) | Seconds median | Round trips median | Child tokens median | Total cost median USD | Non-completed |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('lookupPrice', () => {
    const prices = new Map<string, PriceRow>([
      ['glm-5.2', { input: 1.4, model: 'glm-5.2', output: 4.4 }],
      ['composer-2.5-fast', { input: 3, model: 'composer-2.5-fast', output: 15 }],
    ])

    it('resolves exact keys and strips backend prefixes', () => {
      expect(lookupPrice('composer-2.5-fast', prices)?.input).toBe(3)
      expect(lookupPrice('devin-glm-5.2', prices)?.input).toBe(1.4)
      expect(lookupPrice('cursor-glm-5.2', prices)?.input).toBe(1.4)
    })

    it('strips effort suffixes before lookup', () => {
      expect(lookupPrice('glm-5.2@xhigh', prices)?.input).toBe(1.4)
      expect(lookupPrice('devin-glm-5.2@medium', prices)?.input).toBe(1.4)
    })

    it('returns undefined for unknown models', () => {
      expect(lookupPrice('unknown-model', prices)).toBeUndefined()
    })
  })

  const completedBase: Omit<RunSummary, 'runId' | 'quality'> = {
    childTokens: 100,
    model: 'm',
    outcome: 'completed',
    roundTrips: 1,
    totalCostUsd: 0.1,
    wallClockMs: 1000,
  }

  describe('adoptLatestCompletedPerRep', () => {
    it('keeps only the latest completed run per rep', () => {
      const adopted = adoptLatestCompletedPerRep([
        { ...completedBase, quality: 10, runId: '20260705T000000Z-m-rep0' },
        { ...completedBase, quality: 88, runId: '20260710T110000Z-m-rep0' },
        { ...completedBase, quality: 50, runId: '20260710T090000Z-m-rep0' },
        { ...completedBase, quality: 20, runId: '20260705T010000Z-m-rep1' },
      ])
      expect(adopted.map((run) => run.quality)).toEqual([20, 88])
    })

    it('keeps runs whose rep cannot be parsed', () => {
      const adopted = adoptLatestCompletedPerRep([
        { ...completedBase, quality: 1, runId: '20260705T000000Z-m-norep' },
        { ...completedBase, quality: 2, runId: '20260705T010000Z-m-norep' },
      ])
      expect(adopted).toHaveLength(2)
    })
  })

  describe('report aggregation', () => {
    it('prints model medians as markdown', () => {
      const markdown = buildReportMarkdown([
        {
          childTokens: 100,
          model: 'b',
          outcome: 'completed',
          quality: 10,
          roundTrips: 1,
          runId: '20260705T000000Z-b-rep0',
          totalCostUsd: 0.1,
          wallClockMs: 1000,
        },
        {
          childTokens: 300,
          model: 'b',
          outcome: 'completed',
          quality: 30,
          roundTrips: 3,
          runId: '20260705T010000Z-b-rep1',
          totalCostUsd: 0.3,
          wallClockMs: 3000,
        },
        {
          childTokens: 999,
          model: 'b',
          outcome: 'stalled',
          quality: 99,
          roundTrips: 9,
          runId: '20260705T020000Z-b-rep2',
          totalCostUsd: null,
          wallClockMs: 9000,
        },
        {
          childTokens: 200,
          model: 'a',
          outcome: 'completed',
          quality: 20,
          roundTrips: 2,
          runId: '20260705T000000Z-a-rep0',
          totalCostUsd: null,
          wallClockMs: 2000,
        },
      ])
      expect(markdown).toContain('| a | 1/1 | 20.00 | 2.0 | 2.0 | 200 | N/A | - |')
      expect(markdown).toContain('| b | 2/3 | 40.00 | 2.0 | 2.0 | 200 | 0.2000 | 1 stalled |')
    })

    it('counts superseded completed runs in attempts but not in aggregates', () => {
      const markdown = buildReportMarkdown([
        { ...completedBase, quality: 40, runId: '20260705T000000Z-m-rep0' },
        { ...completedBase, quality: 90, runId: '20260710T110000Z-m-rep0' },
      ])
      expect(markdown).toContain('| m | 1/2 | 90.00 |')
    })
  })
}
