import { NodeServices } from '@effect/platform-node'
import {
  type ChangeEvidence,
  ChangeEvidencePort,
  GitPort,
  type Member,
  PackageManifest,
  type PackageName,
  RelativePath,
  type RepoRoot,
  type TaskName,
} from '@systemfsoftware/release-language'
import { Effect, FileSystem, Layer } from 'effect'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Yaml } from 'effect/unstable/encoding'
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner'
import {
  EvidenceCommandFailed,
  EvidenceFileUnreadable,
  InstalledTurbo,
  PnpmLockfile,
  TurboPinUnusable,
  WorktreeUnavailable,
} from './ChangeEvidence.schema.js'
import { type ProcessFault } from './Process.schema.js'
import { runProcess } from './ProcessRun.js'
import { decodeDryRun, dryRunView } from './TurboDryRun.js'
import { type DryRun, type TurboDryRunFault } from './TurboDryRun.schema.js'

const MANIFEST_SUFFIX = '/package.json'
const LOCKFILE = 'pnpm-lock.yaml'
const TURBO_MANIFEST = 'node_modules/turbo/package.json'
const TURBO_BIN = 'node_modules/.bin/turbo'
const WORKTREE_PREFIX = 'changeset-base-'

type EvidenceFault =
  | EvidenceFileUnreadable
  | EvidenceCommandFailed
  | TurboPinUnusable
  | WorktreeUnavailable
  | ProcessFault
  | TurboDryRunFault

type Requirements = FileSystem.FileSystem | ChildProcessSpawner

const probeMember = (
  manifestPath: string,
  manifestText: string,
): Option.Option<Member> =>
  Option.flatMap(
    Option.getSuccess(
      S.decodeResult(S.fromJsonString(PackageManifest))(manifestText),
    ),
    (manifest) =>
      Option.map(
        Option.getSuccess(
          S.decodeResult(RelativePath)(
            manifestPath.slice(0, -MANIFEST_SUFFIX.length),
          ),
        ),
        (dir): Member => ({
          name: manifest.name,
          dir,
          manifest,
          publishable: manifest.private !== true,
        }),
      ),
  )

const memberOwning = (
  file: RelativePath,
  members: ReadonlyArray<Member>,
): Option.Option<Member> => {
  const owner = members.find(({ dir }) => file === `${dir}${MANIFEST_SUFFIX}` || file.startsWith(`${dir}/`))
  if (owner === undefined) {
    return Option.none()
  }
  return Option.some(owner)
}

const readText = (
  path: string,
): Effect.Effect<string, EvidenceFileUnreadable, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    return yield* fs
      .readFileString(path)
      .pipe(Effect.mapError(() => new EvidenceFileUnreadable({ path })))
  })

const readMember = (
  root: RepoRoot,
  manifestPath: string,
): Effect.Effect<
  Option.Option<Member>,
  EvidenceFileUnreadable,
  FileSystem.FileSystem
> =>
  Effect.gen(function*() {
    const text = yield* readText(`${root}/${manifestPath}`)
    return probeMember(manifestPath, text)
  })

const gitLines = (
  args: ReadonlyArray<string>,
  cwd: string,
): Effect.Effect<
  ReadonlyArray<string>,
  ProcessFault | EvidenceCommandFailed,
  ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const out = yield* runProcess({
      program: 'git',
      args,
      cwd,
      stdio: 'captured',
    })
    if (out.code !== 0) {
      return yield* Effect.fail(
        new EvidenceCommandFailed({
          program: 'git',
          detail: `git ${args.join(' ')} failed: ${out.stderr.trim()}`,
        }),
      )
    }
    return out.stdout.split('\n').filter((line) => line.length > 0)
  })

const listManifestPaths = (
  root: RepoRoot,
): Effect.Effect<ReadonlyArray<string>, EvidenceFault, ChildProcessSpawner> =>
  gitLines(['ls-files', '*package.json', ':(exclude)repos/**'], root)

const allMembers = (
  root: RepoRoot,
): Effect.Effect<ReadonlyArray<Member>, EvidenceFault, Requirements> =>
  Effect.gen(function*() {
    const paths = yield* listManifestPaths(root)
    const found = yield* Effect.forEach(paths, (manifestPath) => readMember(root, manifestPath))
    return found.flatMap((member) => Option.toArray(member))
  })

