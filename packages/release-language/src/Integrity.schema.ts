import * as S from 'effect/Schema'
import { FsPath, PackageName, PackageVersion, ReleaseTag } from './Workspace.schema.js'

export const TarballIntegrity = S.Struct({
  integrity: S.String,
  files: S.Record(S.String, S.String),
})
export type TarballIntegrity = S.Schema.Type<typeof TarballIntegrity>

export const TarballDigest = S.Struct({
  name: PackageName,
  version: PackageVersion,
  integrity: S.String,
  files: S.Record(S.String, S.String),
})
export type TarballDigest = S.Schema.Type<typeof TarballDigest>

export const TagIntegrityMismatch = S.TaggedStruct('TagIntegrityMismatch', {
  package: PackageName,
  version: PackageVersion,
  recorded: S.String,
  current: S.String,
  file: S.String,
})
export type TagIntegrityMismatch = S.Schema.Type<typeof TagIntegrityMismatch>

export const IntegrityNothingToVerify = S.TaggedStruct('IntegrityNothingToVerify', {})
export type IntegrityNothingToVerify = S.Schema.Type<typeof IntegrityNothingToVerify>

export const IntegrityFilesEmpty = S.TaggedStruct('IntegrityFilesEmpty', {
  package: PackageName,
  version: PackageVersion,
  side: S.Literals(['recorded', 'current']),
})
export type IntegrityFilesEmpty = S.Schema.Type<typeof IntegrityFilesEmpty>

export const TagAnnotationMalformed = S.TaggedStruct('TagAnnotationMalformed', {
  tag: ReleaseTag,
  reason: S.String,
})
export type TagAnnotationMalformed = S.Schema.Type<typeof TagAnnotationMalformed>

export const TagAnnotationLightweight = S.TaggedStruct('TagAnnotationLightweight', {
  tag: ReleaseTag,
})
export type TagAnnotationLightweight = S.Schema.Type<typeof TagAnnotationLightweight>

export const TarballMissing = S.TaggedStruct('TarballMissing', {
  package: PackageName,
  version: PackageVersion,
})
export type TarballMissing = S.Schema.Type<typeof TarballMissing>

export const TarballUnreadable = S.TaggedStruct('TarballUnreadable', {
  path: FsPath,
  reason: S.String,
})
export type TarballUnreadable = S.Schema.Type<typeof TarballUnreadable>

export const TarballRefusal = S.Union([TarballMissing, TarballUnreadable])
export type TarballRefusal = S.Schema.Type<typeof TarballRefusal>

export const IntegrityRefusal = S.Union([
  TagIntegrityMismatch,
  IntegrityNothingToVerify,
  IntegrityFilesEmpty,
  TagAnnotationMalformed,
  TagAnnotationLightweight,
  TarballMissing,
  TarballUnreadable,
])
export type IntegrityRefusal = S.Schema.Type<typeof IntegrityRefusal>
