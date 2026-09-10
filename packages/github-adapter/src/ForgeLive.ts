import { ForgePort, GitRef, PullRequestNumber, PullRequestSummary, ReleaseId } from '@systemfsoftware/release-language'
import type {
  PrTitle,
  PullRequestLookup,
  ReleaseLabel,
  ReleaseLookup,
  ReleaseTag,
  RepoSlug,
} from '@systemfsoftware/release-language'
import { Context, Effect, Layer } from 'effect'
import type * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { Octokit, RequestError } from 'octokit'

export interface ForgeConfig {
  readonly token: string | undefined
  readonly baseUrl: string | undefined
}

export const ForgeConfig: Context.Service<ForgeConfig, ForgeConfig> = Context.Service<
  ForgeConfig,
  ForgeConfig
>('ForgeConfig')

const message = (error: unknown): string => error instanceof Error ? error.message : String(error)

const isAlreadyExists = (error: unknown): boolean =>
  error instanceof RequestError &&
  (error.status === 409 ||
    (error.status === 422 && error.message.includes('already_exists')))

const decodeOrDie = <A, E>(result: Result.Result<A, E>): Effect.Effect<A> =>
  Effect.fromResult(result).pipe(Effect.orDie)

const makeForge = (config: ForgeConfig): ForgePort => {
  const client = new Octokit({
    ...(config.token === undefined ? {} : { auth: config.token }),
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
  })

  const addLabels = (
    repo: RepoSlug,
    number: PullRequestNumber,
    labels: ReadonlyArray<ReleaseLabel>,
  ): Effect.Effect<void> =>
    Effect.matchEffect(
      Effect.tryPromise({
        try: () =>
          client.rest.issues.addLabels({
            owner: repo.owner,
            repo: repo.repo,
            issue_number: number,
            labels: [...labels],
          }),
        catch: (error) => error,
      }),
      {
        onFailure: (error: unknown) =>
          Effect.die(
            new Error(
              `adding labels to pull request #${String(number)} failed: ${message(error)}`,
            ),
          ),
        onSuccess: (_res) => Effect.void,
      },
    )

  return {
    releaseByTag: (repo: RepoSlug, tag: ReleaseTag) =>
      Effect.matchEffect(
        Effect.tryPromise({
          try: () =>
            client.rest.repos.getReleaseByTag({
              owner: repo.owner,
              repo: repo.repo,
              tag,
            }),
          catch: (error) => error,
        }),
        {
          onFailure: (error: unknown) =>
            error instanceof RequestError && error.status === 404
              ? Effect.succeed<ReleaseLookup>({ _tag: 'ReleaseAbsent', tag })
              : Effect.die(
                new Error(
                  `looking up ${tag} in ${repo.owner}/${repo.repo} failed: ${message(error)}`,
                ),
              ),
          onSuccess: (res) =>
            decodeOrDie(S.decodeUnknownResult(ReleaseId)(res.data.id)).pipe(
              Effect.map((id): ReleaseLookup => ({ _tag: 'ReleaseFound', id })),
            ),
        },
      ),
    createRelease: (repo: RepoSlug, tag: ReleaseTag, body: string) =>
      Effect.matchEffect(
        Effect.tryPromise({
          try: () =>
            client.rest.repos.createRelease({
              owner: repo.owner,
              repo: repo.repo,
              tag_name: tag,
              body,
              prerelease: false,
              make_latest: 'false',
            }),
          catch: (error) => error,
        }),
        {
          onFailure: (error: unknown) =>
            isAlreadyExists(error)
              ? Effect.die(
                new Error(
                  `release ${tag} already exists in ${repo.owner}/${repo.repo}`,
                ),
              )
              : Effect.die(
                new Error(`creating release ${tag} failed: ${message(error)}`),
              ),
          onSuccess: (res) => decodeOrDie(S.decodeUnknownResult(ReleaseId)(res.data.id)),
        },
      ),
    promoteLatest: (repo: RepoSlug, id: ReleaseId) =>
      Effect.matchEffect(
        Effect.tryPromise({
          try: () =>
            client.rest.repos.updateRelease({
              owner: repo.owner,
              repo: repo.repo,
              release_id: id,
              make_latest: 'true',
            }),
          catch: (error) => error,
        }),
        {
          onFailure: (error: unknown) =>
            Effect.die(
              new Error(
                `reconciling make_latest for ${String(id)} failed: ${message(error)}`,
              ),
            ),
          onSuccess: (_res) => Effect.void,
        },
      ),
    openPullRequest: (repo: RepoSlug, head: GitRef) =>
      Effect.matchEffect(
        Effect.tryPromise({
          try: () =>
            client.rest.pulls.list({
              owner: repo.owner,
              repo: repo.repo,
              head,
              state: 'open',
              per_page: 100,
            }),
          catch: (error) => error,
        }),
        {
          onFailure: (error: unknown) =>
            Effect.die(
              new Error(
                `looking up pull request for ${head} in ${repo.owner}/${repo.repo} failed: ${message(error)}`,
              ),
            ),
          onSuccess: (res) => {
            const first = res.data[0]
            if (first === undefined) {
              return Effect.succeed<PullRequestLookup>({
                _tag: 'PullRequestAbsent',
                head,
              })
            }
            return decodeOrDie(
              S.decodeUnknownResult(PullRequestNumber)(first.number),
            ).pipe(
              Effect.map((number): PullRequestLookup => ({
                _tag: 'PullRequestFound',
                number,
              })),
            )
          },
        },
      ),
    listPullRequests: (repo: RepoSlug) =>
      Effect.matchEffect(
        Effect.tryPromise({
          try: () =>
            client.rest.pulls.list({
              owner: repo.owner,
              repo: repo.repo,
              state: 'open',
              per_page: 100,
            }),
          catch: (error) => error,
        }),
        {
          onFailure: (error: unknown) =>
            Effect.die(
              new Error(
                `listing pull requests in ${repo.owner}/${repo.repo} failed: ${message(error)}`,
              ),
            ),
          onSuccess: (res) =>
            Effect.forEach(res.data, (pr) =>
              decodeOrDie(
                S.decodeUnknownResult(PullRequestSummary)({
                  number: pr.number,
                  title: pr.title,
                  head: pr.head.ref,
                }),
              )),
        },
      ),
    createPullRequest: (
      repo: RepoSlug,
      base: GitRef,
      head: GitRef,
      title: PrTitle,
      body: string,
      labels: ReadonlyArray<ReleaseLabel>,
    ) =>
      Effect.matchEffect(
        Effect.tryPromise({
          try: () =>
            client.rest.pulls.create({
              owner: repo.owner,
              repo: repo.repo,
              base,
              head,
              title,
              body,
            }),
          catch: (error) => error,
        }),
        {
          onFailure: (error: unknown) =>
            Effect.die(
              new Error(
                `creating pull request for ${head} into ${base} failed: ${message(error)}`,
              ),
            ),
          onSuccess: (res) =>
            decodeOrDie(
              S.decodeUnknownResult(PullRequestNumber)(res.data.number),
            ).pipe(
              Effect.flatMap((number) =>
                labels.length === 0
                  ? Effect.succeed(number)
                  : addLabels(repo, number, labels).pipe(
                    Effect.map((_void): PullRequestNumber => number),
                  )
              ),
            ),
        },
      ),
    updatePullRequest: (
      repo: RepoSlug,
      number: PullRequestNumber,
      title: PrTitle,
      body: string,
      labels: ReadonlyArray<ReleaseLabel>,
    ) =>
      Effect.matchEffect(
        Effect.tryPromise({
          try: () =>
            client.rest.pulls.update({
              owner: repo.owner,
              repo: repo.repo,
              pull_number: number,
              title,
              body,
            }),
          catch: (error) => error,
        }),
        {
          onFailure: (error: unknown) =>
            Effect.die(
              new Error(
                `updating pull request #${String(number)} failed: ${message(error)}`,
              ),
            ),
          onSuccess: (_res) =>
            labels.length === 0
              ? Effect.void
              : addLabels(repo, number, labels),
        },
      ),
    closePullRequest: (repo: RepoSlug, number: PullRequestNumber) =>
      Effect.matchEffect(
        Effect.tryPromise({
          try: () =>
            client.rest.pulls.update({
              owner: repo.owner,
              repo: repo.repo,
              pull_number: number,
              state: 'closed',
            }),
          catch: (error) => error,
        }),
        {
          onFailure: (error: unknown) =>
            Effect.die(
              new Error(
                `closing pull request #${String(number)} failed: ${message(error)}`,
              ),
            ),
          onSuccess: (_res) => Effect.void,
        },
      ),
    defaultBranch: (repo: RepoSlug) =>
      Effect.matchEffect(
        Effect.tryPromise({
          try: () => client.rest.repos.get({ owner: repo.owner, repo: repo.repo }),
          catch: (error) => error,
        }),
        {
          onFailure: (error: unknown) =>
            Effect.die(
              new Error(
                `looking up default branch for ${repo.owner}/${repo.repo} failed: ${message(error)}`,
              ),
            ),
          onSuccess: (res) =>
            decodeOrDie(
              S.decodeUnknownResult(GitRef)(res.data.default_branch),
            ),
        },
      ),
  }
}

export const ForgeLive: Layer.Layer<ForgePort, never, ForgeConfig> = Layer.effect(
  ForgePort,
  Effect.flatMap(ForgeConfig, (config) => Effect.sync(() => makeForge(config))),
)
