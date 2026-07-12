import { spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gradeWorkspace } from './grade.ts'
import { buildMetrics, latestMtimeMs, sumFileSizes } from './metrics.ts'
import type { Metrics, Outcome } from './types.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const promptPath = join(repoRoot, 'benchmarks/tasks/conveyor-courier/prompt.md')
const delegateSkillPath = join(repoRoot, '.claude/skills/delegate-implement')
const runsRoot = join(repoRoot, 'benchmarks/runs')

const parentPlaybook = `Read TASK.md and delegate the implementation to the delegate-implement skill.
Verify only the public acceptance criteria in TASK.md.
If verification fails, report the failures back through delegate-implement and ask for a fix.
Use at most 5 delegation round trips.
Do not edit code yourself.
Run dispatch.sh as a FOREGROUND Bash command with timeout 2400000 (40 minutes) and
simply wait for it to return. NEVER run dispatch.sh in the background: you are in
non-interactive mode and will not be re-invoked when a background task finishes, so
backgrounding kills the delegation. Do not poll observe files while waiting.
CRITICAL: a dispatch is finished only when its response_file exists and you have read it
with read-response.sh. Never give your final answer while any dispatch is still running.
If dispatch returns without a response_file, poll for the file for up to 3 minutes
(the wrapper writes a failed response on abnormal exit), then count it as a failed
round trip.
When finished, respond with exactly one word: completed or failed.`

// ベースライン条件: 委譲プロトコルを使わず、親モデル自身が直接実装する
const directPlaybook = `Read TASK.md and implement it yourself in this workspace.
Do NOT delegate: no delegate skills, no subagents. Write all code directly.
Verify the public acceptance criteria in TASK.md yourself before finishing.
When finished, respond with exactly one word: completed or failed.`

// 直接実装ベースラインの擬似モデル ID（実体は親と同じ claude-fable-5）
export const DIRECT_MODEL = 'fable-direct'

interface RunArgs {
  model: string
  rep: number
  dryRun: boolean
  effort?: string
  variant?: string
  childSkill?: string
}

// effort / variant はレポート集計キー（metrics.model / run_id）にだけ載せ、
// CLI へ渡す実モデル ID とは分離する
export const modelLabel = (model: string, suffix?: string): string =>
  suffix === undefined ? model : `${model}@${suffix}`

const safeSegment = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/g, '_')

const makeRunId = (model: string, rep: number): string => {
  const stamp = new Date()
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace(/\.\d{3}Z$/, 'Z')
  return `${stamp}-${safeSegment(model)}-rep${rep}`
}

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

const initWorkspace = (runDir: string, direct: boolean, childSkill?: string): string => {
  const workspace = join(runDir, 'workspace')
  mkdirSync(workspace, { recursive: true })
  copyFileSync(promptPath, join(workspace, 'TASK.md'))
  if (direct) {
    writeFileSync(join(workspace, 'CLAUDE.md'), '実装タスクはこの workspace 内で直接行う。\n')
  } else {
    mkdirSync(join(workspace, '.claude/skills'), { recursive: true })
    cpSync(delegateSkillPath, join(workspace, '.claude/skills/delegate-implement'), {
      recursive: true,
    })
    writeFileSync(
      join(workspace, 'CLAUDE.md'),
      '実装タスクは delegate-implement skill で委譲する。\n'
    )
  }
  if (childSkill !== undefined) {
    const skillName = basename(childSkill)
    mkdirSync(join(workspace, '.claude/skills'), { recursive: true })
    cpSync(childSkill, join(workspace, '.claude/skills', skillName), { recursive: true })
    writeFileSync(
      join(workspace, 'CLAUDE.md'),
      `GDScript の実装・修正を行う実装者は、開始前に .claude/skills/${skillName}/SKILL.md を読み、その規約に従い、同梱の検証スクリプトで headless 検証すること。\n`,
      { flag: 'a' }
    )
  }
  spawnSync('git', ['init'], { cwd: workspace, stdio: 'ignore' })
  return workspace
}

export const violatesParentProtocol = (
  parentResult: Record<string, unknown>,
  delegateWorkDir: string
): boolean => {
  const rawResult = parentResult.result
  const finalWord = (typeof rawResult === 'string' ? rawResult : '').trim().toLowerCase()
  if (finalWord !== 'completed' && finalWord !== 'failed') {
    return true
  }
  if (!existsSync(delegateWorkDir)) {
    return true
  }
  return readdirSync(delegateWorkDir)
    .filter((name) => name.endsWith('_observe.json'))
    .some((name) => {
      try {
        const observed = JSON.parse(readFileSync(join(delegateWorkDir, name), 'utf8')) as {
          state?: { phase?: string }
        }
        return observed.state?.phase === 'running'
      } catch {
        return true
      }
    })
}

