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

const outstandingOf = (
  command: PublishCommand,
): ReadonlyArray<PublishEntryState> => command.entries.filter((entry) => entry.published === false)

const classify = (command: PublishCommand): PublishCase =>
  Match.value(command).pipe(
    Match.when(
      (candidate) => candidate.unpublishedOnly === true && candidate.capturedPath === undefined,
      () => ({ _tag: 'CapturedMissing' } as const),
    ),
    Match.when(
      (candidate) => candidate.unpublishedOnly === false && candidate.dryRun === true,
      () => ({ _tag: 'Dry' } as const),
    ),
    Match.when(
      (candidate) => candidate.unpublishedOnly === false,
      () => ({ _tag: 'Publishable' } as const),
    ),
    Match.when(
      (candidate) => outstandingOf(candidate).length === 0,
      () => ({ _tag: 'Settled' } as const),
    ),
    Match.when({ dryRun: true }, () => ({ _tag: 'Dry' } as const)),
    Match.orElse(() => ({ _tag: 'Publishable' } as const)),
  )

export const publishPackages = Workflow.make(
  PublishCommand,
  (
    command,
  ): Result.Result<PublishWorkflowDecision, PublishRefusal> =>
    Match.value(classify(command)).pipe(
      Match.tag('CapturedMissing', () => Result.fail({ _tag: 'PublishCapturedRequired', flag: '--captured' } as const)),
      Match.tag('Settled', () => Result.succeed(PublishNothingOwed.make({ packages: command.packages }))),
      Match.tag('Dry', () => Result.succeed(PublishDryRun.make({ command: command.command }))),
      Match.tag('Publishable', () => Result.succeed(PublishDispatched.make({ command: command.command }))),
      Match.exhaustive,
    ),
)
