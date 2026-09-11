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
import * as HashSet from 'effect/HashSet'
import type { PlatformError } from 'effect/PlatformError'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { ChildProcess } from 'effect/unstable/process'
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner'
import { DryRunDocument } from './TurboDryRun.schema.js'

const MANIFEST_SUFFIX = '/package.json'
const LOCKFILE = 'pnpm-lock.yaml'
const TURBO_MANIFEST = 'node_modules/turbo/package.json'
const TURBO_BIN = 'node_modules/.bin/turbo'
const WORKTREE_PREFIX = 'changeset-base-'

const describeCause = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message
  }
  if (typeof cause === 'string') {
    return cause
  }
  return 'unknown error'
}

type CommandOutput = {
  readonly success: boolean
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

const capture = (
  program: string,
  args: ReadonlyArray<string>,
  cwd: string,
): Effect.Effect<CommandOutput, Error, ChildProcessSpawner> =>
  Effect.scoped(
    Effect.gen(function*() {
      const start = (cause: unknown): Error =>
        new Error(`${program} ${args.join(' ')} failed to start: ${describeCause(cause)}`)
      const handle = yield* ChildProcess.make(program, [...args], {
        cwd,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      }).pipe(Effect.mapError(start))
      const collect = (
        stream: Stream.Stream<Uint8Array, PlatformError>,
      ): Effect.Effect<string, Error> => stream.pipe(Stream.decodeText, Stream.mkString, Effect.mapError(start))
      const [stdout, stderr, code] = yield* Effect.all(
        [collect(handle.stdout), collect(handle.stderr), handle.exitCode],
        { concurrency: 3 },
      ).pipe(Effect.mapError(start))
      return {
        success: code === 0,
        code,
        stdout,
        stderr,
      }
    }),
  )

const readFile = (path: string): Effect.Effect<string, Error, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFileString(path).pipe(
      Effect.mapError((cause) => new Error(`cannot read ${path}: ${describeCause(cause)}`)),
    )
  })

const gitLines = (
  args: ReadonlyArray<string>,
  cwd: string,
): Effect.Effect<ReadonlyArray<string>, Error, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const out = yield* capture('git', args, cwd)
    if (!out.success) {
      return yield* Effect.fail(new Error(`git ${args[0]} failed: ${out.stderr.trim()}`))
    }
    return out.stdout.split('\n').filter((line) => line.length > 0)
  })

const memberOwning = (
  file: string,
  members: ReadonlyArray<Member>,
): Member | null => members.find(({ dir }) => file === `${dir}${MANIFEST_SUFFIX}` || file.startsWith(`${dir}/`)) ?? null

const probeMember = (manifestPath: string, manifestText: string): Member | null => {
  let json: unknown
  try {
    json = JSON.parse(manifestText)
  } catch {
    return null
  }
  const decoded = S.decodeUnknownResult(PackageManifest)(json)
  if (Result.isFailure(decoded)) return null
  const dir = manifestPath.slice(0, -MANIFEST_SUFFIX.length)
  const decodedDir = S.decodeUnknownResult(RelativePath)(dir)
  if (Result.isFailure(decodedDir)) return null
  return {
    name: decoded.success.name,
    dir: decodedDir.success,
    manifest: decoded.success,
    publishable: decoded.success.private !== true,
  }
}

type DryRun = {
  readonly packages: ReadonlyArray<string>
  readonly matrix: Record<string, string>
  readonly dirs: Record<string, string>
  readonly engineVersion: string | null
}

const parseDryRunDocument = (
  stdout: string,
  context: string,
  task: TaskName,
): DryRunDocument => {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error(`unparsable ${context} output — expected JSON from 'turbo run ${task} --dry=json'`)
  }
  const decoded = S.decodeUnknownResult(DryRunDocument)(parsed)
  if (Result.isFailure(decoded)) {
    throw new Error(`${context} output missing the packages/tasks arrays — is this turbo's dry-run JSON?`)
  }
  return decoded.success
}

const taskIdEnding = (entry: object, suffix: string): string | null => {
  if (!('taskId' in entry)) return null
  const taskId: unknown = entry.taskId
  if (typeof taskId !== 'string' || !taskId.endsWith(suffix)) return null
  return taskId
}

const entryName = (entry: object, context: string, task: TaskName): string => {
  if (!('package' in entry)) {
    throw new Error(`${context} output: a ${task} task without a package name`)
  }
  const name: unknown = entry.package
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`${context} output: a ${task} task without a package name`)
  }
  return name
}

const entryHash = (entry: object, context: string, task: TaskName, name: string, suffix: string): string => {
  if (!('hash' in entry)) {
    throw new Error(`${context} output: ${name}${suffix} has no hash`)
  }
  const hash: unknown = entry.hash
  if (typeof hash !== 'string' || hash.length === 0) {
    throw new Error(`${context} output: ${name}${suffix} has no hash`)
  }
  return hash
}

