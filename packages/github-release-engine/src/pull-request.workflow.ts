import { Workflow } from '@systemfsoftware/effect-cell-types'
import {
  Count,
  DecisionTypeId,
  FsPath,
  GitRef,
  PrTitle,
  PullRequestLookup,
  PullRequestNumber,
  RelativePath,
  ReleaseLabel,
  RemoteName,
  RepoSlug,
} from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export const BranchDeleted = S.Struct({
  branch: GitRef,
  deleted: S.Boolean,
})

export type BranchDeleted = S.Schema.Type<typeof BranchDeleted>

export class PullRequestCreated extends S.TaggedClass<PullRequestCreated>()(
  'PullRequestCreated',
  { number: PullRequestNumber },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class PullRequestUpdated extends S.TaggedClass<PullRequestUpdated>()(
  'PullRequestUpdated',
  { number: PullRequestNumber },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class PullRequestClosed extends S.TaggedClass<PullRequestClosed>()(
  'PullRequestClosed',
  { number: PullRequestNumber, branch: BranchDeleted },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class PullRequestVacant extends S.TaggedClass<PullRequestVacant>()(
  'PullRequestVacant',
  { branch: GitRef },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class PullRequestBodyUnreadable extends S.TaggedError<PullRequestBodyUnreadable>()(
  'PullRequestBodyUnreadable',
  { path: FsPath },
) {}

export class PullRequestHeadInvalid extends S.TaggedError<PullRequestHeadInvalid>()(
  'PullRequestHeadInvalid',
  { branch: GitRef },
) {}

export class PullRequestUnversioned extends S.TaggedError<PullRequestUnversioned>()(
  'PullRequestUnversioned',
  { pending: Count },
) {}

export class PullRequestCommand extends S.TaggedClass<PullRequestCommand>()(
  'PullRequestCommand',
  {
    pending: Count,
    changes: Count,
    created: S.Array(RelativePath),
    existing: PullRequestLookup,
    branch: GitRef,
    base: GitRef,
    title: PrTitle,
    body: S.String,
    bodyIssue: S.optional(FsPath),
    slug: RepoSlug,
    remote: RemoteName,
    labels: S.Array(ReleaseLabel),
  },
) {}

export type PullRequestDecision =
  | PullRequestCreated
  | PullRequestUpdated
  | PullRequestClosed
  | PullRequestVacant

const BodyBadCase = S.TaggedStruct('BodyBad', { path: FsPath })
const HeadBadCase = S.TaggedStruct('HeadBad', { branch: GitRef })
const UnversionedCase = S.TaggedStruct('Unversioned', { pending: Count })
const RefreshingCase = S.TaggedStruct('Refreshing', { number: PullRequestNumber })
const ClosingCase = S.TaggedStruct('Closing', { number: PullRequestNumber, branch: GitRef })
const VacantCase = S.TaggedStruct('Vacant', { branch: GitRef })
const PullRequestCase = S.Union([
  BodyBadCase,
  HeadBadCase,
  UnversionedCase,
  RefreshingCase,
  ClosingCase,
  VacantCase,
])
type PullRequestCase = S.Schema.Type<typeof PullRequestCase>

const pullRequestCaseOf = (command: PullRequestCommand): PullRequestCase => {
  const bodyIssue = command.bodyIssue
  if (bodyIssue !== undefined) {
    return BodyBadCase.make({ path: bodyIssue })
  }
  const branch = command.branch
  if (branch === command.base) {
    return HeadBadCase.make({ branch })
  }
  if (command.pending > 0) {
    return UnversionedCase.make({ pending: command.pending })
  }
  return Match.value(command.existing).pipe(
    Match.tag('PullRequestFound', (found): PullRequestCase => {
      if (command.changes > 0) {
        return RefreshingCase.make({ number: found.number })
      }
      return ClosingCase.make({ number: found.number, branch })
    }),
    Match.tag('PullRequestAbsent', (): PullRequestCase => VacantCase.make({ branch })),
    Match.exhaustive,
  )
}

export const pullRequest = Workflow.make(
  PullRequestCommand,
  (
    command,
  ): Result.Result<
    PullRequestCreated | PullRequestUpdated | PullRequestClosed | PullRequestVacant,
    PullRequestBodyUnreadable | PullRequestHeadInvalid | PullRequestUnversioned
  > =>
    Match.value(pullRequestCaseOf(command)).pipe(
      Match.tag('BodyBad', (bad) => Result.fail(PullRequestBodyUnreadable.make({ path: bad.path }))),
      Match.tag('HeadBad', (bad) => Result.fail(PullRequestHeadInvalid.make({ branch: bad.branch }))),
      Match.tag('Unversioned', (unversioned) =>
        Result.fail(PullRequestUnversioned.make({ pending: unversioned.pending }))),
      Match.tag('Refreshing', (refreshing) =>
        Result.succeed(PullRequestUpdated.make({ number: refreshing.number }))),
      Match.tag('Closing', (closing) =>
        Result.succeed(
          PullRequestClosed.make({
            number: closing.number,
            branch: BranchDeleted.make({ branch: closing.branch, deleted: false }),
          }),
        )),
      Match.tag('Vacant', (vacant) => Result.succeed(PullRequestVacant.make({ branch: vacant.branch }))),
      Match.exhaustive,
    ),
)
