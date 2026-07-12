#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { gradeWorkspace } from './grade.ts'
import { DEFAULT_BENCH_ROUND, isValidBenchRound } from './paths.ts'
import { buildReportMarkdown, loadRuns } from './report.ts'
import { runBenchmark } from './run.ts'

const usage = (): never => {
  console.error(
    `Usage: node src/bench/cli.ts <run|grade|report> [options]\n` +
      `  --bench <round-id>  benchmarks/ 配下のラウンド (default: ${DEFAULT_BENCH_ROUND})`
  )
  process.exit(2)
}

const option = (args: string[], name: string): string | null => {
  const index = args.indexOf(name)
  if (index === -1) {
    return null
  }
  return args[index + 1] ?? null
}

const requireOption = (args: string[], name: string): string => {
  const value = option(args, name)
  if (value !== null) {
    return value
  }
  return usage()
}

const benchOption = (args: string[]): string => {
  const raw = option(args, '--bench')
  // option() は「フラグ未指定」と「値欠落」をどちらも null で返すため、
  // 値欠落を default へ黙って落とさないようフラグの有無で区別する
  if (raw === null && args.includes('--bench')) {
    return usage()
  }
  const bench = raw ?? DEFAULT_BENCH_ROUND
  if (!isValidBenchRound(bench)) {
    console.error(`--bench: invalid round id ${bench} (expected e.g. 202612_delegate_review_bench)`)
    return usage()
  }
  return bench
}

const main = async (): Promise<void> => {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'grade') {
    const workspace = requireOption(args, '--workspace')
    const result = await gradeWorkspace(workspace)
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (command === 'run') {
    const model = requireOption(args, '--model')
    const repRaw = requireOption(args, '--rep')
    const rep = Number.parseInt(repRaw, 10)
    if (!Number.isInteger(rep)) {
      usage()
    }
    // Codex CLI は effort 値をローカル検証せずサーバへ素通しするため、typo を実ラン前に落とす
    const effortRaw = option(args, '--effort')
    if (effortRaw !== null && !['minimal', 'low', 'medium', 'high', 'xhigh'].includes(effortRaw)) {
      usage()
    }
    const effort = effortRaw ?? undefined
    const variantRaw = option(args, '--variant')
    if (variantRaw !== null && !/^[a-z0-9][a-z0-9-]*$/.test(variantRaw)) {
      usage()
    }
    const variant = variantRaw ?? undefined
    const childSkillRaw = option(args, '--child-skill')
    if (childSkillRaw !== null && !existsSync(join(childSkillRaw, 'SKILL.md'))) {
      console.error(`--child-skill: SKILL.md not found under ${childSkillRaw}`)
      usage()
    }
    const childSkill = childSkillRaw ?? undefined
    const result = await runBenchmark({
      bench: benchOption(args),
      childSkill,
      dryRun: args.includes('--dry-run'),
      effort,
      model,
      rep,
      variant,
    })
    console.log(result.runDir)
    return
  }
  if (command === 'report') {
    console.log(buildReportMarkdown(loadRuns(benchOption(args))))
    return
  }
  usage()
}

await main()
