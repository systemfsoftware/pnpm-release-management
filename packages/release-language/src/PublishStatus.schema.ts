import * as S from 'effect/Schema'
import { Count, PackageName, PackageVersion } from './Workspace.schema.js'

export const StatusClass = S.Literals([
  'unpublished',
  'no-oidc',
  'stuck',
  'ok',
  'error',
])
export type StatusClass = S.Schema.Type<typeof StatusClass>

export const PackageEvaluation = S.Struct({
  name: PackageName,
  localVersion: PackageVersion,
  npmLatest: S.optional(PackageVersion),
  attested: S.Boolean,
  class: StatusClass,
})
export type PackageEvaluation = S.Schema.Type<typeof PackageEvaluation>

const PublishStatusDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/PublishStatusDecision',
)
type PublishStatusDecisionTypeId = typeof PublishStatusDecisionTypeId

export class PublishStatusHealthy extends S.TaggedClass<
  PublishStatusHealthy
>()(
  'PublishStatusHealthy',
  {
    packages: Count,
  },
) {
  readonly [PublishStatusDecisionTypeId] = PublishStatusDecisionTypeId
}

export class PublishStatusOwed extends S.TaggedClass<PublishStatusOwed>()(
  'PublishStatusOwed',
  {
    unpublished: Count,
    untrusted: Count,
    stuck: Count,
  },
) {
  readonly [PublishStatusDecisionTypeId] = PublishStatusDecisionTypeId
}

export const PublishStatusDecision = S.Union([
  PublishStatusHealthy,
  PublishStatusOwed,
])
export type PublishStatusDecision = S.Schema.Type<typeof PublishStatusDecision>

export const PublishStatusUnpublished = S.TaggedStruct(
  'PublishStatusUnpublished',
  {
    packages: S.NonEmptyArray(PackageName),
  },
)
export type PublishStatusUnpublished = S.Schema.Type<
  typeof PublishStatusUnpublished
>

export const PublishStatusUnattested = S.TaggedStruct(
  'PublishStatusUnattested',
  {
    packages: S.NonEmptyArray(PackageName),
  },
)
export type PublishStatusUnattested = S.Schema.Type<
  typeof PublishStatusUnattested
>

export const PublishStatusUnreadable = S.TaggedStruct(
  'PublishStatusUnreadable',
  {
    packages: S.NonEmptyArray(PackageName),
  },
)
export type PublishStatusUnreadable = S.Schema.Type<
  typeof PublishStatusUnreadable
>

export const PublishStatusEmpty = S.TaggedStruct('PublishStatusEmpty', {
  members: Count,
})
export type PublishStatusEmpty = S.Schema.Type<typeof PublishStatusEmpty>

export const PublishStatusRefusal = S.Union([
  PublishStatusUnpublished,
  PublishStatusUnattested,
  PublishStatusUnreadable,
  PublishStatusEmpty,
])
export type PublishStatusRefusal = S.Schema.Type<typeof PublishStatusRefusal>
