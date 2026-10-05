import { Workflow } from '@systemfsoftware/effect-cell-types'
import { CheckKind, DecisionTypeId, type StagedChecksRefusal, StagedPath } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { StagedChecksCommand } from './staged-checks.schema.js'

export class StagedChecksRan extends S.TaggedClass<StagedChecksRan>()(
  'StagedChecksRan',
  {
    staged: S.Natural,
    checks: S.NonEmptyArray(CheckKind),
    formattable: S.Array(StagedPath),
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class StagedChecksIdle extends S.TaggedClass<StagedChecksIdle>()(
  'StagedChecksIdle',
  {
    staged: S.Natural,
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class StagedChecksSkipped extends S.TaggedClass<StagedChecksSkipped>()(
  'StagedChecksSkipped',
  {
    staged: S.Natural,
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

const FORMATTABLE = /\.(ts|mjs|cjs|js|json|jsonc|md|ya?ml|toml)$/

const FORMAT_CHECKS: readonly [CheckKind, ...CheckKind[]] = ['format', 'typecheck', 'lint']
const PLAIN_CHECKS: readonly [CheckKind, ...CheckKind[]] = ['typecheck', 'lint']

const MergeCase = S.TaggedStruct('MergeInProgress', { staged: S.Natural })

const VacantCase = S.TaggedStruct('StagedVacant', { staged: S.Natural })

const RunCase = S.TaggedStruct('StagedChecksRun', {
  staged: S.Natural,
  checks: S.NonEmptyArray(CheckKind),
  formattable: S.Array(StagedPath),
})

const StagedChecksCase = S.Union([MergeCase, VacantCase, RunCase])
type StagedChecksCase = S.Schema.Type<typeof StagedChecksCase>

const formattableOf = (staged: ReadonlyArray<StagedPath>): ReadonlyArray<StagedPath> =>
  staged
    .filter((path) => FORMATTABLE.test(path))
    .filter((path) => path.endsWith('deno.lock') === false)

const checksOf = (
  formattable: ReadonlyArray<StagedPath>,
): readonly [CheckKind, ...CheckKind[]] => {
  if (formattable.length === 0) return PLAIN_CHECKS
  return FORMAT_CHECKS
}

const stagedChecksCaseOf = (command: StagedChecksCommand): StagedChecksCase => {
  if (command.merge) return MergeCase.make({ staged: command.staged.length })
  if (command.staged.length === 0) return VacantCase.make({ staged: 0 })
  const formattable = formattableOf(command.staged)
  return RunCase.make({
    staged: command.staged.length,
    checks: checksOf(formattable),
    formattable,
  })
}

export const stagedChecks = Workflow.make(
  StagedChecksCommand,
  (
    command,
  ): Result.Result<
    StagedChecksRan | StagedChecksIdle | StagedChecksSkipped,
    StagedChecksRefusal
  > =>
    Match.value(stagedChecksCaseOf(command)).pipe(
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
