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
import { Effect, Layer } from 'effect'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const MANIFEST_SUFFIX = '/package.json'
const LOCKFILE = 'pnpm-lock.yaml'
const TURBO_MANIFEST = 'node_modules/turbo/package.json'
const TURBO_BIN = 'node_modules/.bin/turbo'
const WORKTREE_PREFIX = 'changeset-base-'

const decoder = new TextDecoder()

const describeCause = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

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
): Effect.Effect<CommandOutput, Error> =>
  Effect.tryPromise({
    try: async (): Promise<CommandOutput> => {
      const out = await new Deno.Command(program, {
        args: [...args],
        cwd,
        stdout: 'piped',
        stderr: 'piped',
      }).output()
      return {
        success: out.success,
        code: out.code,
        stdout: decoder.decode(out.stdout),
        stderr: decoder.decode(out.stderr),
      }
    },
    catch: (cause) => new Error(`${program} ${args.join(' ')} failed to start: ${describeCause(cause)}`),
  })

const readFile = (path: string): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: () => Deno.readTextFile(path),
    catch: (cause) => new Error(`cannot read ${path}: ${describeCause(cause)}`),
  })

const gitLines = (
  args: ReadonlyArray<string>,
  cwd: string,
): Effect.Effect<ReadonlyArray<string>, Error> =>
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

