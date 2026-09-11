import { Workflow } from '@systemfsoftware/effect-cell-types'
import { CheckKind, Count, type StagedChecksRefusal, StagedPath } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const Counts = Count

export class StagedChecksCommand extends S.TaggedClass<StagedChecksCommand>()(
  'StagedChecksCommand',
  {
    staged: S.Array(StagedPath),
    merge: S.Boolean,
    scripts: S.Array(S.String),
  },
) {}

const StagedChecksDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/git-hooks-engine/StagedChecksDecision',
)
type StagedChecksDecisionTypeId = typeof StagedChecksDecisionTypeId

export class StagedChecksRan extends S.TaggedClass<StagedChecksRan>()(
  'StagedChecksRan',
  {
    staged: Count,
    checks: S.NonEmptyArray(CheckKind),
    formattable: S.Array(StagedPath),
  },
) {
  readonly [StagedChecksDecisionTypeId] = StagedChecksDecisionTypeId
}

export class StagedChecksIdle extends S.TaggedClass<StagedChecksIdle>()(
  'StagedChecksIdle',
  {
    staged: Count,
  },
) {
  readonly [StagedChecksDecisionTypeId] = StagedChecksDecisionTypeId
}

export class StagedChecksSkipped extends S.TaggedClass<StagedChecksSkipped>()(
  'StagedChecksSkipped',
  {
    staged: Count,
  },
) {
  readonly [StagedChecksDecisionTypeId] = StagedChecksDecisionTypeId
}

const MergeCase = S.TaggedStruct('MergeInProgress', { staged: Count })

const VacantCase = S.TaggedStruct('StagedVacant', { staged: Count })

const RunCase = S.TaggedStruct('StagedChecksRun', {
  staged: Count,
  checks: S.NonEmptyArray(CheckKind),
  formattable: S.Array(StagedPath),
})

const StagedChecksCase = S.Union([MergeCase, VacantCase, RunCase])
type StagedChecksCase = S.Schema.Type<typeof StagedChecksCase>

const FORMATTABLE = /\.(ts|mjs|cjs|js|json|jsonc|md|ya?ml|toml)$/

const FORMAT_CHECKS: readonly [CheckKind, ...CheckKind[]] = ['format', 'typecheck', 'lint']
const PLAIN_CHECKS: readonly [CheckKind, ...CheckKind[]] = ['typecheck', 'lint']

const countOf = (value: number): Count => Option.getOrThrow(Option.getSuccess(S.decodeUnknownResult(Counts)(value)))

const formattableOf = (staged: ReadonlyArray<StagedPath>): ReadonlyArray<StagedPath> =>
  staged
    .filter((path) => FORMATTABLE.test(path))
    .filter((path) => !path.endsWith('deno.lock'))

const checksOf = (formattable: ReadonlyArray<StagedPath>): readonly [CheckKind, ...CheckKind[]] =>
  Match.value(Option.fromNullishOr(formattable[0])).pipe(
    Match.tag('Some', () => FORMAT_CHECKS),
    Match.tag('None', () => PLAIN_CHECKS),
    Match.exhaustive,
  )

const runCaseOf = (command: StagedChecksCommand): StagedChecksCase => {
  const formattable = formattableOf(command.staged)
  return RunCase.make({
    staged: countOf(command.staged.length),
    checks: checksOf(formattable),
    formattable,
  })
}

const vacantOrRunOf = (command: StagedChecksCommand): StagedChecksCase =>
  Match.value(Option.fromNullishOr(command.staged[0])).pipe(
    Match.tag('None', () => VacantCase.make({ staged: countOf(command.staged.length) })),
    Match.tag('Some', () => runCaseOf(command)),
    Match.exhaustive,
  )

const classifyStagedChecks = (command: StagedChecksCommand): StagedChecksCase =>
  Match.value(command.merge).pipe(
    Match.when(true, () => MergeCase.make({ staged: countOf(command.staged.length) })),
    Match.when(false, () => vacantOrRunOf(command)),
    Match.exhaustive,
  )

export const stagedChecks = Workflow.make(
  StagedChecksCommand,
  (
    command,
  ): Result.Result<
    StagedChecksRan | StagedChecksIdle | StagedChecksSkipped,
    StagedChecksRefusal
  > =>
    Match.value(classifyStagedChecks(command)).pipe(
      Match.tag('MergeInProgress', (merged) => Result.succeed(StagedChecksSkipped.make({ staged: merged.staged }))),
      Match.tag('StagedVacant', (vacant) => Result.succeed(StagedChecksIdle.make({ staged: vacant.staged }))),
      Match.tag('StagedChecksRun', (run) =>
        Result.succeed(
          StagedChecksRan.make({
            staged: run.staged,
            checks: run.checks,
            formattable: run.formattable,
          }),
        )),
      Match.exhaustive,
    ),
)
