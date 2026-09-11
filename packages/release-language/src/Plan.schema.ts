import * as S from 'effect/Schema'
import { Count, FsPath, PackageName, PackageVersion, RelativePath, ReleaseTag } from './Workspace.schema.js'

export const CycleEntry = S.Struct({
  name: PackageName,
  version: PackageVersion,
  tag: ReleaseTag,
  changelog: RelativePath,
})
export type CycleEntry = S.Schema.Type<typeof CycleEntry>

const PlanDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/PlanDecision',
)
type PlanDecisionTypeId = typeof PlanDecisionTypeId

export class PlanVersion extends S.TaggedClass<PlanVersion>()(
  'PlanVersion',
  {
    pending: Count,
    cycle: S.Array(CycleEntry),
  },
) {
  readonly [PlanDecisionTypeId] = PlanDecisionTypeId
}

export class PlanPublish extends S.TaggedClass<PlanPublish>()(
  'PlanPublish',
  {
    cycle: S.Array(CycleEntry),
  },
) {
  readonly [PlanDecisionTypeId] = PlanDecisionTypeId
}

export class PlanSettled extends S.TaggedClass<PlanSettled>()(
  'PlanSettled',
  {
    pending: Count,
    cycle: Count,
  },
) {
  readonly [PlanDecisionTypeId] = PlanDecisionTypeId
}

export const PlanDecision = S.Union([PlanVersion, PlanPublish, PlanSettled])
export type PlanDecision = S.Schema.Type<typeof PlanDecision>

export const PlanDeferredUnknown = S.TaggedStruct('PlanDeferredUnknown', {
  packages: S.NonEmptyArray(PackageName),
})
export type PlanDeferredUnknown = S.Schema.Type<typeof PlanDeferredUnknown>

export const PlanCapturedMalformed = S.TaggedStruct('PlanCapturedMalformed', {
  path: FsPath,
})
export type PlanCapturedMalformed = S.Schema.Type<typeof PlanCapturedMalformed>

export const PlanRefusal = S.Union([PlanDeferredUnknown, PlanCapturedMalformed])
export type PlanRefusal = S.Schema.Type<typeof PlanRefusal>
