import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// ラウンド = 時期をまたがない一続きの計測（スコア比較はラウンド内に限定する）。
// 新ラウンド開始時はこの既定値を更新するか、CLI の --bench で明示する
export const DEFAULT_BENCH_ROUND = '202607_delegate_implement_bench'

// runs/ を benchmarks/<round>/ 配下に置くことで、ラウンド間のラン成果物が混ざらない
export const runsRootOf = (benchRound: string): string =>
  join(repoRoot, 'benchmarks', benchRound, 'runs')

export const isValidBenchRound = (value: string): boolean => /^\d{6}_[a-z0-9_]+$/.test(value)

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('isValidBenchRound', () => {
    it('accepts YYYYMM-prefixed round ids', () => {
      expect(isValidBenchRound('202607_delegate_implement_bench')).toBe(true)
      expect(isValidBenchRound('202612_delegate_review_bench')).toBe(true)
    })

    it('rejects ids that could escape benchmarks/', () => {
      expect(isValidBenchRound('../tasks')).toBe(false)
      expect(isValidBenchRound('202607/evil')).toBe(false)
      expect(isValidBenchRound('delegate_bench')).toBe(false)
    })
  })

  describe('runsRootOf', () => {
    it('places runs under the round directory', () => {
      expect(runsRootOf('202607_delegate_implement_bench')).toBe(
        join(repoRoot, 'benchmarks/202607_delegate_implement_bench/runs')
      )
    })
  })
}
