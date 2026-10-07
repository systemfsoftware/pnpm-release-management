import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import type { IntentRefusal, MemberRefusal, TagRefusal } from '@systemfsoftware/release-language'
import {
  ChangesetsPort,
  ChangesetStore,
  Count,
  CycleStore,
  FsPath,
  GitPort,
  type IntegrityRefusal,
  type PlanRefusal,
  RelativePath,
  RemoteName,
  TagAnnotationLightweight,
  TagAnnotationMalformed,
  TarballDigest,
  TarballIntegrity,
  TarballMissing,
  TarballPort,
  type VersionIntentMalformed,
  type VersionUnknownPackage,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect, Option } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { cycleOf, dropExcluded, tagOf } from './cycle.js'
import { exemptNames, identityCandidates } from './integrity.js'
import { verifyIntegrity } from './integrity.js'
import { type IntegrityCheck } from './integrity.schema.js'
import { PlanCommand, type PlanDeferredUnknown, planRelease } from './plan-release.workflow.js'
import { type PlanDecision, PlanReport } from './plan.schema.js'

export const PlanRequest = Wire.wire({
  deferred: Wire.mint(S.optional(FsPath)),
  remote: Wire.mint(S.optional(RemoteName)),
  tarballs: Wire.mint(FsPath),
  changelogDir: Wire.mint(RelativePath),
})

export type PlanReadRefusal =
  | PlanRefusal
  | IntegrityRefusal
  | VersionIntentMalformed
  | VersionUnknownPackage
  | IntentRefusal
  | MemberRefusal
  | TagRefusal

const parseAnnotation = (text: string): Result.Result<TarballIntegrity, string> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    let reason = 'annotation is not JSON'
    if (cause instanceof Error) {
      reason = cause.message
    }
    return Result.fail(reason)
  }
  return Result.mapError(
    S.decodeUnknownResult(TarballIntegrity)(parsed),
    (error) => error.message,
  )
}

const read = (
  request: S.Schema.Type<typeof PlanRequest>,
): Effect.Effect<
  PlanCommand,
  PlanReadRefusal,
  ChangesetStore | WorkspaceStore | GitPort | CycleStore | ChangesetsPort | TarballPort
> =>
  Effect.gen(function*() {
    const remote = request.remote ?? RemoteName.make('origin')
    const changesets = yield* ChangesetStore
    const workspace = yield* WorkspaceStore
    const git = yield* GitPort
    const cycles = yield* CycleStore
    const port = yield* ChangesetsPort
    const tarballs = yield* TarballPort
    const intents = yield* changesets.listIntents()
    const members = yield* workspace.listMembers()
    const tags = yield* git.remoteTags(remote)
    const deferred = yield* cycles.readDeferred(request.deferred)
    const planned = yield* port.plan()
    const candidates = identityCandidates(
      members.map((member) => ({
        name: member.name,
        version: member.manifest.version,
        publishable: member.publishable,
      })),
      tags,
    )
    const exempt = exemptNames(
      candidates.map((member) => ({ name: member.name, version: member.version })),
      planned.releases,
    )
    const toCheck = candidates.filter((member) => exempt.includes(member.name) === false)
    const digests: ReadonlyArray<TarballDigest> = toCheck.length > 0 ? yield* tarballs.read(request.tarballs) : []
    const checks: Array<IntegrityCheck> = []
    for (const member of toCheck) {
      const version = member.version
      const digest = digests.find((entry) => entry.name === member.name && entry.version === version)
      if (digest === undefined) {
        return yield* Effect.fail(TarballMissing.make({ package: member.name, version }))
      }
      const tag = tagOf(member.name, version)
      const annotation = yield* git.tagAnnotation(remote, tag)
      if (Option.isNone(annotation)) {
        return yield* Effect.fail(TagAnnotationLightweight.make({ tag }))
      }
      const recorded = parseAnnotation(annotation.value)
      if (Result.isFailure(recorded)) {
        return yield* Effect.fail(TagAnnotationMalformed.make({ tag, reason: recorded.failure }))
      }
      checks.push({
        package: member.name,
        version,
        recorded: recorded.success,
        current: { integrity: digest.integrity, files: digest.files },
      })
    }
    if (toCheck.length > 0) {
      const verdict = verifyIntegrity(checks)
      if (Result.isFailure(verdict)) {
        return yield* Effect.fail(verdict.failure)
      }
    }
    const storage = yield* workspace.changelogStorage()
    return PlanCommand.make({
      pending: Count.make(intents.length),
      cycle: dropExcluded(cycleOf(members, tags, request.changelogDir, storage), deferred),
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
  PlanReadRefusal,
  ChangesetStore | WorkspaceStore | GitPort | CycleStore | ChangesetsPort | TarballPort
> = Cell.layer({
  read,
  decide: planRelease,
  write,
})
