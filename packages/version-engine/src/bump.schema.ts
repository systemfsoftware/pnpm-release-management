import {
  Bump,
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

export const BumpInput = S.Struct({
  strategy: S.Literals(['changesets', 'surfaces']),
  changelogDir: RelativePath,
  rootChangelog: S.optional(RelativePath),
  manifest: VersionTarget,
  surfaces: S.Array(VersionTarget),
})
export type BumpInput = S.Schema.Type<typeof BumpInput>

export class BumpCommand extends S.TaggedClass<BumpCommand>()(
  'BumpCommand',
  {
    strategy: S.Literals(['changesets', 'surfaces']),
    intents: S.Array(Intent),
    members: S.Array(Member),
    manifestVersion: PackageVersion,
    changelogDir: RelativePath,
    rootChangelog: S.optional(RelativePath),
    manifest: VersionTarget,
    surfaces: S.Array(VersionTarget),
    consolidated: Bump,
    consolidatedNext: PackageVersion,
    moved: S.Array(PackageName),
    changelogPaths: S.Array(S.Struct({
      name: PackageName,
      path: RelativePath,
    })),
    unknownPackage: S.optional(PackageName),
    malformedPath: S.optional(RelativePath),
    intentCount: Count,
    planned: S.Array(PlannedRelease),
  },
) {}
