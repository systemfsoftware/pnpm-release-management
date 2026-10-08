import { ForgePort } from '@systemfsoftware/release-language'
import type {
  PullRequestLookup,
  PullRequestNumber,
  ReleaseLabel,
  ReleaseLookup,
  RepoSlug,
} from '@systemfsoftware/release-language'
import {
  PullRequestAbsent,
  PullRequestFound,
  PullRequestSummary,
  ReleaseAbsent,
  ReleaseFound,
} from '@systemfsoftware/release-language'
import { Context, Effect, Layer, Option, Result } from 'effect'
import * as Array from 'effect/Array'
import * as S from 'effect/Schema'
import { Octokit } from 'octokit'
import {
  DefaultBranchAnswer,
  LabelAnswers,
  OpenPullAnswers,
  PullRequestAnswer,
  PullSummaryAnswers,
  ReleaseAnswer,
} from './ForgeWire.schema.js'

export interface ForgeConfig {
  readonly token: string | undefined
  readonly baseUrl: string | undefined
}

export const ForgeConfig: Context.Service<ForgeConfig, ForgeConfig> = Context.Service<
  ForgeConfig,
  ForgeConfig
>('ForgeConfig')

const NOT_FOUND = 404

const askMaybe = <A>(
  asked: string,
  wire: S.ConstraintDecoder<A>,
  send: () => Promise<unknown>,
): Effect.Effect<Option.Option<A>> =>
  Effect.matchEffect(Effect.tryPromise({ try: send, catch: (thrown: unknown) => thrown }), {
    onSuccess: (answer: unknown): Effect.Effect<Option.Option<A>> =>
      Effect.map(
        Effect.orDie(S.decodeUnknownEffect(S.Struct({ data: wire }))(answer)),
        (envelope) => Option.some(envelope.data),
      ),
    onFailure: (thrown: unknown): Effect.Effect<Option.Option<A>> => {
      const host = S.decodeUnknownResult(
        S.Struct({ status: S.optional(S.Number), message: S.optional(S.String) }),
      )(thrown)
      if (Result.isFailure(host)) {
        return Effect.die(
          new Error(`${asked} failed: the host threw a value that is not an error`),
        )
      }
      if (host.success.status === NOT_FOUND) {
        return Effect.succeed(Option.none<A>())
      }
      return Effect.die(
        new Error(`${asked} failed: ${host.success.message ?? 'the host gave no detail'}`),
      )
    },
  })

const ask = <A>(
  asked: string,
  wire: S.ConstraintDecoder<A>,
  send: () => Promise<unknown>,
): Effect.Effect<A> =>
  Effect.flatMap(askMaybe(asked, wire, send), (answer) => {
    if (Option.isNone(answer)) {
      return Effect.die(new Error(`${asked} failed: the host answered ${String(NOT_FOUND)}`))
    }
    return Effect.succeed(answer.value)
  })

