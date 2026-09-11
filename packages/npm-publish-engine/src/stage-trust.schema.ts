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

export const TrustWorkItem = S.Struct({
  name: PackageName,
  version: PackageVersion,
  mode: TrustWorkMode,
  hasBuild: S.Boolean,
})
export type TrustWorkItem = S.Schema.Type<typeof TrustWorkItem>

export class TrustItemUnstaged extends S.TaggedError<TrustItemUnstaged>()('TrustItemUnstaged', {
  name: S.String,
}) {}
