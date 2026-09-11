import * as S from 'effect/Schema'
import { Member, PackageName, RelativePath } from './Workspace.schema.js'

export const ChangeEvidence = S.Struct({
  members: S.Array(Member),
  touched: S.Array(PackageName),
  raw: S.Unknown,
})
export type ChangeEvidence = S.Schema.Type<typeof ChangeEvidence>

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
