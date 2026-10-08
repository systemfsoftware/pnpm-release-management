import { GitPort, GitRef, type RelativePath } from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'

const unimplemented = (method: string): Effect.Effect<never> =>
  Effect.die(new Error(`FakeGitPort: ${method} is not implemented`))

const onMain = (changed: ReadonlyArray<RelativePath>) => ({
  currentBranch: () => Effect.succeed(GitRef.make('main')),
  headSha: () => unimplemented('headSha'),
  changedPaths: () => Effect.succeed(changed),
  remoteTags: () => unimplemented('remoteTags'),
  uncommittedChanges: () => unimplemented('uncommittedChanges'),
  commitAll: () => unimplemented('commitAll'),
  pushBranch: () => unimplemented('pushBranch'),
  deleteRemoteBranch: () => unimplemented('deleteRemoteBranch'),
  pushTags: () => unimplemented('pushTags'),
  writeTag: () => unimplemented('writeTag'),
  tagAnnotation: () => unimplemented('tagAnnotation'),
  tagCommit: () => unimplemented('tagCommit'),
  tagTree: () => unimplemented('tagTree'),
  repoSlug: () => unimplemented('repoSlug'),
  stagedPaths: () => unimplemented('stagedPaths'),
  mergeInProgress: () => unimplemented('mergeInProgress'),
})

export const FakeGitOnMain: Layer.Layer<GitPort> = Layer.succeed(GitPort, onMain([]))

export const fakeGitChanging = (changed: ReadonlyArray<RelativePath>): Layer.Layer<GitPort> =>
  Layer.succeed(GitPort, onMain(changed))
