import { it } from '@effect/vitest'
import type * as Lang from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as fc from 'effect/testing/FastCheck'
import { PublishCommand, publishPackages } from '../publish-packages.workflow.js'

const command = S.toArbitrary(PublishCommand)(fc)

const sameWire = (
  left: Lang.WorkspaceCommand,
  right: Lang.WorkspaceCommand,
): boolean =>
  left.program === right.program && left.cwd === right.cwd &&
  left.args.length === right.args.length &&
  left.args.every((arg, index) => arg === right.args[index])

const dispatchLaw = (request: PublishCommand): boolean => {
  const outcome = publishPackages(request)
  const outstanding = request.entries.filter((entry) => entry.published === false)
  if (Result.isFailure(outcome)) {
    return Match.value(outcome.failure).pipe(
      Match.tag(
        'PublishCapturedRequired',
        () => request.unpublishedOnly === true && request.capturedPath === undefined,
      ),
      Match.tag('PublishFiltersUnreadable', () => false),
      Match.tag('PublishCommandRefused', () => false),
      Match.exhaustive,
    )
  }
  return Match.value(outcome.success).pipe(
    Match.tag(
      'PublishNothingOwed',
      (settled) =>
        request.unpublishedOnly === true &&
        outstanding.length === 0 &&
        settled.packages === request.packages,
    ),
    Match.tag(
      'PublishDryRun',
      (preview) => request.dryRun === true && sameWire(preview.command, request.command),
    ),
    Match.tag(
      'PublishDispatched',
      (job) => request.dryRun === false && sameWire(job.command, request.command),
    ),
    Match.exhaustive,
  )
}

const channelLaw = (request: PublishCommand): boolean => {
  const outcome = publishPackages(request)
  const missing = request.unpublishedOnly === true && request.capturedPath === undefined
  return Result.isFailure(outcome) === missing
}

it.prop('∀req_PublishPackages_≡Dispatches', [command], ([request]) => dispatchLaw(request))

it.prop('∀req_PublishPackages_∈FailsIffCapturedMissing', [command], ([request]) => channelLaw(request))
