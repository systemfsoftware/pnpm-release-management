import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import type { IntentRefusal, MemberRefusal, TagRefusal } from '@systemfsoftware/release-language'
import {
  ChangesetStore,
  Count,
  CycleStore,
  FsPath,
  GitPort,
  type PlanRefusal,
  RelativePath,
  RemoteName,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { cycleOf, dropExcluded } from './cycle.js'
import { PlanCommand, type PlanDeferredUnknown, planRelease } from './plan-release.workflow.js'
import { type PlanDecision, PlanReport } from './plan.schema.js'

export const PlanRequest = Wire.wire({
  deferred: Wire.mint(S.optional(FsPath)),
  remote: Wire.mint(S.optional(RemoteName)),
  changelogDir: Wire.mint(RelativePath),
})

const read = (
  request: S.Schema.Type<typeof PlanRequest>,
): Effect.Effect<
  PlanCommand,
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
    return PlanCommand.make({
      pending: Count.make(intents.length),
      cycle: dropExcluded(cycleOf(members, tags, request.changelogDir), deferred),
      deferred: [...deferred],
      unknownDeferred: [],
      members: members.map((member) => member.name),
    })
  })

const write = (
  outcome: Result.Result<PlanDecision, PlanDeferredUnknown>,
  raw: PlanCommand,
): Effect.Effect<PlanReport, PlanRefusal, never> => {
  if (Result.isFailure(outcome)) {
    return Effect.fail(outcome.failure)
  }
  const decision = outcome.success
  const projected = Match.value(decision).pipe(
    Match.tag('PlanVersion', (version) => ({
      phase: 'version' as const,
      thisCycle: Count.make(version.cycle.length),
    })),
    Match.tag('PlanRelease', (release) => ({
      phase: 'release' as const,
      thisCycle: Count.make(release.cycle.length),
    })),
    Match.tag('PlanSettled', (settled) => ({
      phase: 'none' as const,
      thisCycle: Count.make(settled.cycle),
    })),
    Match.exhaustive,
  )
  return Effect.succeed(
    PlanReport.make({
      decision,
      phase: projected.phase,
      pendingIntents: raw.pending,
      thisCycle: projected.thisCycle,
      deferred: Count.make(raw.deferred.length),
      unpublished: raw.deferred.filter((name) => raw.members.includes(name) === false),
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
  decide: planRelease,
  write,
})
