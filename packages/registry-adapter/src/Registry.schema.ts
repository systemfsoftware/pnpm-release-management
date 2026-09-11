import { PackageVersion } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export const PackumentDoc = S.Struct({
  'dist-tags': S.optional(S.Record(S.String, S.Unknown)),
  versions: S.optional(S.Record(S.String, S.Unknown)),
  error: S.optional(S.Unknown),
})
export type PackumentDoc = S.Schema.Type<typeof PackumentDoc>

export const VersionDoc = S.Struct({
  dist: S.optional(S.Struct({ attestations: S.optional(S.Unknown) })),
})
export type VersionDoc = S.Schema.Type<typeof VersionDoc>

export const PublishedBase = S.TaggedStruct('Published', {
  latest: PackageVersion,
  attested: S.Boolean,
  versions: S.optional(S.Record(S.String, S.Unknown)),
})
export type PublishedBase = S.Schema.Type<typeof PublishedBase>

export const UnpublishedBase = S.TaggedStruct('Unpublished', {})
export type UnpublishedBase = S.Schema.Type<typeof UnpublishedBase>

export type RegistryDoc = PublishedBase | UnpublishedBase
