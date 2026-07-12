#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { gradeWorkspace } from './grade.ts'
import { buildReportMarkdown } from './report.ts'
import { runBenchmark } from './run.ts'

const usage = (): never => {
  console.error('Usage: node src/bench/cli.ts <run|grade|report> [options]')
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
    console.log(buildReportMarkdown())
    return
  }
  usage()
}

await main()
