import { assertEquals } from '@std/assert'
import { Count, FsPath, GitRef, PrTitle, PullRequestFound, PullRequestNumber } from '@systemfsoftware/release-language'
import { Result } from 'effect'
import * as fc from 'fast-check'
import { pullRequest, PullRequestCommand } from './pull-request.workflow.ts'

const gitRefArb = fc
  .stringMatching(/^[A-Za-z][A-Za-z0-9._/-]{0,20}$/)
  .map((ref) => GitRef.make(ref))

const numberArb = fc.integer({ min: 1, max: 1000 }).map((number) => PullRequestNumber.make(number))

Deno.test('pullRequest opens, refreshes or closes the release PR', () => {
  fc.assert(
    fc.property(
      fc.nat({ max: 5 }).map((pending) => Count.make(pending)),
      fc.tuple(gitRefArb, fc.boolean(), gitRefArb).map(([base, same, other]) =>
        same ? { base, branch: base } : { base, branch: other }
      ),
      fc.oneof(
        numberArb.map((number) => PullRequestFound.make({ number })),
        gitRefArb.map((head) => ({ _tag: 'PullRequestAbsent', head }) as const),
      ),
      fc.stringMatching(/^[a-zA-Z0-9 ._-]{1,40}$/).map((title) => PrTitle.make(title)),
      fc.string({ maxLength: 80 }),
      fc.option(fc.string({ minLength: 1 }).map((path) => FsPath.make(path)), {
        nil: undefined,
      }),
      (pending, refs, existing, title, body, bodyIssue) => {
        const outcome = pullRequest(
          PullRequestCommand.make({
            pending,
            existing,
            branch: refs.branch,
            base: refs.base,
            title,
            body,
            bodyIssue,
          }),
        )
        if (bodyIssue !== undefined) {
          if (!Result.isFailure(outcome)) {
            throw new Error(`unreadable body must refuse, got ${outcome.success._tag}`)
          }
          if (outcome.failure._tag !== 'BodyFileUnreadable') {
            throw new Error(`expected BodyFileUnreadable, got ${outcome.failure._tag}`)
          }
          assertEquals(outcome.failure.path, bodyIssue)
          return
        }
        if (refs.branch === refs.base) {
          if (!Result.isFailure(outcome)) {
            throw new Error(`branch equal to base must refuse, got ${outcome.success._tag}`)
          }
          if (outcome.failure._tag !== 'HeadRefInvalid') {
            throw new Error(`expected HeadRefInvalid, got ${outcome.failure._tag}`)
          }
          assertEquals(outcome.failure.branch, refs.branch)
          return
        }
        if (!Result.isSuccess(outcome)) {
          throw new Error(`valid request must decide, got ${outcome.failure._tag}`)
        }
        const decision = outcome.success
        if (pending > 0) {
          if (existing._tag === 'PullRequestFound') {
            if (decision._tag !== 'PullRequestReleaseRefreshed') {
              throw new Error(`dirty branch with a PR must refresh, got ${decision._tag}`)
            }
            assertEquals(decision.number, existing.number)
            return
          }
          if (decision._tag !== 'PullRequestReleaseVacant') {
            throw new Error(`dirty branch without a PR must propose one, got ${decision._tag}`)
          }
          assertEquals(decision.branch, refs.branch)
          return
        }
        if (existing._tag === 'PullRequestFound') {
          if (decision._tag !== 'PullRequestReleaseClosed') {
            throw new Error(`clean branch with a PR must close, got ${decision._tag}`)
          }
          assertEquals(decision.number, existing.number)
          assertEquals(decision.branch, refs.branch)
          return
        }
        if (decision._tag !== 'PullRequestReleaseVacant') {
          throw new Error(`clean branch without a PR must rest, got ${decision._tag}`)
        }
        assertEquals(decision.branch, refs.branch)
      },
    ),
    { numRuns: 150 },
  )
})
