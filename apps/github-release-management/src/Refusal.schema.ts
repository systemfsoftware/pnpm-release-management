import {
  ChangelogUnreadable,
  ChangelogUnwritable,
  FsPath,
  IntentFrontmatterMalformed,
  IntentSlugTaken,
  IntentUnknownPackage,
  ManifestInvalid,
  ManifestUnreadable,
  PublishCapturedRequired,
  PublishCommandRefused,
  PublishFiltersUnreadable,
  RootManifestUnwritable,
  VersionIntentMalformed,
  VersionSurfaceMissing,
  VersionUnknownPackage,
} from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'
import { SchemaError } from 'effect/Schema'

export const InvalidFlags = S.TaggedStruct('InvalidFlags', { reason: S.String })
export type InvalidFlags = S.Schema.Type<typeof InvalidFlags>

export const OutputUnwritable = S.TaggedStruct('OutputUnwritable', {
  path: FsPath,
  reason: S.String,
})
export type OutputUnwritable = S.Schema.Type<typeof OutputUnwritable>

export const OutputUnreadable = S.TaggedStruct('OutputUnreadable', {
  path: FsPath,
  reason: S.String,
})
export type OutputUnreadable = S.Schema.Type<typeof OutputUnreadable>

export const BoundaryRefusal = S.Union([InvalidFlags, OutputUnwritable, OutputUnreadable])
export type BoundaryRefusal = S.Schema.Type<typeof BoundaryRefusal>

export const BumpRefusal = S.Union([
  ChangelogUnreadable,
  ChangelogUnwritable,
  IntentFrontmatterMalformed,
  IntentSlugTaken,
  IntentUnknownPackage,
  ManifestInvalid,
  ManifestUnreadable,
  PublishCapturedRequired,
  PublishCommandRefused,
  PublishFiltersUnreadable,
  RootManifestUnwritable,
  S.instanceOf(SchemaError),
  VersionIntentMalformed,
  VersionSurfaceMissing,
  VersionUnknownPackage,
])
export type BumpRefusal = S.Schema.Type<typeof BumpRefusal>

export const VersionStageRefused = S.TaggedStruct('VersionStageRefused', {
  refusal: BumpRefusal,
})
export type VersionStageRefused = S.Schema.Type<typeof VersionStageRefused>
