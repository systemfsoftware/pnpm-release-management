import { PackageName, PackageVersion, TarballIntegrity } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export const IntegrityCheck = S.Struct({
  package: PackageName,
  version: PackageVersion,
  recorded: TarballIntegrity,
  current: TarballIntegrity,
})
export type IntegrityCheck = S.Schema.Type<typeof IntegrityCheck>
