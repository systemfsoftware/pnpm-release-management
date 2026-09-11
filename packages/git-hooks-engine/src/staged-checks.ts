import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import { GitPort, ProcessPort, StagedChecksDecision, WorkspaceCommand } from '@systemfsoftware/release-language'
import type { CheckKind, PublishRefusal, StagedChecksRefusal, StagedPath } from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { MergeChecksSkippedWire, StagedChecksPassedWire, StagedVacantWire } from './staged-checks.schema.js'
import type { DecisionWire } from './staged-checks.schema.js'
import type { StagedChecksIdle, StagedChecksRan, StagedChecksSkipped } from './staged-checks.workflow.js'
import { stagedChecks, StagedChecksCommand } from './staged-checks.workflow.js'

const FORMATTABLE = /\.(ts|mjs|cjs|js|json|jsonc|md|ya?ml|toml)$/

const formattablePaths = (
  staged: ReadonlyArray<StagedPath>,
): ReadonlyArray<StagedPath> => staged.filter((path) => FORMATTABLE.test(path) && !path.endsWith('deno.lock'))

export const StagedChecksInput = Wire.wire({
  scripts: Wire.mint(S.Array(S.String)),
})

class StagedSnapshot {
  constructor(
    readonly staged: ReadonlyArray<StagedPath>,
    readonly merge: boolean,
    readonly scripts: ReadonlyArray<string>,
  ) {}
}

const read = (
  input: S.Schema.Type<typeof StagedChecksInput>,
): Effect.Effect<StagedSnapshot, StagedChecksRefusal, GitPort> =>
  Effect.gen(function*() {
    const git = yield* GitPort
    const staged = yield* git.stagedPaths()
    const merge = yield* git.mergeInProgress()
    return new StagedSnapshot(staged, merge, [...input.scripts])
  })

const decode = (
  raw: StagedSnapshot,
): Result.Result<StagedChecksCommand, S.SchemaError> =>
  S.decodeUnknownResult(StagedChecksCommand)({
    _tag: 'StagedChecksCommand',
    staged: [...raw.staged],
    merge: raw.merge,
    scripts: [...raw.scripts],
  })

const decisionWire = (
  decision: StagedChecksRan | StagedChecksIdle | StagedChecksSkipped,
): DecisionWire =>
  Match.value(decision).pipe(
    Match.tag(
      'StagedChecksRan',
      (ran) => StagedChecksPassedWire.make({ staged: ran.staged, checks: [...ran.checks] }),
    ),
    Match.tag('StagedChecksIdle', (idle) => StagedVacantWire.make({ staged: idle.staged })),
    Match.tag('StagedChecksSkipped', (skipped) => MergeChecksSkippedWire.make({ staged: skipped.staged })),
    Match.exhaustive,
  )

const encode = (
  outcome: Result.Result<StagedChecksRan | StagedChecksIdle | StagedChecksSkipped, StagedChecksRefusal>,
): Result.Result<DecisionWire, StagedChecksRefusal> => Result.map(outcome, decisionWire)

const stateUnreadable = (reason: string): StagedChecksRefusal => ({ _tag: 'StagedStateUnreadable', reason } as const)

const publishReason = (refusal: PublishRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('PublishCapturedRequired', (required) => `required flag ${required.flag} missing`),
    Match.tag('PublishFiltersUnreadable', (unreadable) => `filters unreadable: ${unreadable.path}`),
    Match.tag('PublishCommandRefused', (refused) => refused.reason),
    Match.exhaustive,
  )

const refusedAs = (
  kind: CheckKind,
  command: WorkspaceCommand,
  reason: string,
): StagedChecksRefusal => {
  if (kind === 'format') return { _tag: 'FormatRefused', command: { kind, command }, reason } as const
  if (kind === 'typecheck') {
    return { _tag: 'TypecheckRefused', command: { kind, command }, reason } as const
  }
  return { _tag: 'LintRefused', command: { kind, command }, reason } as const
}

const programOf = (kind: CheckKind): string => {
  if (kind === 'format') return './bin/dprint'
  return 'deno'
}

const argsOf = (kind: CheckKind, raw: StagedSnapshot): ReadonlyArray<string> => {
  if (kind === 'format') return ['fmt', '--allow-no-files', '--', ...formattablePaths(raw.staged)]
  if (kind === 'typecheck') return ['check', ...raw.scripts]
  return ['lint', '--quiet']
}

const workspaceCommand = (
  kind: CheckKind,
  raw: StagedSnapshot,
): Effect.Effect<WorkspaceCommand, StagedChecksRefusal> =>
  Effect.mapError(
    S.decodeUnknownEffect(WorkspaceCommand)({ program: programOf(kind), args: [...argsOf(kind, raw)] }),
    (error): StagedChecksRefusal => stateUnreadable(error.message),
  )

const write = (
  output: Result.Result<DecisionWire, StagedChecksRefusal>,
  raw: StagedSnapshot,
): Effect.Effect<StagedChecksDecision, S.SchemaError | StagedChecksRefusal, ProcessPort> => {
  if (Result.isFailure(output)) return Effect.fail(output.failure)
  return Effect.flatMap(
    S.decodeUnknownEffect(StagedChecksDecision)(output.success),
    (decision): Effect.Effect<StagedChecksDecision, S.SchemaError | StagedChecksRefusal, ProcessPort> =>
      Match.value(decision).pipe(
        Match.tag('StagedVacant', (vacant) => Effect.succeed(vacant)),
        Match.tag('MergeChecksSkipped', (skipped) => Effect.succeed(skipped)),
        Match.tag('StagedChecksPassed', (passed) =>
          Effect.gen(function*() {
            const process = yield* ProcessPort
            yield* Effect.forEach(passed.checks, (kind) =>
              Effect.flatMap(
                workspaceCommand(kind, raw),
                (command) =>
                  Effect.mapError(
                    process.runCommand(command),
                    (refusal) => refusedAs(kind, command, publishReason(refusal)),
                  ),
              ))
            return passed
          })),
        Match.exhaustive,
      ),
  )
}

export const stagedChecksCell: Cell.Cell<
  S.Schema.Type<typeof StagedChecksInput>,
  StagedChecksDecision,
  S.SchemaError | StagedChecksRefusal,
  GitPort | ProcessPort
> = Cell.layer({
  read,
  decode,
  decide: stagedChecks,
  encode,
  write,
})