const readParentResult = (stdout: string): Record<string, unknown> => {
  const trimmed = stdout.trim()
  if (trimmed === '') {
    return {}
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    const lastJsonLine = trimmed
      .split(/\r?\n/)
      .toReversed()
      .find((line) => line.trim().startsWith('{'))
    if (lastJsonLine === undefined) {
      return { raw_stdout: stdout }
    }
    try {
      return JSON.parse(lastJsonLine) as Record<string, unknown>
    } catch {
      return { raw_stdout: stdout }
    }
  }
}

const sampleCpuTicks = (pid: number): number => {
  const statPath = `/proc/${pid}/stat`
  if (!existsSync(statPath)) {
    return 0
  }
  const fields = readFileSync(statPath, 'utf8').split(' ')
  return Number(fields[13] ?? 0) + Number(fields[14] ?? 0)
}

const startWatchdog = (args: {
  pid: number
  workspace: string
  delegateDir: string
  output: string
  onStalled: () => void
  onTimeout: () => void
}): NodeJS.Timeout => {
  const started = Date.now()
  let lastChanged = Date.now()
  let previous = { cpu: 0, logSize: 0, mtime: 0 }
  return setInterval(() => {
    const current = {
      cpu: sampleCpuTicks(args.pid),
      logSize: sumFileSizes(args.delegateDir),
      mtime: latestMtimeMs(args.workspace),
    }
    const alive = existsSync(`/proc/${args.pid}`)
    // cpu は生存確認専用。待機中の親もわずかに消費し続けるため、
    // 無進捗判定に含めると stalled が永久に発火しない
    const changed = current.mtime !== previous.mtime || current.logSize !== previous.logSize
    if (changed) {
      lastChanged = Date.now()
    }
    writeFileSync(
      args.output,
      `${JSON.stringify({ alive, ts: new Date().toISOString(), ...current })}\n`,
      { flag: 'a' }
    )
    previous = current
    if (Date.now() - lastChanged >= 10 * 60_000) {
      args.onStalled()
    }
    if (Date.now() - started >= 40 * 60_000) {
      args.onTimeout()
    }
  }, 30_000)
}

const delegateEnvFor = (args: {
  model: string
  effort?: string
  metricsFile: string
  workDir: string
}): Record<string, string> =>
  args.model === DIRECT_MODEL
    ? {}
    : {
        DELEGATE_IMPLEMENT_MODEL: args.model,
        DELEGATE_METRICS_FILE: args.metricsFile,
        DELEGATE_WORK_DIR: args.workDir,
        ...(args.effort === undefined ? {} : { CODEX_DELEGATE_REASONING_EFFORT: args.effort }),
      }

