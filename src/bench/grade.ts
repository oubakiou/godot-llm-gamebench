import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { GradeJson, GradeResult, GradeScore } from './types.ts'

interface CommandResult {
  command: string
  args: string[]
  exitCode: number | null
  timedOut: boolean
  stdout: string
  stderr: string
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const hiddenTestPath = join(repoRoot, 'benchmarks/tasks/conveyor-courier/hidden-tests/run_tests.gd')
const round = (value: number): number => Math.round(value * 100) / 100

const runCommand = async (
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<CommandResult> =>
  new Promise((resolveResult) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let timedOut = false
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true
            child.kill('SIGKILL')
          }, options.timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
    child.on('close', (exitCode) => {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      resolveResult({
        args,
        command,
        exitCode,
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        timedOut,
      })
    })
    child.on('error', () => {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      resolveResult({ args, command, exitCode: null, stderr: '', stdout: '', timedOut })
    })
  })

const emptyCategories = (): Record<string, { passed: number; failed: number }> => ({})

export const normalizeGradeJson = (grade: GradeJson | null): GradeResult['hidden_tests'] => {
  if (grade === null) {
    return { parsed: false, passed: 0, failed: 0, categories: emptyCategories(), failed_tests: [] }
  }
  const categories = Object.fromEntries(
    Object.entries(grade.categories ?? {}).map(([name, value]) => [
      name,
      { failed: value.failed ?? 0, passed: value.passed ?? 0 },
    ])
  )
  const failedTests = (grade.tests ?? [])
    .filter((test) => test.passed === false)
    .map((test) => ({
      category: test.category ?? '?',
      detail: test.detail ?? '',
      name: test.name ?? '?',
    }))
  return {
    categories,
    failed: grade.failed ?? 0,
    failed_tests: failedTests,
    parsed: true,
    passed: grade.passed ?? 0,
  }
}

export const calculateScore = (args: {
  hidden: GradeResult['hidden_tests']
  importOk: boolean
  smokeOk: boolean
  typeWarnings: number
}): GradeScore => {
  const totalHidden = args.hidden.passed + args.hidden.failed
  const functionality = totalHidden === 0 ? 0 : (args.hidden.passed / totalHidden) * 60
  const determinismCategory = args.hidden.categories.determinism
  const determinismTotal = (determinismCategory?.passed ?? 0) + (determinismCategory?.failed ?? 0)
  const determinism = determinismTotal > 0 && (determinismCategory?.failed ?? 0) === 0 ? 10 : 0
  const contractCategory = args.hidden.categories.contract
  const contractOk =
    contractCategory !== undefined && contractCategory.failed === 0 && contractCategory.passed > 0
  const health = (args.importOk ? 5 : 0) + (args.smokeOk ? 5 : 0) + (contractOk ? 5 : 0)
  const typeQuality = Math.max(0, 15 - args.typeWarnings * 3)
  return {
    determinism,
    functionality: round(functionality),
    health,
    total: round(functionality + determinism + typeQuality + health),
    type_quality: typeQuality,
  }
}

const parseGradeLine = (stdout: string): GradeJson | null => {
  const line = stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith('GRADE_JSON: '))
    ?.slice('GRADE_JSON: '.length)
  if (line === undefined) {
    return null
  }
  try {
    return JSON.parse(line) as GradeJson
  } catch {
    return null
  }
}

const countUntypedWarnings = (stderr: string): number =>
  stderr.split(/\r?\n/).filter((line) => /UNTYPED|untyped/i.test(line)).length

const cpRecursive = (from: string, to: string): void => {
  cpSync(from, to, { recursive: true })
}

const cpWorkspace = (from: string, to: string): void => {
  rmSync(to, { force: true, recursive: true })
  mkdirSync(to, { recursive: true })
  for (const entry of ['project.godot', 'scripts', 'scenes', 'icon.svg']) {
    const source = join(from, entry)
    if (existsSync(source)) {
      cpRecursive(source, join(to, entry))
    }
  }
}

