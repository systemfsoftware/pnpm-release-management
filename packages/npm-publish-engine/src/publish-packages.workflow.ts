import { Workflow } from '@systemfsoftware/effect-cell-types'
import {
  Count,
  DecisionTypeId,
  FsPath,
  HttpUrl,
  PackageName,
  PackageVersion,
  PublishArg,
  type PublishRefusal,
  WorkspaceCommand,
} from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export const PublishEntryState = S.Struct({
  name: PackageName,
  version: PackageVersion,
  published: S.Boolean,
})
export type PublishEntryState = S.Schema.Type<typeof PublishEntryState>

export class PublishCommand extends S.TaggedClass<PublishCommand>()('PublishCommand', {
  capturedPath: S.optional(FsPath),
  unpublishedOnly: S.Boolean,
  filterLines: S.Array(S.String),
  registry: HttpUrl,
  provenance: S.Boolean,
  publishArgs: S.Array(PublishArg),
  dryRun: S.Boolean,
  entries: S.Array(PublishEntryState),
  command: WorkspaceCommand,
  packages: Count,
}) {}

export class PublishDispatched extends S.TaggedClass<PublishDispatched>()(
  'PublishDispatched',
  { command: WorkspaceCommand },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class PublishNothingOwed extends S.TaggedClass<PublishNothingOwed>()(
  'PublishNothingOwed',
  { packages: Count },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class PublishDryRun extends S.TaggedClass<PublishDryRun>()('PublishDryRun', {
  command: WorkspaceCommand,
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export type PublishWorkflowDecision = PublishDispatched | PublishNothingOwed | PublishDryRun

const CapturedMissingCase = S.TaggedStruct('CapturedMissing', { flag: S.Literal('--captured') })
type CapturedMissingCase = S.Schema.Type<typeof CapturedMissingCase>

const NothingOwedCase = S.TaggedStruct('NothingOwed', { packages: Count })
type NothingOwedCase = S.Schema.Type<typeof NothingOwedCase>

const DryRunCase = S.TaggedStruct('DryRun', { command: WorkspaceCommand })
type DryRunCase = S.Schema.Type<typeof DryRunCase>

const DispatchedCase = S.TaggedStruct('Dispatched', { command: WorkspaceCommand })
type DispatchedCase = S.Schema.Type<typeof DispatchedCase>

type PublishCase = CapturedMissingCase | NothingOwedCase | DryRunCase | DispatchedCase

const outstandingIn = (command: PublishCommand): ReadonlyArray<PublishEntryState> =>
  command.entries.filter((entry) => entry.published === false)

const publishCaseOf = (command: PublishCommand): PublishCase => {
  if (command.unpublishedOnly && command.capturedPath === undefined) {
    return CapturedMissingCase.make({ flag: '--captured' })
  }
  if (command.unpublishedOnly && outstandingIn(command).length === 0) {
    return NothingOwedCase.make({ packages: command.packages })
  }
  if (command.dryRun) return DryRunCase.make({ command: command.command })
  return DispatchedCase.make({ command: command.command })
}

export const publishPackages = Workflow.make(
  PublishCommand,
  (command): Result.Result<PublishWorkflowDecision, PublishRefusal> =>
    Match.value(publishCaseOf(command)).pipe(
      Match.tag(
        'CapturedMissing',
        (missing): Result.Result<never, PublishRefusal> =>
          Result.fail({ _tag: 'PublishCapturedRequired', flag: missing.flag }),
      ),
      Match.tag('NothingOwed', (settled) => Result.succeed(PublishNothingOwed.make({ packages: settled.packages }))),
      Match.tag('DryRun', (preview) => Result.succeed(PublishDryRun.make({ command: preview.command }))),
      Match.tag('Dispatched', (job) => Result.succeed(PublishDispatched.make({ command: job.command }))),
      Match.exhaustive,
    ),
)
