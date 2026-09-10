import { join, relative } from '@std/path'
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
import * as S from 'effect/Schema'

const MANIFEST_FILE = 'package.json'

export const WorkspaceStoreLive = (root: RepoRoot): Layer.Layer<WorkspaceStore> => {
  const readManifest = (dir: RelativePath): Effect.Effect<PackageManifest, MemberRefusal> =>
    Effect.gen(function*() {
      const manifestFs = yield* S.decodeUnknownEffect(FsPath)(join(root, dir, MANIFEST_FILE)).pipe(
        Effect.orDie,
      )
      const text = yield* Effect.tryPromise({
        try: () => Deno.readTextFile(join(root, dir, MANIFEST_FILE)),
        catch: (): MemberRefusal => ({ _tag: 'ManifestUnreadable', path: manifestFs }),
      })
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        return yield* Effect.fail({ _tag: 'ManifestInvalid', path: manifestFs, reason: String(error) } as const)
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
      const output = yield* Effect.tryPromise({
        try: () =>
          new Deno.Command('pnpm', {
            args: ['ls', '-r', '--json', '--depth=-1'],
            cwd: root,
            stdout: 'piped',
            stderr: 'piped',
          }).output(),
        catch: (): MemberRefusal => ({ _tag: 'ManifestUnreadable', path: rootFs }),
      })
      if (!output.success) {
        return yield* Effect.fail({ _tag: 'ManifestUnreadable', path: rootFs } as const)
      }
      let rows: unknown
      try {
        rows = JSON.parse(new TextDecoder().decode(output.stdout))
      } catch (error) {
        return yield* Effect.fail({ _tag: 'ManifestInvalid', path: rootFs, reason: String(error) } as const)
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
        const dir = relative(root, rawPath)
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

  const readFileFromRoot = (path: RelativePath): Effect.Effect<RootFile, MemberRefusal> =>
    Effect.gen(function*() {
      const full = join(root, path)
      const fullFs = yield* S.decodeUnknownEffect(FsPath)(full).pipe(Effect.orDie)
      const text = yield* Effect.tryPromise({
        try: () => Deno.readTextFile(full),
        catch: (): MemberRefusal => ({ _tag: 'ManifestUnreadable', path: fullFs }),
      })
      return { path, text }
    })

  return Layer.succeed(WorkspaceStore)({ root, listMembers, readManifest, readFileFromRoot })
}