const runParent = async (args: {
  workspace: string
  runDir: string
  model: string
  effort?: string
}): Promise<{
  outcome: Outcome
  stdout: string
  wallClockMs: number
}> =>
  new Promise((resolveResult) => {
    const start = Date.now()
    const delegateDir = join(args.runDir, 'delegate')
    const metricsFile = join(delegateDir, 'metrics.jsonl')
    const workDir = join(delegateDir, 'work')
    mkdirSync(workDir, { recursive: true })
    const direct = args.model === DIRECT_MODEL
    const delegateEnv = delegateEnvFor({
      effort: args.effort,
      metricsFile,
      model: args.model,
      workDir,
    })
    const child = spawn(
      'claude',
      [
        '-p',
        direct ? directPlaybook : parentPlaybook,
        '--model',
        'claude-fable-5',
        '--output-format',
        'json',
        '--dangerously-skip-permissions',
      ],
      {
        cwd: args.workspace,
        env: {
          ...process.env,
          // 親は claude -p（非対話）なので dispatch を前面で待つしかなく、
          // Bash ツールの timeout 上限を watchdog の絶対上限と揃えて引き上げる
          BASH_DEFAULT_TIMEOUT_MS: '2400000',
          BASH_MAX_TIMEOUT_MS: '2400000',
          ...delegateEnv,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    const stdoutChunks: Buffer[] = []
    let settled = false
    let outcome: Outcome = 'failed'
    const killAs = (nextOutcome: Outcome): void => {
      if (settled) {
        return
      }
      outcome = nextOutcome
      child.kill('SIGKILL')
    }
    const watchdog = startWatchdog({
      delegateDir,
      onStalled: () => killAs('stalled'),
      onTimeout: () => killAs('timeout'),
      output: join(args.runDir, 'watchdog.jsonl'),
      pid: child.pid ?? 0,
      workspace: args.workspace,
    })
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) =>
      writeFileSync(join(args.runDir, 'parent.stderr.log'), chunk, { flag: 'a' })
    )
    child.on('error', () => {
      clearInterval(watchdog)
      settled = true
      resolveResult({ outcome: 'failed', stdout: '', wallClockMs: Date.now() - start })
    })
    child.on('close', (exitCode) => {
      clearInterval(watchdog)
      settled = true
      if (outcome === 'failed') {
        outcome = exitCode === 0 ? 'completed' : 'failed'
      }
      resolveResult({
        outcome,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        wallClockMs: Date.now() - start,
      })
    })
  })

export const runBenchmark = async (
  args: RunArgs
): Promise<{ runDir: string; metrics: Metrics }> => {
  mkdirSync(runsRoot, { recursive: true })
  const label = modelLabel(args.model, args.variant ?? args.effort)
  const runId = makeRunId(label, args.rep)
  const runDir = join(runsRoot, runId)
  rmSync(runDir, { force: true, recursive: true })
  mkdirSync(join(runDir, 'delegate/work'), { recursive: true })
  const direct = args.model === DIRECT_MODEL
  const workspace = initWorkspace(runDir, direct, args.childSkill)
  const metricsFile = join(runDir, 'delegate/metrics.jsonl')
  const delegateWorkDir = join(runDir, 'delegate/work')
  const parentCommand = [
    'claude',
    '-p',
    direct ? directPlaybook : parentPlaybook,
    '--model',
    'claude-fable-5',
    '--output-format',
    'json',
    '--dangerously-skip-permissions',
  ]
  let parentResult: Record<string, unknown> = {}
  let outcome: Outcome = 'completed'
  let wallClockMs = 0
  if (args.dryRun) {
    writeJson(join(runDir, 'dry-run-command.json'), {
      command: parentCommand,
      cwd: workspace,
      env: delegateEnvFor({
        effort: args.effort,
        metricsFile,
        model: args.model,
        workDir: delegateWorkDir,
      }),
    })
    writeFileSync(metricsFile, '')
  } else {
    const parent = await runParent({ effort: args.effort, model: args.model, runDir, workspace })
    const parsedParentResult = readParentResult(parent.stdout)
    parentResult = parsedParentResult
    outcome = parent.outcome
    wallClockMs = parent.wallClockMs
    if (outcome === 'completed' && violatesParentProtocol(parsedParentResult, delegateWorkDir)) {
      outcome = 'failed'
    }
  }
  writeJson(join(runDir, 'parent-result.json'), parentResult)
  const metrics = buildMetrics({
    delegateMetricsJsonl: metricsFile,
    delegateWorkDir,
    model: label,
    outcome,
    parentResult,
    runId,
    wallClockMs,
  })
  writeJson(join(runDir, 'metrics.json'), metrics)
  const grade = await gradeWorkspace(workspace)
  writeJson(join(runDir, 'grade.json'), grade)
  writeFileSync(
    join(runDir, 'run-summary.json'),
    `${JSON.stringify({ runDir, workspaceMtime: statSync(workspace).mtimeMs }, null, 2)}\n`
  )
  return { metrics, runDir }
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('violatesParentProtocol', () => {
    const makeWorkDir = (observe?: { state?: { phase?: string } }): string => {
      const dir = join(repoRoot, '.temp', `vitest-observe-${Math.random().toString(36).slice(2)}`)
      mkdirSync(dir, { recursive: true })
      if (observe !== undefined) {
        writeFileSync(join(dir, 'delegate_x_observe.json'), JSON.stringify(observe))
      }
      return dir
    }

    it('rejects a missing or non-protocol final word', () => {
      const dir = makeWorkDir({ state: { phase: 'ended' } })
      expect(violatesParentProtocol({}, dir)).toBe(true)
      expect(violatesParentProtocol({ result: 'done!' }, dir)).toBe(true)
      rmSync(dir, { force: true, recursive: true })
    })

    it('accepts completed and failed words with ended dispatches', () => {
      const dir = makeWorkDir({ state: { phase: 'ended' } })
      expect(violatesParentProtocol({ result: 'completed' }, dir)).toBe(false)
      expect(violatesParentProtocol({ result: ' Failed ' }, dir)).toBe(false)
      rmSync(dir, { force: true, recursive: true })
    })

    it('rejects a dispatch left running', () => {
      const dir = makeWorkDir({ state: { phase: 'running' } })
      expect(violatesParentProtocol({ result: 'completed' }, dir)).toBe(true)
      rmSync(dir, { force: true, recursive: true })
    })
  })
}
