import { it } from '@effect/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as fc from 'effect/testing/FastCheck'
import {
  bootstrapNpmTrust,
  type TrustCandidateState,
  TrustCommand,
  type TrustWorkItem,
} from '../bootstrap-npm-trust.workflow.js'

const command = S.toArbitrary(TrustCommand)(fc)

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
  const outcome = bootstrapNpmTrust(request)
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
      Match.exhaustive,
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
  const outcome = bootstrapNpmTrust(request)
  if (Result.isFailure(outcome)) {
    const actual = Match.value(outcome.failure).pipe(
      Match.tag('TrustWorkspaceEmpty', () => 'TrustWorkspaceEmpty'),
      Match.tag('TrustOnlyUnmatched', () => 'TrustOnlyUnmatched'),
      Match.tag('TrustRegistryUnreadable', () => 'TrustRegistryUnreadable'),
      Match.tag('TrustLauncherMissing', () => 'TrustLauncherMissing'),
      Match.exhaustive,
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

it.prop('∀req_BootstrapTrust_≡OwesOwed', [command], ([request]) => owedLaw(request))

it.prop('∀req_BootstrapTrust_≡PrecedenceHolds', [command], ([request]) => precedenceLaw(request))
