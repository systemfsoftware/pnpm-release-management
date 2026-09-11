import * as S from 'effect/Schema'
import {
  Bump,
  IntentPackages,
  IntentSlug,
  IntentSlugTaken,
  IntentSummary,
  IntentUnknownPackage,
} from './Intent.schema.js'
import { PackageName, RelativePath } from './Workspace.schema.js'

export const NewIntentRequest = S.Struct({
  packages: S.NonEmptyArray(PackageName),
  bump: Bump,
  summary: IntentSummary,
  slug: S.optional(IntentSlug),
})
export type NewIntentRequest = S.Schema.Type<typeof NewIntentRequest>

const NewIntentDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/NewIntentDecision',
)
type NewIntentDecisionTypeId = typeof NewIntentDecisionTypeId

export class IntentStagedNamed extends S.TaggedClass<IntentStagedNamed>()(
  'IntentStagedNamed',
  {
    path: RelativePath,
    packages: IntentPackages,
    bump: Bump,
    summary: IntentSummary,
  },
) {
  readonly [NewIntentDecisionTypeId] = NewIntentDecisionTypeId
}

export class IntentStagedDerived extends S.TaggedClass<IntentStagedDerived>()(
  'IntentStagedDerived',
  {
    path: RelativePath,
    packages: IntentPackages,
    bump: Bump,
    summary: IntentSummary,
  },
) {
  readonly [NewIntentDecisionTypeId] = NewIntentDecisionTypeId
}

export const NewIntentDecision = S.Union([
  IntentStagedNamed,
  IntentStagedDerived,
])
export type NewIntentDecision = S.Schema.Type<typeof NewIntentDecision>

export const NewIntentInvalidBump = S.TaggedStruct('NewIntentInvalidBump', {
  given: S.String,
})
export type NewIntentInvalidBump = S.Schema.Type<typeof NewIntentInvalidBump>

export const NewIntentSummaryMissing = S.TaggedStruct(
  'NewIntentSummaryMissing',
  {
    packages: S.Array(PackageName),
  },
)
export type NewIntentSummaryMissing = S.Schema.Type<
  typeof NewIntentSummaryMissing
>

export const NewIntentPackagesEmpty = S.TaggedStruct('NewIntentPackagesEmpty', {
  bump: Bump,
  summary: IntentSummary,
})
export type NewIntentPackagesEmpty = S.Schema.Type<
  typeof NewIntentPackagesEmpty
>

export const NewIntentPackageNameMalformed = S.TaggedStruct(
  'NewIntentPackageNameMalformed',
  {
    given: S.String,
  },
)
export type NewIntentPackageNameMalformed = S.Schema.Type<
  typeof NewIntentPackageNameMalformed
>

export const NewIntentRefusal = S.Union([
  NewIntentInvalidBump,
  NewIntentSummaryMissing,
  NewIntentPackagesEmpty,
  NewIntentPackageNameMalformed,
  IntentUnknownPackage,
  IntentSlugTaken,
])
export type NewIntentRefusal = S.Schema.Type<typeof NewIntentRefusal>