const entryDir = (entry: object): string | null => {
  if (!('directory' in entry)) return null
  const directory: unknown = entry.directory
  if (typeof directory !== 'string' || directory.length === 0) return null
  return directory
}

const collectDryRunTask = (
  entry: unknown,
  suffix: string,
  context: string,
  task: TaskName,
  matrix: Record<string, string>,
  dirs: Record<string, string>,
): void => {
  if (typeof entry !== 'object' || entry === null) return
  if (taskIdEnding(entry, suffix) === null) return
  const name = entryName(entry, context, task)
  const hash = entryHash(entry, context, task, name, suffix)
  if (Object.hasOwn(matrix, name)) throw new Error(`${context} output: duplicate task for ${name}`)
  matrix[name] = hash
  const directory = entryDir(entry)
  if (directory !== null) dirs[name] = directory
}

const parseDryRunTasks = (
  tasks: unknown,
  suffix: string,
  context: string,
  task: TaskName,
): { readonly matrix: Record<string, string>; readonly dirs: Record<string, string> } => {
  if (!Array.isArray(tasks)) {
    throw new Error(`${context} output missing the packages/tasks arrays — is this turbo's dry-run JSON?`)
  }
  const entries: ReadonlyArray<unknown> = tasks
  const matrix: Record<string, string> = {}
  const dirs: Record<string, string> = {}
  for (const entry of entries) collectDryRunTask(entry, suffix, context, task, matrix, dirs)
  return { matrix, dirs }
}

const parseDryRunOutput = (stdout: string, context: string, task: TaskName): DryRun => {
  const suffix = `#${task}`
  const doc = parseDryRunDocument(stdout, context, task)
  if (!Array.isArray(doc.packages)) {
    throw new Error(`${context} output missing the packages/tasks arrays — is this turbo's dry-run JSON?`)
  }
  const { matrix, dirs } = parseDryRunTasks(doc.tasks, suffix, context, task)
  if (doc.packages.length > 0 && Object.keys(matrix).length === 0) {
    throw new Error(
      `${context} output: ${doc.packages.length} package(s) enumerated but no ${suffix} task parsed — turbo's task format drifted`,
    )
  }
  let engineVersion: string | null = null
  if (typeof doc.turboVersion === 'string') {
    engineVersion = doc.turboVersion
  }
  return {
    packages: doc.packages,
    matrix,
    dirs,
    engineVersion,
  }
}

const engineSelfReportMatches = (run: DryRun, pinned: string): boolean =>
  run.engineVersion === null || run.engineVersion === pinned

const lockfileIsV9 = (lockfile: string): boolean => /^lockfileVersion:\s*['"]?9\.0['"]?\s*$/m.test(lockfile)

const lockfileTurboEntry = (lockfile: string): { readonly specifier: string; readonly version: string } | null => {
  const importers = lockfile.slice(lockfile.indexOf('\nimporters:'))
  if (importers.length === 0) return null
  const rootStart = importers.indexOf('\n  .:')
  if (rootStart === -1) return null
  const root = importers.slice(rootStart + 1)
  const nextRoot = root.search(/^\n[ ]{2}(?!\.)/m)
  let end = root.length
  if (nextRoot !== -1) {
    end = nextRoot
  }
  const block = `${root.slice(0, end)}\n`
  const match = /^ {6}turbo:\n {8}specifier: (\S+)\n {8}version: ([^\s'\n]+)/m.exec(block)
  if (match === null) return null
  const specifier = match[1]
  const version = match[2]
  if (specifier === undefined || version === undefined) return null
  return { specifier, version }
}

const assertTurboPin = (
  lockfile: string,
  resolvedTurboPackageJson: string,
  context: string,
): string => {
  if (!lockfileIsV9(lockfile)) {
    throw new Error(`${context}: ${LOCKFILE} is not lockfileVersion 9.0 — the pin parser is schema-bound`)
  }
  const pinned = lockfileTurboEntry(lockfile)
  if (pinned === null) {
    throw new Error(`${context}: no 'turbo' devDependency in the root importer of ${LOCKFILE}`)
  }
  let resolved: { readonly version?: unknown } = {}
  try {
    const raw: unknown = JSON.parse(resolvedTurboPackageJson)
    if (typeof raw === 'object' && raw !== null && 'version' in raw) {
      resolved = { version: raw.version }
    }
  } catch {
    throw new Error(`${context}: ${TURBO_MANIFEST} is not parseable JSON`)
  }
  if (resolved.version !== pinned.version) {
    throw new Error(
      `${context}: installed turbo ${String(resolved.version)} does not match the lockfile pin ${pinned.version} — ` +
        `run 'pnpm install --frozen-lockfile'`,
    )
  }
  return pinned.version
}

const liveTurboPin = (root: RepoRoot): Effect.Effect<string, Error, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const lockfile = yield* readFile(`${root}/${LOCKFILE}`)
    const fs = yield* FileSystem.FileSystem
    const resolvedTurbo = yield* fs.readFileString(`${root}/${TURBO_MANIFEST}`).pipe(
      Effect.orElseSucceed(() => '{}'),
    )
    try {
      return assertTurboPin(lockfile, resolvedTurbo, 'change-evidence')
    } catch (cause) {
      if (cause instanceof Error) return yield* Effect.fail(cause)
      return yield* Effect.die(cause)
    }
  })

const dryRunAt = (
  cwd: string,
  root: RepoRoot,
  task: TaskName,
  pinned: string,
): Effect.Effect<DryRun, Error, FileSystem.FileSystem | ChildProcessSpawner> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const turboBin = `${root}/${TURBO_BIN}`
    const installed = yield* fs.stat(turboBin).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )
    if (!installed) {
      return yield* Effect.fail(
        new Error(
          `turbo not present at ${turboBin} — run 'pnpm install --frozen-lockfile' (the gate runs the lockfile-installed binary, nothing else)`,
        ),
      )
    }
    const out = yield* capture(turboBin, ['run', task, '--dry=json'], cwd)
    if (!out.success) {
      const tail = out.stderr.trim().split('\n').slice(-5).join('\n')
      return yield* Effect.fail(new Error(`turbo dry run failed in ${cwd}:\n${tail}`))
    }
    let run: DryRun
    try {
      run = parseDryRunOutput(out.stdout, cwd, task)
    } catch (cause) {
      if (cause instanceof Error) return yield* Effect.fail(cause)
      return yield* Effect.die(cause)
    }
    if (!engineSelfReportMatches(run, pinned)) {
      return yield* Effect.fail(
        new Error(
          `turbo in ${cwd} self-reports version ${run.engineVersion}, not the lockfile pin ${pinned} — run 'pnpm install --frozen-lockfile'`,
        ),
      )
    }
    return run
  })

