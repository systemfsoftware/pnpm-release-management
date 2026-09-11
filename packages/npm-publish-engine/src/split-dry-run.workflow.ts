import { Workflow } from '@systemfsoftware/effect-cell-types'
import { DecisionTypeId, PackageName, RelativePath } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { type TrustLauncherMissing, TrustWorkItem } from './stage-trust.schema.js'

export class SplitDryRunCommand extends S.TaggedClass<SplitDryRunCommand>()('SplitDryRunCommand', {
  packages: S.Int,
  items: S.Array(TrustWorkItem),
  debuts: S.Array(PackageName),
  dryRun: S.Boolean,
  launcherManifest: S.optional(RelativePath),
  launcherReadable: S.Boolean,
  workflowFile: S.NonEmptyString,
  slug: S.String,
}) {}

export class TrustIdle extends S.TaggedClass<TrustIdle>()('TrustIdle', {
  packages: S.Int,
  stage: S.Array(TrustWorkItem),
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class TrustComplete extends S.TaggedClass<TrustComplete>()('TrustComplete', {
  processed: S.Int,
  debuts: S.Int,
  owed: S.Array(TrustWorkItem),
  stage: S.Array(TrustWorkItem),
  dryRun: S.Boolean,
  workflowFile: S.NonEmptyString,
  slug: S.String,
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export type TrustWorkflowDecision = TrustIdle | TrustComplete

const IdleCase = S.TaggedStruct('Idle', { packages: S.Int })
type IdleCase = S.Schema.Type<typeof IdleCase>

const CompleteCase = S.TaggedStruct('Complete', {
  dryRun: S.Boolean,
  stage: S.Array(TrustWorkItem),
})
type CompleteCase = S.Schema.Type<typeof CompleteCase>

const BlockedCase = S.TaggedStruct('Blocked', { package: PackageName })
type BlockedCase = S.Schema.Type<typeof BlockedCase>

type SplitCase = IdleCase | CompleteCase | BlockedCase

const splitCaseOf = (command: SplitDryRunCommand): SplitCase => {
  if (command.items.length === 0) return IdleCase.make({ packages: command.packages })
  if (command.dryRun) return CompleteCase.make({ dryRun: true, stage: [] })
  const firstDebut = command.debuts[0]
  if (
    firstDebut === undefined || command.launcherManifest === undefined || command.launcherReadable
  ) {
    return CompleteCase.make({ dryRun: false, stage: command.items })
  }
  return BlockedCase.make({ package: firstDebut })
}

const completeOf = (
  command: SplitDryRunCommand,
  dryRun: boolean,
  stage: ReadonlyArray<TrustWorkItem>,
): TrustComplete =>
  TrustComplete.make({
    debuts: command.debuts.length,
    dryRun,
    owed: command.items,
    processed: command.items.length,
    slug: command.slug,
    stage,
    workflowFile: command.workflowFile,
  })

export const splitDryRun = Workflow.make(
  SplitDryRunCommand,
  (command): Result.Result<TrustIdle | TrustComplete, TrustLauncherMissing> =>
    Match.value(splitCaseOf(command)).pipe(
      Match.tag('Idle', (idle) => Result.succeed(TrustIdle.make({ packages: idle.packages, stage: [] }))),
      Match.tag('Complete', (complete) => Result.succeed(completeOf(command, complete.dryRun, complete.stage))),
      Match.tag(
        'Blocked',
        (blocked): Result.Result<never, TrustLauncherMissing> =>
          Result.fail({ _tag: 'TrustLauncherMissing', package: blocked.package }),
      ),
      Match.exhaustive,
    ),
)
