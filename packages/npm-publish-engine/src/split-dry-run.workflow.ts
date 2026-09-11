import { Workflow } from '@systemfsoftware/effect-cell-types'
import { PackageName } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { TrustWorkItem } from './stage-trust.schema.js'

export class SplitDryRunCommand extends S.TaggedClass<SplitDryRunCommand>()('SplitDryRunCommand', {
  packages: S.Int,
  items: S.Array(TrustWorkItem),
  debuts: S.Array(PackageName),
  dryRun: S.Boolean,
  launcherReady: S.Boolean,
  workflowFile: S.NonEmptyString,
  slug: S.String,
}) {}

const SplitDryRunTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/npm-publish-engine/SplitDryRunDecision',
)
type SplitDryRunTypeId = typeof SplitDryRunTypeId

export class TrustIdle extends S.TaggedClass<TrustIdle>()('TrustIdle', {
  packages: S.Int,
}) {
  readonly [SplitDryRunTypeId] = SplitDryRunTypeId
}

export class TrustComplete extends S.TaggedClass<TrustComplete>()('TrustComplete', {
  processed: S.Int,
  debuts: S.Int,
  owed: S.Array(TrustWorkItem),
  dryRun: S.Boolean,
  workflowFile: S.NonEmptyString,
  slug: S.String,
}) {
  readonly [SplitDryRunTypeId] = SplitDryRunTypeId
}

export class TrustLauncherMissing extends S.TaggedError<TrustLauncherMissing>()(
  'TrustLauncherMissing',
  { package: PackageName },
) {}

const IdleCase = S.TaggedStruct('Idle', { packages: S.Int })
const DryRunCase = S.TaggedStruct('DryRun', {})
const StagedCase = S.TaggedStruct('Staged', {})
const BlockedCase = S.TaggedStruct('Blocked', { package: PackageName })
const SplitCase = S.Union([IdleCase, DryRunCase, StagedCase, BlockedCase])
type SplitCase = S.Schema.Type<typeof SplitCase>

const launcherCaseOf = (command: SplitDryRunCommand): SplitCase =>
  Match.value(command.launcherReady).pipe(
    Match.when(true, () => StagedCase.make({})),
    Match.when(false, () =>
      BlockedCase.make({
        package: Option.getOrThrow(Option.fromNullishOr(command.debuts[0])),
      })),
    Match.exhaustive,
  )

const stagedCaseOf = (command: SplitDryRunCommand): SplitCase =>
  Match.value(Option.fromNullishOr(command.debuts[0])).pipe(
    Match.tag('None', () => StagedCase.make({})),
    Match.tag('Some', () => launcherCaseOf(command)),
    Match.exhaustive,
  )

const workCaseOf = (command: SplitDryRunCommand): SplitCase =>
  Match.value(command.dryRun).pipe(
    Match.when(true, () => DryRunCase.make({})),
    Match.when(false, () => stagedCaseOf(command)),
    Match.exhaustive,
  )

const classify = (command: SplitDryRunCommand): SplitCase =>
  Match.value(Option.fromNullishOr(command.items[0])).pipe(
    Match.tag('None', () => IdleCase.make({ packages: command.packages })),
    Match.tag('Some', () => workCaseOf(command)),
    Match.exhaustive,
  )

const completeOf = (
  command: SplitDryRunCommand,
  dryRun: boolean,
): TrustComplete =>
  TrustComplete.make({
    debuts: command.debuts.length,
    dryRun,
    owed: [...command.items],
    processed: command.items.length,
    slug: command.slug,
    workflowFile: command.workflowFile,
  })

export const splitDryRun = Workflow.make(
  SplitDryRunCommand,
  (command): Result.Result<TrustIdle | TrustComplete, TrustLauncherMissing> =>
    Match.value(classify(command)).pipe(
      Match.tag('Idle', (idle) => Result.succeed(TrustIdle.make({ packages: idle.packages }))),
      Match.tag('DryRun', () => Result.succeed(completeOf(command, true))),
      Match.tag('Staged', () => Result.succeed(completeOf(command, false))),
      Match.tag('Blocked', (blocked) => Result.fail(TrustLauncherMissing.make({ package: blocked.package }))),
      Match.exhaustive,
    ),
)
