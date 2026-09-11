import {
  FsPath,
  type Member,
  type MemberRefusal,
  type PackageManifest,
  type RelativePath,
  type RepoRoot,
  type RootFile,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as S from 'effect/Schema'

export type FakeWorkspaceState = {
  readonly members: Array<Member>
  readonly files: Map<RelativePath, string>
}

const mustBrand = <C extends S.Constraint>(schema: C, input: unknown) =>
  S.decodeUnknownEffect(schema)(input).pipe(Effect.orDie)

export const makeFakeWorkspaceStore = (
  members: ReadonlyArray<Member>,
  root: RepoRoot,
  files: ReadonlyMap<RelativePath, string> = new Map(),
): { readonly layer: Layer.Layer<WorkspaceStore>; readonly state: FakeWorkspaceState } => {
  const liveMembers = [...members]
  const liveFiles = new Map(files)
  const layer = Layer.succeed(WorkspaceStore, {
    root,
    listMembers: () => Effect.succeed([...liveMembers]),
    readManifest: (dir: RelativePath) =>
      Effect.suspend(() => {
        const found = liveMembers.find((member) => member.dir === dir)
        if (found === undefined) {
          return Effect.flatMap(
            mustBrand(FsPath, dir),
            (path): Effect.Effect<PackageManifest, MemberRefusal> => Effect.fail({ _tag: 'ManifestUnreadable', path }),
          )
        }
        return Effect.succeed(found.manifest)
      }),
    readFileFromRoot: (path: RelativePath) =>
      Effect.suspend(() => {
        const text = liveFiles.get(path)
        if (text === undefined) {
          return Effect.flatMap(
            mustBrand(FsPath, path),
            (fsPath): Effect.Effect<RootFile, MemberRefusal> =>
              Effect.fail({ _tag: 'ManifestUnreadable', path: fsPath }),
          )
        }
        return Effect.succeed({ path, text })
      }),
  })
  return { layer, state: { members: liveMembers, files: liveFiles } }
}
