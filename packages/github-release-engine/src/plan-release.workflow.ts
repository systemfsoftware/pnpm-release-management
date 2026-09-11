import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Count, CycleEntry, PackageName } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
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
  { pending: Count, cycleCount: S.Finite },
) {
  readonly [PlanReleaseDecisionTypeId] = PlanReleaseDecisionTypeId
}

export class DeferredPackagesUnknown extends S.TaggedError<DeferredPackagesUnknown>()(
  'DeferredPackagesUnknown',
  { packages: S.Array(PackageName) },
) {}

export class PlanCommand extends S.TaggedClass<PlanCommand>()('PlanCommand', {
  pending: Count,
  cycle: S.Array(CycleEntry),
  deferred: S.Array(PackageName),
  unknownDeferred: S.Array(PackageName),
}) {}

const UnknownDeferredCase = S.TaggedStruct('PlanUnknownDeferred', {
  unknown: S.Array(PackageName),
})
const OwedCase = S.TaggedStruct('PlanOwed', { cycle: S.Array(CycleEntry) })
const PendingCase = S.TaggedStruct('PlanPending', {})
const ClearCase = S.TaggedStruct('PlanClear', {})
const PlanCase = S.Union([UnknownDeferredCase, OwedCase, PendingCase, ClearCase])
type PlanCase = S.Schema.Type<typeof PlanCase>

const pendingCaseOf = (command: PlanCommand): PlanCase =>
  Match.value(command.pending > 0).pipe(
    Match.when(true, () => PendingCase.make({})),
    Match.when(false, () => ClearCase.make({})),
    Match.exhaustive,
  )

const owedCaseOf = (command: PlanCommand): PlanCase =>
  Match.value(Option.fromNullishOr(command.cycle[0])).pipe(
    Match.tag('Some', () => OwedCase.make({ cycle: [...command.cycle] })),
    Match.tag('None', () => pendingCaseOf(command)),
    Match.exhaustive,
  )

const classify = (command: PlanCommand): PlanCase =>
  Match.value(Option.fromNullishOr(command.unknownDeferred[0])).pipe(
    Match.tag('Some', () => UnknownDeferredCase.make({ unknown: [...command.unknownDeferred] })),
    Match.tag('None', () => owedCaseOf(command)),
    Match.exhaustive,
  )

export const planRelease = Workflow.make(
  PlanCommand,
  (
    command,
  ): Result.Result<
    PlanReleasePublish | PlanReleaseVersion | PlanReleaseSettled,
    DeferredPackagesUnknown
  > =>
    Match.value(classify(command)).pipe(
      Match.tag('PlanUnknownDeferred', (bad) =>
        Result.fail(DeferredPackagesUnknown.make({ packages: [...bad.unknown] }))),
      Match.tag('PlanOwed', (owed) =>
        Result.succeed(PlanReleasePublish.make({ cycle: [...owed.cycle] }))),
      Match.tag('PlanPending', () =>
        Result.succeed(
          PlanReleaseVersion.make({ pending: command.pending, cycle: [...command.cycle] }),
        )),
      Match.tag('PlanClear', () =>
        Result.succeed(
          PlanReleaseSettled.make({
            pending: command.pending,
            cycleCount: command.cycle.length,
          }),
        )),
      Match.exhaustive,
    ),
)
