import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Count, FsPath, GitRef, PrTitle, PullRequestLookup } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const PullRequestReleaseDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/PullRequestReleaseDecision',
)
type PullRequestReleaseDecisionTypeId = typeof PullRequestReleaseDecisionTypeId

export class PullRequestReleaseOpened extends S.TaggedClass<PullRequestReleaseOpened>()(
  'PullRequestReleaseOpened',
  { number: S.Finite },
) {
  readonly [PullRequestReleaseDecisionTypeId] = PullRequestReleaseDecisionTypeId
}

export class PullRequestReleaseRefreshed extends S.TaggedClass<PullRequestReleaseRefreshed>()(
  'PullRequestReleaseRefreshed',
  { number: S.Finite },
) {
  readonly [PullRequestReleaseDecisionTypeId] = PullRequestReleaseDecisionTypeId
}

export class PullRequestReleaseClosed extends S.TaggedClass<PullRequestReleaseClosed>()(
  'PullRequestReleaseClosed',
  { number: S.Finite, branch: S.String },
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

const BodyBadCase = S.TaggedStruct('PullRequestBodyBad', { path: FsPath })
const HeadBadCase = S.TaggedStruct('PullRequestHeadBad', { branch: GitRef })
const DirtyFoundCase = S.TaggedStruct('PullRequestDirtyFound', { number: S.Finite })
const DirtyAbsentCase = S.TaggedStruct('PullRequestDirtyAbsent', {})
const CleanFoundCase = S.TaggedStruct('PullRequestCleanFound', { number: S.Finite })
const CleanAbsentCase = S.TaggedStruct('PullRequestCleanAbsent', {})
const PullRequestCase = S.Union([
  BodyBadCase,
  HeadBadCase,
  DirtyFoundCase,
  DirtyAbsentCase,
  CleanFoundCase,
  CleanAbsentCase,
])
type PullRequestCase = S.Schema.Type<typeof PullRequestCase>

const cleanCaseOf = (command: PullRequestCommand): PullRequestCase =>
  Match.value(command.existing).pipe(
    Match.tag('PullRequestFound', (found) => CleanFoundCase.make({ number: found.number })),
    Match.tag('PullRequestAbsent', () => CleanAbsentCase.make({})),
    Match.exhaustive,
  )

const dirtyCaseOf = (command: PullRequestCommand): PullRequestCase =>
  Match.value(command.existing).pipe(
    Match.tag('PullRequestFound', (found) => DirtyFoundCase.make({ number: found.number })),
    Match.tag('PullRequestAbsent', () => DirtyAbsentCase.make({})),
    Match.exhaustive,
  )

const pendingCaseOf = (command: PullRequestCommand): PullRequestCase =>
  Match.value(command.pending > 0).pipe(
    Match.when(true, () => dirtyCaseOf(command)),
    Match.when(false, () => cleanCaseOf(command)),
    Match.exhaustive,
  )

const headCaseOf = (command: PullRequestCommand): PullRequestCase =>
  Match.value(command.branch === command.base).pipe(
    Match.when(true, () => HeadBadCase.make({ branch: command.branch })),
    Match.when(false, () => pendingCaseOf(command)),
    Match.exhaustive,
  )

const classify = (command: PullRequestCommand): PullRequestCase =>
  Match.value(Option.fromNullishOr(command.bodyIssue)).pipe(
    Match.tag('Some', (issue) => BodyBadCase.make({ path: issue.value })),
    Match.tag('None', () => headCaseOf(command)),
    Match.exhaustive,
  )

export const pullRequest = Workflow.make(
  PullRequestCommand,
  (
    command,
  ): Result.Result<
    | PullRequestReleaseOpened
    | PullRequestReleaseRefreshed
    | PullRequestReleaseClosed
    | PullRequestReleaseVacant,
    BodyFileUnreadable | HeadRefInvalid
  > =>
    Match.value(classify(command)).pipe(
      Match.tag('PullRequestBodyBad', (bad) => Result.fail(BodyFileUnreadable.make({ path: bad.path }))),
      Match.tag('PullRequestHeadBad', (bad) => Result.fail(HeadRefInvalid.make({ branch: bad.branch }))),
      Match.tag('PullRequestDirtyFound', (dirty) =>
        Result.succeed(PullRequestReleaseRefreshed.make({ number: dirty.number }))),
      Match.tag('PullRequestDirtyAbsent', () =>
        Result.succeed(PullRequestReleaseVacant.make({ branch: command.branch }))),
      Match.tag('PullRequestCleanFound', (clean) =>
        Result.succeed(
          PullRequestReleaseClosed.make({ number: clean.number, branch: command.branch }),
        )),
      Match.tag('PullRequestCleanAbsent', () =>
        Result.succeed(PullRequestReleaseVacant.make({ branch: command.branch }))),
      Match.exhaustive,
    ),
)
