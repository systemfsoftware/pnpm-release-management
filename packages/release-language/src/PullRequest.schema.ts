import * as S from 'effect/Schema'
import { FsPath, GitRef } from './Workspace.schema.ts'

export const ReleaseLabel = S.NonEmptyString.pipe(S.brand('ReleaseLabel'))
export type ReleaseLabel = S.Schema.Type<typeof ReleaseLabel>
export const PullRequestNumber = S.Int.pipe(
  S.check(S.isGreaterThanOrEqualTo(1)),
  S.brand('PullRequestNumber'),
)
export type PullRequestNumber = S.Schema.Type<typeof PullRequestNumber>

export const BranchDeleted = S.Struct({
  branch: GitRef,
  deleted: S.Boolean,
})
export type BranchDeleted = S.Schema.Type<typeof BranchDeleted>

export const PullRequestFound = S.TaggedStruct('PullRequestFound', {
  number: PullRequestNumber,
})
export type PullRequestFound = S.Schema.Type<typeof PullRequestFound>

export const PullRequestAbsent = S.TaggedStruct('PullRequestAbsent', {
  head: GitRef,
})
export type PullRequestAbsent = S.Schema.Type<typeof PullRequestAbsent>

export const PullRequestLookup = S.Union([
  PullRequestFound,
  PullRequestAbsent,
])
export type PullRequestLookup = S.Schema.Type<typeof PullRequestLookup>

export const PullRequestSummary = S.Struct({
  number: PullRequestNumber,
  title: S.String,
  head: GitRef,
})
export type PullRequestSummary = S.Schema.Type<typeof PullRequestSummary>

const PullRequestDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/PullRequestDecision',
)
type PullRequestDecisionTypeId = typeof PullRequestDecisionTypeId

export class PullRequestCreated extends S.TaggedClass<PullRequestCreated>()(
  'PullRequestCreated',
  {
    number: PullRequestNumber,
  },
) {
  readonly [PullRequestDecisionTypeId] = PullRequestDecisionTypeId
}

export class PullRequestUpdated extends S.TaggedClass<PullRequestUpdated>()(
  'PullRequestUpdated',
  {
    number: PullRequestNumber,
  },
) {
  readonly [PullRequestDecisionTypeId] = PullRequestDecisionTypeId
}

export class PullRequestClosed extends S.TaggedClass<PullRequestClosed>()(
  'PullRequestClosed',
  {
    number: PullRequestNumber,
    branch: BranchDeleted,
  },
) {
  readonly [PullRequestDecisionTypeId] = PullRequestDecisionTypeId
}

export class PullRequestVacant extends S.TaggedClass<PullRequestVacant>()(
  'PullRequestVacant',
  {
    branch: GitRef,
  },
) {
  readonly [PullRequestDecisionTypeId] = PullRequestDecisionTypeId
}

export const PullRequestDecision = S.Union([
  PullRequestCreated,
  PullRequestUpdated,
  PullRequestClosed,
  PullRequestVacant,
])
export type PullRequestDecision = S.Schema.Type<typeof PullRequestDecision>

export const PullRequestBodyUnreadable = S.TaggedStruct(
  'PullRequestBodyUnreadable',
  {
    path: FsPath,
  },
)
export type PullRequestBodyUnreadable = S.Schema.Type<
  typeof PullRequestBodyUnreadable
>

export const PullRequestHeadInvalid = S.TaggedStruct('PullRequestHeadInvalid', {
  branch: GitRef,
})
export type PullRequestHeadInvalid = S.Schema.Type<
  typeof PullRequestHeadInvalid
>

export const PullRequestRefusal = S.Union([
  PullRequestBodyUnreadable,
  PullRequestHeadInvalid,
])
export type PullRequestRefusal = S.Schema.Type<typeof PullRequestRefusal>