const makeForge = (config: ForgeConfig): ForgePort => {
  const options: { auth?: string; baseUrl?: string } = {}
  if (config.token !== undefined) {
    options.auth = config.token
  }
  if (config.baseUrl !== undefined) {
    options.baseUrl = config.baseUrl
  }
  const client = new Octokit(options)

  const attachLabels = (
    repo: RepoSlug,
    number: PullRequestNumber,
    attached: ReadonlyArray<ReleaseLabel>,
  ): Effect.Effect<void> => {
    if (attached.length === 0) {
      return Effect.void
    }
    return Effect.asVoid(
      ask(
        `adding labels to pull request #${String(number)} in ${repo.owner}/${repo.repo}`,
        LabelAnswers,
        () =>
          client.rest.issues.addLabels({
            owner: repo.owner,
            repo: repo.repo,
            issue_number: number,
            labels: [...attached],
          }),
      ),
    )
  }

  return {
    releaseByTag: (repo, tag) =>
      Effect.map(
        askMaybe(`looking up ${tag} in ${repo.owner}/${repo.repo}`, ReleaseAnswer, () =>
          client.rest.repos.getReleaseByTag({
            owner: repo.owner,
            repo: repo.repo,
            tag,
          })),
        Option.match({
          onNone: (): ReleaseLookup =>
            ReleaseAbsent.make({ tag }),
          onSome: (release): ReleaseLookup =>
            ReleaseFound.make({ id: release.id }),
        }),
      ),
    createRelease: (repo, tag, body) =>
      Effect.map(
        ask(
          `creating release ${tag} in ${repo.owner}/${repo.repo}`,
          ReleaseAnswer,
          () =>
            client.rest.repos.createRelease({
              owner: repo.owner,
              repo: repo.repo,
              tag_name: tag,
              body,
              prerelease: false,
              make_latest: 'false',
            }),
        ),
        (release) => release.id,
      ),
    promoteLatest: (repo, id) =>
      Effect.asVoid(
        ask(
          `reconciling make_latest for release ${String(id)} in ${repo.owner}/${repo.repo}`,
          ReleaseAnswer,
          () =>
            client.rest.repos.updateRelease({
              owner: repo.owner,
              repo: repo.repo,
              release_id: id,
              make_latest: 'true',
            }),
        ),
      ),
    openPullRequest: (repo, head) =>
      Effect.map(
        ask(
          `looking up pull request for ${head} in ${repo.owner}/${repo.repo}`,
          OpenPullAnswers,
          () =>
            client.rest.pulls.list({
              owner: repo.owner,
              repo: repo.repo,
              head: `${repo.owner}:${head}`,
              state: 'open',
              per_page: 100,
            }),
        ),
        (pulls) =>
          Option.match(
            Array.findFirst(pulls, (pull) =>
              pull.head.ref === head &&
              pull.head.repo?.owner.login.toLowerCase() === repo.owner.toLowerCase()),
            {
              onNone: (): PullRequestLookup => PullRequestAbsent.make({ head }),
              onSome: (pull): PullRequestLookup => PullRequestFound.make({ number: pull.number }),
            },
          ),
      ),
    listPullRequests: (repo) =>
      Effect.map(
        ask(
          `listing pull requests in ${repo.owner}/${repo.repo}`,
          PullSummaryAnswers,
          () =>
            client.rest.pulls.list({
              owner: repo.owner,
              repo: repo.repo,
              state: 'open',
              per_page: 100,
            }),
        ),
        (pulls) =>
          pulls.map(
            (pull): PullRequestSummary =>
              PullRequestSummary.make({
                number: pull.number,
                title: pull.title,
                head: pull.head.ref,
              }),
          ),
      ),
    createPullRequest: (repo, base, head, title, body, attached) =>
      Effect.flatMap(
        ask(
          `creating pull request for ${head} into ${base} in ${repo.owner}/${repo.repo}`,
          PullRequestAnswer,
          () =>
            client.rest.pulls.create({
              owner: repo.owner,
              repo: repo.repo,
              base,
              head,
              title,
              body,
            }),
        ),
        (created) => Effect.as(attachLabels(repo, created.number, attached), created.number),
      ),
    updatePullRequest: (repo, number, title, body, attached) =>
      Effect.flatMap(
        ask(
          `updating pull request #${String(number)} in ${repo.owner}/${repo.repo}`,
          PullRequestAnswer,
          () =>
            client.rest.pulls.update({
              owner: repo.owner,
              repo: repo.repo,
              pull_number: number,
              title,
              body,
            }),
        ),
        () => attachLabels(repo, number, attached),
      ),
    closePullRequest: (repo, number) =>
      Effect.asVoid(
        ask(
          `closing pull request #${String(number)} in ${repo.owner}/${repo.repo}`,
          PullRequestAnswer,
          () =>
            client.rest.pulls.update({
              owner: repo.owner,
              repo: repo.repo,
              pull_number: number,
              state: 'closed',
            }),
        ),
      ),
    defaultBranch: (repo) =>
      Effect.map(
        ask(
          `looking up the default branch of ${repo.owner}/${repo.repo}`,
          DefaultBranchAnswer,
          () => client.rest.repos.get({ owner: repo.owner, repo: repo.repo }),
        ),
        (answer) => answer.default_branch,
      ),
  }
}

export const ForgeLive: Layer.Layer<ForgePort, never, ForgeConfig> = Layer.effect(
  ForgePort,
  Effect.map(ForgeConfig, makeForge),
)
