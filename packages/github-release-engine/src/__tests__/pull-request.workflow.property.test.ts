import { it } from '@effect/vitest'
import {
  Count,
  FsPath,
  GitRef,
  OwnerName,
  PrTitle,
  PullRequestAbsent,
  PullRequestFound,
  PullRequestNumber,
  ReleaseLabel,
  RemoteName,
  RepoName,
  RepoSlug,
} from '@systemfsoftware/release-language'
import { Result } from 'effect'
import * as Match from 'effect/Match'
import * as fc from 'effect/testing/FastCheck'
import { pullRequest, PullRequestCommand } from '../pull-request.workflow.js'

const gitRefArb = fc
  .stringMatching(/^[A-Za-z][A-Za-z0-9._/-]{0,20}$/)
  .map((ref) => GitRef.make(ref))

const numberArb = fc.integer({ min: 1, max: 1000 }).map((number) => PullRequestNumber.make(number))

const countArb = fc.nat({ max: 5 }).map((count) => Count.make(count))

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

const slugPartArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/)

const slugArb = fc
  .tuple(slugPartArb, slugPartArb)
  .map(([owner, repo]) => RepoSlug.make({ owner: OwnerName.make(owner), repo: RepoName.make(repo) }))

const remoteArb = slugPartArb.map((remote) => RemoteName.make(remote))

const labelsArb = fc
  .array(slugPartArb.map((label) => ReleaseLabel.make(label)), { maxLength: 3 })

it.prop(
  '∀state_PullRequest_≡OpensRefreshesCloses',
  [countArb, countArb, refsArb, existingArb, titleArb, bodyArb, bodyIssueArb, slugArb, remoteArb, labelsArb],
  ([pending, changes, refs, existing, title, body, bodyIssue, slug, remote, labels]) => {
    const outcome = pullRequest(
      PullRequestCommand.make({
        pending,
        changes,
        existing,
        branch: refs.branch,
        base: refs.base,
        title,
        body,
        bodyIssue,
        slug,
        remote,
        labels,
      }),
    )
    if (bodyIssue !== undefined) {
      if (Result.isFailure(outcome) === false) {
        return false
      }
      return Match.value(outcome.failure).pipe(
        Match.tag('PullRequestBodyUnreadable', (bad) => bad.path === bodyIssue),
        Match.tag('PullRequestHeadInvalid', () => false),
        Match.tag('PullRequestUnversioned', () => false),
        Match.exhaustive,
      )
    }
    if (refs.branch === refs.base) {
      if (Result.isFailure(outcome) === false) {
        return false
      }
      return Match.value(outcome.failure).pipe(
        Match.tag('PullRequestHeadInvalid', (bad) => bad.branch === refs.branch),
        Match.tag('PullRequestBodyUnreadable', () => false),
        Match.tag('PullRequestUnversioned', () => false),
        Match.exhaustive,
      )
    }
    if (pending > 0) {
      if (Result.isFailure(outcome) === false) {
        return false
      }
      return Match.value(outcome.failure).pipe(
        Match.tag('PullRequestUnversioned', (unversioned) => unversioned.pending === pending),
        Match.tag('PullRequestHeadInvalid', () => false),
        Match.tag('PullRequestBodyUnreadable', () => false),
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
    if (changes > 0) {
      if (existingIsFound) {
        return Match.value(decision).pipe(
          Match.tag('PullRequestUpdated', (refreshed) => {
            return Match.value(existing).pipe(
              Match.tag('PullRequestFound', (found) => refreshed.number === found.number),
              Match.tag('PullRequestAbsent', () => false),
              Match.exhaustive,
            )
          }),
          Match.tag('PullRequestCreated', () => false),
          Match.tag('PullRequestClosed', () => false),
          Match.tag('PullRequestVacant', () => false),
          Match.exhaustive,
        )
      }
      return Match.value(decision).pipe(
        Match.tag('PullRequestVacant', (vacant) => vacant.branch === refs.branch),
        Match.tag('PullRequestCreated', () => false),
        Match.tag('PullRequestUpdated', () => false),
        Match.tag('PullRequestClosed', () => false),
        Match.exhaustive,
      )
    }
    if (existingIsFound) {
      return Match.value(decision).pipe(
        Match.tag('PullRequestClosed', (closed) => {
          const numberMatches = Match.value(existing).pipe(
            Match.tag('PullRequestFound', (found) => closed.number === found.number),
            Match.tag('PullRequestAbsent', () => false),
            Match.exhaustive,
          )
          if (numberMatches === false) {
            return false
          }
          return closed.branch.branch === refs.branch
        }),
        Match.tag('PullRequestCreated', () => false),
        Match.tag('PullRequestUpdated', () => false),
        Match.tag('PullRequestVacant', () => false),
        Match.exhaustive,
      )
    }
    return Match.value(decision).pipe(
      Match.tag('PullRequestVacant', (vacant) => vacant.branch === refs.branch),
      Match.tag('PullRequestCreated', () => false),
      Match.tag('PullRequestUpdated', () => false),
      Match.tag('PullRequestClosed', () => false),
      Match.exhaustive,
    )
  },
)
