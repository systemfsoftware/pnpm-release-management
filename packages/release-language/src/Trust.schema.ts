import * as S from 'effect/Schema'
import { Count, PackageName, PackageVersion } from './Workspace.schema.js'

export const TrustSnapshot = S.Struct({
  name: PackageName,
  latest: S.optional(PackageVersion),
  attested: S.Boolean,
  reachable: S.Boolean,
})
export type TrustSnapshot = S.Schema.Type<typeof TrustSnapshot>

export const TrustOnlyUnmatched = S.TaggedStruct('TrustOnlyUnmatched', {
  only: S.NonEmptyArray(PackageName),
})
export type TrustOnlyUnmatched = S.Schema.Type<typeof TrustOnlyUnmatched>

export const TrustWorkspaceEmpty = S.TaggedStruct('TrustWorkspaceEmpty', {
  members: Count,
})
export type TrustWorkspaceEmpty = S.Schema.Type<typeof TrustWorkspaceEmpty>

export const TrustRegistryUnreadable = S.TaggedStruct(
  'TrustRegistryUnreadable',
  {
    packages: S.NonEmptyArray(PackageName),
  },
)
export type TrustRegistryUnreadable = S.Schema.Type<
  typeof TrustRegistryUnreadable
>

export const TrustPublishRefused = S.TaggedStruct('TrustPublishRefused', {
  packages: S.NonEmptyArray(PackageName),
})
export type TrustPublishRefused = S.Schema.Type<typeof TrustPublishRefused>

export const TrustLauncherMissing = S.TaggedStruct('TrustLauncherMissing', {
  package: PackageName,
})
export type TrustLauncherMissing = S.Schema.Type<typeof TrustLauncherMissing>

export const TrustRefusal = S.Union([
  TrustOnlyUnmatched,
  TrustWorkspaceEmpty,
  TrustRegistryUnreadable,
  TrustPublishRefused,
  TrustLauncherMissing,
])
export type TrustRefusal = S.Schema.Type<typeof TrustRefusal>
