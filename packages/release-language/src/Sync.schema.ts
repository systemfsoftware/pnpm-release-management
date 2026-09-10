import * as S from 'effect/Schema'
import { Count, PackageVersion, RelativePath } from './Workspace.schema.ts'

export const SurfaceWrite = S.Struct({
  path: RelativePath,
  moved: S.Boolean,
})
export type SurfaceWrite = S.Schema.Type<typeof SurfaceWrite>

export const SyncDrift = S.Struct({
  path: RelativePath,
  found: PackageVersion,
})
export type SyncDrift = S.Schema.Type<typeof SyncDrift>

const SyncDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/SyncDecision',
)
type SyncDecisionTypeId = typeof SyncDecisionTypeId

export class SyncAligned extends S.TaggedClass<SyncAligned>()(
  'SyncAligned',
  {
    version: PackageVersion,
    surfaces: Count,
  },
) {
  readonly [SyncDecisionTypeId] = SyncDecisionTypeId
}

export class SyncRealigned extends S.TaggedClass<SyncRealigned>()(
  'SyncRealigned',
  {
    version: PackageVersion,
    rewritten: S.Array(RelativePath),
  },
) {
  readonly [SyncDecisionTypeId] = SyncDecisionTypeId
}

export const SyncDecision = S.Union([SyncAligned, SyncRealigned])
export type SyncDecision = S.Schema.Type<typeof SyncDecision>

export const SyncStrategyMismatch = S.TaggedStruct('SyncStrategyMismatch', {
  strategy: S.String,
})
export type SyncStrategyMismatch = S.Schema.Type<typeof SyncStrategyMismatch>

export const SyncSurfacesDrifted = S.TaggedStruct('SyncSurfacesDrifted', {
  expected: PackageVersion,
  diffs: S.NonEmptyArray(SyncDrift),
})
export type SyncSurfacesDrifted = S.Schema.Type<typeof SyncSurfacesDrifted>

export const SyncVersionMissing = S.TaggedStruct('SyncVersionMissing', {
  action: S.Literal('bump'),
})
export type SyncVersionMissing = S.Schema.Type<typeof SyncVersionMissing>

export const SyncActionUnknown = S.TaggedStruct('SyncActionUnknown', {
  given: S.String,
})
export type SyncActionUnknown = S.Schema.Type<typeof SyncActionUnknown>

export const SyncRefusal = S.Union([
  SyncStrategyMismatch,
  SyncSurfacesDrifted,
  SyncVersionMissing,
  SyncActionUnknown,
])
export type SyncRefusal = S.Schema.Type<typeof SyncRefusal>
