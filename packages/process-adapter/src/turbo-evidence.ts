import {
  EvidenceCommandFailed,
  type EvidenceRefusal,
  type RelativePath,
  type RepoRoot,
  type TaskName,
  type TurboComparison,
  TurboDryRunDrifted,
  TurboDryRunUnreadable,
  type TurboRun,
  WorktreeUnavailable,
} from '@systemfsoftware/release-language'
import { Effect, FileSystem } from 'effect'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type * as HttpClient from 'effect/unstable/http/HttpClient'
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner'
import { runProcess } from './ProcessRun.js'
import { type FetchedTurbo, fetchTurbo, TURBO_ENV } from './turbo-fetch.js'
import type { TurboPin } from './turbo-pin.js'
import { DryRunDocument, GlobalFiles, GlobalInputs } from './TurboDryRun.schema.js'

const WORKTREE_PREFIX = 'changeset-base-'

type Requirements = FileSystem.FileSystem | ChildProcessSpawner

interface DryRun {
  readonly document: DryRunDocument
}

const decodeDryRun = (
  stdout: string,
  context: string,
): Result.Result<DryRunDocument, TurboDryRunUnreadable> =>
  Result.mapError(
    S.decodeResult(S.fromJsonString(DryRunDocument))(stdout),
    (error) => new TurboDryRunUnreadable({ context, reason: error.message }),
  )

const dryRunView = (
  document: DryRunDocument,
  context: string,
  task: TaskName,
): Result.Result<DryRun, TurboDryRunDrifted> => {
  const requested = document.tasks.filter((entry) => entry.taskId.endsWith(`#${task}`))
  const matrix = HashMap.fromIterable(
    requested.map((entry): readonly [string, string] => [
      entry.package,
      entry.hash,
    ]),
  )
  if (HashMap.size(matrix) !== requested.length) {
    return Result.fail(
      new TurboDryRunDrifted({
        context,
        reason: `turbo scheduled ${task} more than once for one package`,
      }),
    )
  }
  if (document.packages.length === 0) {
    return Result.fail(
      new TurboDryRunDrifted({
        context,
        reason: 'turbo enumerated no workspace packages',
      }),
    )
  }
  if (HashMap.isEmpty(matrix)) {
    return Result.fail(
      new TurboDryRunDrifted({
        context,
        reason: `${document.packages.length} package(s) enumerated but no #${task} task parsed`,
      }),
    )
  }
  return Result.succeed({ document })
}

const dryRunAt = (
  cwd: string,
  turbo: FetchedTurbo,
  task: TaskName,
): Effect.Effect<DryRun, EvidenceRefusal, Requirements> =>
  Effect.gen(function*() {
    const out = yield* runProcess({
      program: turbo.program,
      args: ['run', task, '--dry=json'],
      cwd,
      stdio: 'captured',
      env: TURBO_ENV,
    })
    if (out.code !== 0) {
      const tail = out.stderr.trim().split('\n').slice(-5).join('\n')
      return yield* Effect.fail(
        new EvidenceCommandFailed({
          program: `turbo (${turbo.key})`,
          detail: `dry run in ${cwd} failed:\n${tail}`,
        }),
      )
    }
    const document = yield* Effect.fromResult(decodeDryRun(out.stdout, cwd))
    return yield* Effect.fromResult(dryRunView(document, cwd, task))
  })

const inputPathOf = (directory: RelativePath | undefined, file: string): string => {
  if (directory === undefined || directory === '.' || directory === '') return file
  const parts: Array<string> = directory.split('/')
  for (const part of file.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  return parts.join('/')
}

const globalViewOf = (inputs: unknown): { readonly files: Record<string, string>; readonly other: string } => {
  const decoded = S.decodeUnknownOption(GlobalInputs)(inputs)
  if (Option.isNone(decoded)) return { files: {}, other: JSON.stringify(inputs ?? null) }
  const { files, ...other } = decoded.value
  return {
    files: Option.getOrElse(S.decodeUnknownOption(GlobalFiles)(files), () => ({})),
    other: JSON.stringify(other),
  }
}

const runOf = (run: DryRun): TurboRun => {
  const global = globalViewOf(run.document.globalCacheInputs)
  return {
    tasks: run.document.tasks.map((task) => ({
      taskId: task.taskId,
      package: task.package,
      hash: task.hash,
      dependencies: [...(task.dependencies ?? [])],
      inputs: Object.fromEntries(
        Object.entries(task.inputs ?? {}).map(([file, hash]) => [inputPathOf(task.directory, file), hash]),
      ),
      externalHash: task.hashOfExternalDependencies ?? '',
    })),
    globalFiles: global.files,
    globalOther: global.other,
  }
}

const comparisonAt = (
  root: RepoRoot,
  baseDir: string,
  task: TaskName,
  turbo: FetchedTurbo,
): Effect.Effect<TurboComparison, EvidenceRefusal, Requirements> =>
  Effect.map(
    Effect.all([dryRunAt(baseDir, turbo, task), dryRunAt(root, turbo, task)], { concurrency: 2 }),
    ([baseRun, headRun]): TurboComparison => ({ task, base: runOf(baseRun), head: runOf(headRun) }),
  )

export const compareTurboRuns = (
  root: RepoRoot,
  baseSha: string,
  task: TaskName,
  pin: TurboPin,
): Effect.Effect<TurboComparison, EvidenceRefusal, Requirements | HttpClient.HttpClient> =>
  Effect.scoped(Effect.gen(function*() {
    const turbo = yield* fetchTurbo(pin)
    const fs = yield* FileSystem.FileSystem
    const baseDir = yield* fs.makeTempDirectory({
      prefix: WORKTREE_PREFIX,
    }).pipe(
      Effect.mapError((error) =>
        new WorktreeUnavailable({
          detail: `cannot create a worktree directory: ${error.message}`,
        })
      ),
    )
    const added = yield* runProcess({
      program: 'git',
      args: ['worktree', 'add', '--detach', '--force', baseDir, baseSha],
      cwd: root,
      stdio: 'captured',
    })
    if (added.code !== 0) {
      yield* fs.remove(baseDir, { recursive: true }).pipe(Effect.ignore)
      return yield* Effect.fail(
        new WorktreeUnavailable({
          detail: `git worktree failed: ${added.stderr.trim()}`,
        }),
      )
    }
    return yield* Effect.ensuring(
      comparisonAt(root, baseDir, task, turbo),
      runProcess({
        program: 'git',
        args: ['worktree', 'remove', '--force', baseDir],
        cwd: root,
        stdio: 'captured',
      }).pipe(Effect.ignore),
    )
  }))
