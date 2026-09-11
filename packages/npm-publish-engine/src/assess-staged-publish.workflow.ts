import { Workflow } from '@systemfsoftware/effect-cell-types'
import { DecisionTypeId, PackageName } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { type TrustPublishRefused } from './stage-trust.schema.js'

export const StagedItemOutcome = S.Struct({
  name: PackageName,
  staged: S.Boolean,
})
export type StagedItemOutcome = S.Schema.Type<typeof StagedItemOutcome>

export class AssessStagedPublishCommand extends S.TaggedClass<AssessStagedPublishCommand>()(
  'AssessStagedPublishCommand',
  {
    outcomes: S.Array(StagedItemOutcome),
  },
) {}

export class StagedPublishCleared extends S.TaggedClass<StagedPublishCleared>()(
  'StagedPublishCleared',
  {
    staged: S.NonEmptyArray(PackageName),
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class StagedPublishVacant extends S.TaggedClass<StagedPublishVacant>()(
  'StagedPublishVacant',
  {
    staged: S.Array(PackageName),
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

const VacantCase = S.TaggedStruct('Vacant', { staged: S.Array(PackageName) })
type VacantCase = S.Schema.Type<typeof VacantCase>

const ClearedCase = S.TaggedStruct('Cleared', { staged: S.NonEmptyArray(PackageName) })
type ClearedCase = S.Schema.Type<typeof ClearedCase>

const RefusedCase = S.TaggedStruct('Refused', { packages: S.NonEmptyArray(PackageName) })
type RefusedCase = S.Schema.Type<typeof RefusedCase>

type StagedPublishCase = VacantCase | ClearedCase | RefusedCase

const namesWhere = (
  command: AssessStagedPublishCommand,
  staged: boolean,
): ReadonlyArray<PackageName> =>
  command.outcomes
    .filter((outcome) => outcome.staged === staged)
    .map((outcome) => outcome.name)

const nonEmptyOf = (
  names: ReadonlyArray<PackageName>,
): readonly [PackageName, ...PackageName[]] | undefined => {
  const first = names[0]
  if (first === undefined) return undefined
  return [first, ...names.slice(1)]
}

const stagedPublishCaseOf = (command: AssessStagedPublishCommand): StagedPublishCase => {
  const failed = nonEmptyOf(namesWhere(command, false))
  if (failed !== undefined) return RefusedCase.make({ packages: failed })
  const staged = nonEmptyOf(namesWhere(command, true))
  if (staged === undefined) return VacantCase.make({ staged: [] })
  return ClearedCase.make({ staged })
}

export const assessStagedPublish = Workflow.make(
  AssessStagedPublishCommand,
  (
    command,
  ): Result.Result<StagedPublishCleared | StagedPublishVacant, TrustPublishRefused> =>
    Match.value(stagedPublishCaseOf(command)).pipe(
      Match.tag('Vacant', (vacant) => Result.succeed(StagedPublishVacant.make({ staged: vacant.staged }))),
      Match.tag('Cleared', (cleared) => Result.succeed(StagedPublishCleared.make({ staged: cleared.staged }))),
      Match.tag(
        'Refused',
        (refused): Result.Result<never, TrustPublishRefused> =>
          Result.fail({ _tag: 'TrustPublishRefused', packages: refused.packages }),
      ),
      Match.exhaustive,
    ),
)
