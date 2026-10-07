import { type Member, RepoRoot, WorkspaceStore } from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Layer from 'effect/Layer'

export const fakeWorkspaceStore = (members: ReadonlyArray<Member>) =>
  Layer.succeed(WorkspaceStore, {
    root: RepoRoot.make('/repo'),
    listMembers: () => Effect.succeed(members),
    readManifest: () => Effect.die(new Error('FakeWorkspaceStore.readManifest is not used by these cells')),
    readFileFromRoot: () => Effect.die(new Error('FakeWorkspaceStore.readFileFromRoot is not used by these cells')),
    changelogStorage: () => Effect.die(new Error('FakeWorkspaceStore.changelogStorage is not used by these cells')),
  })
