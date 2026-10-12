import * as S from 'effect/Schema'
import { ReleaseBump } from './Intent.schema.js'
import { Count, PackageName, PackageVersion } from './Workspace.schema.js'

export const PlannedRelease = S.Struct({
  name: PackageName,
  type: ReleaseBump,
  oldVersion: PackageVersion,
  newVersion: PackageVersion,
  summary: S.String,
})
export type PlannedRelease = S.Schema.Type<typeof PlannedRelease>

export const PlannedBump = S.Struct({
  changesets: Count,
  releases: S.Array(PlannedRelease),
})
export type PlannedBump = S.Schema.Type<typeof PlannedBump>
