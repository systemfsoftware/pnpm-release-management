import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Count, CycleEntry, PackageName } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const PlanReleaseDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/PlanReleaseDecision',
)
type PlanReleaseDecisionTypeId = typeof PlanReleaseDecisionTypeId

export class PlanReleasePublish extends S.TaggedClass<PlanReleasePublish>()(
  'PlanReleasePublish',
  { cycle: S.Array(CycleEntry) },
) {
  readonly [PlanReleaseDecisionTypeId] = PlanReleaseDecisionTypeId
}

export class PlanReleaseVersion extends S.TaggedClass<PlanReleaseVersion>()(
  'PlanReleaseVersion',
  { pending: Count, cycle: S.Array(CycleEntry) },
) {
  readonly [PlanReleaseDecisionTypeId] = PlanReleaseDecisionTypeId
}

export class PlanReleaseSettled extends S.TaggedClass<PlanReleaseSettled>()(
  'PlanReleaseSettled',
  { pending: Count, cycleCount: S.Number },
) {
  readonly [PlanReleaseDecisionTypeId] = PlanReleaseDecisionTypeId
}

export class DeferredPackagesUnknown extends S.TaggedError<DeferredPackagesUnknown>()(
  'DeferredPackagesUnknown',
  { packages: S.Array(PackageName) },
) {}

const PlanCase = S.Union([
  S.TaggedStruct('PlanDeferredBad', { unknown: S.Array(PackageName) }),
  S.TaggedStruct('PlanOwed', {}),
  S.TaggedStruct('PlanPending', {}),
  S.TaggedStruct('PlanClear', {}),
])

type PlanCase = S.Schema.Type<typeof PlanCase>

const nonEmpty = <A>(list: ReadonlyArray<A>): [A, ...Array<A>] => {
  const [first, ...rest] = list
  if (first === undefined) {
    throw new Error('nonEmpty: empty list')
  }
  return [first, ...rest]
}

const deferredPackagesUnknown = (packages: ReadonlyArray<PackageName>) =>
  DeferredPackagesUnknown.make({ packages: nonEmpty(packages) })

export class PlanCommand extends S.TaggedClass<PlanCommand>()('PlanCommand', {
  pending: Count,
  cycle: S.Array(CycleEntry),
  deferred: S.Array(PackageName),
  unknownDeferred: S.Array(PackageName),
}) {}

const classify = (command: PlanCommand): PlanCase => {
  if (command.unknownDeferred.length > 0) {
    return { _tag: 'PlanDeferredBad', unknown: command.unknownDeferred }
  }
  if (command.cycle.length > 0) {
    return { _tag: 'PlanOwed' }
  }
  if (command.pending > 0) {
    return { _tag: 'PlanPending' }
  }
  return { _tag: 'PlanClear' }
}

export const planRelease = Workflow.make(
  PlanCommand,
  (
    command,
  ): Result.Result<
    PlanReleasePublish | PlanReleaseVersion | PlanReleaseSettled,
    DeferredPackagesUnknown
  > =>
    Match.value(classify(command)).pipe(
      Match.tag('PlanDeferredBad', (bad) => Result.fail(deferredPackagesUnknown(bad.unknown))),
      Match.tag(
        'PlanOwed',
        () => Result.succeed(PlanReleasePublish.make({ cycle: [...command.cycle] })),
      ),
      Match.tag(
        'PlanPending',
        () =>
          Result.succeed(
            PlanReleaseVersion.make({ pending: command.pending, cycle: [...command.cycle] }),
          ),
      ),
      Match.tag(
        'PlanClear',
        () =>
          Result.succeed(
            PlanReleaseSettled.make({ pending: command.pending, cycleCount: command.cycle.length }),
          ),
      ),
      Match.exhaustive,
    ),
)
