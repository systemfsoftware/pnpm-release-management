import { Context, type Effect } from 'effect'
import type { PrTitle } from './Config.schema.js'
import type { GithubReleaseRefusal, ReleaseId, ReleaseLookup } from './GithubRelease.schema.js'
import type {
  PullRequestLookup,
  PullRequestNumber,
  PullRequestRefusal,
  PullRequestSummary,
  ReleaseLabel,
} from './PullRequest.schema.js'
import type { RepoSlug } from './Tag.schema.js'
import type { GitRef, ReleaseTag } from './Workspace.schema.js'

export interface ForgePort {
  readonly releaseByTag: (
    repo: RepoSlug,
    tag: ReleaseTag,
  ) => Effect.Effect<ReleaseLookup, GithubReleaseRefusal, never>
  readonly createRelease: (
    repo: RepoSlug,
    tag: ReleaseTag,
    body: string,
  ) => Effect.Effect<ReleaseId, GithubReleaseRefusal, never>
  readonly promoteLatest: (
    repo: RepoSlug,
    id: ReleaseId,
  ) => Effect.Effect<void, GithubReleaseRefusal, never>
  readonly openPullRequest: (
    repo: RepoSlug,
    head: GitRef,
  ) => Effect.Effect<PullRequestLookup, PullRequestRefusal, never>
  readonly listPullRequests: (
    repo: RepoSlug,
  ) => Effect.Effect<
    ReadonlyArray<PullRequestSummary>,
    PullRequestRefusal,
    never
  >
  readonly createPullRequest: (
    repo: RepoSlug,
    base: GitRef,
    head: GitRef,
    title: PrTitle,
    body: string,
    labels: ReadonlyArray<ReleaseLabel>,
  ) => Effect.Effect<PullRequestNumber, PullRequestRefusal, never>
  readonly updatePullRequest: (
    repo: RepoSlug,
    number: PullRequestNumber,
    title: PrTitle,
    body: string,
    labels: ReadonlyArray<ReleaseLabel>,
  ) => Effect.Effect<void, PullRequestRefusal, never>
  readonly closePullRequest: (
    repo: RepoSlug,
    number: PullRequestNumber,
  ) => Effect.Effect<void, PullRequestRefusal, never>
  readonly defaultBranch: (
    repo: RepoSlug,
  ) => Effect.Effect<GitRef, PullRequestRefusal, never>
}

export const ForgePort: Context.Service<ForgePort, ForgePort> = Context.Service<
  ForgePort,
  ForgePort
>('ForgePort')
