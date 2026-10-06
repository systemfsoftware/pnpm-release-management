import * as S from 'effect/Schema'
import { HttpUrl, PackageName, PackageVersion, ReleaseTag } from './Workspace.schema.js'

export const RegistryMetadata = S.Struct({
  tarball: HttpUrl,
  integrity: S.String,
})
export type RegistryMetadata = S.Schema.Type<typeof RegistryMetadata>

export const RegistryFetchFailed = S.TaggedStruct('RegistryFetchFailed', {
  package: PackageName,
  version: PackageVersion,
  reason: S.String,
  status: S.optional(S.Number),
})
export type RegistryFetchFailed = S.Schema.Type<typeof RegistryFetchFailed>

export const RegistryMetadataMalformed = S.TaggedStruct('RegistryMetadataMalformed', {
  package: PackageName,
  version: PackageVersion,
  reason: S.String,
})
export type RegistryMetadataMalformed = S.Schema.Type<typeof RegistryMetadataMalformed>

export const RegistryDownloadFailed = S.TaggedStruct('RegistryDownloadFailed', {
  url: HttpUrl,
  reason: S.String,
  status: S.optional(S.Number),
})
export type RegistryDownloadFailed = S.Schema.Type<typeof RegistryDownloadFailed>

export const RegistryIntegrityMismatch = S.TaggedStruct('RegistryIntegrityMismatch', {
  package: PackageName,
  version: PackageVersion,
  expected: S.String,
  actual: S.String,
})
export type RegistryIntegrityMismatch = S.Schema.Type<typeof RegistryIntegrityMismatch>

export const RegistryRefusal = S.Union([
  RegistryFetchFailed,
  RegistryMetadataMalformed,
  RegistryDownloadFailed,
])
export type RegistryRefusal = S.Schema.Type<typeof RegistryRefusal>

export const AdoptionExcluded = S.Struct({
  tag: ReleaseTag,
  package: PackageName,
  version: PackageVersion,
  reason: S.String,
})
export type AdoptionExcluded = S.Schema.Type<typeof AdoptionExcluded>

export const AdoptionTagUnresolved = S.TaggedStruct('AdoptionTagUnresolved', {
  tag: ReleaseTag,
  reason: S.String,
})
export type AdoptionTagUnresolved = S.Schema.Type<typeof AdoptionTagUnresolved>

export const AdoptionFailure = S.Union([
  RegistryFetchFailed,
  RegistryMetadataMalformed,
  RegistryIntegrityMismatch,
  AdoptionTagUnresolved,
])
export type AdoptionFailure = S.Schema.Type<typeof AdoptionFailure>
