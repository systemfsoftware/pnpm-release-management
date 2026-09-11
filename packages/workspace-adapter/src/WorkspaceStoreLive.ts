import {
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
import * as S from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'
import { readTextFile } from './StoreFile.js'
import { ManifestText, WorkspaceListing } from './Workspace.schema.js'

const MANIFEST_FILE = 'package.json'
const LIST_ARGS = ['ls', '-r', '--json', '--depth=-1']

const unreadable = (path: FsPath): MemberRefusal => ManifestUnreadable.make({ path })
const invalid = (path: FsPath, reason: string): MemberRefusal => ManifestInvalid.make({ path, reason })

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

      const listMembers = (): Effect.Effect<ReadonlyArray<Member>, MemberRefusal> =>
        Effect.gen(function*() {
          const [code, stdout] = yield* Effect.scoped(
            Effect.flatMap(
              spawner.spawn(ChildProcess.make('pnpm', LIST_ARGS, { cwd: root })),
              (handle) => Effect.all([handle.exitCode, Stream.mkString(Stream.decodeText(handle.stdout))]),
            ),
          ).pipe(Effect.mapError(() => unreadable(rootFs)))
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

      return { root, listMembers, readManifest, readFileFromRoot }
    }),
  )
