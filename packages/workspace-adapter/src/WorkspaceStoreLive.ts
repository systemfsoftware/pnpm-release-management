import {
  FsPath,
  type Member,
  type MemberRefusal,
  PackageManifest,
  RelativePath,
  type RepoRoot,
  type RootFile,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'

const MANIFEST_FILE = 'package.json'

export const WorkspaceStoreLive = (
  root: RepoRoot,
): Layer.Layer<WorkspaceStore, never, FileSystem | Path | ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    WorkspaceStore,
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const readManifest = (dir: RelativePath): Effect.Effect<PackageManifest, MemberRefusal> =>
        Effect.gen(function*() {
          const full = path.join(root, dir, MANIFEST_FILE)
          const manifestFs = yield* S.decodeUnknownEffect(FsPath)(full).pipe(Effect.orDie)
          const text = yield* fs.readFileString(full).pipe(
            Effect.catchTag(
              'PlatformError',
              (): Effect.Effect<never, MemberRefusal> =>
                Effect.fail({ _tag: 'ManifestUnreadable', path: manifestFs } as const),
            ),
          )
          let parsed: unknown
          try {
            parsed = JSON.parse(text)
          } catch (error) {
            if (error instanceof Error) {
              return yield* Effect.fail({ _tag: 'ManifestInvalid', path: manifestFs, reason: error.message } as const)
            }
            return yield* Effect.fail({ _tag: 'ManifestInvalid', path: manifestFs, reason: 'unknown error' } as const)
          }
          return yield* S.decodeUnknownEffect(PackageManifest)(parsed).pipe(
            Effect.mapError((error): MemberRefusal => ({
              _tag: 'ManifestInvalid',
              path: manifestFs,
              reason: error.message,
            })),
          )
        })

      const listMembers = (): Effect.Effect<ReadonlyArray<Member>, MemberRefusal> =>
        Effect.gen(function*() {
          const rootFs = yield* S.decodeUnknownEffect(FsPath)(root).pipe(Effect.orDie)
          const unreadable = { _tag: 'ManifestUnreadable', path: rootFs } as const
          const command = ChildProcess.make('pnpm', ['ls', '-r', '--json', '--depth=-1'], { cwd: root })
          const spawned = yield* Effect.scoped(
            Effect.flatMap(
              spawner.spawn(command),
              (handle) => Effect.all([handle.exitCode, Stream.mkString(Stream.decodeText(handle.stdout))]),
            ),
          ).pipe(
            Effect.catchTag(
              'PlatformError',
              (): Effect.Effect<never, MemberRefusal> => Effect.fail(unreadable),
            ),
          )
          const [code, stdout] = spawned
          if (code !== 0) {
            return yield* Effect.fail(unreadable)
          }
          let rows: unknown
          try {
            rows = JSON.parse(stdout)
          } catch (error) {
            if (error instanceof Error) {
              return yield* Effect.fail({ _tag: 'ManifestInvalid', path: rootFs, reason: error.message } as const)
            }
            return yield* Effect.fail({ _tag: 'ManifestInvalid', path: rootFs, reason: 'unknown error' } as const)
          }
          if (!Array.isArray(rows)) {
            return yield* Effect.fail(
              { _tag: 'ManifestInvalid', path: rootFs, reason: 'expected a JSON array' } as const,
            )
          }
          const members: Array<Member> = []
          const unknownRows: ReadonlyArray<unknown> = rows
          for (const row of unknownRows) {
            if (typeof row !== 'object' || row === null || !('path' in row)) {
              return yield* Effect.fail(
                { _tag: 'ManifestInvalid', path: rootFs, reason: 'a workspace row without a path' } as const,
              )
            }
            const rawPath: unknown = row.path
            if (typeof rawPath !== 'string') {
              return yield* Effect.fail(
                { _tag: 'ManifestInvalid', path: rootFs, reason: 'a workspace row without a path' } as const,
              )
            }
            const dir = path.relative(root, rawPath)
            if (dir === '') continue
            const member = yield* S.decodeUnknownEffect(RelativePath)(dir).pipe(
              Effect.mapError((error): MemberRefusal => ({
                _tag: 'ManifestInvalid',
                path: rootFs,
                reason: error.message,
              })),
            )
            const manifest = yield* readManifest(member)
            members.push({ name: manifest.name, dir: member, manifest, publishable: manifest.private !== true })
          }
          return members
        })

      const readFileFromRoot = (path_: RelativePath): Effect.Effect<RootFile, MemberRefusal> =>
        Effect.gen(function*() {
          const full = path.join(root, path_)
          const fullFs = yield* S.decodeUnknownEffect(FsPath)(full).pipe(Effect.orDie)
          const text = yield* fs.readFileString(full).pipe(
            Effect.catchTag(
              'PlatformError',
              (): Effect.Effect<never, MemberRefusal> =>
                Effect.fail({ _tag: 'ManifestUnreadable', path: fullFs } as const),
            ),
          )
          return { path: path_, text }
        })

      return { root, listMembers, readManifest, readFileFromRoot }
    }),
  )
