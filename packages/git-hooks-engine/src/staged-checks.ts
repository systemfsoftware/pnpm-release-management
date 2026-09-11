import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import {
  FormatRefused,
  GitPort,
  LintRefused,
  ProcessPort,
  TypecheckRefused,
  WorkspaceCommand,
} from '@systemfsoftware/release-language'
import type { CheckKind, PublishRefusal, StagedChecksRefusal, StagedPath } from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import {
  MergeChecksSkipped,
  StagedChecksCommand,
  type StagedChecksDecision,
  StagedChecksPassed,
  StagedVacant,
} from './staged-checks.schema.js'
import { stagedChecks } from './staged-checks.workflow.js'
import type { StagedChecksIdle, StagedChecksRan, StagedChecksSkipped } from './staged-checks.workflow.js'

export const StagedChecksInput = Wire.wire({
  scripts: Wire.mint(S.Array(S.String)),
})

type StagedChecksRequest = S.Schema.Type<typeof StagedChecksInput>

type CheckProgram = {
  readonly program: string
  readonly args: ReadonlyArray<string>
}

const CHECK_PROGRAMS: Record<
  CheckKind,
  (command: StagedChecksCommand, formattable: ReadonlyArray<StagedPath>) => CheckProgram
> = {
  format: (_command, formattable) => ({
    program: './bin/dprint',
    args: ['fmt', '--allow-no-files', '--', ...formattable],
  }),
  typecheck: (command) => ({ program: 'deno', args: ['check', ...command.scripts] }),
  lint: () => ({ program: 'deno', args: ['lint', '--quiet'] }),
}

const CHECK_REFUSALS: Record<
  CheckKind,
  (command: WorkspaceCommand, reason: string) => StagedChecksRefusal
> = {
  format: (command, reason) => FormatRefused.make({ command: { kind: 'format', command }, reason }),
  typecheck: (command, reason) => TypecheckRefused.make({ command: { kind: 'typecheck', command }, reason }),
  lint: (command, reason) => LintRefused.make({ command: { kind: 'lint', command }, reason }),
}

const publishReason = (refusal: PublishRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('PublishCapturedRequired', (required) => `required flag ${required.flag} missing`),
    Match.tag('PublishFiltersUnreadable', (unreadable) => `filters unreadable: ${unreadable.path}`),
    Match.tag('PublishCommandRefused', (refused) => refused.reason),
    Match.exhaustive,
  )

const read = (
  request: StagedChecksRequest,
): Effect.Effect<StagedChecksCommand, StagedChecksRefusal, GitPort> =>
  Effect.gen(function*() {
    const git = yield* GitPort
    const staged = yield* git.stagedPaths()
    const merge = yield* git.mergeInProgress()
    return StagedChecksCommand.make({ staged: [...staged], merge, scripts: [...request.scripts] })
  })

const runCheck = (
  kind: CheckKind,
  command: StagedChecksCommand,
  formattable: ReadonlyArray<StagedPath>,
): Effect.Effect<void, S.SchemaError | StagedChecksRefusal, ProcessPort> =>
  Effect.gen(function*() {
    const process = yield* ProcessPort
    const program = CHECK_PROGRAMS[kind](command, formattable)
    const workspaceCommand = yield* S.decodeUnknownEffect(WorkspaceCommand)({
      program: program.program,
      args: [...program.args],
    })
    yield* process.runCommand(workspaceCommand).pipe(
      Effect.mapError((refusal) => CHECK_REFUSALS[kind](workspaceCommand, publishReason(refusal))),
    )
  })

const runChecks = (
  decision: StagedChecksRan | StagedChecksIdle | StagedChecksSkipped,
  command: StagedChecksCommand,
): Effect.Effect<StagedChecksDecision, S.SchemaError | StagedChecksRefusal, ProcessPort> =>
  Match.value(decision).pipe(
    Match.tag('StagedChecksRan', (ran) =>
      Effect.gen(function*() {
        yield* Effect.forEach(ran.checks, (kind) => runCheck(kind, command, ran.formattable))
        return StagedChecksPassed.make({ staged: ran.staged, checks: ran.checks })
      })),
    Match.tag('StagedChecksIdle', (idle) => Effect.succeed(StagedVacant.make({ staged: idle.staged }))),
    Match.tag('StagedChecksSkipped', (skipped) => Effect.succeed(MergeChecksSkipped.make({ staged: skipped.staged }))),
    Match.exhaustive,
  )

const write = (
  outcome: Result.Result<StagedChecksRan | StagedChecksIdle | StagedChecksSkipped, StagedChecksRefusal>,
  command: StagedChecksCommand,
): Effect.Effect<StagedChecksDecision, S.SchemaError | StagedChecksRefusal, ProcessPort> =>
  Match.value(outcome).pipe(
    Match.tag('Failure', (failure) => Effect.fail(failure.failure)),
    Match.tag('Success', (success) => runChecks(success.success, command)),
    Match.exhaustive,
  )

export const stagedChecksCell: Cell.Cell<
  StagedChecksRequest,
  StagedChecksDecision,
  S.SchemaError | StagedChecksRefusal,
  GitPort | ProcessPort
> = Cell.layer({
  read,
  decide: stagedChecks,
  write,
})
