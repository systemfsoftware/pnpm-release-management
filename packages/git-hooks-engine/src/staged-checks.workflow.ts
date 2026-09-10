import { Workflow } from '@systemfsoftware/effect-cell-types'
import { CheckKind, StagedPath } from '@systemfsoftware/release-language'
import type { StagedChecksRefusal } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class StagedChecksCommand extends S.TaggedClass<StagedChecksCommand>()(
  'StagedChecksCommand',
  {
    staged: S.Array(StagedPath),
    merge: S.Boolean,
    scripts: S.Array(S.String),
  },
) {}

const DecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/git-hooks-engine/StagedChecksDecision',
)
type DecisionTypeId = typeof DecisionTypeId

export class StagedChecksRan extends S.TaggedClass<StagedChecksRan>()(
  'StagedChecksRan',
  {
    staged: S.Number,
    checks: S.Array(CheckKind),
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class StagedChecksIdle extends S.TaggedClass<StagedChecksIdle>()(
  'StagedChecksIdle',
  {
    staged: S.Number,
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class StagedChecksSkipped extends S.TaggedClass<StagedChecksSkipped>()(
  'StagedChecksSkipped',
  {
    staged: S.Number,
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

const FORMATTABLE = /\.(ts|mjs|cjs|js|json|jsonc|md|ya?ml|toml)$/

type StagedVerdict = StagedChecksRan | StagedChecksIdle | StagedChecksSkipped

const classify = (command: StagedChecksCommand): StagedVerdict => {
  if (command.merge) return StagedChecksSkipped.make({ staged: command.staged.length })
  if (command.staged.length === 0) return StagedChecksIdle.make({ staged: command.staged.length })
  const formattable = command.staged.filter((path) => FORMATTABLE.test(path) && !path.endsWith('deno.lock'))
  const checks: Array<CheckKind> = []
  if (formattable.length > 0) checks.push('format')
  checks.push('typecheck', 'lint')
  return StagedChecksRan.make({ staged: command.staged.length, checks })
}

export const stagedChecks = Workflow.make(
  StagedChecksCommand,
  (
    command: StagedChecksCommand,
  ): Result.Result<StagedChecksRan | StagedChecksIdle | StagedChecksSkipped, StagedChecksRefusal> =>
    Match.value(classify(command)).pipe(
      Match.tag('StagedChecksSkipped', (decision) => Result.succeed(decision)),
      Match.tag('StagedChecksIdle', (decision) => Result.succeed(decision)),
      Match.tag('StagedChecksRan', (decision) => Result.succeed(decision)),
      Match.exhaustive,
    ),
)
