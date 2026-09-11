import * as S from 'effect/Schema'
import { Count, PackageName, PackageVersion } from './Workspace.schema.js'

export const TrustSnapshot = S.Struct({
  name: PackageName,
  latest: S.optional(PackageVersion),
  attested: S.Boolean,
  reachable: S.Boolean,
})
export type TrustSnapshot = S.Schema.Type<typeof TrustSnapshot>

export const TrustOwed = S.Struct({
  name: PackageName,
  mode: S.Literals(['debut', 'untrusted']),
})
export type TrustOwed = S.Schema.Type<typeof TrustOwed>

const TrustDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/TrustDecision',
)
type TrustDecisionTypeId = typeof TrustDecisionTypeId

export class TrustComplete extends S.TaggedClass<TrustComplete>()(
  'TrustComplete',
  {
    processed: Count,
    debuts: Count,
  },
) {
  readonly [TrustDecisionTypeId] = TrustDecisionTypeId
}

export class TrustIdle extends S.TaggedClass<TrustIdle>()(
  'TrustIdle',
  {
    packages: Count,
  },
) {
  readonly [TrustDecisionTypeId] = TrustDecisionTypeId
}

export const TrustDecision = S.Union([TrustComplete, TrustIdle])
export type TrustDecision = S.Schema.Type<typeof TrustDecision>

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
