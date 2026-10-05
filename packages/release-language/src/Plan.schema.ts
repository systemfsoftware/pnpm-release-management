import * as S from 'effect/Schema'
import { FsPath, PackageName, PackageVersion, RelativePath, ReleaseTag } from './Workspace.schema.js'

export const CycleEntry = S.Struct({
  name: PackageName,
  version: PackageVersion,
  tag: ReleaseTag,
  changelog: RelativePath,
})
export type CycleEntry = S.Schema.Type<typeof CycleEntry>

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
