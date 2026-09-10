import { Count, PackageVersion, RelativePath, VersionSurface } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export const SyncInput = S.Struct({
  strategy: S.String,
  action: S.String,
  version: S.optional(S.String),
  manifest: S.Struct({
    file: RelativePath,
    surface: VersionSurface,
  }),
  surfaces: S.Array(S.Struct({
    file: RelativePath,
    surface: VersionSurface,
  })),
})
export type SyncInput = S.Schema.Type<typeof SyncInput>

export class SyncCommand extends S.TaggedClass<SyncCommand>()(
  'SyncCommand',
  {
    strategy: S.String,
    action: S.String,
    pinned: S.optional(PackageVersion),
    expected: PackageVersion,
    manifestFile: RelativePath,
    entries: S.Array(S.Struct({
      file: RelativePath,
      found: PackageVersion,
    })),
    count: Count,
  },
) {}
