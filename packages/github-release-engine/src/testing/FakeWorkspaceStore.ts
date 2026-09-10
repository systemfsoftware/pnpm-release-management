import type { Member, RelativePath } from '@systemfsoftware/release-language'
import { FsPath, ManifestUnreadable, RepoRoot, WorkspaceStore } from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'

export interface FakeWorkspaceState {
  readonly members: Array<Member>
  readonly files: Record<string, string>
}

export const makeFakeWorkspaceStore = (state: FakeWorkspaceState) =>
  Layer.succeed(WorkspaceStore, {
    root: RepoRoot.make('/repo'),
    listMembers: () => Effect.succeed([...state.members]),
    readManifest: (dir: RelativePath) => {
      const member = state.members.find((candidate) => candidate.dir === dir)
      return member === undefined
        ? Effect.fail(ManifestUnreadable.make({ path: FsPath.make(dir) }))
        : Effect.succeed(member.manifest)
    },
    readFileFromRoot: (path: RelativePath) => {
      const text = state.files[path]
      if (text === undefined) {
        return Effect.fail(ManifestUnreadable.make({ path: FsPath.make(path) }))
      }
      return Effect.succeed({ path, text })
    },
  })
