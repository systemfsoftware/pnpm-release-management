import type { GitRef, ReleaseTag, RemoteName } from '@systemfsoftware/release-language'
import {
  BranchDeleted,
  CommitSha,
  Count,
  GitPort,
  GitRef as GitRefSchema,
  OwnerName,
  RepoName,
} from '@systemfsoftware/release-language'
import { Effect, Layer, Option } from 'effect'
import { FAKE_FILES, FAKE_INTEGRITY } from './FakeTarball.js'

export interface FakeGitState {
  readonly tags?: Array<ReleaseTag>
  readonly owner?: string
  readonly repo?: string
  readonly annotation?: string
  readonly uncommitted?: number
}

export interface FakeGitCalls {
  readonly writtenTags: Array<ReleaseTag>
  readonly writtenAnnotations: Array<{ readonly tag: ReleaseTag; readonly message: string }>
  readonly pushed: Array<{ readonly tags: Array<ReleaseTag>; readonly remote: RemoteName }>
  readonly commits: Array<string>
  readonly branchesPushed: Array<{ readonly branch: GitRef; readonly remote: RemoteName }>
  readonly branchesDeleted: Array<{ readonly branch: GitRef; readonly remote: RemoteName }>
}

export const makeFakeGit = (state: FakeGitState = {}) => {
  const tags = [...(state.tags ?? [])]
  const calls: FakeGitCalls = {
    writtenTags: [],
    writtenAnnotations: [],
    pushed: [],
    commits: [],
    branchesPushed: [],
    branchesDeleted: [],
  }
  const layer = Layer.succeed(GitPort, {
    currentBranch: () => Effect.succeed(GitRefSchema.make('main')),
    headSha: () => Effect.succeed(CommitSha.make('deadbeef')),
    changedPaths: () => Effect.succeed([]),
    remoteTags: () => Effect.succeed([...tags]),
    uncommittedChanges: () => Effect.succeed(Count.make(state.uncommitted ?? 0)),
    commitAll: (message) => {
      calls.commits.push(message)
      return Effect.succeed(CommitSha.make('deadbeef'))
    },
    pushBranch: (branch, remote) => {
      calls.branchesPushed.push({ branch, remote })
      return Effect.succeed(undefined)
    },
    deleteRemoteBranch: (branch, remote) => {
      calls.branchesDeleted.push({ branch, remote })
      return Effect.succeed(BranchDeleted.make({ branch, deleted: true }))
    },
    pushTags: (pushed, remote) => {
      calls.pushed.push({ tags: [...pushed], remote })
      return Effect.succeed(Count.make(pushed.length))
    },
    writeTag: (tag, message) => {
      calls.writtenTags.push(tag)
      calls.writtenAnnotations.push({ tag, message })
      if (!tags.includes(tag)) {
        tags.push(tag)
      }
      return Effect.succeed(tag)
    },
    tagAnnotation: () =>
      Effect.succeed(Option.some(state.annotation ?? JSON.stringify({ integrity: FAKE_INTEGRITY, files: FAKE_FILES }))),
    tagCommit: () => Effect.succeed(Option.some(CommitSha.make('deadbeef'))),
    tagTree: () => Effect.succeed(Option.none()),
    repoSlug: () =>
      Effect.succeed({
        owner: OwnerName.make(state.owner ?? 'acme'),
        repo: RepoName.make(state.repo ?? 'acme'),
      }),
    stagedPaths: () => Effect.succeed([]),
    mergeInProgress: () => Effect.succeed(false),
  })
  return Object.assign(layer, { calls })
}
