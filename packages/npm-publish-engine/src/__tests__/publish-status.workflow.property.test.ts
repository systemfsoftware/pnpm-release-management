import { it } from '@effect/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as fc from 'effect/testing/FastCheck'
import { publishStatus, StatusCommand, type StatusEvaluationState } from '../publish-status.workflow.js'

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
    return Match.value(outcome.failure).pipe(
      Match.tag('PublishStatusEmpty', () => request.evaluations.length === 0),
      Match.tag('PublishStatusUnreadable', () => request.mode !== 'report' && countOf('error') > 0),
      Match.tag(
        'PublishStatusUnpublished',
        () =>
          countOf('error') === 0 && countOf('unpublished') > 0 &&
          (request.mode === 'check' || request.mode === 'preflight'),
      ),
      Match.tag(
        'PublishStatusUnattested',
        () =>
          countOf('error') === 0 && request.mode === 'check' &&
          countOf('unpublished') === 0 && countOf('no-oidc') > 0,
      ),
      Match.exhaustive,
    )
  }
  const settled = request.evaluations.length > 0 &&
    (request.mode === 'report' || countOf('error') === 0) &&
    (request.mode !== 'check' || (countOf('unpublished') === 0 && countOf('no-oidc') === 0)) &&
    (request.mode !== 'preflight' || countOf('unpublished') === 0)
  if (settled === false) {
    return false
  }
  return Match.value(outcome.success).pipe(
    Match.tag(
      'PublishStatusHealthy',
      (healthy) =>
        countOf('unpublished') === 0 && countOf('no-oidc') === 0 &&
        countOf('stuck') === 0 && countOf('error') === 0 &&
        healthy.packages === request.evaluations.length,
    ),
    Match.tag(
      'PublishStatusOwed',
      (owed) =>
        owed.unpublished === countOf('unpublished') &&
        owed.untrusted === countOf('no-oidc') &&
        owed.stuck === countOf('stuck') &&
        owed.evaluations.length === request.evaluations.length,
    ),
    Match.exhaustive,
  )
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
  const kept = Match.value(outcome.success).pipe(
    Match.tag('PublishStatusHealthy', (healthy) => healthy.evaluations.map((evaluation) => evaluation.name).sort()),
    Match.tag('PublishStatusOwed', (owed) => owed.evaluations.map((evaluation) => evaluation.name).sort()),
    Match.exhaustive,
  )
  const wanted = request.evaluations.map((evaluation) => evaluation.name).sort()
  return kept.length === wanted.length && kept.every((name, index) => name === wanted[index])
}

it.prop('∀req_PublishStatus_≡TruthTable', [command], ([request]) => truthTable(request))

it.prop('∀req_PublishStatus_≡PopulationPreserved', [command], ([request]) => populationPreserved(request))
