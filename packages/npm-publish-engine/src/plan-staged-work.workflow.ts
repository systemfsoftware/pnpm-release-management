import { Workflow } from '@systemfsoftware/effect-cell-types'
import { PackageName } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { TrustCandidateState, TrustWorkItem, type TrustWorkMode } from './stage-trust.schema.js'

export class PlanStagedWorkCommand extends S.TaggedClass<PlanStagedWorkCommand>()(
  'PlanStagedWorkCommand',
  {
    owed: S.Array(TrustCandidateState),
  },
) {}

const PlanStagedWorkTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/npm-publish-engine/PlanStagedWorkDecision',
)
type PlanStagedWorkTypeId = typeof PlanStagedWorkTypeId

export class StagedWorkPlanned extends S.TaggedClass<StagedWorkPlanned>()(
  'StagedWorkPlanned',
  {
    items: S.Array(TrustWorkItem),
    debuts: S.Array(PackageName),
    packages: S.Int,
  },
) {
  readonly [PlanStagedWorkTypeId] = PlanStagedWorkTypeId
}

export class NoStagedWork extends S.TaggedClass<NoStagedWork>()('NoStagedWork', {
  items: S.Array(TrustWorkItem),
  debuts: S.Array(PackageName),
  packages: S.Int,
}) {
  readonly [PlanStagedWorkTypeId] = PlanStagedWorkTypeId
}

export class TrustRegistryUnreadable extends S.TaggedError<TrustRegistryUnreadable>()(
  'TrustRegistryUnreadable',
  { packages: S.Array(PackageName) },
) {}

const UnreadableCase = S.TaggedStruct('Unreadable', { packages: S.Array(PackageName) })
const EmptyCase = S.TaggedStruct('Empty', {})
const PlannedCase = S.TaggedStruct('Planned', {
  items: S.Array(TrustWorkItem),
  debuts: S.Array(PackageName),
  packages: S.Int,
})
const PlanCase = S.Union([UnreadableCase, EmptyCase, PlannedCase])
type PlanCase = S.Schema.Type<typeof PlanCase>

const debutMode: TrustWorkMode = 'debut'
const untrustedMode: TrustWorkMode = 'untrusted'

const modeOf = (candidate: TrustCandidateState): TrustWorkMode =>
  Option.match(Option.fromNullishOr(candidate.snapshot.latest), {
    onNone: () => debutMode,
    onSome: () => untrustedMode,
  })

const itemsIn = (
  command: PlanStagedWorkCommand,
): ReadonlyArray<TrustWorkItem> =>
  command.owed.map((candidate) => ({
    name: candidate.name,
    version: candidate.version,
    mode: modeOf(candidate),
    hasBuild: candidate.hasBuild,
  }))

const debutsIn = (command: PlanStagedWorkCommand): ReadonlyArray<PackageName> =>
  command.owed
    .filter((candidate) => modeOf(candidate) === debutMode)
    .map((candidate) => candidate.name)

const unreachableIn = (
  command: PlanStagedWorkCommand,
): ReadonlyArray<TrustCandidateState> => command.owed.filter((candidate) => candidate.snapshot.reachable === false)

const owedCaseOf = (command: PlanStagedWorkCommand): PlanCase =>
  Match.value(Option.fromNullishOr(command.owed[0])).pipe(
    Match.tag('None', () => EmptyCase.make({})),
    Match.tag('Some', () =>
      PlannedCase.make({
        items: [...itemsIn(command)],
        debuts: [...debutsIn(command)],
        packages: command.owed.length,
      })),
    Match.exhaustive,
  )

const classify = (command: PlanStagedWorkCommand): PlanCase =>
  Match.value(Option.fromNullishOr(unreachableIn(command)[0])).pipe(
    Match.tag('None', () => owedCaseOf(command)),
    Match.tag('Some', () =>
      UnreadableCase.make({
        packages: unreachableIn(command).map((candidate) => candidate.name),
      })),
    Match.exhaustive,
  )

export const planStagedWork = Workflow.make(
  PlanStagedWorkCommand,
  (command): Result.Result<StagedWorkPlanned | NoStagedWork, TrustRegistryUnreadable> =>
    Match.value(classify(command)).pipe(
      Match.tag(
        'Unreadable',
        (unreadable) => Result.fail(TrustRegistryUnreadable.make({ packages: [...unreadable.packages] })),
      ),
      Match.tag('Empty', () =>
        Result.succeed(
          NoStagedWork.make({ items: [], debuts: [], packages: 0 }),
        )),
      Match.tag('Planned', (planned) =>
        Result.succeed(
          StagedWorkPlanned.make({
            items: [...planned.items],
            debuts: [...planned.debuts],
            packages: planned.packages,
          }),
        )),
      Match.exhaustive,
    ),
)
