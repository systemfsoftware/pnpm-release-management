import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { program, Reporter, ReporterLive } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { GitLive } from '@systemfsoftware/git-adapter'
import { ForgeConfig, ForgeLive } from '@systemfsoftware/github-adapter'
import {
  githubReleaseCell,
  GithubReleaseRequest,
  planCell,
  PlanRequest,
  pullRequestCell,
  PullRequestRequest,
  tagCell,
  TagRequest,
} from '@systemfsoftware/github-release-engine'
import { ProcessLive } from '@systemfsoftware/process-adapter'
import {
  GitPort,
  type GitRef,
  type PrTitle,
  type PullRequestDecision,
  type PullRequestRefusal,
  type RelativePath,
  type ReleaseConfig,
  ReleaseConfigStore,
  RemoteName,
  RepoRoot,
} from '@systemfsoftware/release-language'
import { bumpCell } from '@systemfsoftware/version-engine'
import {
  ChangelogStoreLive,
  ChangesetStoreLive,
  CycleStoreLive,
  ReleaseConfigStoreLive,
  SurfaceStoreLive,
  WorkspaceStoreLive,
} from '@systemfsoftware/workspace-adapter'
import { Effect, FileSystem, Layer, Option, Path } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import { Command, Flag } from 'effect/unstable/cli'
import { refuse, tell } from './Lines.js'
import { planFailureText, prFailureText, releaseFailureText, tagFailureText } from './Refusal.js'
import { InvalidFlags } from './Refusal.schema.js'
import type { BoundaryRefusal, VersionStageRefused } from './Refusal.schema.js'
import { planLines, prLines, releaseLines, tagLines, versionLines } from './Render.js'
import { bumpInput, CHANGESET_FALLBACK, workspaceOf } from './Workspace.js'

const VERSION = '0.0.0'

const DEFAULT_REMOTE: RemoteName = RemoteName.make('origin')

const workspaceAtEdge: Effect.Effect<
  { readonly root: RepoRoot; readonly changesetDir: RelativePath },
  never,
  FileSystem.FileSystem | Path.Path | ReleaseConfigStore
> = Effect.gen(function*() {
  const cwd = yield* Effect.sync(() => process.cwd())
  const root = yield* S.decodeUnknownEffect(RepoRoot)(cwd).pipe(Effect.orDie)
  const changesetDir = yield* Effect.flatMap(
    ReleaseConfigStore,
    (configs) => configs.loadConfig(root),
  ).pipe(
    Effect.map((config) => config.changesetDir),
    Effect.orElseSucceed(() => CHANGESET_FALLBACK),
  )
  return { root, changesetDir }
})

const MainLive = Layer.unwrap(
  Effect.map(
    workspaceAtEdge.pipe(
      Effect.provide(ReleaseConfigStoreLive),
      Effect.provide(NodeServices.layer),
    ),
    ({ root, changesetDir }) =>
      Layer.mergeAll(
        Layer.provide(
          ForgeLive,
          Layer.succeed(ForgeConfig, {
            token: process.env['GITHUB_TOKEN'],
            baseUrl: process.env['GITHUB_API_URL'],
          }),
        ),
        GitLive,
        ProcessLive,
        ChangelogStoreLive(root),
        ChangesetStoreLive({ root, changesetDir }),
        CycleStoreLive,
        ReleaseConfigStoreLive,
        SurfaceStoreLive(root),
        WorkspaceStoreLive(root),
      ).pipe(Layer.provide(NodeServices.layer)),
  ),
)

const decodeFlags = <A, E extends { readonly message: string }>(
  decode: Effect.Effect<A, E>,
): Effect.Effect<A, InvalidFlags> =>
  decode.pipe(Effect.mapError((issue) => InvalidFlags.make({ reason: issue.message })))

const reporting = <E, R>(
  work: Effect.Effect<void, E, R>,
  text: (refusal: E) => string,
): Effect.Effect<void, never, R | Reporter> =>
  Effect.matchEffect(work, {
    onFailure: (refusal) => refuse(text(refusal)),
    onSuccess: () => Effect.void,
  })

const versionStage = (
  config: ReleaseConfig,
): Effect.Effect<
  void,
  BoundaryRefusal | VersionStageRefused,
  Reporter | FileSystem.FileSystem
> =>
  Cell.run(
    Cell.provide(bumpCell, MainLive),
    bumpInput(config.changelogDir, config.versioning),
  ).pipe(
    Effect.mapError((refusal): VersionStageRefused => ({ _tag: 'VersionStageRefused', refusal })),
    Effect.flatMap((decision) => tell(versionLines(decision))),
  )

const landVersion = (
  decision: PullRequestDecision,
  branch: GitRef,
  title: PrTitle,
): Effect.Effect<void, PullRequestRefusal, GitPort> => {
  const land: Effect.Effect<void, PullRequestRefusal, GitPort> = Effect.gen(function*() {
    const git = yield* GitPort
    yield* git.commitAll(title)
    yield* git.pushBranch(branch, DEFAULT_REMOTE)
  })
  return Match.value(decision).pipe(
    Match.tag('PullRequestCreated', () => land),
    Match.tag('PullRequestUpdated', () => land),
    Match.tag('PullRequestClosed', () => Effect.void),
    Match.tag('PullRequestVacant', () => Effect.void),
    Match.exhaustive,
  )
}