const parseDryRunOutput = (stdout: string, context: string, task: TaskName): DryRun => {
  const suffix = `#${task}`
  let doc: { readonly packages?: unknown; readonly tasks?: unknown; readonly turboVersion?: unknown }
  try {
    doc = JSON.parse(stdout)
  } catch {
    throw new Error(`unparsable ${context} output — expected JSON from 'turbo run ${task} --dry=json'`)
  }
  if (!Array.isArray(doc.packages) || !Array.isArray(doc.tasks)) {
    throw new Error(`${context} output missing the packages/tasks arrays — is this turbo's dry-run JSON?`)
  }
  const matrix: Record<string, string> = {}
  const dirs: Record<string, string> = {}
  for (const entry of doc.tasks) {
    if (typeof entry !== 'object' || entry === null) continue
    if (!('taskId' in entry)) continue
    const taskId: unknown = entry.taskId
    if (typeof taskId !== 'string' || !taskId.endsWith(suffix)) continue
    const name: unknown = 'package' in entry ? entry.package : undefined
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`${context} output: a ${task} task without a package name`)
    }
    const hash: unknown = 'hash' in entry ? entry.hash : undefined
    if (typeof hash !== 'string' || hash.length === 0) {
      throw new Error(`${context} output: ${name}${suffix} has no hash`)
    }
    if (Object.hasOwn(matrix, name)) throw new Error(`${context} output: duplicate task for ${name}`)
    matrix[name] = hash
    const directory: unknown = 'directory' in entry ? entry.directory : undefined
    if (typeof directory === 'string' && directory.length > 0) dirs[name] = directory
  }
  if (doc.packages.length > 0 && Object.keys(matrix).length === 0) {
    throw new Error(
      `${context} output: ${doc.packages.length} package(s) enumerated but no ${suffix} task parsed — turbo's task format drifted`,
    )
  }
  return {
    packages: doc.packages,
    matrix,
    dirs,
    engineVersion: typeof doc.turboVersion === 'string' ? doc.turboVersion : null,
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
  const block = (nextRoot === -1 ? root : root.slice(0, nextRoot)) + '\n'
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
  let resolved: { readonly version?: unknown }
  try {
    resolved = JSON.parse(resolvedTurboPackageJson)
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

const liveTurboPin = (root: RepoRoot): Effect.Effect<string, Error> =>
  Effect.gen(function*() {
    const lockfile = yield* readFile(`${root}/${LOCKFILE}`)
    const resolvedTurbo = yield* Effect.tryPromise({
      try: () => Deno.readTextFile(`${root}/${TURBO_MANIFEST}`).catch(() => '{}'),
      catch: (cause) => new Error(`cannot read ${root}/${TURBO_MANIFEST}: ${describeCause(cause)}`),
    })
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
): Effect.Effect<DryRun, Error> =>
  Effect.gen(function*() {
    const turboBin = `${root}/${TURBO_BIN}`
    const installed = yield* Effect.tryPromise({
      try: () => Deno.lstat(turboBin).then(() => true).catch(() => false),
      catch: (cause) => new Error(`cannot stat ${turboBin}: ${describeCause(cause)}`),
    })
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

const listManifestPaths = (root: RepoRoot): Effect.Effect<ReadonlyArray<string>, Error> =>
  gitLines(['ls-files', '*package.json', ':(exclude)repos/**'], root)

const allMembers = (root: RepoRoot): Effect.Effect<ReadonlyArray<Member>, Error> =>
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
): Effect.Effect<ReadonlyArray<Member>, Error> =>
  Effect.gen(function*() {
    const dirs = new Map<string, string>()
    for (const run of runs) {
      for (const [name, dir] of Object.entries(run.dirs)) dirs.set(name, dir)
    }
    const turboNames = new Set(runs.flatMap((run) => run.packages))
    if ([...turboNames].some((name) => !dirs.has(name))) {
      const manifestPaths = yield* listManifestPaths(root)
      for (const manifestPath of manifestPaths) {
        const member = probeMember(manifestPath, yield* readFile(`${root}/${manifestPath}`))
        if (member === null || !turboNames.has(member.name) || dirs.has(member.name)) continue
        dirs.set(member.name, member.dir)
      }
    }
    const members: Array<Member> = []
    for (const [, dir] of dirs) {
      const member = probeMember(`${dir}${MANIFEST_SUFFIX}`, yield* readFile(`${root}/${dir}${MANIFEST_SUFFIX}`))
      if (member === null || dirs.get(member.name) !== member.dir) continue
      members.push(member)
    }
    return members
  })

const pathsTouched = (
  members: ReadonlyArray<Member>,
  changedFiles: ReadonlyArray<RelativePath>,
): ReadonlyArray<PackageName> => {
  const touched = new Set<PackageName>()
  for (const file of changedFiles) {
    const owner = memberOwning(file, members)
    if (owner !== null && owner.publishable) touched.add(owner.name)
  }
  return [...touched].sort()
}

const verdictTouched = (
  base: Record<string, string>,
  head: Record<string, string>,
  members: ReadonlyArray<Member>,
  changedFiles: ReadonlyArray<RelativePath>,
): ReadonlyArray<PackageName> => {
  const touched = new Set<PackageName>()
  for (const member of members) {
    if (!member.publishable) continue
    const atBase = Object.hasOwn(base, member.name) ? base[member.name] : undefined
    const atHead = Object.hasOwn(head, member.name) ? head[member.name] : undefined
    if (atHead === undefined) continue
    if (atBase === undefined || atBase !== atHead) touched.add(member.name)
  }
  for (const member of members) {
    if (!member.publishable) continue
    if (Object.hasOwn(base, member.name) || Object.hasOwn(head, member.name)) continue
    if (changedFiles.some((file) => memberOwning(file, [member]) !== null)) touched.add(member.name)
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
): Effect.Effect<ChangeEvidence, Error> =>
  Effect.gen(function*() {
    const added = yield* capture('git', ['worktree', 'add', '--detach', '--force', baseDir, baseSha], root)
    if (!added.success) {
      yield* Effect.tryPromise({
        try: () => Deno.remove(baseDir, { recursive: true }).catch(() => undefined),
        catch: (cause) => new Error(`cannot remove ${baseDir}: ${describeCause(cause)}`),
      }).pipe(Effect.orDie)
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

export const ChangeEvidenceLive: Layer.Layer<ChangeEvidencePort, never, GitPort> = Layer.effect(
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
      })
    const turboEvidence: ChangeEvidencePort['turboEvidence'] = (root, ref, task) =>
      Effect.gen(function*() {
        const head = yield* git.currentBranch().pipe(Effect.orDie)
        const pinned = yield* liveTurboPin(root).pipe(Effect.orDie)
        const parsed = yield* gitLines(['rev-parse', '--verify', `${ref}^{commit}`], root).pipe(Effect.orDie)
        const baseSha = parsed[0]
        if (baseSha === undefined) return yield* Effect.die(new Error(`git rev-parse returned no sha for ${ref}`))
        const changed = yield* git.changedPaths(ref, head)
        const baseDir = yield* Effect.tryPromise({
          try: () => Deno.makeTempDir({ prefix: WORKTREE_PREFIX }),
          catch: (cause) => new Error(`cannot create a base worktree directory: ${describeCause(cause)}`),
        }).pipe(Effect.orDie)
        return yield* Effect.ensuring(
          collectTurboEvidence(root, baseDir, baseSha, task, pinned, changed).pipe(Effect.orDie),
          Effect.asVoid(Effect.option(gitLines(['worktree', 'remove', '--force', baseDir], root))),
        )
      })
    return { pathsEvidence, turboEvidence }
  }),
)
