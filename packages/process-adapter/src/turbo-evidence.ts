import {
  type ChangeEvidence,
  EvidenceCommandFailed,
  type EvidenceRefusal,
  type Member,
  type RelativePath,
  type RepoRoot,
  type TaskName,
  TurboDryRunDrifted,
  TurboDryRunUnreadable,
  TurboPinUnusable,
  WorktreeUnavailable,
} from '@systemfsoftware/release-language'
import { Effect, FileSystem } from 'effect'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner'
import { verdictTouched } from './change-verdict.js'
import { gitLines, MANIFEST_GLOB, MANIFEST_SUFFIX, memberOf, membersAt, readText } from './evidence-io.js'
import { runProcess } from './ProcessRun.js'
import { DryRunDocument } from './TurboDryRun.schema.js'

const TURBO_BIN = 'node_modules/.bin/turbo'
const WORKTREE_PREFIX = 'changeset-base-'

type Requirements = FileSystem.FileSystem | ChildProcessSpawner

interface DryRun {
  readonly document: DryRunDocument
  readonly matrix: HashMap.HashMap<string, string>
  readonly dirs: HashMap.HashMap<string, RelativePath>
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
  return Result.succeed({
    document,
    matrix,
    dirs: HashMap.fromIterable(
      requested.flatMap((entry) => {
        const directory = entry.directory
        if (directory === undefined) {
          return []
        }
        return [[entry.package, directory]]
      }),
    ),
  })
}

const dryRunAt = (
  cwd: string,
  root: RepoRoot,
  task: TaskName,
  pinned: string,
): Effect.Effect<DryRun, EvidenceRefusal, Requirements> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const turboBin = `${root}/${TURBO_BIN}`
    const installed = yield* fs.stat(turboBin).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )
    if (!installed) {
      return yield* Effect.fail(
        new TurboPinUnusable({
          detail: `turbo not present at ${turboBin} — run 'pnpm install --frozen-lockfile'`,
        }),
      )
    }
    const out = yield* runProcess({
      program: turboBin,
      args: ['run', task, '--dry=json'],
      cwd,
      stdio: 'captured',
    })
    if (out.code !== 0) {
      const tail = out.stderr.trim().split('\n').slice(-5).join('\n')
      return yield* Effect.fail(
        new EvidenceCommandFailed({
          program: turboBin,
          detail: `dry run in ${cwd} failed:\n${tail}`,
        }),
      )
    }
    const document = yield* Effect.fromResult(decodeDryRun(out.stdout, cwd))
    const run = yield* Effect.fromResult(dryRunView(document, cwd, task))
    if (
      run.document.turboVersion !== undefined &&
      run.document.turboVersion !== pinned
    ) {
      return yield* Effect.fail(
        new TurboPinUnusable({
          detail:
            `turbo in ${cwd} self-reports version ${run.document.turboVersion}, not the lockfile pin ${pinned} — run 'pnpm install --frozen-lockfile'`,
        }),
      )
    }
    return run
  })

const turboMembers = (
  root: RepoRoot,
  runs: ReadonlyArray<DryRun>,
): Effect.Effect<ReadonlyArray<Member>, EvidenceRefusal, Requirements> =>
  Effect.gen(function*() {
    let dirs = HashMap.empty<string, RelativePath>()
    for (const run of runs) {
      for (const [name, dir] of HashMap.toEntries(run.dirs)) {
        dirs = HashMap.set(dirs, name, dir)
      }
    }
    const turboNames = HashSet.fromIterable(
      runs.flatMap((run) => run.document.packages),
    )
    if ([...turboNames].some((name) => !HashMap.has(dirs, name))) {
      const found = yield* membersAt(
        root,
        yield* gitLines(root, MANIFEST_GLOB),
      )
      for (const member of found) {
        if (!HashSet.has(turboNames, member.name)) continue
        if (HashMap.has(dirs, member.name)) continue
        dirs = HashMap.set(dirs, member.name, member.dir)
      }
    }
    const members: Array<Member> = []
    for (const [, dir] of HashMap.toEntries(dirs)) {
      const member = memberOf(
        dir,
        yield* readText(`${root}/${dir}${MANIFEST_SUFFIX}`),
      )
      if (Option.isNone(member)) continue
      members.push(member.value)
    }
    return members
  })

const dryRunEvidence = (
  root: RepoRoot,
  baseDir: string,
  task: TaskName,
  pinned: string,
  changedFiles: ReadonlyArray<RelativePath>,
): Effect.Effect<ChangeEvidence, EvidenceRefusal, Requirements> =>
  Effect.gen(function*() {
    const [baseRun, headRun] = yield* Effect.all(
      [
        dryRunAt(baseDir, root, task, pinned),
        dryRunAt(root, root, task, pinned),
      ],
      { concurrency: 2 },
    )
    const members = yield* turboMembers(root, [baseRun, headRun])
    const evidence: ChangeEvidence = {
      members: [...members],
      touched: verdictTouched(
        baseRun.matrix,
        headRun.matrix,
        members,
        changedFiles,
      ),
      raw: {
        strategy: 'turbo',
        task,
        base: Object.fromEntries(HashMap.toEntries(baseRun.matrix)),
        head: Object.fromEntries(HashMap.toEntries(headRun.matrix)),
        engineVersion: headRun.document.turboVersion ?? null,
      },
    }
    return evidence
  })

export const collectTurboEvidence = (
  root: RepoRoot,
  baseSha: string,
  task: TaskName,
  pinned: string,
  changedFiles: ReadonlyArray<RelativePath>,
): Effect.Effect<ChangeEvidence, EvidenceRefusal, Requirements> =>
  Effect.gen(function*() {
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
      dryRunEvidence(root, baseDir, task, pinned, changedFiles),
      runProcess({
        program: 'git',
        args: ['worktree', 'remove', '--force', baseDir],
        cwd: root,
        stdio: 'captured',
      }).pipe(Effect.ignore),
    )
  })
