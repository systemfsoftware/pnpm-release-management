import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import type { IntentRefusal, LegacyTagUnverified, MemberRefusal, TagRefusal } from '@systemfsoftware/release-language'
import {
  ChangesetsPort,
  ChangesetStore,
  Count,
  CycleStore,
  FsPath,
  GitPort,
  type IntegrityRefusal,
  LEDGER_PATH,
  type LedgerIdentityRefusal,
  LedgerPort,
  type LedgerRefusal,
  LegacyTags,
  type PlanRefusal,
  RelativePath,
  ReleaseLedger,
  RemoteName,
  TarballDigest,
  TarballPort,
  type VersionBurned,
  type VersionIntentMalformed,
  type VersionUnknownPackage,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect, Option } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { cycleOf, dropExcluded } from './cycle.js'
import { exemptNames, identityCandidates, verifyIntegrity } from './integrity.js'
import { legacyReleased } from './legacy.js'
import { PlanCommand, type PlanDeferredUnknown, planRelease } from './plan-release.workflow.js'
import { type PlanDecision, PlanReport } from './plan.schema.js'
import { releasedTarballChecks } from './released-tarballs.js'

export const PlanRequest = Wire.wire({
  deferred: Wire.mint(S.optional(FsPath)),
  remote: Wire.mint(S.optional(RemoteName)),
  tarballs: Wire.mint(FsPath),
  changelogDir: Wire.mint(RelativePath),
  legacyTags: Wire.mint(S.optional(LegacyTags)),
})

export type PlanReadRefusal =
  | PlanRefusal
  | IntegrityRefusal
  | LedgerRefusal
  | LedgerIdentityRefusal
  | VersionBurned
  | VersionIntentMalformed
  | VersionUnknownPackage
  | IntentRefusal
  | MemberRefusal
  | TagRefusal
  | LegacyTagUnverified

const digestsWhen = <E, R>(
  needed: boolean,
  read: () => Effect.Effect<ReadonlyArray<TarballDigest>, E, R>,
): Effect.Effect<ReadonlyArray<TarballDigest>, E, R> => {
  if (!needed) return Effect.succeed([])
  return read()
}

const read = (
  request: S.Schema.Type<typeof PlanRequest>,
): Effect.Effect<
  PlanCommand,
  PlanReadRefusal,
  ChangesetStore | WorkspaceStore | GitPort | CycleStore | ChangesetsPort | TarballPort | LedgerPort
> =>
  Effect.gen(function*() {
    const remote = request.remote ?? RemoteName.make('origin')
    const changesets = yield* ChangesetStore
    const workspace = yield* WorkspaceStore
    const git = yield* GitPort
    const cycles = yield* CycleStore
    const port = yield* ChangesetsPort
    const tarballs = yield* TarballPort
    const ledgerPort = yield* LedgerPort
    const intents = yield* changesets.listIntents()
    const members = yield* workspace.listMembers()
    const tags = yield* git.remoteTags(remote)
    const legacy = yield* legacyReleased({ git, remote, members, remoteTags: tags, legacy: request.legacyTags })
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
    const digests = yield* digestsWhen(toCheck.length > 0, () => tarballs.read(request.tarballs))
    const ledger = yield* ledgerPort.read(LEDGER_PATH)
    const ledgerEntries = Option.getOrElse(ledger, () => ReleaseLedger.make({ entries: [] })).entries
    const checks = yield* releasedTarballChecks(toCheck, digests, ledgerEntries, remote)
    if (toCheck.length > 0) {
      const verdict = verifyIntegrity(checks)
      if (Result.isFailure(verdict)) {
        return yield* Effect.fail(verdict.failure)
      }
    }
    const storage = yield* workspace.changelogStorage()
    return PlanCommand.make({
      pending: Count.make(intents.length),
      cycle: dropExcluded(cycleOf(members, tags, legacy, request.changelogDir, storage), deferred),
      deferred: [...deferred],
      unknownDeferred: [],
      members: members.map((member) => member.name),
      legacy: [...legacy],
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
      legacy: raw.legacy,
    }),
  )
}

export const planCell: Cell.Cell<
  S.Schema.Type<typeof PlanRequest>,
  PlanReport,
  PlanReadRefusal,
  ChangesetStore | WorkspaceStore | GitPort | CycleStore | ChangesetsPort | TarballPort | LedgerPort
> = Cell.layer({
  read,
  decide: planRelease,
  write,
})
