import { ForgePort } from '@systemfsoftware/release-language'
import type {
  PullRequestLookup,
  PullRequestNumber,
  PullRequestSummary,
  ReleaseLabel,
  ReleaseLookup,
  RepoSlug,
} from '@systemfsoftware/release-language'
import { Context, Effect, Layer } from 'effect'
import * as Array from 'effect/Array'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Octokit } from 'octokit'
import {
  DefaultBranchAnswer,
  LabelAnswers,
  PullRequestAnswer,
  PullRequestAnswers,
  PullSummaryAnswers,
  ReleaseAnswer,
  ThrownHost,
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

const absenceOrDie = <A>(
  asked: string,
  thrown: unknown,
): Effect.Effect<Option.Option<A>> => {
  const host = S.decodeUnknownResult(ThrownHost)(thrown)
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
}

const askOrAbsent = <A>(
  asked: string,
  wire: S.ConstraintDecoder<A>,
  send: () => Promise<unknown>,
): Effect.Effect<Option.Option<A>> =>
  Effect.tryPromise({ try: send, catch: (thrown: unknown) => thrown }).pipe(
    Effect.matchEffect({
      onFailure: (thrown: unknown): Effect.Effect<Option.Option<A>> => absenceOrDie<A>(asked, thrown),
      onSuccess: (answer: unknown): Effect.Effect<Option.Option<A>> =>
        S.decodeUnknownEffect(S.Struct({ data: wire }))(answer).pipe(
          Effect.orDie,
          Effect.map((envelope): Option.Option<A> => Option.some(envelope.data)),
        ),
    }),
  )

const ask = <A>(
  asked: string,
  wire: S.ConstraintDecoder<A>,
  send: () => Promise<unknown>,
): Effect.Effect<A> =>
  askOrAbsent(asked, wire, send).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.die(new Error(`${asked} failed: the host answered ${String(NOT_FOUND)}`)),
        onSome: (answer: A) => Effect.succeed(answer),
      }),
    ),
  )

const slugOf = (repo: RepoSlug): string => `${repo.owner}/${repo.repo}`

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
  ): Effect.Effect<void> =>
    Array.match(attached, {
      onEmpty: () => Effect.void,
      onNonEmpty: () =>
        ask(
          `adding labels to pull request #${String(number)} in ${slugOf(repo)}`,
          LabelAnswers,
          () =>
            client.rest.issues.addLabels({
              owner: repo.owner,
              repo: repo.repo,
              issue_number: number,
              labels: [...attached],
            }),
        ).pipe(Effect.asVoid),
    })

  return {
    releaseByTag: (repo, tag) =>
      askOrAbsent(
        `looking up ${tag} in ${slugOf(repo)}`,
        ReleaseAnswer,
        () =>
          client.rest.repos.getReleaseByTag({
            owner: repo.owner,
            repo: repo.repo,
            tag,
          }),
      ).pipe(
        Effect.map(
          Option.match({
            onNone: (): ReleaseLookup => ({ _tag: 'ReleaseAbsent', tag }),
            onSome: (release): ReleaseLookup => ({
              _tag: 'ReleaseFound',
              id: release.id,
            }),
          }),
        ),
      ),
    createRelease: (repo, tag, body) =>
      ask(
        `creating release ${tag} in ${slugOf(repo)}`,
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
      ).pipe(Effect.map((release) => release.id)),
    promoteLatest: (repo, id) =>
      ask(
        `reconciling make_latest for release ${String(id)} in ${slugOf(repo)}`,
        ReleaseAnswer,
        () =>
          client.rest.repos.updateRelease({
            owner: repo.owner,
            repo: repo.repo,
            release_id: id,
            make_latest: 'true',
          }),
      ).pipe(Effect.asVoid),
    openPullRequest: (repo, head) =>
      ask(
        `looking up pull request for ${head} in ${slugOf(repo)}`,
        PullRequestAnswers,
        () =>
          client.rest.pulls.list({
            owner: repo.owner,
            repo: repo.repo,
            head,
            state: 'open',
            per_page: 100,
          }),
      ).pipe(
        Effect.map((pulls) =>
          Option.match(Array.head(pulls), {
            onNone: (): PullRequestLookup => ({ _tag: 'PullRequestAbsent', head }),
            onSome: (pull): PullRequestLookup => ({
              _tag: 'PullRequestFound',
              number: pull.number,
            }),
          })
        ),
      ),
    listPullRequests: (repo) =>
      ask(
        `listing pull requests in ${slugOf(repo)}`,
        PullSummaryAnswers,
        () =>
          client.rest.pulls.list({
            owner: repo.owner,
            repo: repo.repo,
            state: 'open',
            per_page: 100,
          }),
      ).pipe(
        Effect.map((pulls) =>
          pulls.map(
            (pull): PullRequestSummary => ({
              number: pull.number,
              title: pull.title,
              head: pull.head.ref,
            }),
          )
        ),
      ),
    createPullRequest: (repo, base, head, title, body, attached) =>
      ask(
        `creating pull request for ${head} into ${base} in ${slugOf(repo)}`,
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
      ).pipe(
        Effect.flatMap((created) => attachLabels(repo, created.number, attached).pipe(Effect.as(created.number))),
      ),
    updatePullRequest: (repo, number, title, body, attached) =>
      ask(
        `updating pull request #${String(number)} in ${slugOf(repo)}`,
        PullRequestAnswer,
        () =>
          client.rest.pulls.update({
            owner: repo.owner,
            repo: repo.repo,
            pull_number: number,
            title,
            body,
          }),
      ).pipe(Effect.flatMap(() => attachLabels(repo, number, attached))),
    closePullRequest: (repo, number) =>
      ask(
        `closing pull request #${String(number)} in ${slugOf(repo)}`,
        PullRequestAnswer,
        () =>
          client.rest.pulls.update({
            owner: repo.owner,
            repo: repo.repo,
            pull_number: number,
            state: 'closed',
          }),
      ).pipe(Effect.asVoid),
    defaultBranch: (repo) =>
      ask(
        `looking up the default branch of ${slugOf(repo)}`,
        DefaultBranchAnswer,
        () => client.rest.repos.get({ owner: repo.owner, repo: repo.repo }),
      ).pipe(Effect.map((answer) => answer.default_branch)),
  }
}

export const ForgeLive: Layer.Layer<ForgePort, never, ForgeConfig> = Layer.effect(
  ForgePort,
  Effect.map(ForgeConfig, makeForge),
)