const listManifestPaths = (root: RepoRoot): Effect.Effect<ReadonlyArray<string>, Error, ChildProcessSpawner> =>
  gitLines(['ls-files', '*package.json', ':(exclude)repos/**'], root)

const allMembers = (
  root: RepoRoot,
): Effect.Effect<ReadonlyArray<Member>, Error, FileSystem.FileSystem | ChildProcessSpawner> =>
  Effect.gen(function*() {
    const paths = yield* listManifestPaths(root)
    const members: Array<Member> = []
    for (const manifestPath of paths) {
      const member = probeMember(manifestPath, yield* readFile(`${root}/${manifestPath}`))
      if (member !== null) members.push(member)
    }
    return members
  })

const turboMembers = (
  root: RepoRoot,
  runs: ReadonlyArray<DryRun>,
): Effect.Effect<ReadonlyArray<Member>, Error, FileSystem.FileSystem | ChildProcessSpawner> =>
  Effect.gen(function*() {
    const dirs: Record<string, string> = {}
    for (const run of runs) {
      for (const [name, dir] of Object.entries(run.dirs)) dirs[name] = dir
    }
    const turboNames = HashSet.fromIterable(runs.flatMap((run) => run.packages))
    if ([...turboNames].some((name) => !Object.hasOwn(dirs, name))) {
      const manifestPaths = yield* listManifestPaths(root)
      for (const manifestPath of manifestPaths) {
        const member = probeMember(manifestPath, yield* readFile(`${root}/${manifestPath}`))
        if (member === null || !HashSet.has(turboNames, member.name) || Object.hasOwn(dirs, member.name)) continue
        dirs[member.name] = member.dir
      }
    }
    const members: Array<Member> = []
    for (const dir of Object.values(dirs)) {
      const member = probeMember(`${dir}${MANIFEST_SUFFIX}`, yield* readFile(`${root}/${dir}${MANIFEST_SUFFIX}`))
      if (member === null || dirs[member.name] !== member.dir) continue
      members.push(member)
    }
    return members
  })

const pathsTouched = (
  members: ReadonlyArray<Member>,
  changedFiles: ReadonlyArray<RelativePath>,
): ReadonlyArray<PackageName> => {
  let touched = HashSet.empty<PackageName>()
  for (const file of changedFiles) {
    const owner = memberOwning(file, members)
    if (owner !== null && owner.publishable) touched = HashSet.add(touched, owner.name)
  }
  return [...touched].sort()
}

