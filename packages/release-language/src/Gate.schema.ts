import * as S from 'effect/Schema'
import { Member, PackageName, RelativePath } from './Workspace.schema.ts'

export const ChangeEvidence = S.Struct({
  members: S.Array(Member),
  touched: S.Array(PackageName),
  raw: S.Unknown,
})
export type ChangeEvidence = S.Schema.Type<typeof ChangeEvidence>

const GateDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/GateDecision',
)
type GateDecisionTypeId = typeof GateDecisionTypeId

export class GateSatisfied extends S.TaggedClass<GateSatisfied>()(
  'GateSatisfied',
  {
    touched: S.Array(PackageName),
  },
) {
  readonly [GateDecisionTypeId] = GateDecisionTypeId
}

export class GateVacant extends S.TaggedClass<GateVacant>()(
  'GateVacant',
  {
    members: S.Array(PackageName),
  },
) {
  readonly [GateDecisionTypeId] = GateDecisionTypeId
}

export const GateDecision = S.Union([GateSatisfied, GateVacant])
export type GateDecision = S.Schema.Type<typeof GateDecision>

export const GateUnknownPackage = S.TaggedStruct('GateUnknownPackage', {
  path: RelativePath,
  package: PackageName,
})
export type GateUnknownPackage = S.Schema.Type<typeof GateUnknownPackage>

export const GateIntentMissing = S.TaggedStruct('GateIntentMissing', {
  packages: S.NonEmptyArray(PackageName),
})
export type GateIntentMissing = S.Schema.Type<typeof GateIntentMissing>

export const GateRefusal = S.Union([GateUnknownPackage, GateIntentMissing])
export type GateRefusal = S.Schema.Type<typeof GateRefusal>
