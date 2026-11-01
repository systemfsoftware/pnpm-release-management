import { PackageName, PackageVersion } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export const ManifestFields = S.Struct({
  name: PackageName,
  version: PackageVersion,
})
