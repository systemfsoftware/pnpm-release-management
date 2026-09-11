import { it } from '@effect/vitest'
import { Cell } from '@systemfsoftware/effect-cell-types'
import * as Lang from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as fc from 'effect/testing/FastCheck'
import { TrustCommand } from '../select-trust-candidates.workflow.js'
import { stageNpmTrustCell, TrustRequest } from '../stage-npm-trust.js'
import { type TrustCandidateState, type TrustWorkItem } from '../stage-trust.schema.js'
import { makeFakeProcess } from '../testing/FakeProcess.js'
import { type FakeRegistrySnapshot, makeFakeRegistry } from '../testing/FakeRegistry.js'
import { makeFakeWorkspace } from '../testing/FakeWorkspace.js'

const command = S.toArbitrary(TrustCommand)(fc)

const launcherPath = 'dist/launcher.json'

const manifestPathsIn = (
  command: TrustCommand,
): Record<string, string> => {
  if (command.launcherReady === true) {
    return { [launcherPath]: '{}' }
  }
  return {}
}

const launcherFlag = {
  launcherManifest: S.decodeUnknownSync(Lang.RelativePath)(launcherPath),
}

const snapshotOf = (candidate: TrustCandidateState): FakeRegistrySnapshot => {
  const base = { attested: candidate.snapshot.attested, reachable: candidate.snapshot.reachable }
  if (candidate.snapshot.latest === undefined) {
    return base
  }
  return { ...base, latest: candidate.snapshot.latest }
}

const snapshotsIn = (
  command: TrustCommand,
): Record<string, FakeRegistrySnapshot> =>
  Object.fromEntries(
    command.candidates.map((candidate) => [candidate.name, snapshotOf(candidate)]),
  )

const requestOf = (command: TrustCommand): TrustRequest => ({
  only: [...command.only],
  dryRun: command.dryRun,
  registry: command.registry,
  workflowFile: command.workflowFile,
  slug: command.slug,
  jobs: 1,
  ...launcherFlag,
})

const layerOf = (command: TrustCommand) =>
  Layer.mergeAll(
    makeFakeWorkspace({
      members: command.candidates.map((candidate) => ({
        name: candidate.name,
        dir: `packages/${candidate.name}`,
        version: candidate.version,
        build: candidate.hasBuild,
      })),
      files: manifestPathsIn(command),
    }).layer,
    makeFakeRegistry({ snapshots: snapshotsIn(command) }).layer,
    makeFakeProcess().layer,
  )

const runTrustPipeline = (command: TrustCommand) =>
  Effect.runSync(
    Effect.match(
      Cell.run(Cell.provide(stageNpmTrustCell, layerOf(command)), requestOf(command)),
      {
        onFailure: (refusal) => Result.fail(refusal),
        onSuccess: (decision) => Result.succeed(decision),
      },
    ),
  )

const matchedOf = (
  request: TrustCommand,
): ReadonlyArray<TrustCandidateState> => {
  if (request.only.length === 0) {
    return request.candidates
  }
  return request.candidates.filter((candidate) => request.only.includes(candidate.name))
}

const owedOf = (
  matched: ReadonlyArray<TrustCandidateState>,
): ReadonlyArray<TrustCandidateState> =>
  matched.filter((candidate) => candidate.snapshot.latest === undefined || candidate.snapshot.attested === false)

const owedModesMatch = (
  decided: ReadonlyArray<TrustWorkItem>,
  source: ReadonlyArray<TrustCandidateState>,
): boolean =>
  decided.length === source.length &&
  decided.every((item) =>
    source.some((candidate) => {
      if (candidate.snapshot.latest === undefined) {
        return candidate.name === item.name && candidate.version === item.version &&
          candidate.hasBuild === item.hasBuild && item.mode === 'debut'
      }
      return candidate.name === item.name && candidate.version === item.version &&
        candidate.hasBuild === item.hasBuild && item.mode === 'untrusted'
    })
  )