const pathsTouched = (
  members: ReadonlyArray<Member>,
  changedFiles: ReadonlyArray<RelativePath>,
): ReadonlyArray<PackageName> => {
  const touched = changedFiles.flatMap((file) =>
    Option.toArray(memberOwning(file, members)).flatMap((member) => {
      if (!member.publishable) {
        return []
      }
      return [member.name]
    })
  )
  return [...HashSet.fromIterable(touched)].sort()
}

const hashMoved = (
  base: HashMap.HashMap<string, string>,
  head: HashMap.HashMap<string, string>,
  name: PackageName,
): boolean =>
  Option.match(HashMap.get(head, name), {
    onNone: () => false,
    onSome: (atHead) =>
      Option.match(HashMap.get(base, name), {
        onNone: () => true,
        onSome: (atBase) => atBase !== atHead,
      }),
  })

const verdictTouched = (
  base: HashMap.HashMap<string, string>,
  head: HashMap.HashMap<string, string>,
  members: ReadonlyArray<Member>,
  changedFiles: ReadonlyArray<RelativePath>,
): ReadonlyArray<PackageName> => {
  const moved = members.filter((member) => member.publishable).flatMap(
    (member) => {
      if (hashMoved(base, head, member.name)) {
        return [member.name]
      }
      if (HashMap.has(base, member.name) || HashMap.has(head, member.name)) {
        return []
      }
      if (
        !changedFiles.some((file) => Option.isSome(memberOwning(file, [member])))
      ) {
        return []
      }
      return [member.name]
    },
  )
  return [...HashSet.fromIterable(moved)].sort()
}

const pinFromLockfile = (
  lockfileText: string,
  context: string,
): Result.Result<string, TurboPinUnusable> => {
  const decoded = S.decodeUnknownResult(PnpmLockfile)(Yaml.parse(lockfileText))
  if (Result.isFailure(decoded)) {
    return Result.fail(
      new TurboPinUnusable({
        detail: `${context}: ${LOCKFILE} is not the lockfileVersion 9.0 document the turbo pin is read from`,
      }),
    )
  }
  const rootImporter = decoded.success.importers['.']
  if (rootImporter === undefined) {
    return Result.fail(
      new TurboPinUnusable({
        detail: `${context}: ${LOCKFILE} declares no root importer`,
      }),
    )
  }
  const entry = rootImporter.devDependencies?.['turbo']
  if (entry === undefined) {
    return Result.fail(
      new TurboPinUnusable({
        detail: `${context}: no 'turbo' devDependency in the root importer of ${LOCKFILE}`,
      }),
    )
  }
  return Result.succeed(entry.version)
}

const turboPin = (
  root: RepoRoot,
  context: string,
): Effect.Effect<string, EvidenceFault, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const lockfile = yield* readText(`${root}/${LOCKFILE}`)
    const pinned = yield* Effect.fromResult(
      pinFromLockfile(lockfile, context),
    )
    const fs = yield* FileSystem.FileSystem
    const resolved = yield* fs
      .readFileString(`${root}/${TURBO_MANIFEST}`)
      .pipe(Effect.orElseSucceed(() => '{}'))
    const installed = yield* Effect.mapError(
      Effect.fromResult(
        S.decodeUnknownResult(S.fromJsonString(InstalledTurbo))(resolved),
      ),
      () =>
        new TurboPinUnusable({
          detail: `${context}: ${TURBO_MANIFEST} is not parseable JSON`,
        }),
    )
    if (installed.version === pinned) {
      return pinned
    }
    return yield* Effect.fail(
      new TurboPinUnusable({
        detail:
          `${context}: installed turbo ${installed.version} does not match the lockfile pin ${pinned} — run 'pnpm install --frozen-lockfile'`,
      }),
    )
  })

const dryRunAt = (
  cwd: string,
  root: RepoRoot,
  task: TaskName,
  pinned: string,
): Effect.Effect<DryRun, EvidenceFault, Requirements> =>
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
    if (run.engineVersion !== null && run.engineVersion !== pinned) {
      return yield* Effect.fail(
        new TurboPinUnusable({
          detail:
            `turbo in ${cwd} self-reports version ${run.engineVersion}, not the lockfile pin ${pinned} — run 'pnpm install --frozen-lockfile'`,
        }),
      )
    }
    return run
  })

