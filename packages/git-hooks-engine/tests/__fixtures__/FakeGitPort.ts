import { GitPort, StagedPath } from '@systemfsoftware/release-language'
import type { StagedChecksRefusal } from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as S from 'effect/Schema'
export type FakeGitState = {
  readonly staged: ReadonlyArray<string>
  readonly merge: boolean
  readonly stagedError?: StagedChecksRefusal | undefined
}

const unimplemented = (method: string): Effect.Effect<never> =>
  Effect.die(new Error(`FakeGitPort: ${method} is not implemented`))

const decodePath = (
  path: string,
): Effect.Effect<StagedPath, StagedChecksRefusal> =>
  Effect.mapError(
    S.decodeUnknownEffect(StagedPath)(path),
    (error): StagedChecksRefusal => ({ _tag: 'StagedStateUnreadable', reason: error.message } as const),
  )

export const makeFakeGitPort = (state: FakeGitState): Layer.Layer<GitPort> =>
  Layer.succeed(GitPort, {
    currentBranch: () => unimplemented('currentBranch'),
    headSha: () => unimplemented('headSha'),
    changedPaths: () => unimplemented('changedPaths'),
    remoteTags: () => unimplemented('remoteTags'),
    commitAll: () => unimplemented('commitAll'),
    pushBranch: () => unimplemented('pushBranch'),
    deleteRemoteBranch: () => unimplemented('deleteRemoteBranch'),
    pushTags: () => unimplemented('pushTags'),
    writeTag: () => unimplemented('writeTag'),
    tagAnnotation: () => unimplemented('tagAnnotation'),
    tagCommit: () => unimplemented('tagCommit'),
    tagTree: () => unimplemented('tagTree'),
    repoSlug: () => unimplemented('repoSlug'),
    stagedPaths: () => {
      if (state.stagedError !== undefined) {
        return Effect.fail(state.stagedError)
      }
      return Effect.forEach(state.staged, decodePath)
    },
    mergeInProgress: () => Effect.succeed(state.merge),
  })
