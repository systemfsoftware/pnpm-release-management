import * as S from 'effect/Schema'
import { FsPath, PackageVersion, RepoRoot } from './Workspace.schema.ts'

export const PinName = S.NonEmptyString.pipe(S.brand('PinName'))
export type PinName = S.Schema.Type<typeof PinName>

const PinDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/PinDecision',
)
type PinDecisionTypeId = typeof PinDecisionTypeId

export class WorkspaceVersionRepinned extends S.TaggedClass<
  WorkspaceVersionRepinned
>()(
  'WorkspaceVersionRepinned',
  {
    version: PackageVersion,
    pins: S.Array(PinName),
    text: S.String,
  },
) {
  readonly [PinDecisionTypeId] = PinDecisionTypeId
}

export class WorkspaceVersionAlreadyCurrent extends S.TaggedClass<
  WorkspaceVersionAlreadyCurrent
>()(
  'WorkspaceVersionAlreadyCurrent',
  {
    version: PackageVersion,
    pins: S.Array(PinName),
    text: S.String,
  },
) {
  readonly [PinDecisionTypeId] = PinDecisionTypeId
}

export const PinDecision = S.Union([
  WorkspaceVersionRepinned,
  WorkspaceVersionAlreadyCurrent,
])
export type PinDecision = S.Schema.Type<typeof PinDecision>

export const PinVersionUnusable = S.TaggedStruct('PinVersionUnusable', {
  given: S.optional(S.String),
})
export type PinVersionUnusable = S.Schema.Type<typeof PinVersionUnusable>

export const PinDistributionMissing = S.TaggedStruct(
  'PinDistributionMissing',
  {
    root: RepoRoot,
  },
)
export type PinDistributionMissing = S.Schema.Type<
  typeof PinDistributionMissing
>

export const PinManifestInvalid = S.TaggedStruct('PinManifestInvalid', {
  path: FsPath,
  reason: S.String,
})
export type PinManifestInvalid = S.Schema.Type<typeof PinManifestInvalid>

export const PinRefusal = S.Union([
  PinVersionUnusable,
  PinDistributionMissing,
  PinManifestInvalid,
])
export type PinRefusal = S.Schema.Type<typeof PinRefusal>
