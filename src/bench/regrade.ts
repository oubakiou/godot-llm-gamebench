import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gradeWorkspace } from './grade.ts'
import { runsRootOf } from './paths.ts'
import type { GradeResult } from './types.ts'

interface RegradeEntry {
  runId: string
  workspace: string
  oldTotal: number
}

const readGrade = (path: string): GradeResult | null => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as GradeResult
  } catch {
    return null
  }
}

const workspaceOf = (runDir: string, grade: GradeResult): string | null => {
  const local = join(runDir, 'workspace')
  if (existsSync(local)) {
    return local
  }
  if (existsSync(grade.workspace)) {
    return grade.workspace
  }
  return null
}

const collectEntries = (bench: string): { entries: RegradeEntry[]; skipped: string[] } => {
  const runsRoot = runsRootOf(bench)
  const entries: RegradeEntry[] = []
  const skipped: string[] = []
  for (const runId of readdirSync(runsRoot).toSorted()) {
    const runDir = join(runsRoot, runId)
    const grade = readGrade(join(runDir, 'grade.json'))
    const workspace = grade === null ? null : workspaceOf(runDir, grade)
    if (grade === null) {
      skipped.push(`${runId}: no grade.json`)
    } else if (workspace === null) {
      skipped.push(`${runId}: no workspace`)
    } else {
      entries.push({ oldTotal: grade.score.total, runId, workspace })
    }
  }
  return { entries, skipped }
}

export const regradeBench = async (bench: string, concurrency: number): Promise<void> => {
  const { entries, skipped } = collectEntries(bench)
  for (const line of skipped) {
    console.log(`skip ${line}`)
  }
  console.log(`regrading ${String(entries.length)} runs (concurrency ${String(concurrency)})`)
  const runsRoot = runsRootOf(bench)
  let index = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const current = entries[index]
      index += 1
      if (current === undefined) {
        return
      }
      // ワーカーはキューを順に消化する意図的な逐次 await（並列度は worker 数で制御）
      // eslint-disable-next-line no-await-in-loop
      const result = await gradeWorkspace(current.workspace)
      writeFileSync(
        join(runsRoot, current.runId, 'grade.json'),
        `${JSON.stringify(result, null, 2)}\n`
      )
      const marker = result.score.total === current.oldTotal ? '=' : '->'
      console.log(
        `${current.runId}: ${String(current.oldTotal)} ${marker} ${String(result.score.total)}`
      )
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))
  console.log('regrade done')
}
