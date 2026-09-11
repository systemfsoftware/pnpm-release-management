import { it } from '@effect/vitest'
import {
  Count,
  FsPath,
  GitRef,
  PrTitle,
  PullRequestAbsent,
  PullRequestFound,
  PullRequestNumber,
} from '@systemfsoftware/release-language'
import { Result } from 'effect'
import * as Match from 'effect/Match'
import * as fc from 'effect/testing/FastCheck'
import { pullRequest, PullRequestCommand } from '../pull-request.workflow.js'

const gitRefArb = fc
  .stringMatching(/^[A-Za-z][A-Za-z0-9._/-]{0,20}$/)
  .map((ref) => GitRef.make(ref))

const numberArb = fc.integer({ min: 1, max: 1000 }).map((number) => PullRequestNumber.make(number))

const pendingArb = fc.nat({ max: 5 }).map((pending) => Count.make(pending))

const refsArb = fc.tuple(gitRefArb, fc.boolean(), gitRefArb).map(([base, same, other]) => {
  if (same) {
    return { base, branch: base }
  }
  return { base, branch: other }
})

const existingArb = fc.oneof(
  numberArb.map((number) => PullRequestFound.make({ number })),
  gitRefArb.map((head) => PullRequestAbsent.make({ head })),
)

const titleArb = fc.stringMatching(/^[a-zA-Z0-9 ._-]{1,40}$/).map((title) => PrTitle.make(title))
const bodyArb = fc.string({ maxLength: 80 })
const bodyIssueArb = fc.option(fc.string({ minLength: 1 }).map((path) => FsPath.make(path)), {
  nil: undefined,
})

it.prop(
  '∀state_PullRequest_≡OpensRefreshesCloses',
  [pendingArb, refsArb, existingArb, titleArb, bodyArb, bodyIssueArb],
  ([pending, refs, existing, title, body, bodyIssue]) => {
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
      if (Result.isFailure(outcome) === false) {
        return false
      }
      return Match.value(outcome.failure).pipe(
        Match.tag('BodyFileUnreadable', (bad) => bad.path === bodyIssue),
        Match.tag('HeadRefInvalid', () => false),
        Match.exhaustive,
      )
    }
    if (refs.branch === refs.base) {
      if (Result.isFailure(outcome) === false) {
        return false
      }
      return Match.value(outcome.failure).pipe(
        Match.tag('HeadRefInvalid', (bad) => bad.branch === refs.branch),
        Match.tag('BodyFileUnreadable', () => false),
        Match.exhaustive,
      )
    }
    if (Result.isSuccess(outcome) === false) {
      return false
    }
    const decision = outcome.success
    const existingIsFound = Match.value(existing).pipe(
      Match.tag('PullRequestFound', () => true),
      Match.tag('PullRequestAbsent', () => false),
      Match.exhaustive,
    )
    if (pending > 0) {
      if (existingIsFound) {
        return Match.value(decision).pipe(
          Match.tag('PullRequestReleaseRefreshed', (refreshed) => {
            return Match.value(existing).pipe(
              Match.tag('PullRequestFound', (found) => refreshed.number === found.number),
              Match.tag('PullRequestAbsent', () => false),
              Match.exhaustive,
            )
          }),
          Match.tag('PullRequestReleaseOpened', () => false),
          Match.tag('PullRequestReleaseClosed', () => false),
          Match.tag('PullRequestReleaseVacant', () => false),
          Match.exhaustive,
        )
      }
      return Match.value(decision).pipe(
        Match.tag('PullRequestReleaseVacant', (vacant) => vacant.branch === refs.branch),
        Match.tag('PullRequestReleaseOpened', () => false),
        Match.tag('PullRequestReleaseRefreshed', () => false),
        Match.tag('PullRequestReleaseClosed', () => false),
        Match.exhaustive,
      )
    }
    if (existingIsFound) {
      return Match.value(decision).pipe(
        Match.tag('PullRequestReleaseClosed', (closed) => {
          const numberMatches = Match.value(existing).pipe(
            Match.tag('PullRequestFound', (found) => closed.number === found.number),
            Match.tag('PullRequestAbsent', () => false),
            Match.exhaustive,
          )
          if (numberMatches === false) {
            return false
          }
          return closed.branch === refs.branch
        }),
        Match.tag('PullRequestReleaseOpened', () => false),
        Match.tag('PullRequestReleaseRefreshed', () => false),
        Match.tag('PullRequestReleaseVacant', () => false),
        Match.exhaustive,
      )
    }
    return Match.value(decision).pipe(
      Match.tag('PullRequestReleaseVacant', (vacant) => vacant.branch === refs.branch),
      Match.tag('PullRequestReleaseOpened', () => false),
      Match.tag('PullRequestReleaseRefreshed', () => false),
      Match.tag('PullRequestReleaseClosed', () => false),
      Match.exhaustive,
    )
  },
)
