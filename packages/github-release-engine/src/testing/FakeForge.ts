import type { ReleaseId, ReleaseLabel, ReleaseTag } from '@systemfsoftware/release-language'
import {
  ForgePort,
  GitRef as GitRefSchema,
  PullRequestAbsent,
  PullRequestFound,
  PullRequestNumber,
  ReleaseAbsent,
  ReleaseFound,
  ReleaseId as ReleaseIdSchema,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'

export interface FakeReleaseSeed {
  readonly tag: ReleaseTag
  readonly id: number
}

export interface FakePullRequestSeed {
  readonly number: number
  readonly head: string
  readonly title: string
}

export interface FakeForgeState {
  readonly releases?: Array<FakeReleaseSeed>
  readonly pullRequests?: Array<FakePullRequestSeed>
}

export interface FakeForgeCalls {
  readonly created: Array<{ readonly tag: ReleaseTag; readonly id: ReleaseId; readonly body: string }>
  readonly promoted: Array<ReleaseId>
  readonly createdPullRequests: Array<{
    readonly number: number
    readonly head: string
    readonly labels: Array<ReleaseLabel>
  }>
  readonly updatedPullRequests: Array<{ readonly number: number; readonly labels: Array<ReleaseLabel> }>
  readonly closedPullRequests: Array<number>
}

export const makeFakeForge = (state: FakeForgeState = {}) => {
  const releases = new Map<ReleaseTag, ReleaseId>(
    (state.releases ?? []).map((seed) => [seed.tag, ReleaseIdSchema.make(seed.id)]),
  )
  const pullRequests = (state.pullRequests ?? []).map((seed) => ({
    number: PullRequestNumber.make(seed.number),
    head: GitRefSchema.make(seed.head),
    title: seed.title,
  }))
  const calls: FakeForgeCalls = {
    created: [],
    promoted: [],
    createdPullRequests: [],
    updatedPullRequests: [],
    closedPullRequests: [],
  }
  let nextReleaseId = 1000
  let nextPullNumber = 500
  const layer = Layer.succeed(ForgePort, {
    releaseByTag: (_repo, tag) => {
      const id = releases.get(tag)
      return Effect.succeed(
        id === undefined ? ReleaseAbsent.make({ tag }) : ReleaseFound.make({ id }),
      )
    },
    createRelease: (_repo, tag, body) => {
      const id = ReleaseIdSchema.make(nextReleaseId)
      nextReleaseId += 1
      releases.set(tag, id)
      calls.created.push({ tag, id, body })
      return Effect.succeed(id)
    },
    promoteLatest: (_repo, id) => {
      calls.promoted.push(id)
      return Effect.succeed(undefined)
    },
    openPullRequest: (_repo, head) => {
      const found = pullRequests.find((candidate) => candidate.head === head)
      return Effect.succeed(
        found === undefined
          ? PullRequestAbsent.make({ head })
          : PullRequestFound.make({ number: found.number }),
      )
    },
    listPullRequests: () =>
      Effect.succeed(
        pullRequests.map((candidate) => ({
          number: candidate.number,
          title: candidate.title,
          head: candidate.head,
        })),
      ),
    createPullRequest: (_repo, _base, head, title, _body, labels) => {
      const number = PullRequestNumber.make(nextPullNumber)
      nextPullNumber += 1
      pullRequests.push({ number, head, title })
      calls.createdPullRequests.push({ number, head, labels: [...labels] })
      return Effect.succeed(number)
    },
    updatePullRequest: (_repo, number, title, _body, labels) => {
      const found = pullRequests.find((candidate) => candidate.number === number)
      if (found !== undefined) {
        found.title = title
      }
      calls.updatedPullRequests.push({ number, labels: [...labels] })
      return Effect.succeed(undefined)
    },
    closePullRequest: (_repo, number) => {
      const index = pullRequests.findIndex((candidate) => candidate.number === number)
      if (index !== -1) {
        pullRequests.splice(index, 1)
      }
      calls.closedPullRequests.push(number)
      return Effect.succeed(undefined)
    },
    defaultBranch: () => Effect.succeed(GitRefSchema.make('main')),
  })
  const live = Object.assign(layer, { calls })
  return Object.assign(live, { layer: live })
}
