import { PackageVersion, PinName, RelativePath, RepoRoot, TargetSuffix } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export const PinnedManifest = S.Struct({
  name: S.String,
  version: S.optional(S.String),
})

export const PinRootManifestInput = S.Struct({
  manifest: RelativePath,
  requestedVersion: S.optional(S.String),
  suffixes: S.optional(S.Array(TargetSuffix)),
  dryRun: S.optional(S.Boolean),
})
export type PinRootManifestInput = S.Schema.Type<typeof PinRootManifestInput>

export class PinRootManifestCommand extends S.TaggedClass<PinRootManifestCommand>()(
  'PinRootManifestCommand',
  {
    manifestText: S.String,
    manifest: S.Record(S.String, S.Unknown),
    packageName: S.String,
    indent: S.Union([S.String, S.Finite]),
    trailingNewline: S.Boolean,
    requestedVersion: S.optional(S.String),
    requestedUsable: S.optional(PackageVersion),
    declaredVersion: S.optional(S.String),
    declaredUsable: S.optional(PackageVersion),
    suffixes: S.optional(S.Array(TargetSuffix)),
    pinNames: S.Array(PinName),
    repoRoot: RepoRoot,
  },
) {}
