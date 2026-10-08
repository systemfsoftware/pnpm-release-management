import {
  type ChangelogStorage,
  CommandUnstartable,
  FsPath,
  ManifestInvalid,
  ManifestUnreadable,
  type Member,
  type MemberRefusal,
  type PackageManifest,
  RelativePath,
  type RepoRoot,
  type RootFile,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import type { PlatformError } from 'effect/PlatformError'
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'
import { readTextFile } from './StoreFile.js'
import { ManifestText, WorkspaceListing } from './Workspace.schema.js'

const MANIFEST_FILE = 'package.json'
const WORKSPACE_FILE = 'pnpm-workspace.yaml'
const LIST_ARGS = ['ls', '-r', '--json', '--depth=-1']
const STORAGE_ARGS = ['config', 'get', 'versioning.changelog.storage']

const unreadable = (path: FsPath): MemberRefusal => ManifestUnreadable.make({ path })
const invalid = (path: FsPath, reason: string): MemberRefusal => ManifestInvalid.make({ path, reason })

const spawnReasonOf = (error: PlatformError): string => {
  const cause = error.reason.cause
  if (typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string') {
    return `${cause.code} (${error.message})`
  }
  return error.message
}

export const WorkspaceStoreLive = (
  root: RepoRoot,
): Layer.Layer<WorkspaceStore, never, FileSystem | Path | ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    WorkspaceStore,
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const rootFs = FsPath.make(root)

      const readManifest = (dir: RelativePath): Effect.Effect<PackageManifest, MemberRefusal> =>
        Effect.gen(function*() {
          const file = FsPath.make(path.join(root, dir, MANIFEST_FILE))
          const text = yield* readTextFile(fs, file).pipe(Effect.mapError(() => unreadable(file)))
          return yield* S.decodeUnknownEffect(ManifestText)(text).pipe(
            Effect.mapError((error) => invalid(file, error.message)),
          )
        })

      const runPnpm = (
        args: ReadonlyArray<string>,
      ): Effect.Effect<{ readonly code: number; readonly stdout: string; readonly stderr: string }, MemberRefusal> =>
        Effect.scoped(
          Effect.flatMap(
            spawner.spawn(ChildProcess.make('pnpm', args, { cwd: root })),
            (handle) =>
              Effect.all({
                code: handle.exitCode,
                stdout: Stream.mkString(Stream.decodeText(handle.stdout)),
                stderr: Stream.mkString(Stream.decodeText(handle.stderr)),
              }, { concurrency: 'unbounded' }),
          ),
        ).pipe(Effect.mapError((error) => CommandUnstartable.make({ command: 'pnpm', reason: spawnReasonOf(error) })))

      const listMembers = (): Effect.Effect<ReadonlyArray<Member>, MemberRefusal> =>
        Effect.gen(function*() {
          const { code, stdout } = yield* runPnpm(LIST_ARGS)
          if (code !== 0) {
            return yield* Effect.fail(unreadable(rootFs))
          }
          const rows = yield* S.decodeUnknownEffect(WorkspaceListing)(stdout).pipe(
            Effect.mapError((error) => invalid(rootFs, error.message)),
          )
          const listed = rows.map((row) => path.relative(root, row.path)).filter((dir) => dir !== '')
          return yield* Effect.forEach(listed, (dir) =>
            Effect.gen(function*() {
              const memberDir = yield* S.decodeUnknownEffect(RelativePath)(dir).pipe(
                Effect.mapError((error) => invalid(rootFs, error.message)),
              )
              const manifest = yield* readManifest(memberDir)
              return {
                name: manifest.name,
                dir: memberDir,
                manifest,
                publishable: manifest.private !== true,
              }
            }))
        })

      const readFileFromRoot = (file: RelativePath): Effect.Effect<RootFile, MemberRefusal> => {
        const full = FsPath.make(path.join(root, file))
        return readTextFile(fs, full).pipe(
          Effect.mapError(() => unreadable(full)),
          Effect.map((text): RootFile => ({ path: file, text })),
        )
      }

      const changelogStorage = (): Effect.Effect<ChangelogStorage, MemberRefusal> =>
        Effect.flatMap(runPnpm(STORAGE_ARGS), ({ code, stdout, stderr }) => {
          const workspaceFile = FsPath.make(path.join(root, WORKSPACE_FILE))
          const value = stdout.trim()
          if (code !== 0) return Effect.fail(invalid(workspaceFile, `${stderr}${stdout}`.trim()))
          if (value === 'repository') return Effect.succeed('repository' as const)
          if (value === 'registry' || value === 'undefined') return Effect.succeed('registry' as const)
          return Effect.fail(
            invalid(
              workspaceFile,
              `versioning.changelog.storage is ${JSON.stringify(value)}; expected "registry" or "repository"`,
            ),
          )
        })

      return { root, listMembers, readManifest, readFileFromRoot, changelogStorage }
    }),
  )
