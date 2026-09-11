import { Workflow } from '@systemfsoftware/effect-cell-types'
import { DecisionTypeId, PackageName, RelativePath } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { type TrustLauncherMissing } from './stage-trust.schema.js'

export class AssessLauncherReadinessCommand extends S.TaggedClass<AssessLauncherReadinessCommand>()(
  'AssessLauncherReadinessCommand',
  {
    debuts: S.Array(PackageName),
    launcherManifest: S.optional(RelativePath),
    launcherReadable: S.Boolean,
  },
) {}

export class LauncherUnneeded extends S.TaggedClass<LauncherUnneeded>()('LauncherUnneeded', {
  debuts: S.Array(PackageName),
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class LauncherReady extends S.TaggedClass<LauncherReady>()('LauncherReady', {
  debuts: S.Array(PackageName),
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

const UnneededCase = S.TaggedStruct('Unneeded', { debuts: S.Array(PackageName) })
type UnneededCase = S.Schema.Type<typeof UnneededCase>

const ReadyCase = S.TaggedStruct('Ready', { debuts: S.Array(PackageName) })
type ReadyCase = S.Schema.Type<typeof ReadyCase>

const MissingCase = S.TaggedStruct('Missing', { package: PackageName })
type MissingCase = S.Schema.Type<typeof MissingCase>

type LauncherCase = UnneededCase | ReadyCase | MissingCase

const launcherCaseOf = (command: AssessLauncherReadinessCommand): LauncherCase => {
  const firstDebut = command.debuts[0]
  if (firstDebut === undefined) return UnneededCase.make({ debuts: [] })
  if (command.launcherManifest === undefined) return ReadyCase.make({ debuts: command.debuts })
  if (command.launcherReadable) return ReadyCase.make({ debuts: command.debuts })
  return MissingCase.make({ package: firstDebut })
}

export const assessLauncherReadiness = Workflow.make(
  AssessLauncherReadinessCommand,
  (
    command,
  ): Result.Result<LauncherUnneeded | LauncherReady, TrustLauncherMissing> =>
    Match.value(launcherCaseOf(command)).pipe(
      Match.tag('Unneeded', (unneeded) => Result.succeed(LauncherUnneeded.make({ debuts: unneeded.debuts }))),
      Match.tag('Ready', (ready) => Result.succeed(LauncherReady.make({ debuts: ready.debuts }))),
      Match.tag(
        'Missing',
        (missing): Result.Result<never, TrustLauncherMissing> =>
          Result.fail({ _tag: 'TrustLauncherMissing', package: missing.package }),
      ),
      Match.exhaustive,
    ),
)
