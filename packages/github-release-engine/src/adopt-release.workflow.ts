import { Workflow } from '@systemfsoftware/effect-cell-types'
import {
  AdoptionFailure as AdoptionFailureSchema,
  DecisionTypeId,
  LedgerEntry,
  RelativePath,
} from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class AdoptionRecorded extends S.TaggedClass<AdoptionRecorded>()('AdoptionRecorded', {
  entries: S.Finite,
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class AdoptionVacant extends S.TaggedClass<AdoptionVacant>()('AdoptionVacant', {}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export type AdoptionDecision = AdoptionRecorded | AdoptionVacant

export class AdoptionRefused extends S.TaggedError<AdoptionRefused>()('AdoptionRefused', {
  failures: S.Array(AdoptionFailureSchema),
}) {}

export class AdoptionCommand extends S.TaggedClass<AdoptionCommand>()('AdoptionCommand', {
  entries: S.Array(LedgerEntry),
  failures: S.Array(AdoptionFailureSchema),
  output: RelativePath,
}) {}

const RefusedCase = S.TaggedStruct('Refused', { failures: S.Array(AdoptionFailureSchema) })
const RecordedCase = S.TaggedStruct('Recorded', { entries: S.Finite })
const VacantCase = S.TaggedStruct('Vacant', {})
const AdoptionCase = S.Union([RefusedCase, RecordedCase, VacantCase])
type AdoptionCase = S.Schema.Type<typeof AdoptionCase>

const adoptionCaseOf = (command: AdoptionCommand): AdoptionCase => {
  if (command.failures.length > 0) {
    return RefusedCase.make({ failures: [...command.failures] })
  }
  if (command.entries.length === 0) {
    return VacantCase.make({})
  }
  return RecordedCase.make({ entries: command.entries.length })
}

export const adoptRelease: Workflow.Workflow<AdoptionCommand, AdoptionDecision, AdoptionRefused> = Workflow.make(
  AdoptionCommand,
  (command): Result.Result<AdoptionDecision, AdoptionRefused> =>
    Match.value(adoptionCaseOf(command)).pipe(
      Match.tag('Refused', (refused) => Result.fail(AdoptionRefused.make({ failures: [...refused.failures] }))),
      Match.tag('Recorded', (recorded) => Result.succeed(AdoptionRecorded.make({ entries: recorded.entries }))),
      Match.tag('Vacant', () => Result.succeed(AdoptionVacant.make({}))),
      Match.exhaustive,
    ),
)