const plan = Command.make('plan', {
  deferred: Flag.string('deferred').pipe(Flag.optional),
  output: Flag.string('output').pipe(Flag.optional),
  remote: Flag.string('remote').pipe(Flag.optional),
  config: Flag.string('config').pipe(Flag.optional),
}, ({ deferred, output, remote, config }) =>
  reporting(
    Effect.gen(function*() {
      const workspace = yield* workspaceOf(Option.getOrUndefined(config))
      const request = yield* decodeFlags(
        S.decodeUnknownEffect(PlanRequest)({
          deferred: Option.getOrUndefined(deferred),
          remote: Option.getOrUndefined(remote),
          changelogDir: workspace.config.changelogDir,
        }),
      )
      const report = yield* Cell.run(Cell.provide(planCell, MainLive), request)
      yield* tell(planLines(report, Option.getOrUndefined(output)))
    }),
    planFailureText,
  ))

const tag = Command.make('tag', {
  dryRun: Flag.boolean('dry-run').pipe(Flag.withDefault(false)),
  json: Flag.boolean('json').pipe(Flag.withDefault(false)),
  captured: Flag.string('captured').pipe(Flag.optional),
  capturedFile: Flag.string('captured-file').pipe(Flag.optional),
  exclude: Flag.string('exclude').pipe(Flag.optional),
  output: Flag.string('output').pipe(Flag.optional),
  remote: Flag.string('remote').pipe(Flag.optional),
  config: Flag.string('config').pipe(Flag.optional),
}, ({ dryRun, json, captured, capturedFile, exclude, output, remote, config }) =>
  reporting(
    Effect.gen(function*() {
      const workspace = yield* workspaceOf(Option.getOrUndefined(config))
      const outputPath = Option.getOrUndefined(output)
      const request = yield* decodeFlags(
        S.decodeUnknownEffect(TagRequest)({
          captured: Option.getOrUndefined(captured),
          capturedFile: Option.getOrUndefined(capturedFile),
          exclude: Option.getOrUndefined(exclude),
          output: outputPath,
          remote: Option.getOrUndefined(remote),
          dryRun,
          json,
          changelogDir: workspace.config.changelogDir,
        }),
      )
      const decision = yield* Cell.run(Cell.provide(tagCell, MainLive), request)
      yield* tell(tagLines(decision, { output: outputPath, json, dryRun }))
    }),
    tagFailureText,
  ))

const releaseCommand = Command.make('release', {
  dryRun: Flag.boolean('dry-run').pipe(Flag.withDefault(false)),
  assert: Flag.boolean('assert').pipe(Flag.withDefault(false)),
  captured: Flag.string('captured').pipe(Flag.optional),
  capturedFile: Flag.string('captured-file').pipe(Flag.optional),
  config: Flag.string('config').pipe(Flag.optional),
}, ({ dryRun, assert, captured, capturedFile, config }) =>
  reporting(
    Effect.gen(function*() {
      const workspace = yield* workspaceOf(Option.getOrUndefined(config))
      const request = yield* decodeFlags(
        S.decodeUnknownEffect(GithubReleaseRequest)({
          captured: Option.getOrUndefined(captured),
          capturedFile: Option.getOrUndefined(capturedFile),
          assert,
          dryRun,
          changelogDir: workspace.config.changelogDir,
        }),
      )
      const decision = yield* Cell.run(Cell.provide(githubReleaseCell, MainLive), request)
      yield* tell(releaseLines(decision))
    }),
    releaseFailureText,
  ))

const pr = Command.make('pr', {
  title: Flag.string('title').pipe(Flag.optional),
  body: Flag.string('body').pipe(Flag.optional),
  bodyFile: Flag.string('body-file').pipe(Flag.optional),
  base: Flag.string('base').pipe(Flag.optional),
  branch: Flag.string('branch').pipe(Flag.optional),
  config: Flag.string('config').pipe(Flag.optional),
}, ({ title, body, bodyFile: bodyFileFlag, base, branch, config }) =>
  reporting(
    Effect.gen(function*() {
      const path = yield* Path.Path
      const workspace = yield* workspaceOf(Option.getOrUndefined(config))
      const cwd = yield* Effect.sync(() => process.cwd())
      const bodyFile = Option.match(bodyFileFlag, {
        onNone: (): string | undefined => undefined,
        onSome: (file) => path.relative(cwd, path.resolve(cwd, file)),
      })
      const bodyValue = Option.match(body, {
        onNone: (): string | undefined =>
          Option.match(Option.fromNullishOr(bodyFile), {
            onNone: () => workspace.config.pr.body,
            onSome: (): string | undefined => undefined,
          }),
        onSome: (given) => given,
      })
      const request = yield* decodeFlags(
        S.decodeUnknownEffect(PullRequestRequest)({
          title: Option.getOrElse(title, () => workspace.config.pr.title),
          body: bodyValue,
          bodyFile,
          base: Option.getOrElse(base, () => workspace.config.base),
          branch: Option.getOrElse(branch, () => workspace.config.branch),
          remote: undefined,
          labels: ['release'],
        }),
      )
      const decision = yield* Cell.run(Cell.provide(pullRequestCell, MainLive), request)
      yield* versionStage(workspace.config)
      yield* tell(prLines(decision))
      yield* landVersion(decision, request.branch, request.title)
    }),
    prFailureText,
  ))

const release = Command.make('release').pipe(
  Command.withDescription('Plan release phases, open release PRs, tag and publish GitHub releases'),
  Command.withSubcommands([plan, pr, tag, releaseCommand]),
)

NodeRuntime.runMain(
  Effect.provide(
    program(release, VERSION),
    Layer.mergeAll(MainLive, ReporterLive, NodeServices.layer),
  ),
)
