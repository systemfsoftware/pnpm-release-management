import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { LedgerLive, RegistryLive } from '@systemfsoftware/adoption-adapter'
import { ChangesetsPortLive } from '@systemfsoftware/changesets-adapter'
import { program, ReporterLive } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { GitLive } from '@systemfsoftware/git-adapter'
import { ForgeConfig, ForgeLive } from '@systemfsoftware/github-adapter'
import {
  adoptCell,
  githubReleaseCell,
  planCell,
  pullRequestCell,
  type PullRequestDecision,
  tagCell,
} from '@systemfsoftware/github-release-engine'
import { ProcessLive } from '@systemfsoftware/process-adapter'
import {
  GitPort,
  type GitRef,
  type PrTitle,
  type PullRequestRefusal,
  type ReleaseConfig,
  ReleaseConfigStore,
  RemoteName,
  RepoRoot,
} from '@systemfsoftware/release-language'
import { TarballLive } from '@systemfsoftware/tarball-adapter'
import { bumpCell } from '@systemfsoftware/version-engine'
import {
  ChangelogStoreLive,
  ChangesetStoreLive,
  CycleStoreLive,
  ReleaseConfigStoreLive,
  SurfaceStoreLive,
  WorkspaceStoreLive,
} from '@systemfsoftware/workspace-adapter'
import { Effect, Layer, Option } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import { Command, Flag } from 'effect/unstable/cli'
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient'
import {
  adoptRequestOf,
  bumpInput,
  CHANGESET_FALLBACK,
  planRequestOf,
  pullRequestRequestOf,
  releaseRequestOf,
  tagRequestOf,
  workspaceOf,
} from './boundary.js'
import { VersionStageRefused } from './boundary.schema.js'
import {
  renderAdoption,
  renderAdoptRefusal,
  renderPlan,
  renderPlanRefusal,
  renderPullRequest,
  renderPullRequestRefusal,
  renderRelease,
  renderReleaseRefusal,
  renderTag,
  renderTagRefusal,
  renderVersion,
} from './render.js'

const VERSION = '0.0.0'

const DEFAULT_REMOTE: RemoteName = RemoteName.make('origin')

const workspaceAtEdge = Effect.gen(function*() {
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
        LedgerLive(root),
        ReleaseConfigStoreLive,
        SurfaceStoreLive(root),
        WorkspaceStoreLive(root),
      ).pipe(Layer.provide(NodeServices.layer)),
  ),
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
    Match.tagsExhaustive({
      PullRequestCreated: () => land,
      PullRequestUpdated: () => land,
      PullRequestClosed: () => Effect.void,
      PullRequestVacant: () => Effect.void,
    }),
  )
}

const adopt = Command.make('adopt', {
  registry: Flag.string('registry'),
  output: Flag.string('output'),
  remote: Flag.string('remote').pipe(Flag.optional),
  config: Flag.string('config').pipe(Flag.optional),
}, (flags) =>
  Effect.gen(function*() {
    const request = yield* adoptRequestOf({
      registry: flags.registry,
      output: flags.output,
      remote: Option.getOrUndefined(flags.remote),
    })
    const report = yield* Cell.run(adoptCell, request).pipe(
      Effect.provide(TarballLive),
      Effect.provide(RegistryLive.pipe(Layer.provide(FetchHttpClient.layer))),
    )
    yield* renderAdoption(report, request.output)
  }).pipe(Effect.catch(renderAdoptRefusal)))

const plan = Command.make('plan', {
  deferred: Flag.string('deferred').pipe(Flag.optional),
  output: Flag.string('output').pipe(Flag.optional),
  remote: Flag.string('remote').pipe(Flag.optional),
  tarballs: Flag.string('tarballs'),
  config: Flag.string('config').pipe(Flag.optional),
}, (flags) =>
  Effect.gen(function*() {
    const workspace = yield* workspaceOf(flags.config)
    const request = yield* planRequestOf(workspace, {
      deferred: Option.getOrUndefined(flags.deferred),
      remote: Option.getOrUndefined(flags.remote),
      tarballs: flags.tarballs,
    })
    const report = yield* Cell.run(planCell, request).pipe(
      Effect.provide(TarballLive),
      Effect.provide(ChangesetsPortLive({ root: workspace.root, base: workspace.config.base })),
    )
    yield* renderPlan(report, Option.getOrUndefined(flags.output))
  }).pipe(Effect.catch(renderPlanRefusal)))

