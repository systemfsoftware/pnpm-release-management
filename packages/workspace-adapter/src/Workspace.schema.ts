import { PackageManifest, PackageVersion } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export const ManifestText = S.fromJsonString(S.Struct({
  ...PackageManifest.fields,
  version: S.optional(PackageVersion),
}))
export type ManifestText = S.Schema.Type<typeof ManifestText>

export const WorkspaceListing = S.fromJsonString(S.Array(S.Struct({ path: S.String })))
export type WorkspaceListing = S.Schema.Type<typeof WorkspaceListing>