const owedLaw = (request: TrustCommand): boolean => {
  const outcome = runTrustPipeline(request)
  const matched = matchedOf(request)
  const owed = owedOf(matched)
  const debuts = owed.filter((candidate) => candidate.snapshot.latest === undefined)
  const unreadable = matched.filter((candidate) => candidate.snapshot.reachable === false)
  if (Result.isFailure(outcome)) {
    return Match.value(outcome.failure).pipe(
      Match.tag('TrustWorkspaceEmpty', () => request.candidates.length === 0),
      Match.tag('TrustOnlyUnmatched', () => request.only.length > 0 && matched.length === 0),
      Match.tag('TrustRegistryUnreadable', () => unreadable.length > 0),
      Match.tag('TrustLauncherMissing', () => debuts.length > 0 && request.launcherReady === false),
      Match.orElse(() => false),
    )
  }
  return Match.value(outcome.success).pipe(
    Match.tag('TrustIdle', (idle) => owed.length === 0 && idle.packages === matched.length),
    Match.tag(
      'TrustComplete',
      (complete) =>
        complete.processed === owed.length && complete.debuts === debuts.length &&
        complete.dryRun === request.dryRun && complete.workflowFile === request.workflowFile &&
        complete.slug === request.slug && owedModesMatch(complete.owed, owed),
    ),
    Match.exhaustive,
  )
}

const precedenceLaw = (request: TrustCommand): boolean => {
  const matched = matchedOf(request)
  const owed = owedOf(matched)
  const debuts = owed.filter((candidate) => candidate.snapshot.latest === undefined)
  const unreadable = matched.filter((candidate) => candidate.snapshot.reachable === false)
  let firstHit = 'TrustComplete'
  if (request.candidates.length === 0) {
    firstHit = 'TrustWorkspaceEmpty'
  } else if (request.only.length > 0 && matched.length === 0) {
    firstHit = 'TrustOnlyUnmatched'
  } else if (unreadable.length > 0) {
    firstHit = 'TrustRegistryUnreadable'
  } else if (debuts.length > 0 && request.launcherReady === false) {
    firstHit = 'TrustLauncherMissing'
  } else if (owed.length === 0) {
    firstHit = 'TrustIdle'
  }
  const outcome = runTrustPipeline(request)
  if (Result.isFailure(outcome)) {
    const actual = Match.value(outcome.failure).pipe(
      Match.tag('TrustWorkspaceEmpty', () => 'TrustWorkspaceEmpty'),
      Match.tag('TrustOnlyUnmatched', () => 'TrustOnlyUnmatched'),
      Match.tag('TrustRegistryUnreadable', () => 'TrustRegistryUnreadable'),
      Match.tag('TrustLauncherMissing', () => 'TrustLauncherMissing'),
      Match.orElse(() => 'UnstagedRefusal'),
    )
    return actual === firstHit
  }
  const actual = Match.value(outcome.success).pipe(
    Match.tag('TrustIdle', () => 'TrustIdle'),
    Match.tag('TrustComplete', () => 'TrustComplete'),
    Match.exhaustive,
  )
  return actual === firstHit
}

const dedupedOf = (request: TrustCommand): TrustCommand =>
  TrustCommand.make({
    only: [...request.only],
    dryRun: request.dryRun,
    registry: request.registry,
    workflowFile: request.workflowFile,
    slug: request.slug,
    launcherReady: request.launcherReady,
    candidates: request.candidates.filter((candidate, index) =>
      request.candidates.findIndex((entry) => entry.name === candidate.name) === index
    ),
  })

it.prop('∀req_StageNpmTrust_≡OwesOwed', [command], ([request]) => owedLaw(dedupedOf(request)))

it.prop('∀req_StageNpmTrust_≡PrecedenceHolds', [command], ([request]) => precedenceLaw(dedupedOf(request)))
