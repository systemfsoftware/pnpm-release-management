import * as S from 'effect/Schema'
import { Member, PackageName, RelativePath } from './Workspace.schema.js'

export const ChangeEvidence = S.Struct({
  members: S.Array(Member),
  touched: S.Array(PackageName),
  raw: S.Unknown,
})
export type ChangeEvidence = S.Schema.Type<typeof ChangeEvidence>

export const GateUnknownPackage = S.TaggedStruct('GateUnknownPackage', {
  path: RelativePath,
  package: PackageName,
})
export type GateUnknownPackage = S.Schema.Type<typeof GateUnknownPackage>

export const GateIntentMissing = S.TaggedStruct('GateIntentMissing', {
  packages: S.NonEmptyArray(PackageName),
})
export type GateIntentMissing = S.Schema.Type<typeof GateIntentMissing>

export const GateRefusal = S.Union([GateUnknownPackage, GateIntentMissing])
export type GateRefusal = S.Schema.Type<typeof GateRefusal>

export class EvidenceFileUnreadable extends S.TaggedError<EvidenceFileUnreadable>()('EvidenceFileUnreadable', {
  path: S.String,
}) {}

export class EvidenceCommandFailed extends S.TaggedError<EvidenceCommandFailed>()('EvidenceCommandFailed', {
  program: S.String,
  detail: S.String,
}) {}

export class TurboPinUnusable extends S.TaggedError<TurboPinUnusable>()('TurboPinUnusable', {
  detail: S.String,
}) {}

export class WorktreeUnavailable extends S.TaggedError<WorktreeUnavailable>()('WorktreeUnavailable', {
  detail: S.String,
}) {}

export class ProcessUnstartable extends S.TaggedError<ProcessUnstartable>()('ProcessUnstartable', {
  program: S.String,
  reason: S.String,
}) {}

export class ProcessUnobservable extends S.TaggedError<ProcessUnobservable>()('ProcessUnobservable', {
  program: S.String,
  reason: S.String,
}) {}

export class TurboDryRunUnreadable extends S.TaggedError<TurboDryRunUnreadable>()('TurboDryRunUnreadable', {
  context: S.String,
  reason: S.String,
}) {}

export class TurboDryRunDrifted extends S.TaggedError<TurboDryRunDrifted>()('TurboDryRunDrifted', {
  context: S.String,
  reason: S.String,
}) {}

export const EvidenceRefusal = S.Union([
  EvidenceFileUnreadable,
  EvidenceCommandFailed,
  TurboPinUnusable,
  WorktreeUnavailable,
  ProcessUnstartable,
  ProcessUnobservable,
  TurboDryRunUnreadable,
  TurboDryRunDrifted,
])
export type EvidenceRefusal = S.Schema.Type<typeof EvidenceRefusal>
