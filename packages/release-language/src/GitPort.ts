import { Context, type Effect, type Option } from 'effect'
import type { PrTitle } from './Config.schema.js'
import type { GateRefusal } from './Gate.schema.js'
import type { BranchDeleted, PullRequestRefusal } from './PullRequest.schema.js'
import type { StagedChecksRefusal, StagedPath } from './StagedChecks.schema.js'
import type { CommitSha, RemoteName, RepoSlug, TagRefusal } from './Tag.schema.js'
import type { Count, GitRef, RelativePath, ReleaseTag } from './Workspace.schema.js'

export interface GitPort {
  readonly currentBranch: () => Effect.Effect<GitRef, TagRefusal, never>
  readonly headSha: () => Effect.Effect<CommitSha, TagRefusal, never>
  readonly changedPaths: (
    base: GitRef,
    head: GitRef,
  ) => Effect.Effect<ReadonlyArray<RelativePath>, GateRefusal, never>
  readonly remoteTags: (
    remote: RemoteName,
  ) => Effect.Effect<ReadonlyArray<ReleaseTag>, TagRefusal, never>
  readonly commitAll: (
    message: PrTitle,
  ) => Effect.Effect<CommitSha, PullRequestRefusal, never>
  readonly pushBranch: (
    branch: GitRef,
    remote: RemoteName,
  ) => Effect.Effect<void, PullRequestRefusal, never>
  readonly deleteRemoteBranch: (
    branch: GitRef,
    remote: RemoteName,
  ) => Effect.Effect<BranchDeleted, PullRequestRefusal, never>
  readonly pushTags: (
    tags: ReadonlyArray<ReleaseTag>,
    remote: RemoteName,
  ) => Effect.Effect<Count, TagRefusal, never>
  readonly writeTag: (
    tag: ReleaseTag,
    message: string,
  ) => Effect.Effect<ReleaseTag, TagRefusal, never>
  readonly tagAnnotation: (
    remote: RemoteName,
    tag: ReleaseTag,
  ) => Effect.Effect<Option.Option<string>, TagRefusal, never>
  readonly tagCommit: (
    remote: RemoteName,
    tag: ReleaseTag,
  ) => Effect.Effect<Option.Option<CommitSha>, TagRefusal, never>
  readonly repoSlug: () => Effect.Effect<RepoSlug, TagRefusal, never>
  readonly stagedPaths: () => Effect.Effect<
    ReadonlyArray<StagedPath>,
    StagedChecksRefusal,
    never
  >
  readonly mergeInProgress: () => Effect.Effect<
    boolean,
    StagedChecksRefusal,
    never
  >
}

export const GitPort: Context.Service<GitPort, GitPort> = Context.Service<
  GitPort,
  GitPort
>('GitPort')
