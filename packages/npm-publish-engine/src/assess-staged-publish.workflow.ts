import { Workflow } from '@systemfsoftware/effect-cell-types'
import { PackageName } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

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

const AssessStagedPublishTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/npm-publish-engine/AssessStagedPublishDecision',
)
type AssessStagedPublishTypeId = typeof AssessStagedPublishTypeId

export class StagedPublishCleared extends S.TaggedClass<StagedPublishCleared>()(
  'StagedPublishCleared',
  {
    staged: S.NonEmptyArray(PackageName),
  },
) {
  readonly [AssessStagedPublishTypeId] = AssessStagedPublishTypeId
}

export class StagedPublishVacant extends S.TaggedClass<StagedPublishVacant>()(
  'StagedPublishVacant',
  {
    staged: S.Array(PackageName),
  },
) {
  readonly [AssessStagedPublishTypeId] = AssessStagedPublishTypeId
}

export class TrustPublishRefused extends S.TaggedError<TrustPublishRefused>()(
  'TrustPublishRefused',
  { packages: S.NonEmptyArray(PackageName) },
) {}

const VacantCase = S.TaggedStruct('Vacant', {})
const ClearedCase = S.TaggedStruct('Cleared', { staged: S.Array(PackageName) })
const RefusedCase = S.TaggedStruct('Refused', { packages: S.Array(PackageName) })
const StagedPublishCase = S.Union([VacantCase, ClearedCase, RefusedCase])
type StagedPublishCase = S.Schema.Type<typeof StagedPublishCase>

const nonEmptyOf = <T>(
  values: ReadonlyArray<T>,
): Option.Option<readonly [T, ...T[]]> =>
  Option.map(
    Option.fromNullishOr(values[0]),
    (head): readonly [T, ...T[]] => [head, ...values.slice(1)],
  )

const stagedIn = (
  command: AssessStagedPublishCommand,
): ReadonlyArray<PackageName> =>
  command.outcomes
    .filter((outcome) => outcome.staged === true)
    .map((outcome) => outcome.name)

const failedIn = (
  command: AssessStagedPublishCommand,
): ReadonlyArray<PackageName> =>
  command.outcomes
    .filter((outcome) => outcome.staged === false)
    .map((outcome) => outcome.name)

const stagedCaseOf = (command: AssessStagedPublishCommand): StagedPublishCase =>
  Match.value(Option.fromNullishOr(stagedIn(command)[0])).pipe(
    Match.tag('None', () => VacantCase.make({})),
    Match.tag('Some', () => ClearedCase.make({ staged: [...stagedIn(command)] })),
    Match.exhaustive,
  )

const classify = (command: AssessStagedPublishCommand): StagedPublishCase =>
  Match.value(Option.fromNullishOr(failedIn(command)[0])).pipe(
    Match.tag('None', () => stagedCaseOf(command)),
    Match.tag('Some', () => RefusedCase.make({ packages: [...failedIn(command)] })),
    Match.exhaustive,
  )

export const assessStagedPublish = Workflow.make(
  AssessStagedPublishCommand,
  (
    command,
  ): Result.Result<StagedPublishCleared | StagedPublishVacant, TrustPublishRefused> =>
    Match.value(classify(command)).pipe(
      Match.tag('Vacant', () => Result.succeed(StagedPublishVacant.make({ staged: [] }))),
      Match.tag('Cleared', (cleared) =>
        Result.succeed(
          StagedPublishCleared.make({
            staged: Option.getOrThrow(nonEmptyOf(cleared.staged)),
          }),
        )),
      Match.tag('Refused', (refused) =>
        Result.fail(
          TrustPublishRefused.make({
            packages: Option.getOrThrow(nonEmptyOf(refused.packages)),
          }),
        )),
      Match.exhaustive,
    ),
)
