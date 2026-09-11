import { CheckKind } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export const StagedChecksPassedWire = S.TaggedStruct('StagedChecksPassed', {
  staged: S.Finite,
  checks: S.Array(CheckKind),
})
export type StagedChecksPassedWire = S.Schema.Type<typeof StagedChecksPassedWire>

export const StagedVacantWire = S.TaggedStruct('StagedVacant', {
  staged: S.Finite,
})
export type StagedVacantWire = S.Schema.Type<typeof StagedVacantWire>

export const MergeChecksSkippedWire = S.TaggedStruct('MergeChecksSkipped', {
  staged: S.Finite,
})
export type MergeChecksSkippedWire = S.Schema.Type<typeof MergeChecksSkippedWire>

export const DecisionWire = S.Union([
  StagedChecksPassedWire,
  StagedVacantWire,
  MergeChecksSkippedWire,
])
export type DecisionWire = S.Schema.Type<typeof DecisionWire>
