import { CheckKind, DecisionTypeId, StagedPath } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export class StagedChecksCommand extends S.TaggedClass<StagedChecksCommand>()(
  'StagedChecksCommand',
  {
    staged: S.Array(StagedPath),
    merge: S.Boolean,
    scripts: S.Array(S.String),
  },
) {}

export class StagedChecksPassed extends S.TaggedClass<StagedChecksPassed>()(
  'StagedChecksPassed',
  {
    staged: S.Natural,
    checks: S.NonEmptyArray(CheckKind),
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class StagedVacant extends S.TaggedClass<StagedVacant>()(
  'StagedVacant',
  {
    staged: S.Natural,
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class MergeChecksSkipped extends S.TaggedClass<MergeChecksSkipped>()(
  'MergeChecksSkipped',
  {
    staged: S.Natural,
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export const StagedChecksDecision = S.Union([
  StagedChecksPassed,
  StagedVacant,
  MergeChecksSkipped,
])
export type StagedChecksDecision = S.Schema.Type<typeof StagedChecksDecision>
