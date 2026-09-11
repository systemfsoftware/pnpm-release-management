import * as S from 'effect/Schema'
import { Count, PackageName, PackageVersion, RelativePath } from './Workspace.schema.js'

const VersionDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/VersionDecision',
)
type VersionDecisionTypeId = typeof VersionDecisionTypeId

export class VersionBumped extends S.TaggedClass<VersionBumped>()(
  'VersionBumped',
  {
    version: PackageVersion,
    moved: S.Array(PackageName),
    changelogs: S.Array(RelativePath),
  },
) {
  readonly [VersionDecisionTypeId] = VersionDecisionTypeId
}

export class VersionConsumed extends S.TaggedClass<VersionConsumed>()(
  'VersionConsumed',
  {
    consumed: Count,
  },
) {
  readonly [VersionDecisionTypeId] = VersionDecisionTypeId
}

export class VersionIdle extends S.TaggedClass<VersionIdle>()(
  'VersionIdle',
  {
    pending: Count,
  },
) {
  readonly [VersionDecisionTypeId] = VersionDecisionTypeId
}

export const VersionDecision = S.Union([
  VersionBumped,
  VersionConsumed,
  VersionIdle,
])
export type VersionDecision = S.Schema.Type<typeof VersionDecision>

export const VersionIntentMalformed = S.TaggedStruct('VersionIntentMalformed', {
  path: RelativePath,
})
export type VersionIntentMalformed = S.Schema.Type<
  typeof VersionIntentMalformed
>

export const VersionUnknownPackage = S.TaggedStruct('VersionUnknownPackage', {
  package: PackageName,
})
export type VersionUnknownPackage = S.Schema.Type<typeof VersionUnknownPackage>

export const VersionSurfaceMissing = S.TaggedStruct('VersionSurfaceMissing', {
  path: RelativePath,
})
export type VersionSurfaceMissing = S.Schema.Type<typeof VersionSurfaceMissing>

export const RootManifestUnwritable = S.TaggedStruct(
  'RootManifestUnwritable',
  {
    path: RelativePath,
  },
)
export type RootManifestUnwritable = S.Schema.Type<
  typeof RootManifestUnwritable
>

export const VersionRefusal = S.Union([
  VersionIntentMalformed,
  VersionUnknownPackage,
  VersionSurfaceMissing,
  RootManifestUnwritable,
])
export type VersionRefusal = S.Schema.Type<typeof VersionRefusal>

export const ChangelogFile = S.Struct({
  path: RelativePath,
  text: S.String,
})
export type ChangelogFile = S.Schema.Type<typeof ChangelogFile>

export const MemberChangelogEntry = S.Struct({
  changelogDir: RelativePath,
  name: PackageName,
  version: PackageVersion,
  summary: S.String,
})
export type MemberChangelogEntry = S.Schema.Type<typeof MemberChangelogEntry>

export const RootChangelogAppend = S.Struct({
  path: RelativePath,
  version: PackageVersion,
  summary: S.String,
})
export type RootChangelogAppend = S.Schema.Type<typeof RootChangelogAppend>

export const ChangelogUnreadable = S.TaggedStruct('ChangelogUnreadable', {
  path: RelativePath,
})
export type ChangelogUnreadable = S.Schema.Type<typeof ChangelogUnreadable>

export const ChangelogUnwritable = S.TaggedStruct('ChangelogUnwritable', {
  path: RelativePath,
  reason: S.String,
})
export type ChangelogUnwritable = S.Schema.Type<typeof ChangelogUnwritable>

export const ChangelogRefusal = S.Union([
  ChangelogUnreadable,
  ChangelogUnwritable,
])
export type ChangelogRefusal = S.Schema.Type<typeof ChangelogRefusal>
