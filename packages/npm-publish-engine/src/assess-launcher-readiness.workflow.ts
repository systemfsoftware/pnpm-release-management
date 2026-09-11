import { Workflow } from '@systemfsoftware/effect-cell-types'
import { PackageName, RelativePath } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class AssessLauncherReadinessCommand extends S.TaggedClass<AssessLauncherReadinessCommand>()(
  'AssessLauncherReadinessCommand',
  {
    debuts: S.Array(PackageName),
    launcherManifest: S.optional(RelativePath),
    launcherReadable: S.Boolean,
  },
) {}

const AssessLauncherReadinessTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/npm-publish-engine/AssessLauncherReadinessDecision',
)
type AssessLauncherReadinessTypeId = typeof AssessLauncherReadinessTypeId

export class LauncherUnneeded extends S.TaggedClass<LauncherUnneeded>()(
  'LauncherUnneeded',
  {},
) {
  readonly [AssessLauncherReadinessTypeId] = AssessLauncherReadinessTypeId
}

export class LauncherReady extends S.TaggedClass<LauncherReady>()('LauncherReady', {
  debuts: S.Array(PackageName),
}) {
  readonly [AssessLauncherReadinessTypeId] = AssessLauncherReadinessTypeId
}

export class TrustLauncherMissing extends S.TaggedError<TrustLauncherMissing>()(
  'TrustLauncherMissing',
  { package: PackageName },
) {}

const UnneededCase = S.TaggedStruct('Unneeded', {})
const ReadyCase = S.TaggedStruct('Ready', { debuts: S.Array(PackageName) })
const MissingCase = S.TaggedStruct('Missing', { package: PackageName })
const LauncherCase = S.Union([UnneededCase, ReadyCase, MissingCase])
type LauncherCase = S.Schema.Type<typeof LauncherCase>

const configuredCaseOf = (command: AssessLauncherReadinessCommand): LauncherCase =>
  Match.value(command.launcherReadable).pipe(
    Match.when(true, () => ReadyCase.make({ debuts: [...command.debuts] })),
    Match.when(false, () =>
      MissingCase.make({
        package: Option.getOrThrow(Option.fromNullishOr(command.debuts[0])),
      })),
    Match.exhaustive,
  )

const manifestCaseOf = (command: AssessLauncherReadinessCommand): LauncherCase =>
  Match.value(Option.fromNullishOr(command.launcherManifest)).pipe(
    Match.tag('None', () => ReadyCase.make({ debuts: [...command.debuts] })),
    Match.tag('Some', () => configuredCaseOf(command)),
    Match.exhaustive,
  )

const classify = (command: AssessLauncherReadinessCommand): LauncherCase =>
  Match.value(Option.fromNullishOr(command.debuts[0])).pipe(
    Match.tag('None', () => UnneededCase.make({})),
    Match.tag('Some', () => manifestCaseOf(command)),
    Match.exhaustive,
  )

export const assessLauncherReadiness = Workflow.make(
  AssessLauncherReadinessCommand,
  (
    command,
  ): Result.Result<LauncherUnneeded | LauncherReady, TrustLauncherMissing> =>
    Match.value(classify(command)).pipe(
      Match.tag('Unneeded', () => Result.succeed(LauncherUnneeded.make({}))),
      Match.tag('Ready', (ready) => Result.succeed(LauncherReady.make({ debuts: [...ready.debuts] }))),
      Match.tag('Missing', (missing) => Result.fail(TrustLauncherMissing.make({ package: missing.package }))),
      Match.exhaustive,
    ),
)
