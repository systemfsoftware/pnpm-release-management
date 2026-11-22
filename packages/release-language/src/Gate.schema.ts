import * as S from 'effect/Schema'
import { Bump } from './Intent.schema.js'
import { CommitSha } from './Tag.schema.js'
import { PackageName, RelativePath } from './Workspace.schema.js'

export const ChangeRange = S.Struct({
  head: CommitSha,
  base: CommitSha,
  mergeBase: CommitSha,
})
export type ChangeRange = S.Schema.Type<typeof ChangeRange>

export const PathChange = S.Struct({
  path: RelativePath,
  status: S.Literals(['added', 'modified', 'deleted']),
})
export type PathChange = S.Schema.Type<typeof PathChange>

export const RangeCommit = S.Struct({
  sha: CommitSha,
  parents: S.Array(CommitSha),
  changes: S.Array(PathChange),
  residue: S.Array(RelativePath),
})
export type RangeCommit = S.Schema.Type<typeof RangeCommit>

export const TurboTask = S.Struct({
  taskId: S.NonEmptyString,
  package: S.NonEmptyString,
  hash: S.NonEmptyString,
  dependencies: S.Array(S.NonEmptyString),
  inputs: S.Record(S.String, S.String),
  externalHash: S.String,
})
export type TurboTask = S.Schema.Type<typeof TurboTask>

export const TurboRun = S.Struct({
  tasks: S.Array(TurboTask),
  globalFiles: S.Record(S.String, S.String),
  globalOther: S.String,
})
export type TurboRun = S.Schema.Type<typeof TurboRun>

export const TurboComparison = S.Struct({
  task: S.NonEmptyString,
  base: TurboRun,
  head: TurboRun,
})
export type TurboComparison = S.Schema.Type<typeof TurboComparison>

export const ReleaseCandidate = S.Struct({
  commit: CommitSha,
  parent: CommitSha,
  consumed: S.Array(RelativePath),
  intentOnly: S.Boolean,
})
export type ReleaseCandidate = S.Schema.Type<typeof ReleaseCandidate>

export const ReleaseReplayed = S.TaggedStruct('ReleaseReplayed', {
  divergent: S.Array(RelativePath),
})
export type ReleaseReplayed = S.Schema.Type<typeof ReleaseReplayed>

export const ReleaseUnreplayed = S.TaggedStruct('ReleaseUnreplayed', {
  reason: S.String,
})
export type ReleaseUnreplayed = S.Schema.Type<typeof ReleaseUnreplayed>

export const ReplayOutcome = S.Union([ReleaseReplayed, ReleaseUnreplayed])
export type ReplayOutcome = S.Schema.Type<typeof ReplayOutcome>

export const ReleaseCheck = S.Struct({
  candidate: ReleaseCandidate,
  outcome: ReplayOutcome,
  staleSurfaces: S.Array(RelativePath),
})
export type ReleaseCheck = S.Schema.Type<typeof ReleaseCheck>

export const BaseIntent = S.Struct({
  path: RelativePath,
  packages: S.optional(S.Array(S.Struct({ name: PackageName, bump: Bump }))),
})
export type BaseIntent = S.Schema.Type<typeof BaseIntent>

export const GateUnknownPackage = S.TaggedStruct('GateUnknownPackage', {
  path: RelativePath,
  package: PackageName,
})
export type GateUnknownPackage = S.Schema.Type<typeof GateUnknownPackage>

export const GateIntentMissing = S.TaggedStruct('GateIntentMissing', {
  packages: S.NonEmptyArray(PackageName),
})
export type GateIntentMissing = S.Schema.Type<typeof GateIntentMissing>

export const GateReleaseDiverged = S.TaggedStruct('GateReleaseDiverged', {
  commit: CommitSha,
  paths: S.NonEmptyArray(RelativePath),
})
export type GateReleaseDiverged = S.Schema.Type<typeof GateReleaseDiverged>

export const GateReleaseUnreplayable = S.TaggedStruct('GateReleaseUnreplayable', {
  commit: CommitSha,
  reason: S.String,
})
export type GateReleaseUnreplayable = S.Schema.Type<typeof GateReleaseUnreplayable>

export const GateReleaseStale = S.TaggedStruct('GateReleaseStale', {
  commit: CommitSha,
  paths: S.NonEmptyArray(RelativePath),
})
export type GateReleaseStale = S.Schema.Type<typeof GateReleaseStale>

export const GateBaseIntentMalformed = S.TaggedStruct('GateBaseIntentMalformed', {
  path: RelativePath,
})
export type GateBaseIntentMalformed = S.Schema.Type<typeof GateBaseIntentMalformed>

export const DroppedRelease = S.Struct({
  package: PackageName,
  pending: Bump,
  remaining: S.optional(Bump),
  intents: S.Array(RelativePath),
})
export type DroppedRelease = S.Schema.Type<typeof DroppedRelease>

export const GateReleaseDropped = S.TaggedStruct('GateReleaseDropped', {
  dropped: S.NonEmptyArray(DroppedRelease),
})
export type GateReleaseDropped = S.Schema.Type<typeof GateReleaseDropped>

export const GateRefusal = S.Union([
  GateUnknownPackage,
  GateIntentMissing,
  GateReleaseDiverged,
  GateReleaseUnreplayable,
  GateReleaseStale,
  GateBaseIntentMalformed,
  GateReleaseDropped,
])
export type GateRefusal = S.Schema.Type<typeof GateRefusal>

export class EvidenceFileUnreadable extends S.TaggedError<EvidenceFileUnreadable>()('EvidenceFileUnreadable', {
  path: S.String,
}) {}

export class EvidenceCommandFailed extends S.TaggedError<EvidenceCommandFailed>()('EvidenceCommandFailed', {
  program: S.String,
  detail: S.String,
}) {}

export class EvidenceShallowClone extends S.TaggedError<EvidenceShallowClone>()('EvidenceShallowClone', {
  root: S.String,
}) {}

export class TurboPinUnusable extends S.TaggedError<TurboPinUnusable>()('TurboPinUnusable', {
  detail: S.String,
}) {}

export const TurboConfigFile = S.Literals(['turbo.json', 'turbo.jsonc'])
export type TurboConfigFile = S.Schema.Type<typeof TurboConfigFile>

export class PathsGateUnderTurbo extends S.TaggedError<PathsGateUnderTurbo>()('PathsGateUnderTurbo', {
  turboConfig: TurboConfigFile,
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
  EvidenceShallowClone,
  TurboPinUnusable,
  PathsGateUnderTurbo,
  WorktreeUnavailable,
  ProcessUnstartable,
  ProcessUnobservable,
  TurboDryRunUnreadable,
  TurboDryRunDrifted,
])
export type EvidenceRefusal = S.Schema.Type<typeof EvidenceRefusal>
