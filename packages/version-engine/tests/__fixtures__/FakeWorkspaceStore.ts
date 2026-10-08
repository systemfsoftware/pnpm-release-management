import {
  type ChangelogStorage,
  FsPath,
  type Member,
  type RelativePath,
  type RepoRoot,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'

export type FakeWorkspaceState = {
  readonly members: Array<Member>
  readonly files: Map<RelativePath, string>
}

export const makeFakeWorkspaceStore = (
  members: ReadonlyArray<Member>,
  root: RepoRoot,
  files: ReadonlyMap<RelativePath, string> = new Map(),
  storage: ChangelogStorage = 'registry',
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
          return Effect.fail({ _tag: 'ManifestUnreadable', path: FsPath.make(dir) } as const)
        }
        return Effect.succeed(found.manifest)
      }),
    readFileFromRoot: (path: RelativePath) =>
      Effect.suspend(() => {
        const text = liveFiles.get(path)
        if (text === undefined) {
          return Effect.fail({ _tag: 'ManifestUnreadable', path: FsPath.make(path) } as const)
        }
        return Effect.succeed({ path, text })
      }),
    changelogStorage: () => Effect.succeed(storage),
  })
  return { layer, state: { members: liveMembers, files: liveFiles } }
}
