import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as fc from 'fast-check'
import {
  bootstrapNpmTrust,
  type TrustCandidateState,
  TrustCommand,
  type TrustWorkItem,
} from './bootstrap-npm-trust.workflow.ts'

const command = S.toArbitrary(TrustCommand)(fc)

const matchedOf = (
  request: TrustCommand,
): ReadonlyArray<TrustCandidateState> =>
  request.only.length === 0
    ? request.candidates
    : request.candidates.filter((candidate) => request.only.includes(candidate.name))

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
    source.some((candidate) =>
      candidate.name === item.name && candidate.version === item.version &&
      candidate.hasBuild === item.hasBuild &&
      item.mode === (candidate.snapshot.latest === undefined ? 'debut' : 'untrusted')
    )
  )

const owedLaw = (request: TrustCommand): boolean => {
  const outcome = bootstrapNpmTrust(request)
  const matched = matchedOf(request)
  const owed = owedOf(matched)
  const debuts = owed.filter((candidate) => candidate.snapshot.latest === undefined)
  const unreadable = matched.filter((candidate) => candidate.snapshot.reachable === false)
  if (Result.isFailure(outcome)) {
    const tag = outcome.failure._tag
    if (tag === 'TrustWorkspaceEmpty') {
      return request.candidates.length === 0
    }
    if (tag === 'TrustOnlyUnmatched') {
      return request.only.length > 0 && matched.length === 0
    }
    if (tag === 'TrustRegistryUnreadable') {
      return unreadable.length > 0
    }
    return debuts.length > 0 && request.launcherReady === false
  }
  const decision = outcome.success
  if (decision._tag === 'TrustIdle') {
    return owed.length === 0 && decision.packages === matched.length
  }
  return decision.processed === owed.length && decision.debuts === debuts.length &&
    decision.dryRun === request.dryRun && decision.workflowFile === request.workflowFile &&
    decision.slug === request.slug && owedModesMatch(decision.owed, owed)
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
  const actual = Result.isFailure(outcome) ? outcome.failure._tag : outcome.success._tag
  return actual === firstHit
}

Deno.test('bootstrapNpmTrust owes exactly the debut and untrusted members', () => {
  fc.assert(fc.property(command, owedLaw))
})

Deno.test('bootstrapNpmTrust honors refusal precedence', () => {
  fc.assert(fc.property(command, precedenceLaw))
})
