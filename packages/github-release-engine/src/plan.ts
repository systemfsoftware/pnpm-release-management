import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import type { IntentRefusal, MemberRefusal, TagRefusal } from '@systemfsoftware/release-language'
import {
  ChangesetStore,
  Count,
  CycleStore,
  FsPath,
  GitPort,
  PackageName,
  PlanDecision,
  PlanDeferredUnknown,
  PlanPublish,
  type PlanRefusal,
  PlanSettled,
  PlanVersion,
  RelativePath,
  RemoteName,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { computeCycle, dropExcluded, nonEmptyArray } from './cycle.js'
import {
  type DeferredPackagesUnknown,
  PlanCommand,
  planRelease,
  type PlanReleasePublish,
  type PlanReleaseSettled,
  type PlanReleaseVersion,
} from './plan-release.workflow.js'
import { PlanPhase, PlanReport } from './plan.schema.js'

export { PlanReport } from './plan.schema.js'

export const PlanRequest = Wire.wire({
  deferred: Wire.mint(S.optional(FsPath)),
  remote: Wire.mint(S.optional(RemoteName)),
  changelogDir: Wire.mint(RelativePath),
})

class RawPlan {
  constructor(
    readonly pending: Count,
    readonly members: Parameters<typeof computeCycle>[0],
    readonly tags: Parameters<typeof computeCycle>[1],
    readonly deferred: ReadonlyArray<PackageName>,
    readonly changelogDir: RelativePath,
  ) {}
}

const read = (
  request: S.Schema.Type<typeof PlanRequest>,
): Effect.Effect<
  RawPlan,
  PlanRefusal | IntentRefusal | MemberRefusal | TagRefusal,
  ChangesetStore | WorkspaceStore | GitPort | CycleStore
> =>
  Effect.gen(function*() {
    const remote = request.remote ?? RemoteName.make('origin')
    const changesets = yield* ChangesetStore
    const workspace = yield* WorkspaceStore
    const git = yield* GitPort
    const cycles = yield* CycleStore
    const intents = yield* changesets.listIntents()
    const members = yield* workspace.listMembers()
    const tags = yield* git.remoteTags(remote)
    const deferred = yield* cycles.readDeferred(request.deferred)
    return new RawPlan(
      Count.make(intents.length),
      members,
      tags,
      deferred,
      request.changelogDir,
    )
  })

const decode = (raw: RawPlan): Result.Result<PlanCommand, never> => {
  const known = new Set<PackageName>(raw.members.map((member) => member.name))
  return Result.succeed(
    PlanCommand.make({
      pending: raw.pending,
      cycle: dropExcluded(computeCycle(raw.members, raw.tags, raw.changelogDir), raw.deferred),
      deferred: [...raw.deferred],
      unknownDeferred: raw.deferred.filter((name) => !known.has(name)),
    }),
  )
}

interface EncodedPlan {
  readonly decision: PlanDecision
  readonly phase: PlanPhase
}

const encode = (
  outcome: Result.Result<
    PlanReleasePublish | PlanReleaseVersion | PlanReleaseSettled,
    DeferredPackagesUnknown
  >,
): Result.Result<EncodedPlan, PlanRefusal> =>
  Result.mapError(outcome, (bad) => PlanDeferredUnknown.make({ packages: nonEmptyArray([...bad.packages]) })).pipe(
    Result.map((decision) => ({
      decision: Match.value(decision).pipe(
        Match.tag('PlanReleasePublish', (publish) => PlanPublish.make({ cycle: [...publish.cycle] })),
        Match.tag(
          'PlanReleaseVersion',
          (version) => PlanVersion.make({ pending: version.pending, cycle: [...version.cycle] }),
        ),
        Match.tag('PlanReleaseSettled', (settled) =>
          PlanSettled.make({
            pending: settled.pending,
            cycle: Count.make(settled.cycleCount),
          })),
        Match.exhaustive,
      ),
      phase: Match.value(decision).pipe(
        Match.tag('PlanReleaseVersion', (): PlanPhase => 'version'),
        Match.tag('PlanReleasePublish', (): PlanPhase => 'publish'),
        Match.tag('PlanReleaseSettled', (): PlanPhase => 'none'),
        Match.exhaustive,
      ),
    })),
  )

const write = (
  output: Result.Result<EncodedPlan, PlanRefusal>,
  raw: RawPlan,
): Effect.Effect<PlanReport, PlanRefusal, never> => {
  if (Result.isFailure(output)) {
    return Match.value(output.failure).pipe(
      Match.tag('PlanCapturedMalformed', (malformed) => Effect.fail(malformed)),
      Match.tag('PlanDeferredUnknown', (unknown) =>
        Effect.succeed(
          (() => {
            const owed = dropExcluded(computeCycle(raw.members, raw.tags, raw.changelogDir), raw.deferred)
            const phaseFrom = (): PlanPhase => {
              if (owed.length > 0) {
                return 'publish'
              }
              if (raw.pending > 0) {
                return 'version'
              }
              return 'none'
            }
            const decisionFrom = (): PlanDecision => {
              if (owed.length > 0) {
                return PlanPublish.make({ cycle: owed })
              }
              if (raw.pending > 0) {
                return PlanVersion.make({ pending: raw.pending, cycle: owed })
              }
              return PlanSettled.make({ pending: raw.pending, cycle: Count.make(0) })
            }
            const decision = decisionFrom()
            return PlanReport.make({
              decision,
              phase: phaseFrom(),
              pendingIntents: raw.pending,
              thisCycle: Match.value(decision).pipe(
                Match.tag('PlanVersion', (version) => Count.make(version.cycle.length)),
                Match.tag('PlanPublish', (publish) => Count.make(publish.cycle.length)),
                Match.tag('PlanSettled', (settled) => settled.cycle),
                Match.exhaustive,
              ),
              deferred: Count.make(raw.deferred.length),
              unpublished: [...unknown.packages],
            })
          })(),
        )),
      Match.exhaustive,
    )
  }
  const encoded = output.success
  return Effect.succeed(
    PlanReport.make({
      decision: encoded.decision,
      phase: encoded.phase,
      pendingIntents: raw.pending,
      thisCycle: Match.value(encoded.decision).pipe(
        Match.tag('PlanVersion', (version) => Count.make(version.cycle.length)),
        Match.tag('PlanPublish', (publish) => Count.make(publish.cycle.length)),
        Match.tag('PlanSettled', (settled) => settled.cycle),
        Match.exhaustive,
      ),
      deferred: Count.make(raw.deferred.length),
      unpublished: [],
    }),
  )
}

export const planCell: Cell.Cell<
  S.Schema.Type<typeof PlanRequest>,
  PlanReport,
  PlanRefusal | IntentRefusal | MemberRefusal | TagRefusal,
  ChangesetStore | WorkspaceStore | GitPort | CycleStore
> = Cell.layer({
  read,
  decode,
  decide: planRelease,
  encode,
  write,
})
