import {
  Bump,
  Count,
  Intent,
  Member,
  PackageName,
  PackageVersion,
  RelativePath,
  VersionSurface,
} from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

const VersionTarget = S.Struct({
  file: RelativePath,
  surface: VersionSurface,
})

const PnpmInput = S.Struct({
  strategy: S.Literal('pnpm'),
  changelogDir: RelativePath,
})

const SurfacesInput = S.Struct({
  strategy: S.Literal('surfaces'),
  changelogDir: RelativePath,
  rootChangelog: S.optional(RelativePath),
  manifest: VersionTarget,
  surfaces: S.Array(VersionTarget),
})

export const BumpInput = S.Union([PnpmInput, SurfacesInput])
export type BumpInput = S.Schema.Type<typeof BumpInput>

const PnpmVersioning = S.Struct({
  strategy: S.Literal('pnpm'),
})

const SurfacesVersioning = S.Struct({
  strategy: S.Literal('surfaces'),
  manifest: VersionTarget,
  surfaces: S.Array(VersionTarget),
  rootChangelog: S.optional(RelativePath),
  manifestVersion: PackageVersion,
  consolidatedNext: PackageVersion,
})
export type SurfacesVersioning = S.Schema.Type<typeof SurfacesVersioning>

const CommandVersioning = S.Union([PnpmVersioning, SurfacesVersioning])

export class BumpCommand extends S.TaggedClass<BumpCommand>()(
  'BumpCommand',
  {
    versioning: CommandVersioning,
    intents: S.Array(Intent),
    members: S.Array(Member),
    changelogDir: RelativePath,
    consolidated: Bump,
    nexts: S.Array(S.Struct({
      name: PackageName,
      next: PackageVersion,
    })),
    moved: S.Array(PackageName),
    changelogPaths: S.Array(S.Struct({
      name: PackageName,
      path: RelativePath,
    })),
    packageRanks: S.Array(S.Struct({
      name: PackageName,
      rank: Bump,
      summaries: S.Array(S.String),
    })),
    unknownPackage: S.optional(PackageName),
    malformedPath: S.optional(RelativePath),
    intentCount: Count,
  },
) {}