const turboMembers = (
  root: RepoRoot,
  runs: ReadonlyArray<DryRun>,
): Effect.Effect<ReadonlyArray<Member>, EvidenceFault, Requirements> =>
  Effect.gen(function*() {
    let dirs = HashMap.empty<string, RelativePath>()
    for (const run of runs) {
      for (const [name, dir] of HashMap.toEntries(run.dirs)) {
        dirs = HashMap.set(dirs, name, dir)
      }
    }
    const turboNames = HashSet.fromIterable(
      runs.flatMap((run) => run.packages),
    )
    if ([...turboNames].some((name) => !HashMap.has(dirs, name))) {
      const found = yield* Effect.forEach(
        yield* listManifestPaths(root),
        (manifestPath) => readMember(root, manifestPath),
      )
      for (const member of found.flatMap((found) => Option.toArray(found))) {
        if (!HashSet.has(turboNames, member.name)) {
          continue
        }
        if (HashMap.has(dirs, member.name)) {
          continue
        }
        dirs = HashMap.set(dirs, member.name, member.dir)
      }
    }
    const members: Array<Member> = []
    for (const [name, dir] of HashMap.toEntries(dirs)) {
      const member = probeMember(
        `${dir}${MANIFEST_SUFFIX}`,
        yield* readText(`${root}/${dir}${MANIFEST_SUFFIX}`),
      )
      if (Option.isNone(member)) {
        continue
      }
      const canonical = HashMap.get(dirs, name)
      if (Option.isNone(canonical)) {
        continue
      }
      if (canonical.value !== member.value.dir) {
        continue
      }
      members.push(member.value)
    }
    return members
  })

const collectTurboEvidence = (
  root: RepoRoot,
  baseDir: string,
  baseSha: string,
  task: TaskName,
  pinned: string,
  changedFiles: ReadonlyArray<RelativePath>,
): Effect.Effect<ChangeEvidence, EvidenceFault, Requirements> =>
  Effect.gen(function*() {
    const added = yield* runProcess({
      program: 'git',
      args: ['worktree', 'add', '--detach', '--force', baseDir, baseSha],
      cwd: root,
      stdio: 'captured',
    })
    if (added.code !== 0) {
      const fs = yield* FileSystem.FileSystem
      yield* fs.remove(baseDir, { recursive: true }).pipe(Effect.ignore)
      return yield* Effect.fail(
        new WorktreeUnavailable({
          detail: `git worktree failed: ${added.stderr.trim()}`,
        }),
      )
    }
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
        engineVersion: headRun.engineVersion,
      },
    }
    return evidence
  })

const ChangeEvidenceInner: Layer.Layer<ChangeEvidencePort, never, GitPort> = Layer
  .effect(
    ChangeEvidencePort,
    Effect.gen(function*() {
      const git = yield* GitPort
      const pathsEvidence: ChangeEvidencePort['pathsEvidence'] = (root, ref) =>
        Effect.gen(function*() {
          const head = yield* git.currentBranch().pipe(Effect.orDie)
          const changed = yield* git.changedPaths(ref, head).pipe(Effect.orDie)
          const members = yield* allMembers(root)
          const evidence: ChangeEvidence = {
            members: [...members],
            touched: pathsTouched(members, changed),
            raw: { strategy: 'paths', base: ref, changedPaths: [...changed] },
          }
          return evidence
        }).pipe(Effect.orDie, Effect.provide(NodeServices.layer))
      const turboEvidence: ChangeEvidencePort['turboEvidence'] = (
        root,
        ref,
        task,
      ) =>
        Effect.gen(function*() {
          const head = yield* git.currentBranch().pipe(Effect.orDie)
          const pinned = yield* turboPin(root, 'change-evidence')
          const parsed = yield* gitLines(
            ['rev-parse', '--verify', `${ref}^{commit}`],
            root,
          )
          const baseSha = parsed[0]
          if (baseSha === undefined) {
            return yield* Effect.fail(
              new EvidenceCommandFailed({
                program: 'git',
                detail: `git rev-parse printed no sha for ${ref}`,
              }),
            )
          }
          const changed = yield* git.changedPaths(ref, head).pipe(Effect.orDie)
          const fs = yield* FileSystem.FileSystem
          const baseDir = yield* fs.makeTempDirectory({
            prefix: WORKTREE_PREFIX,
          })
          return yield* Effect.ensuring(
            collectTurboEvidence(root, baseDir, baseSha, task, pinned, changed),
            runProcess({
              program: 'git',
              args: ['worktree', 'remove', '--force', baseDir],
              cwd: root,
              stdio: 'captured',
            }).pipe(Effect.ignore),
          )
        }).pipe(Effect.orDie, Effect.provide(NodeServices.layer))
      return { pathsEvidence, turboEvidence }
    }),
  )

export const ChangeEvidenceLive: Layer.Layer<ChangeEvidencePort, never, GitPort> = ChangeEvidenceInner.pipe(
  Layer.provide(NodeServices.layer),
)
