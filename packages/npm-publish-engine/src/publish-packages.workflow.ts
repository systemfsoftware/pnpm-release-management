import { Workflow } from '@systemfsoftware/effect-cell-types'
import {
  Count,
  FsPath,
  HttpUrl,
  PackageName,
  PackageVersion,
  PublishArg,
  type PublishRefusal,
  WorkspaceCommand,
} from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const PublishDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/npm-publish-engine/PublishDecision',
)
type PublishDecisionTypeId = typeof PublishDecisionTypeId

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
  readonly [PublishDecisionTypeId] = PublishDecisionTypeId
}

export class PublishNothingOwed extends S.TaggedClass<PublishNothingOwed>()(
  'PublishNothingOwed',
  { packages: Count },
) {
  readonly [PublishDecisionTypeId] = PublishDecisionTypeId
}

export class PublishDryRun extends S.TaggedClass<PublishDryRun>()(
  'PublishDryRun',
  { command: WorkspaceCommand },
) {
  readonly [PublishDecisionTypeId] = PublishDecisionTypeId
}

export type PublishWorkflowDecision = PublishDispatched | PublishNothingOwed | PublishDryRun

const CapturedMissingCase = S.TaggedStruct('CapturedMissing', {})
const PublishableCase = S.TaggedStruct('Publishable', {})
const DryCase = S.TaggedStruct('Dry', {})
const SettledCase = S.TaggedStruct('Settled', {})

const PublishCase = S.Union([CapturedMissingCase, PublishableCase, DryCase, SettledCase])
type PublishCase = S.Schema.Type<typeof PublishCase>

const outstandingIn = (command: PublishCommand): ReadonlyArray<PublishEntryState> =>
  command.entries.filter((entry) => entry.published === false)

const dryRunCaseOf = (command: PublishCommand): PublishCase =>
  Match.value(command.dryRun).pipe(
    Match.when(true, () => DryCase.make({})),
    Match.when(false, () => PublishableCase.make({})),
    Match.exhaustive,
  )

const outstandingCaseOf = (command: PublishCommand): PublishCase =>
  Match.value(outstandingIn(command).length === 0).pipe(
    Match.when(true, () => SettledCase.make({})),
    Match.when(false, () => dryRunCaseOf(command)),
    Match.exhaustive,
  )

const capturedCaseOf = (command: PublishCommand): PublishCase =>
  Match.value(Option.fromNullishOr(command.capturedPath)).pipe(
    Match.tag('None', () => CapturedMissingCase.make({})),
    Match.tag('Some', () => outstandingCaseOf(command)),
    Match.exhaustive,
  )

const classify = (command: PublishCommand): PublishCase =>
  Match.value(command.unpublishedOnly).pipe(
    Match.when(true, () => capturedCaseOf(command)),
    Match.when(false, () => dryRunCaseOf(command)),
    Match.exhaustive,
  )

export const publishPackages = Workflow.make(
  PublishCommand,
  (command): Result.Result<PublishWorkflowDecision, PublishRefusal> =>
    Match.value(classify(command)).pipe(
      Match.tag('CapturedMissing', () =>
        Result.fail<PublishRefusal>({ _tag: 'PublishCapturedRequired', flag: '--captured' })),
      Match.tag('Settled', () =>
        Result.succeed(PublishNothingOwed.make({ packages: command.packages }))),
      Match.tag('Dry', () => Result.succeed(PublishDryRun.make({ command: command.command }))),
      Match.tag('Publishable', () => Result.succeed(PublishDispatched.make({ command: command.command }))),
      Match.exhaustive,
    ),
)
