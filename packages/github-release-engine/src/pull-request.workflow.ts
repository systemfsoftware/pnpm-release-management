import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Count, FsPath, GitRef, PrTitle, PullRequestLookup } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const PullRequestReleaseDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/PullRequestReleaseDecision',
)
type PullRequestReleaseDecisionTypeId = typeof PullRequestReleaseDecisionTypeId

export class PullRequestReleaseOpened extends S.TaggedClass<PullRequestReleaseOpened>()(
  'PullRequestReleaseOpened',
  { number: S.Number },
) {
  readonly [PullRequestReleaseDecisionTypeId] = PullRequestReleaseDecisionTypeId
}

export class PullRequestReleaseRefreshed extends S.TaggedClass<PullRequestReleaseRefreshed>()(
  'PullRequestReleaseRefreshed',
  { number: S.Number },
) {
  readonly [PullRequestReleaseDecisionTypeId] = PullRequestReleaseDecisionTypeId
}

export class PullRequestReleaseClosed extends S.TaggedClass<PullRequestReleaseClosed>()(
  'PullRequestReleaseClosed',
  { number: S.Number, branch: S.String },
) {
  readonly [PullRequestReleaseDecisionTypeId] = PullRequestReleaseDecisionTypeId
}

export class PullRequestReleaseVacant extends S.TaggedClass<PullRequestReleaseVacant>()(
  'PullRequestReleaseVacant',
  { branch: S.String },
) {
  readonly [PullRequestReleaseDecisionTypeId] = PullRequestReleaseDecisionTypeId
}

export class BodyFileUnreadable extends S.TaggedError<BodyFileUnreadable>()(
  'BodyFileUnreadable',
  { path: FsPath },
) {}

export class HeadRefInvalid extends S.TaggedError<HeadRefInvalid>()(
  'HeadRefInvalid',
  { branch: GitRef },
) {}

const PullRequestCase = S.Union([
  S.TaggedStruct('PRBodyBad', { path: FsPath }),
  S.TaggedStruct('PRHeadBad', { branch: GitRef }),
  S.TaggedStruct('PRDirtyFound', { number: S.Number }),
  S.TaggedStruct('PRDirtyAbsent', {}),
  S.TaggedStruct('PRCleanFound', { number: S.Number }),
  S.TaggedStruct('PRCleanAbsent', {}),
])

type PullRequestCase = S.Schema.Type<typeof PullRequestCase>

export class PullRequestCommand extends S.TaggedClass<PullRequestCommand>()(
  'PullRequestCommand',
  {
    pending: Count,
    existing: PullRequestLookup,
    branch: GitRef,
    base: GitRef,
    title: PrTitle,
    body: S.String,
    bodyIssue: S.optional(FsPath),
  },
) {}

const foundNumber = (existing: PullRequestLookup): number | undefined =>
  Match.value(existing).pipe(
    Match.tag('PullRequestFound', (found) => found.number),
    Match.tag('PullRequestAbsent', () => undefined),
    Match.exhaustive,
  )

const classify = (command: PullRequestCommand): PullRequestCase => {
  if (command.bodyIssue !== undefined) {
    return { _tag: 'PRBodyBad', path: command.bodyIssue }
  }
  if (command.branch === command.base) {
    return { _tag: 'PRHeadBad', branch: command.branch }
  }
  const number = foundNumber(command.existing)
  if (command.pending > 0) {
    if (number !== undefined) {
      return { _tag: 'PRDirtyFound', number }
    }
    return { _tag: 'PRDirtyAbsent' }
  }
  if (number !== undefined) {
    return { _tag: 'PRCleanFound', number }
  }
  return { _tag: 'PRCleanAbsent' }
}

export const pullRequest = Workflow.make(
  PullRequestCommand,
  (
    command,
  ): Result.Result<
    PullRequestReleaseOpened | PullRequestReleaseRefreshed | PullRequestReleaseClosed | PullRequestReleaseVacant,
    BodyFileUnreadable | HeadRefInvalid
  > =>
    Match.value(classify(command)).pipe(
      Match.tag('PRBodyBad', (bad) => Result.fail(BodyFileUnreadable.make({ path: bad.path }))),
      Match.tag('PRHeadBad', (bad) => Result.fail(HeadRefInvalid.make({ branch: bad.branch }))),
      Match.tag('PRDirtyFound', (dirty) => Result.succeed(PullRequestReleaseRefreshed.make({ number: dirty.number }))),
      Match.tag('PRDirtyAbsent', () => Result.succeed(PullRequestReleaseVacant.make({ branch: command.branch }))),
      Match.tag('PRCleanFound', (clean) =>
        Result.succeed(
          PullRequestReleaseClosed.make({ number: clean.number, branch: command.branch }),
        )),
      Match.tag('PRCleanAbsent', () => Result.succeed(PullRequestReleaseVacant.make({ branch: command.branch }))),
      Match.exhaustive,
    ),
)
