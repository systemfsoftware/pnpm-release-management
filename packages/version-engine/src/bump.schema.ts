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

export const BumpInput = S.Struct({
  strategy: S.Literals(['pnpm', 'surfaces']),
  changelogDir: RelativePath,
  rootChangelog: S.optional(RelativePath),
  manifest: S.Struct({
    file: RelativePath,
    surface: VersionSurface,
  }),
  surfaces: S.Array(S.Struct({
    file: RelativePath,
    surface: VersionSurface,
  })),
})
export type BumpInput = S.Schema.Type<typeof BumpInput>

export class BumpCommand extends S.TaggedClass<BumpCommand>()(
  'BumpCommand',
  {
    strategy: S.Literals(['pnpm', 'surfaces']),
    intents: S.Array(Intent),
    members: S.Array(Member),
    manifestVersion: PackageVersion,
    changelogDir: RelativePath,
    rootChangelog: S.optional(RelativePath),
    consolidated: Bump,
    consolidatedNext: PackageVersion,
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
