import * as S from 'effect/Schema'
import { ChangelogStorage, PackageName, PackageVersion, RelativePath } from './Workspace.schema.js'

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

export const VersionLockStale = S.TaggedStruct('VersionLockStale', {
  path: RelativePath,
})
export type VersionLockStale = S.Schema.Type<typeof VersionLockStale>

export const VersionCargoPackageMissing = S.TaggedStruct(
  'VersionCargoPackageMissing',
  {
    path: RelativePath,
  },
)
export type VersionCargoPackageMissing = S.Schema.Type<
  typeof VersionCargoPackageMissing
>

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
  VersionLockStale,
  VersionCargoPackageMissing,
  RootManifestUnwritable,
])
export type VersionRefusal = S.Schema.Type<typeof VersionRefusal>

export const ChangelogFile = S.Struct({
  path: RelativePath,
  text: S.String,
})
export type ChangelogFile = S.Schema.Type<typeof ChangelogFile>

export const MemberChangelogEntry = S.Struct({
  storage: ChangelogStorage,
  path: RelativePath,
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
