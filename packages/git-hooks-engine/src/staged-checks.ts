import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import {
  FormatRefused,
  GitPort,
  LintRefused,
  MergeChecksSkipped,
  ProcessPort,
  StagedChecksPassed,
  StagedVacant,
  TypecheckRefused,
  WorkspaceCommand,
} from '@systemfsoftware/release-language'
import type {
  CheckKind,
  PublishRefusal,
  StagedChecksDecision,
  StagedChecksRefusal,
  StagedPath,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { stagedChecks, StagedChecksCommand } from './staged-checks.workflow.js'
import type { StagedChecksIdle, StagedChecksRan, StagedChecksSkipped } from './staged-checks.workflow.js'

export const StagedChecksInput = Wire.wire({
  scripts: Wire.mint(S.Array(S.String)),
})

type StagedChecksRequest = S.Schema.Type<typeof StagedChecksInput>

type StagedChecksSnapshot = {
  readonly staged: ReadonlyArray<StagedPath>
  readonly merge: boolean
  readonly scripts: ReadonlyArray<string>
}

type StagedChecksDocument = {
  readonly decision: StagedChecksDecision
  readonly formattable: ReadonlyArray<StagedPath>
}

type CheckProgram = {
  readonly program: string
  readonly args: ReadonlyArray<string>
}

const CHECK_PROGRAMS: Record<
  CheckKind,
  (raw: StagedChecksSnapshot, formattable: ReadonlyArray<StagedPath>) => CheckProgram
> = {
  format: (_raw, formattable) => ({
    program: './bin/dprint',
    args: ['fmt', '--allow-no-files', '--', ...formattable],
  }),
  typecheck: (raw) => ({ program: 'deno', args: ['check', ...raw.scripts] }),
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
): Effect.Effect<StagedChecksSnapshot, StagedChecksRefusal, GitPort> =>
  Effect.gen(function*() {
    const git = yield* GitPort
    const staged = yield* git.stagedPaths()
    const merge = yield* git.mergeInProgress()
    return { staged: [...staged], merge, scripts: [...request.scripts] }
  })

const decode = (
  raw: StagedChecksSnapshot,
): Result.Result<StagedChecksCommand, S.SchemaError> =>
  S.decodeUnknownResult(StagedChecksCommand)({
    _tag: 'StagedChecksCommand',
    staged: [...raw.staged],
    merge: raw.merge,
    scripts: [...raw.scripts],
  })

const encode = (
  outcome: Result.Result<
    StagedChecksRan | StagedChecksIdle | StagedChecksSkipped,
    StagedChecksRefusal
  >,
): Result.Result<StagedChecksDocument, StagedChecksRefusal> =>
  Result.map(outcome, (decision) =>
    Match.value(decision).pipe(
      Match.tag('StagedChecksRan', (ran) => ({
        decision: StagedChecksPassed.make({ staged: ran.staged, checks: ran.checks }),
        formattable: ran.formattable,
      })),
      Match.tag('StagedChecksIdle', (idle): StagedChecksDocument => ({
        decision: StagedVacant.make({ staged: idle.staged }),
        formattable: [],
      })),
      Match.tag('StagedChecksSkipped', (skipped): StagedChecksDocument => ({
        decision: MergeChecksSkipped.make({ staged: skipped.staged }),
        formattable: [],
      })),
      Match.exhaustive,
    ))

const runCheck = (
  kind: CheckKind,
  raw: StagedChecksSnapshot,
  formattable: ReadonlyArray<StagedPath>,
): Effect.Effect<void, S.SchemaError | StagedChecksRefusal, ProcessPort> =>
  Effect.gen(function*() {
    const process = yield* ProcessPort
    const program = CHECK_PROGRAMS[kind](raw, formattable)
    const command = yield* S.decodeUnknownEffect(WorkspaceCommand)({
      program: program.program,
      args: [...program.args],
    })
    yield* process.runCommand(command).pipe(
      Effect.mapError((refusal) => CHECK_REFUSALS[kind](command, publishReason(refusal))),
    )
  })

const runChecks = (
  document: StagedChecksDocument,
  raw: StagedChecksSnapshot,
): Effect.Effect<StagedChecksDecision, S.SchemaError | StagedChecksRefusal, ProcessPort> =>
  Match.value(document.decision).pipe(
    Match.tag('StagedChecksPassed', (passed) =>
      Effect.gen(function*() {
        yield* Effect.forEach(passed.checks, (kind) => runCheck(kind, raw, document.formattable))
        return document.decision
      })),
    Match.tag('StagedVacant', () => Effect.succeed(document.decision)),
    Match.tag('MergeChecksSkipped', () => Effect.succeed(document.decision)),
    Match.exhaustive,
  )

const write = (
  output: Result.Result<StagedChecksDocument, StagedChecksRefusal>,
  raw: StagedChecksSnapshot,
): Effect.Effect<StagedChecksDecision, S.SchemaError | StagedChecksRefusal, ProcessPort> =>
  Match.value(output).pipe(
    Match.tag('Failure', (failure) => Effect.fail(failure.failure)),
    Match.tag('Success', (success) => runChecks(success.success, raw)),
    Match.exhaustive,
  )

export const stagedChecksCell: Cell.Cell<
  StagedChecksRequest,
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