const tag = Command.make('tag', {
  dryRun: Flag.boolean('dry-run').pipe(Flag.withDefault(false)),
  json: Flag.boolean('json').pipe(Flag.withDefault(false)),
  captured: Flag.string('captured').pipe(Flag.optional),
  capturedFile: Flag.string('captured-file').pipe(Flag.optional),
  exclude: Flag.string('exclude').pipe(Flag.optional),
  output: Flag.string('output').pipe(Flag.optional),
  remote: Flag.string('remote').pipe(Flag.optional),
  tarballs: Flag.string('tarballs'),
  config: Flag.string('config').pipe(Flag.optional),
}, (flags) =>
  Effect.gen(function*() {
    const workspace = yield* workspaceOf(flags.config)
    const output = Option.getOrUndefined(flags.output)
    const request = yield* tagRequestOf(workspace, {
      captured: Option.getOrUndefined(flags.captured),
      capturedFile: Option.getOrUndefined(flags.capturedFile),
      exclude: Option.getOrUndefined(flags.exclude),
      output,
      remote: Option.getOrUndefined(flags.remote),
      tarballs: flags.tarballs,
      dryRun: flags.dryRun,
      json: flags.json,
    })
    const decision = yield* Cell.run(tagCell, request).pipe(Effect.provide(TarballLive))
    yield* renderTag(decision, { output, json: flags.json, dryRun: flags.dryRun })
  }).pipe(Effect.catch(renderTagRefusal)))

const releaseCommand = Command.make('release', {
  dryRun: Flag.boolean('dry-run').pipe(Flag.withDefault(false)),
  assert: Flag.boolean('assert').pipe(Flag.withDefault(false)),
  captured: Flag.string('captured').pipe(Flag.optional),
  capturedFile: Flag.string('captured-file').pipe(Flag.optional),
  config: Flag.string('config').pipe(Flag.optional),
}, (flags) =>
  Effect.gen(function*() {
    const workspace = yield* workspaceOf(flags.config)
    const request = yield* releaseRequestOf(workspace, {
      captured: Option.getOrUndefined(flags.captured),
      capturedFile: Option.getOrUndefined(flags.capturedFile),
      assert: flags.assert,
      dryRun: flags.dryRun,
    })
    const decision = yield* Cell.run(githubReleaseCell, request)
    yield* renderRelease(decision)
  }).pipe(Effect.catch(renderReleaseRefusal)))

const pr = Command.make('pr', {
  title: Flag.string('title').pipe(Flag.optional),
  body: Flag.string('body').pipe(Flag.optional),
  bodyFile: Flag.string('body-file').pipe(Flag.optional),
  base: Flag.string('base').pipe(Flag.optional),
  branch: Flag.string('branch').pipe(Flag.optional),
  config: Flag.string('config').pipe(Flag.optional),
}, (flags) =>
  Effect.gen(function*() {
    const workspace = yield* workspaceOf(flags.config)
    const request = yield* pullRequestRequestOf(workspace, {
      title: Option.getOrUndefined(flags.title),
      body: Option.getOrUndefined(flags.body),
      bodyFile: Option.getOrUndefined(flags.bodyFile),
      base: Option.getOrUndefined(flags.base),
      branch: Option.getOrUndefined(flags.branch),
    })
    const decision = yield* Cell.run(pullRequestCell, request)
    const config: ReleaseConfig = workspace.config
    yield* Cell.run(bumpCell, bumpInput(config.changelogDir, config.versioning)).pipe(
      Effect.provide(ChangesetsPortLive({ root: workspace.root, base: config.base })),
      Effect.mapError((refusal): VersionStageRefused => VersionStageRefused.make({ refusal })),
      Effect.flatMap((versioned) => renderVersion(versioned)),
    )
    yield* renderPullRequest(decision)
    yield* landVersion(decision, request.branch, request.title)
  }).pipe(Effect.catch(renderPullRequestRefusal)))

const release = Command.make('release').pipe(
  Command.withDescription('Plan release phases, open release PRs, tag and publish GitHub releases'),
  Command.withSubcommands([adopt, plan, pr, tag, releaseCommand]),
)

NodeRuntime.runMain(
  Effect.provide(
    program(release, VERSION),
    Layer.mergeAll(MainLive, ReporterLive, NodeServices.layer),
  ),
)
