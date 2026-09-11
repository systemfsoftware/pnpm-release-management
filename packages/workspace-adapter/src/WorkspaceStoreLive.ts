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
import { readTextFile } from './StoreFile.js'
import { ManifestText, WorkspaceListing } from './Workspace.schema.js'

const MANIFEST_FILE = 'package.json'
const LIST_ARGS = ['ls', '-r', '--json', '--depth=-1']

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
          const text = yield* readTextFile(fs, file).pipe(
            Effect.mapError((): MemberRefusal => ({ _tag: 'ManifestUnreadable', path: file })),
          )
          return yield* S.decodeUnknownEffect(ManifestText)(text).pipe(
            Effect.mapError((error): MemberRefusal => ({ _tag: 'ManifestInvalid', path: file, reason: error.message })),
          )
        })

      const listMembers = (): Effect.Effect<ReadonlyArray<Member>, MemberRefusal> =>
        Effect.gen(function*() {
          const [code, stdout] = yield* Effect.scoped(
            Effect.flatMap(
              spawner.spawn(ChildProcess.make('pnpm', [...LIST_ARGS], { cwd: root })),
              (handle) => Effect.all([handle.exitCode, Stream.mkString(Stream.decodeText(handle.stdout))]),
            ),
          ).pipe(Effect.mapError((): MemberRefusal => ({ _tag: 'ManifestUnreadable', path: rootFs })))
          if (code !== 0) {
            return yield* Effect.fail<MemberRefusal>({ _tag: 'ManifestUnreadable', path: rootFs })
          }
          const rows = yield* S.decodeUnknownEffect(WorkspaceListing)(stdout).pipe(
            Effect.mapError((error): MemberRefusal => ({
              _tag: 'ManifestInvalid',
              path: rootFs,
              reason: error.message,
            })),
          )
          const members: Array<Member> = []
          for (const row of rows) {
            const dir = path.relative(root, row.path)
            if (dir === '') continue
            const memberDir = yield* S.decodeUnknownEffect(RelativePath)(dir).pipe(
              Effect.mapError((error): MemberRefusal => ({
                _tag: 'ManifestInvalid',
                path: rootFs,
                reason: error.message,
              })),
            )
            const manifest = yield* readManifest(memberDir)
            members.push({
              name: manifest.name,
              dir: memberDir,
              manifest,
              publishable: manifest.private !== true,
            })
          }
          return members
        })

      const readFileFromRoot = (file: RelativePath): Effect.Effect<RootFile, MemberRefusal> =>
        Effect.gen(function*() {
          const full = FsPath.make(path.join(root, file))
          const text = yield* readTextFile(fs, full).pipe(
            Effect.mapError((): MemberRefusal => ({ _tag: 'ManifestUnreadable', path: full })),
          )
          return { path: file, text }
        })

      return { root, listMembers, readManifest, readFileFromRoot }
    }),
  )
