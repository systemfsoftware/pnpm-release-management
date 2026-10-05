import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import type { IntentRefusal, PullRequestRefusal, TagRefusal } from '@systemfsoftware/release-language'
import {
  ChangesetStore,
  Count,
  ForgePort,
  FsPath,
  GitPort,
  GitRef,
  PrTitle,
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
  pullRequest,
  PullRequestClosed,
  PullRequestCommand,
  PullRequestCreated,
  type PullRequestDecision,
  PullRequestVacant,
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
  PullRequestCommand,
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
    return PullRequestCommand.make({
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
    })
  })

const openRequest = (
  raw: PullRequestCommand,
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
  outcome: Result.Result<PullRequestDecision, PullRequestRefusal>,
  raw: PullRequestCommand,
): Effect.Effect<PullRequestDecision, PullRequestRefusal, GitPort | ForgePort> => {
  if (Result.isFailure(outcome)) {
    return Effect.fail(outcome.failure)
  }
  return Match.value(outcome.success).pipe(
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
  decide: pullRequest,
  write,
})
