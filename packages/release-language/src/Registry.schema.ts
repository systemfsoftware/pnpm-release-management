import * as S from 'effect/Schema'
import { TarballUnreadable } from './Integrity.schema.js'
import { HttpUrl, PackageName, PackageVersion } from './Workspace.schema.js'

export const RegistryMetadata = S.Struct({
  tarball: HttpUrl,
  integrity: S.String,
})
export type RegistryMetadata = S.Schema.Type<typeof RegistryMetadata>

export const RegistryFetchFailed = S.TaggedStruct('RegistryFetchFailed', {
  package: PackageName,
  version: PackageVersion,
  reason: S.String,
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

export const AdoptionFailure = S.Union([
  RegistryFetchFailed,
  RegistryMetadataMalformed,
  RegistryDownloadFailed,
  RegistryIntegrityMismatch,
  TarballUnreadable,
])
export type AdoptionFailure = S.Schema.Type<typeof AdoptionFailure>
