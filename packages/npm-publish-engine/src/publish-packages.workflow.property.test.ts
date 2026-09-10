import type * as Lang from '@systemfsoftware/release-language'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as fc from 'fast-check'
import { PublishCommand, publishPackages } from './publish-packages.workflow.ts'

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
    return outcome.failure._tag === 'PublishCapturedRequired' &&
      outcome.failure.flag === '--captured' &&
      request.unpublishedOnly === true &&
      request.capturedPath === undefined
  }
  const decision = outcome.success
  if (decision._tag === 'PublishNothingOwed') {
    return request.unpublishedOnly === true &&
      outstanding.length === 0 &&
      decision.packages === request.packages
  }
  if (decision._tag === 'PublishDryRun') {
    return request.dryRun === true && sameWire(decision.command, request.command)
  }
  return request.dryRun === false && sameWire(decision.command, request.command)
}

const channelLaw = (request: PublishCommand): boolean => {
  const outcome = publishPackages(request)
  const missing = request.unpublishedOnly === true && request.capturedPath === undefined
  return Result.isFailure(outcome) === missing
}

Deno.test('publishPackages obeys the dispatch law', () => {
  fc.assert(fc.property(command, dispatchLaw))
})

Deno.test('publishPackages fails exactly when the captured flag is missing', () => {
  fc.assert(fc.property(command, channelLaw))
})
