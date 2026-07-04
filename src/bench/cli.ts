#!/usr/bin/env node
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
    const result = await runBenchmark({ dryRun: args.includes('--dry-run'), model, rep })
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
