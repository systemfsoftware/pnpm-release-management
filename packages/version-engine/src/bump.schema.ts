import {
  Bump,
  ChangelogStorage,
  Count,
  Intent,
  Member,
  PackageName,
  PackageVersion,
  PlannedRelease,
  RelativePath,
  VersionSurface,
} from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

const VersionTarget = S.Struct({
  file: RelativePath,
  surface: VersionSurface,
})

const ChangesetsInput = S.Struct({
  strategy: S.Literal('changesets'),
  changelogDir: RelativePath,
  surfaces: S.Array(VersionTarget),
})

const SurfacesInput = S.Struct({
  strategy: S.Literal('surfaces'),
  changelogDir: RelativePath,
  rootChangelog: S.optional(RelativePath),
  manifest: VersionTarget,
  surfaces: S.Array(VersionTarget),
})

export const BumpInput = S.Union([ChangesetsInput, SurfacesInput])
export type BumpInput = S.Schema.Type<typeof BumpInput>

const ChangesetsVersioning = S.Struct({
  strategy: S.Literal('changesets'),
  surfaces: S.Array(VersionTarget),
  planned: S.Array(PlannedRelease),
})
export type ChangesetsVersioning = S.Schema.Type<typeof ChangesetsVersioning>

const SurfacesVersioning = S.Struct({
  strategy: S.Literal('surfaces'),
  manifest: VersionTarget,
  surfaces: S.Array(VersionTarget),
  rootChangelog: S.optional(RelativePath),
  manifestVersion: PackageVersion,
  consolidated: Bump,
  consolidatedNext: PackageVersion,
})
export type SurfacesVersioning = S.Schema.Type<typeof SurfacesVersioning>

const CommandVersioning = S.Union([ChangesetsVersioning, SurfacesVersioning])

export class BumpCommand extends S.TaggedClass<BumpCommand>()(
  'BumpCommand',
  {
    versioning: CommandVersioning,
    intents: S.Array(Intent),
    members: S.Array(Member),
    changelogDir: RelativePath,
    changelogStorage: ChangelogStorage,
    moved: S.Array(PackageName),
    changelogPaths: S.Array(S.Struct({
      name: PackageName,
      path: RelativePath,
    })),
    unknownPackage: S.optional(PackageName),
    malformedPath: S.optional(RelativePath),
    intentCount: Count,
  },
) {}
