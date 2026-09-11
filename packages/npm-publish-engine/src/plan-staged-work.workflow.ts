import { Workflow } from '@systemfsoftware/effect-cell-types'
import { DecisionTypeId, PackageName, type TrustRegistryUnreadable } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { TrustCandidateState, TrustWorkItem, type TrustWorkMode, type TrustWorkStep } from './stage-trust.schema.js'

export class PlanStagedWorkCommand extends S.TaggedClass<PlanStagedWorkCommand>()(
  'PlanStagedWorkCommand',
  {
    owed: S.Array(TrustCandidateState),
  },
) {}

export class StagedWorkPlanned extends S.TaggedClass<StagedWorkPlanned>()(
  'StagedWorkPlanned',
  {
    items: S.Array(TrustWorkItem),
    debuts: S.Array(PackageName),
    packages: S.Int,
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class NoStagedWork extends S.TaggedClass<NoStagedWork>()('NoStagedWork', {
  items: S.Array(TrustWorkItem),
  debuts: S.Array(PackageName),
  packages: S.Int,
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

const UnreadableCase = S.TaggedStruct('Unreadable', { packages: S.NonEmptyArray(PackageName) })
type UnreadableCase = S.Schema.Type<typeof UnreadableCase>

const EmptyCase = S.TaggedStruct('Empty', {
  items: S.Array(TrustWorkItem),
  debuts: S.Array(PackageName),
  packages: S.Int,
})
type EmptyCase = S.Schema.Type<typeof EmptyCase>

const PlannedCase = S.TaggedStruct('Planned', {
  items: S.Array(TrustWorkItem),
  debuts: S.Array(PackageName),
  packages: S.Int,
})
type PlannedCase = S.Schema.Type<typeof PlannedCase>

type PlanCase = UnreadableCase | EmptyCase | PlannedCase

const debutMode: TrustWorkMode = 'debut'
const untrustedMode: TrustWorkMode = 'untrusted'

const buildStep: TrustWorkStep = 'build'
const publishStep: TrustWorkStep = 'publish'
const githubStep: TrustWorkStep = 'trust-github'
const listStep: TrustWorkStep = 'trust-list'

const untrustedSteps: ReadonlyArray<TrustWorkStep> = [githubStep, listStep]

const modeOf = (candidate: TrustCandidateState): TrustWorkMode => {
  if (candidate.snapshot.latest === undefined) return debutMode
  return untrustedMode
}

const stepsOf = (candidate: TrustCandidateState): ReadonlyArray<TrustWorkStep> => {
  if (candidate.snapshot.latest !== undefined) return untrustedSteps
  if (candidate.hasBuild) return [buildStep, publishStep, githubStep, listStep]
  return [publishStep, githubStep, listStep]
}

const itemsIn = (owed: ReadonlyArray<TrustCandidateState>): ReadonlyArray<TrustWorkItem> =>
  owed.map((candidate) => ({
    name: candidate.name,
    version: candidate.version,
    mode: modeOf(candidate),
    hasBuild: candidate.hasBuild,
    steps: stepsOf(candidate),
  }))

const debutsIn = (owed: ReadonlyArray<TrustCandidateState>): ReadonlyArray<PackageName> =>
  owed
    .filter((candidate) => modeOf(candidate) === debutMode)
    .map((candidate) => candidate.name)

const nonEmptyOf = (
  names: ReadonlyArray<PackageName>,
): readonly [PackageName, ...PackageName[]] | undefined => {
  const first = names[0]
  if (first === undefined) return undefined
  return [first, ...names.slice(1)]
}

const planCaseOf = (command: PlanStagedWorkCommand): PlanCase => {
  const unreadable = nonEmptyOf(
    command.owed
      .filter((candidate) => candidate.snapshot.reachable === false)
      .map((candidate) => candidate.name),
  )
  if (unreadable !== undefined) return UnreadableCase.make({ packages: unreadable })
  if (command.owed.length === 0) return EmptyCase.make({ items: [], debuts: [], packages: 0 })
  return PlannedCase.make({
    items: itemsIn(command.owed),
    debuts: debutsIn(command.owed),
    packages: command.owed.length,
  })
}

export const planStagedWork = Workflow.make(
  PlanStagedWorkCommand,
  (command): Result.Result<StagedWorkPlanned | NoStagedWork, TrustRegistryUnreadable> =>
    Match.value(planCaseOf(command)).pipe(
      Match.tag(
        'Unreadable',
        (unreadable): Result.Result<never, TrustRegistryUnreadable> =>
          Result.fail({ _tag: 'TrustRegistryUnreadable', packages: unreadable.packages }),
      ),
      Match.tag('Empty', (empty) =>
        Result.succeed(
          NoStagedWork.make({
            items: empty.items,
            debuts: empty.debuts,
            packages: empty.packages,
          }),
        )),
      Match.tag('Planned', (planned) =>
        Result.succeed(
          StagedWorkPlanned.make({
            items: planned.items,
            debuts: planned.debuts,
            packages: planned.packages,
          }),
        )),
      Match.exhaustive,
    ),
)
