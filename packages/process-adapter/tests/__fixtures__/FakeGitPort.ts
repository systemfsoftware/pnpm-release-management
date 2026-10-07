import { GitPort, GitRef } from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'

const unimplemented = (method: string): Effect.Effect<never> =>
  Effect.die(new Error(`FakeGitPort: ${method} is not implemented`))

export const FakeGitOnMain: Layer.Layer<GitPort> = Layer.succeed(GitPort, {
  currentBranch: () => Effect.succeed(GitRef.make('main')),
  headSha: () => unimplemented('headSha'),
  changedPaths: () => unimplemented('changedPaths'),
  remoteTags: () => unimplemented('remoteTags'),
  commitAll: () => unimplemented('commitAll'),
  pushBranch: () => unimplemented('pushBranch'),
  deleteRemoteBranch: () => unimplemented('deleteRemoteBranch'),
  pushTags: () => unimplemented('pushTags'),
  writeTag: () => unimplemented('writeTag'),
  tagAnnotation: () => unimplemented('tagAnnotation'),
  repoSlug: () => unimplemented('repoSlug'),
  stagedPaths: () => unimplemented('stagedPaths'),
  mergeInProgress: () => unimplemented('mergeInProgress'),
})