const makeTypecheckProject = (workspace: string): string => {
  const tempDir = join(
    repoRoot,
    '.temp/bench-typecheck',
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(dirname(tempDir), { recursive: true })
  cpWorkspace(workspace, tempDir)
  const projectFile = join(tempDir, 'project.godot')
  const existing = existsSync(projectFile) ? readFileSync(projectFile, 'utf8') : ''
  writeFileSync(
    projectFile,
    `${existing.trimEnd()}\n\n[debug]\n\ngdscript/warnings/untyped_declaration=1\ngdscript/warnings/unsafe_property_access=1\ngdscript/warnings/unsafe_method_access=1\n`
  )
  return tempDir
}

export const gradeWorkspace = async (workspaceInput: string): Promise<GradeResult> => {
  const workspace = resolve(workspaceInput)
  const commands: GradeResult['commands'] = []
  const importResult = await runCommand('godot', ['--headless', '--path', workspace, '--import'])
  commands.push({
    command: `godot --headless --path ${workspace} --import`,
    exit_code: importResult.exitCode,
    name: 'import',
    timed_out: importResult.timedOut,
  })
  const smokeResult = await runCommand(
    'godot',
    ['--headless', '--path', workspace, '--quit-after', '30'],
    { timeoutMs: 30_000 }
  )
  commands.push({
    command: `godot --headless --path ${workspace} --quit-after 30`,
    exit_code: smokeResult.exitCode,
    name: 'smoke',
    timed_out: smokeResult.timedOut,
  })

  const injectedTest = join(workspace, 'run_tests.gd')
  let hiddenResult: CommandResult = {
    args: [],
    command: 'godot',
    exitCode: null,
    stderr: '',
    stdout: '',
    timedOut: false,
  }
  try {
    copyFileSync(hiddenTestPath, injectedTest)
    hiddenResult = await runCommand(
      'godot',
      ['--headless', '--path', workspace, '-s', 'res://run_tests.gd'],
      { timeoutMs: 60_000 }
    )
  } finally {
    rmSync(injectedTest, { force: true })
  }
  commands.push({
    command: `godot --headless --path ${workspace} -s res://run_tests.gd`,
    exit_code: hiddenResult.exitCode,
    name: 'hidden-tests',
    timed_out: hiddenResult.timedOut,
  })

  let typeWarnings = 0
  let typeProject = ''
  try {
    typeProject = makeTypecheckProject(workspace)
    const typeResult = await runCommand('godot', ['--headless', '--path', typeProject, '--import'])
    typeWarnings = countUntypedWarnings(typeResult.stderr)
    commands.push({
      command: `godot --headless --path ${typeProject} --import`,
      exit_code: typeResult.exitCode,
      name: 'type-warnings',
      timed_out: typeResult.timedOut,
    })
  } finally {
    if (typeProject !== '') {
      rmSync(typeProject, { recursive: true, force: true })
    }
  }

  const hidden = normalizeGradeJson(parseGradeLine(hiddenResult.stdout))
  const score = calculateScore({
    hidden,
    importOk: importResult.exitCode === 0 && !importResult.timedOut,
    smokeOk: smokeResult.exitCode === 0 && !smokeResult.timedOut,
    typeWarnings,
  })
  return { commands, hidden_tests: hidden, score, type_warnings: typeWarnings, workspace }
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest

  describe('grade rubric', () => {
    it('converts hidden test results to the documented rubric', () => {
      const hidden = normalizeGradeJson({
        categories: { contract: { failed: 0, passed: 1 }, determinism: { failed: 0, passed: 2 } },
        failed: 3,
        passed: 30,
      })
      expect(calculateScore({ hidden, importOk: true, smokeOk: true, typeWarnings: 2 })).toEqual({
        determinism: 10,
        functionality: 54.55,
        health: 15,
        total: 88.55,
        type_quality: 9,
      })
    })

    it('zeros determinism and contract health when those categories fail', () => {
      const hidden = normalizeGradeJson({
        categories: { contract: { failed: 1, passed: 0 }, determinism: { failed: 1, passed: 1 } },
        failed: 1,
        passed: 1,
      })
      expect(
        calculateScore({ hidden, importOk: false, smokeOk: true, typeWarnings: 99 }).determinism
      ).toBe(0)
      expect(
        calculateScore({ hidden, importOk: false, smokeOk: true, typeWarnings: 99 }).health
      ).toBe(5)
    })
  })
}
