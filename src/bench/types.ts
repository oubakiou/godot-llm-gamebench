export type Measurement = 'measured' | 'estimated'
export type Outcome = 'completed' | 'failed' | 'stalled' | 'timeout'

export interface ParentTokens {
  input: number
  cache_read: number
  output: number
  cost_usd: number | null
}

export interface ChildTokens {
  input: number
  output: number
  measurement: Measurement
  cost_usd: number | null
}

export interface Metrics {
  run_id: string
  model: string
  backend: string
  wall_clock_ms: number
  round_trips: number
  parent_tokens: ParentTokens
  child_tokens: ChildTokens
  outcome: Outcome
}

export interface GradeJson {
  passed?: number
  failed?: number
  categories?: Record<string, { passed?: number; failed?: number }>
  tests?: { category?: string; name?: string; passed?: boolean; detail?: string }[]
}

export interface GradeScore {
  total: number
  functionality: number
  determinism: number
  type_quality: number
  health: number
}

export interface GradeResult {
  workspace: string
  commands: { name: string; command: string; exit_code: number | null; timed_out: boolean }[]
  hidden_tests: {
    parsed: boolean
    passed: number
    failed: number
    categories: Record<string, { passed: number; failed: number }>
    failed_tests: { category: string; name: string; detail: string }[]
    tests: { category: string; name: string; passed: boolean; detail: string }[]
  }
  type_warnings: number
  score: GradeScore
}
