import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import type {
  IntentRefusal,
  PullRequestDecision,
  PullRequestLookup,
  PullRequestRefusal,
  RepoSlug,
  TagRefusal,
} from '@systemfsoftware/release-language'
import {
  BranchDeleted,
  ChangesetStore,
  Count,
  ForgePort,
  FsPath,
  GitPort,
  GitRef,
  PrTitle,
  PullRequestBodyUnreadable,
  PullRequestClosed,
  PullRequestCreated,
  PullRequestHeadInvalid,
  PullRequestNumber,
  PullRequestUpdated,
  PullRequestVacant,
  RelativePath,
  ReleaseLabel,
  RemoteName,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import {
  type BodyFileUnreadable,
  type HeadRefInvalid,
  pullRequest,
  PullRequestCommand,
  type PullRequestReleaseClosed,
  type PullRequestReleaseOpened,
  type PullRequestReleaseRefreshed,
  type PullRequestReleaseVacant,
} from './pull-request.workflow.js'

export const PullRequestRequest = Wire.wire({
  title: Wire.mint(PrTitle),
  body: Wire.mint(S.optional(S.String)),
  bodyFile: Wire.mint(S.optional(RelativePath)),
  base: Wire.mint(GitRef),
  branch: Wire.mint(GitRef),
  remote: Wire.mint(S.optional(RemoteName)),
  labels: Wire.mint(S.Array(ReleaseLabel)),
})

interface RawPullRequest {
  readonly pending: Count
  readonly existing: PullRequestLookup
  readonly branch: GitRef
  readonly base: GitRef
  readonly title: PrTitle
  readonly body: string
  readonly bodyIssue: FsPath | undefined
  readonly slug: RepoSlug
  readonly remote: RemoteName
  readonly labels: ReadonlyArray<ReleaseLabel>
}

interface BodyScan {
  readonly text: string
  readonly issue: FsPath | undefined
}

const readBody = (
  workspace: WorkspaceStore,
  body: string | undefined,
  bodyFile: RelativePath | undefined,
): Effect.Effect<BodyScan, never, never> => {
  if (body !== undefined) {
    return Effect.succeed({ text: body, issue: undefined })
  }
  if (bodyFile === undefined) {
    return Effect.succeed({ text: '', issue: undefined })
  }
  return Effect.match(workspace.readFileFromRoot(bodyFile), {
    onFailure: () => ({ text: '', issue: FsPath.make(bodyFile) }),
    onSuccess: (file) => ({ text: file.text, issue: undefined }),
  })
}

const read = (
  request: S.Schema.Type<typeof PullRequestRequest>,
): Effect.Effect<
  RawPullRequest,
  IntentRefusal | TagRefusal | PullRequestRefusal,
  ChangesetStore | WorkspaceStore | GitPort | ForgePort
> =>
  Effect.gen(function*() {
    const remote = request.remote ?? RemoteName.make('origin')
    const changesets = yield* ChangesetStore
    const workspace = yield* WorkspaceStore
    const git = yield* GitPort
    const forge = yield* ForgePort
    const intents = yield* changesets.listIntents()
    const slug = yield* git.repoSlug()
    const existing = yield* forge.openPullRequest(slug, request.branch)
    const body = yield* readBody(workspace, request.body, request.bodyFile)
    return {
      pending: Count.make(intents.length),
      existing,
      branch: request.branch,
      base: request.base,
      title: request.title,
      body: body.text,
      bodyIssue: body.issue,
      slug,
      remote,
      labels: [...request.labels],
    }
  })

const decode = (raw: RawPullRequest): Result.Result<PullRequestCommand, never> =>
  Result.succeed(
    PullRequestCommand.make({
      pending: raw.pending,
      existing: raw.existing,
      branch: raw.branch,
      base: raw.base,
      title: raw.title,
      body: raw.body,
      bodyIssue: raw.bodyIssue,
    }),
  )

const toRefusal = (bad: BodyFileUnreadable | HeadRefInvalid): PullRequestRefusal =>
  Match.value(bad).pipe(
    Match.tag('BodyFileUnreadable', (unreadable) => PullRequestBodyUnreadable.make({ path: unreadable.path })),
    Match.tag('HeadRefInvalid', (invalid) => PullRequestHeadInvalid.make({ branch: invalid.branch })),
    Match.exhaustive,
  )

const toDecision = (
  decision:
    | PullRequestReleaseOpened
    | PullRequestReleaseRefreshed
    | PullRequestReleaseClosed
    | PullRequestReleaseVacant,
): PullRequestDecision =>
  Match.value(decision).pipe(
    Match.tag('PullRequestReleaseOpened', (opened) =>
      PullRequestCreated.make({ number: PullRequestNumber.make(opened.number) })),
    Match.tag('PullRequestReleaseRefreshed', (refreshed) =>
      PullRequestUpdated.make({ number: PullRequestNumber.make(refreshed.number) })),
    Match.tag('PullRequestReleaseClosed', (closed) =>
      PullRequestClosed.make({
        number: PullRequestNumber.make(closed.number),
        branch: BranchDeleted.make({ branch: GitRef.make(closed.branch), deleted: false }),
      })),
    Match.tag('PullRequestReleaseVacant', (vacant) =>
      PullRequestVacant.make({ branch: GitRef.make(vacant.branch) })),
    Match.exhaustive,
  )

const encode = (
  outcome: Result.Result<
    | PullRequestReleaseOpened
    | PullRequestReleaseRefreshed
    | PullRequestReleaseClosed
    | PullRequestReleaseVacant,
    BodyFileUnreadable | HeadRefInvalid
  >,
): Result.Result<PullRequestDecision, PullRequestRefusal> =>
  Result.mapError(outcome, toRefusal).pipe(Result.map(toDecision))

const openRequest = (
  raw: RawPullRequest,
  vacant: PullRequestVacant,
): Effect.Effect<PullRequestDecision, PullRequestRefusal, GitPort | ForgePort> => {
  if (raw.pending <= 0) {
    return Effect.succeed(vacant)
  }
  return Effect.gen(function*() {
    const git = yield* GitPort
    const forge = yield* ForgePort
    yield* git.commitAll(raw.title)
    yield* git.pushBranch(raw.branch, raw.remote)
    const number = yield* forge.createPullRequest(
      raw.slug,
      raw.base,
      raw.branch,
      raw.title,
      raw.body,
      raw.labels,
    )
    return PullRequestCreated.make({ number })
  })
}

const write = (
  output: Result.Result<PullRequestDecision, PullRequestRefusal>,
  raw: RawPullRequest,
): Effect.Effect<PullRequestDecision, PullRequestRefusal, GitPort | ForgePort> => {
  if (Result.isFailure(output)) {
    return Effect.fail(output.failure)
  }
  return Match.value(output.success).pipe(
    Match.tag('PullRequestClosed', (closed) =>
      Effect.gen(function*() {
        const git = yield* GitPort
        const forge = yield* ForgePort
        yield* forge.closePullRequest(raw.slug, closed.number)
        const branch = yield* git.deleteRemoteBranch(raw.branch, raw.remote)
        return PullRequestClosed.make({ number: closed.number, branch })
      })),
    Match.tag('PullRequestUpdated', (updated) =>
      Effect.gen(function*() {
        const git = yield* GitPort
        const forge = yield* ForgePort
        yield* git.commitAll(raw.title)
        yield* git.pushBranch(raw.branch, raw.remote)
        yield* forge.updatePullRequest(raw.slug, updated.number, raw.title, raw.body, raw.labels)
        return updated
      })),
    Match.tag('PullRequestVacant', (vacant) => openRequest(raw, vacant)),
    Match.tag('PullRequestCreated', (created) => Effect.succeed(created)),
    Match.exhaustive,
  )
}

export const pullRequestCell: Cell.Cell<
  S.Schema.Type<typeof PullRequestRequest>,
  PullRequestDecision,
  IntentRefusal | TagRefusal | PullRequestRefusal,
  ChangesetStore | WorkspaceStore | GitPort | ForgePort
> = Cell.layer({
  read,
  decode,
  decide: pullRequest,
  encode,
  write,
})
