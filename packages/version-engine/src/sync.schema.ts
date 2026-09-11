import { Count, PackageVersion, RelativePath, VersionSurface } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

const VersionTarget = S.Struct({
  file: RelativePath,
  surface: VersionSurface,
})

export const SyncInput = S.Struct({
  strategy: S.String,
  action: S.String,
  version: S.optional(S.String),
  manifest: VersionTarget,
  surfaces: S.Array(VersionTarget),
})
export type SyncInput = S.Schema.Type<typeof SyncInput>

export class SyncCommand extends S.TaggedClass<SyncCommand>()(
  'SyncCommand',
  {
    strategy: S.String,
    action: S.String,
    pinned: S.optional(PackageVersion),
    expected: PackageVersion,
    manifest: VersionTarget,
    entries: S.Array(S.Struct({
      file: RelativePath,
      surface: VersionSurface,
      found: PackageVersion,
    })),
    count: Count,
  },
) {}
