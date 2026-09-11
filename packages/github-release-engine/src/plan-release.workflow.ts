import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Count, CycleEntry, DecisionTypeId, PackageName } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class PlanVersion extends S.TaggedClass<PlanVersion>()('PlanVersion', {
  pending: Count,
  cycle: S.Array(CycleEntry),
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class PlanPublish extends S.TaggedClass<PlanPublish>()('PlanPublish', {
  cycle: S.Array(CycleEntry),
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class PlanSettled extends S.TaggedClass<PlanSettled>()('PlanSettled', {
  pending: Count,
  cycle: S.Finite,
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class PlanDeferredUnknown extends S.TaggedError<PlanDeferredUnknown>()(
  'PlanDeferredUnknown',
  { packages: S.NonEmptyArray(PackageName) },
) {}

export class PlanCommand extends S.TaggedClass<PlanCommand>()('PlanCommand', {
  pending: Count,
  cycle: S.Array(CycleEntry),
  deferred: S.Array(PackageName),
  unknownDeferred: S.Array(PackageName),
  members: S.Array(PackageName),
}) {}

const UnknownDeferredCase = S.TaggedStruct('UnknownDeferred', {
  packages: S.NonEmptyArray(PackageName),
})
const OwedCase = S.TaggedStruct('Owed', { cycle: S.NonEmptyArray(CycleEntry) })
const PendingCase = S.TaggedStruct('Pending', { pending: Count, cycle: S.Array(CycleEntry) })
const SettledCase = S.TaggedStruct('Settled', { pending: Count, cycle: S.Finite })
const PlanCase = S.Union([UnknownDeferredCase, OwedCase, PendingCase, SettledCase])
type PlanCase = S.Schema.Type<typeof PlanCase>

const planCaseOf = (command: PlanCommand): PlanCase => {
  const [firstUnknown, ...restUnknown] = command.unknownDeferred
  if (firstUnknown !== undefined) {
    return UnknownDeferredCase.make({ packages: [firstUnknown, ...restUnknown] })
  }
  const [firstOwed, ...restOwed] = command.cycle
  if (firstOwed !== undefined) {
    return OwedCase.make({ cycle: [firstOwed, ...restOwed] })
  }
  if (command.pending > 0) {
    return PendingCase.make({ pending: command.pending, cycle: [...command.cycle] })
  }
  return SettledCase.make({ pending: command.pending, cycle: command.cycle.length })
}

export const planRelease = Workflow.make(
  PlanCommand,
  (
    command,
  ): Result.Result<PlanVersion | PlanPublish | PlanSettled, PlanDeferredUnknown> =>
    Match.value(planCaseOf(command)).pipe(
      Match.tag('UnknownDeferred', (unknown) => Result.fail(PlanDeferredUnknown.make({ packages: unknown.packages }))),
      Match.tag('Owed', (owed) => Result.succeed(PlanPublish.make({ cycle: [...owed.cycle] }))),
      Match.tag('Pending', (pending) =>
        Result.succeed(
          PlanVersion.make({ pending: pending.pending, cycle: [...pending.cycle] }),
        )),
      Match.tag(
        'Settled',
        (settled) => Result.succeed(PlanSettled.make({ pending: settled.pending, cycle: settled.cycle })),
      ),
      Match.exhaustive,
    ),
)
