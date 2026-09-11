import { PackageVersion } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export const PackumentDoc = S.Struct({
  'dist-tags': S.optional(S.Record(S.String, S.Unknown)),
  versions: S.optional(S.Record(S.String, S.Unknown)),
  error: S.optional(S.Unknown),
})
export type PackumentDoc = S.Schema.Type<typeof PackumentDoc>

export const PublishedBase = S.TaggedStruct('Published', {
  latest: PackageVersion,
  attested: S.Boolean,
  versions: S.optional(S.Record(S.String, S.Unknown)),
})
export const UnpublishedBase = S.TaggedStruct('Unpublished', {})

export type RegistryDoc =
  | S.Schema.Type<typeof PublishedBase>
  | S.Schema.Type<typeof UnpublishedBase>
