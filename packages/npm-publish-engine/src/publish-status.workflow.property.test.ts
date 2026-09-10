import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as fc from 'fast-check'
import { publishStatus, StatusCommand, type StatusEvaluationState } from './publish-status.workflow.ts'

const command = S.toArbitrary(StatusCommand)(fc)

type StatusKind = 'unpublished' | 'no-oidc' | 'stuck' | 'ok' | 'error'

const classOf = (evaluation: StatusEvaluationState): StatusKind => {
  if (evaluation.npmLatest === undefined) {
    return 'unpublished'
  }
  if (evaluation.reachable === false) {
    return 'error'
  }
  if (evaluation.attested === false) {
    return 'no-oidc'
  }
  if (evaluation.localVersion === evaluation.npmLatest) {
    return 'ok'
  }
  return 'stuck'
}

const truthTable = (request: StatusCommand): boolean => {
  const kinds = request.evaluations.map((evaluation) => classOf(evaluation))
  const countOf = (kind: StatusKind): number => kinds.filter((found) => found === kind).length
  const outcome = publishStatus(request)
  if (Result.isFailure(outcome)) {
    const tag = outcome.failure._tag
    if (tag === 'PublishStatusEmpty') {
      return request.evaluations.length === 0
    }
    if (tag === 'PublishStatusUnreadable') {
      return request.mode !== 'report' && countOf('error') > 0
    }
    if (tag === 'PublishStatusUnpublished') {
      return countOf('error') === 0 && countOf('unpublished') > 0 &&
        (request.mode === 'check' || request.mode === 'preflight')
    }
    return countOf('error') === 0 && request.mode === 'check' &&
      countOf('unpublished') === 0 && countOf('no-oidc') > 0
  }
  const decision = outcome.success
  const settled = request.evaluations.length > 0 &&
    (request.mode === 'report' || countOf('error') === 0) &&
    (request.mode !== 'check' || (countOf('unpublished') === 0 && countOf('no-oidc') === 0)) &&
    (request.mode !== 'preflight' || countOf('unpublished') === 0)
  if (settled === false) {
    return false
  }
  if (decision._tag === 'PublishStatusHealthy') {
    return countOf('unpublished') === 0 && countOf('no-oidc') === 0 &&
      countOf('stuck') === 0 && countOf('error') === 0 &&
      decision.packages === request.evaluations.length
  }
  return decision.unpublished === countOf('unpublished') &&
    decision.untrusted === countOf('no-oidc') &&
    decision.stuck === countOf('stuck') &&
    decision.evaluations.length === request.evaluations.length
}

const populationPreserved = (request: StatusCommand): boolean => {
  const kinds = request.evaluations.map((evaluation) => classOf(evaluation))
  const countOf = (kind: StatusKind): number => kinds.filter((found) => found === kind).length
  const outcome = publishStatus(request)
  if (Result.isFailure(outcome)) {
    return request.evaluations.length === 0 ||
      (request.mode !== 'report' && countOf('error') > 0) ||
      ((request.mode === 'check' || request.mode === 'preflight') &&
        countOf('unpublished') > 0) ||
      (request.mode === 'check' && countOf('no-oidc') > 0)
  }
  const kept = outcome.success.evaluations.map((evaluation) => evaluation.name).sort()
  const wanted = request.evaluations.map((evaluation) => evaluation.name).sort()
  return kept.length === wanted.length && kept.every((name, index) => name === wanted[index])
}

Deno.test('publishStatus obeys the classification truth table', () => {
  fc.assert(fc.property(command, truthTable))
})

Deno.test('publishStatus preserves the evaluated population', () => {
  fc.assert(fc.property(command, populationPreserved))
})
