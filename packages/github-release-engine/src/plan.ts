import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import type { IntentRefusal, MemberRefusal, TagRefusal } from '@systemfsoftware/release-language'
import {
  ChangesetStore,
  Count,
  CycleStore,
  FsPath,
  GitPort,
  type Member,
  type PackageName,
  PlanDecision,
  PlanPublish,
  type PlanRefusal,
  PlanSettled,
  PlanVersion,
  RelativePath,
  type ReleaseTag,
  RemoteName,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { cycleOf, dropExcluded } from './cycle.js'
import {
  DeferredPackagesUnknown,
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

interface RawPlan {
  readonly intents: ReadonlyArray<RelativePath>
  readonly members: ReadonlyArray<Member>
  readonly tags: ReadonlyArray<ReleaseTag>
  readonly deferred: ReadonlyArray<PackageName>
  readonly changelogDir: RelativePath
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
    return {
      intents,
      members,
      tags,
      deferred: [...deferred],
      changelogDir: request.changelogDir,
    }
  })

const noUnknownDeferred: ReadonlyArray<PackageName> = []

const decode = (raw: RawPlan): Result.Result<PlanCommand, never> =>
  Result.succeed(
    PlanCommand.make({
      pending: Count.make(raw.intents.length),
      cycle: dropExcluded(cycleOf(raw.members, raw.tags, raw.changelogDir), raw.deferred),
      deferred: [...raw.deferred],
      unknownDeferred: noUnknownDeferred,
    }),
  )

const phaseOf = (decision: PlanDecision): PlanPhase =>
  Match.value(decision).pipe(
    Match.tag('PlanVersion', (): PlanPhase => 'version'),
    Match.tag('PlanPublish', (): PlanPhase => 'publish'),
    Match.tag('PlanSettled', (): PlanPhase => 'none'),
    Match.exhaustive,
  )

const cycleCountOf = (decision: PlanDecision): Count =>
  Match.value(decision).pipe(
    Match.tag('PlanVersion', (version) => Count.make(version.cycle.length)),
    Match.tag('PlanPublish', (publish) => Count.make(publish.cycle.length)),
    Match.tag('PlanSettled', (settled) => settled.cycle),
    Match.exhaustive,
  )

const unpublishedOf = (raw: RawPlan): ReadonlyArray<PackageName> => {
  const known = raw.members.map((member) => member.name)
  return raw.deferred.filter((name) => known.includes(name) === false)
}

const encode = (
  outcome: Result.Result<
    PlanReleasePublish | PlanReleaseVersion | PlanReleaseSettled,
    DeferredPackagesUnknown
  >,
): Result.Result<PlanDecision, DeferredPackagesUnknown> =>
  Result.map(outcome, (decision) =>
    Match.value(decision).pipe(
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
    ))

const write = (
  output: Result.Result<PlanDecision, DeferredPackagesUnknown>,
  raw: RawPlan,
): Effect.Effect<PlanReport, never, never> =>
  Effect.map(
    Effect.orDie(Effect.fromResult(output)),
    (decision) =>
      PlanReport.make({
        decision,
        phase: phaseOf(decision),
        pendingIntents: Count.make(raw.intents.length),
        thisCycle: cycleCountOf(decision),
        deferred: Count.make(raw.deferred.length),
        unpublished: [...unpublishedOf(raw)],
      }),
  )

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
