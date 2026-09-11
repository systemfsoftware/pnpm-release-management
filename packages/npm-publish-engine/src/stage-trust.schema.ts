import { PackageName, PackageVersion, TrustSnapshot } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export const TrustCandidateState = S.Struct({
  name: PackageName,
  version: PackageVersion,
  hasBuild: S.Boolean,
  snapshot: TrustSnapshot,
})
export type TrustCandidateState = S.Schema.Type<typeof TrustCandidateState>

export const TrustWorkMode = S.Literals(['debut', 'untrusted'])
export type TrustWorkMode = S.Schema.Type<typeof TrustWorkMode>

export const TrustWorkStep = S.Literals(['build', 'publish', 'trust-github', 'trust-list'])
export type TrustWorkStep = S.Schema.Type<typeof TrustWorkStep>

export const TrustWorkItem = S.Struct({
  name: PackageName,
  version: PackageVersion,
  mode: TrustWorkMode,
  hasBuild: S.Boolean,
  steps: S.Array(TrustWorkStep),
})
export type TrustWorkItem = S.Schema.Type<typeof TrustWorkItem>

export const TrustPublishRefused = S.TaggedStruct('TrustPublishRefused', {
  packages: S.NonEmptyArray(PackageName),
})
export type TrustPublishRefused = S.Schema.Type<typeof TrustPublishRefused>

export const TrustLauncherMissing = S.TaggedStruct('TrustLauncherMissing', {
  package: PackageName,
})
export type TrustLauncherMissing = S.Schema.Type<typeof TrustLauncherMissing>

export class TrustItemUnstaged extends S.TaggedError<TrustItemUnstaged>()('TrustItemUnstaged', {
  name: S.String,
}) {}
