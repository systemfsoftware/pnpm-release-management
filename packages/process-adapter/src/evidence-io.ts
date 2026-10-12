import {
  EvidenceCommandFailed,
  EvidenceFileUnreadable,
  type Member,
  PackageManifest,
  type PackageName,
  PathsGateUnderTurbo,
  RelativePath,
  type RepoRoot,
  TurboConfigFile,
} from '@systemfsoftware/release-language'
import { Effect, FileSystem, Option } from 'effect'
import * as S from 'effect/Schema'
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner'
import { type ProcessFault, runProcess } from './ProcessRun.js'

export const MANIFEST_SUFFIX = '/package.json'

export const MANIFEST_GLOB: ReadonlyArray<string> = [
  'ls-files',
  '*package.json',
  ':(exclude)repos/**',
]

export const readText = (
  path: string,
): Effect.Effect<string, EvidenceFileUnreadable, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    return yield* fs
      .readFileString(path)
      .pipe(Effect.mapError(() => new EvidenceFileUnreadable({ path })))
  })

export const gitLines = (
  root: RepoRoot,
  args: ReadonlyArray<string>,
): Effect.Effect<
  ReadonlyArray<string>,
  EvidenceCommandFailed | ProcessFault,
  ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const out = yield* runProcess({
      program: 'git',
      args,
      cwd: root,
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

const turboConfigsAt = (
  root: RepoRoot,
  rev: string,
): Effect.Effect<ReadonlyArray<string>, EvidenceCommandFailed | ProcessFault, ChildProcessSpawner> =>
  gitLines(root, ['ls-tree', '--name-only', rev, '--', ...TurboConfigFile.literals])

export const refuseUnderTurbo = (
  root: RepoRoot,
  base: string,
  head: string,
): Effect.Effect<void, PathsGateUnderTurbo | EvidenceCommandFailed | ProcessFault, ChildProcessSpawner> =>
  Effect.gen(function*() {
    const atHead = yield* turboConfigsAt(root, head)
    const named = TurboConfigFile.literals.find((file) => atHead.includes(file))
    if (named === undefined) return
    if ((yield* turboConfigsAt(root, base)).length === 0) return
    return yield* Effect.fail(new PathsGateUnderTurbo({ turboConfig: named }))
  })

const dirOf = (manifestPath: string): Option.Option<RelativePath> => {
  if (!manifestPath.endsWith(MANIFEST_SUFFIX)) {
    return Option.none()
  }
  return S.decodeUnknownOption(RelativePath)(
    manifestPath.slice(0, -MANIFEST_SUFFIX.length),
  )
}

export const memberOf = (
  dir: RelativePath,
  manifestText: string,
): Option.Option<Member> =>
  Option.map(
    S.decodeUnknownOption(S.fromJsonString(PackageManifest))(manifestText),
    (manifest): Member => ({
      name: manifest.name,
      dir,
      manifest,
      publishable: manifest.private !== true,
    }),
  )

export const membersAt = (
  root: RepoRoot,
  paths: ReadonlyArray<string>,
): Effect.Effect<
  ReadonlyArray<Member>,
  EvidenceFileUnreadable,
  FileSystem.FileSystem
> =>
  Effect.gen(function*() {
    const members: Array<Member> = []
    for (const manifestPath of paths) {
      const dir = dirOf(manifestPath)
      if (Option.isNone(dir)) continue
      const member = memberOf(
        dir.value,
        yield* readText(`${root}/${manifestPath}`),
      )
      if (Option.isNone(member)) continue
      members.push(member.value)
    }
    return members
  })

export const deletedAt = (
  root: RepoRoot,
  base: string,
  changed: ReadonlyArray<string>,
): Effect.Effect<
  ReadonlyArray<PackageName>,
  EvidenceCommandFailed | ProcessFault,
  FileSystem.FileSystem | ChildProcessSpawner
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const deleted: Array<PackageName> = []
    for (const manifestPath of changed) {
      const dir = dirOf(manifestPath)
      if (Option.isNone(dir)) continue
      if (yield* fs.exists(`${root}/${manifestPath}`).pipe(Effect.orElseSucceed(() => false))) continue
      const shown = yield* gitLines(root, ['show', `${base}:${manifestPath}`])
      const member = memberOf(dir.value, shown.join('\n'))
      if (Option.isSome(member)) deleted.push(member.value.name)
    }
    return deleted.sort()
  })