const verdictTouched = (
  base: Record<string, string>,
  head: Record<string, string>,
  members: ReadonlyArray<Member>,
  changedFiles: ReadonlyArray<RelativePath>,
): ReadonlyArray<PackageName> => {
  let touched = HashSet.empty<PackageName>()
  for (const member of members) {
    if (!member.publishable) continue
    let atBase: string | undefined
    if (Object.hasOwn(base, member.name)) {
      atBase = base[member.name]
    } else {
      atBase = undefined
    }
    let atHead: string | undefined
    if (Object.hasOwn(head, member.name)) {
      atHead = head[member.name]
    } else {
      atHead = undefined
    }
    if (atHead === undefined) continue
    if (atBase === undefined || atBase !== atHead) touched = HashSet.add(touched, member.name)
  }
  for (const member of members) {
    if (!member.publishable) continue
    if (Object.hasOwn(base, member.name) || Object.hasOwn(head, member.name)) continue
    if (changedFiles.some((file) => memberOwning(file, [member]) !== null)) touched = HashSet.add(touched, member.name)
  }
  return [...touched].sort()
}

const collectTurboEvidence = (
  root: RepoRoot,
  baseDir: string,
  baseSha: string,
  task: TaskName,
  pinned: string,
  changedFiles: ReadonlyArray<RelativePath>,
): Effect.Effect<ChangeEvidence, Error, FileSystem.FileSystem | ChildProcessSpawner> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const added = yield* capture('git', ['worktree', 'add', '--detach', '--force', baseDir, baseSha], root)
    if (!added.success) {
      yield* fs.remove(baseDir, { recursive: true }).pipe(Effect.ignore)
      return yield* Effect.fail(new Error(`git worktree failed: ${added.stderr.trim()}`))
    }
    const [baseRun, headRun] = yield* Effect.all(
      [dryRunAt(baseDir, root, task, pinned), dryRunAt(root, root, task, pinned)],
      { concurrency: 2 },
    )
    const sides: ReadonlyArray<readonly [string, DryRun]> = [['base', baseRun], ['head', headRun]]
    for (const [side, run] of sides) {
      if (run.packages.length === 0) {
        return yield* Effect.die(
          new Error(`turbo enumerated no workspace packages in the ${side} run — refusing the empty verdict`),
        )
      }
    }
    const members = yield* turboMembers(root, [baseRun, headRun])
    const evidence: ChangeEvidence = {
      members: [...members],
      touched: verdictTouched(baseRun.matrix, headRun.matrix, members, changedFiles),
      raw: {
        strategy: 'turbo',
        task,
        base: baseRun.matrix,
        head: headRun.matrix,
        engineVersion: headRun.engineVersion,
      },
    }
    return evidence
  })

const ChangeEvidenceInner: Layer.Layer<ChangeEvidencePort, never, GitPort> = Layer.effect(
  ChangeEvidencePort,
  Effect.gen(function*() {
    const git = yield* GitPort
    const pathsEvidence: ChangeEvidencePort['pathsEvidence'] = (root, ref) =>
      Effect.gen(function*() {
        const head = yield* git.currentBranch().pipe(Effect.orDie)
        const changed = yield* git.changedPaths(ref, head)
        const members = yield* allMembers(root).pipe(Effect.orDie)
        const evidence: ChangeEvidence = {
          members: [...members],
          touched: pathsTouched(members, changed),
          raw: { strategy: 'paths', base: ref, changedPaths: [...changed] },
        }
        return evidence
      }).pipe(Effect.provide(NodeServices.layer))
    const turboEvidence: ChangeEvidencePort['turboEvidence'] = (root, ref, task) =>
      Effect.gen(function*() {
        const head = yield* git.currentBranch().pipe(Effect.orDie)
        const pinned = yield* liveTurboPin(root).pipe(Effect.orDie)
        const parsed = yield* gitLines(['rev-parse', '--verify', `${ref}^{commit}`], root).pipe(Effect.orDie)
        const baseSha = parsed[0]
        if (baseSha === undefined) return yield* Effect.die(new Error(`git rev-parse returned no sha for ${ref}`))
        const changed = yield* git.changedPaths(ref, head)
        const fs = yield* FileSystem.FileSystem
        const baseDir = yield* fs.makeTempDirectory({ prefix: WORKTREE_PREFIX }).pipe(
          Effect.mapError((cause) => new Error(`cannot create a base worktree directory: ${describeCause(cause)}`)),
          Effect.orDie,
        )
        return yield* Effect.ensuring(
          collectTurboEvidence(root, baseDir, baseSha, task, pinned, changed).pipe(Effect.orDie),
          Effect.asVoid(Effect.option(gitLines(['worktree', 'remove', '--force', baseDir], root))),
        )
      }).pipe(Effect.provide(NodeServices.layer))
    return { pathsEvidence, turboEvidence }
  }),
)

export const ChangeEvidenceLive: Layer.Layer<ChangeEvidencePort, never, GitPort> = ChangeEvidenceInner.pipe(
  Layer.provide(NodeServices.layer),
)
