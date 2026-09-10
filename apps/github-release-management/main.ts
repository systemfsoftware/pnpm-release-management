#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run=git,pnpm --allow-net=api.github.com --allow-env
import { DenoRuntime } from '@effect/platform-deno'
import { parse as parseJsonc } from '@std/jsonc'
import { dirname, join, relative, resolve } from '@std/path'
import { program, Reporter } from '@systemfsoftware/cli-adapter'
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
  ChangelogStore,
  ChangesetStore,
  CycleStore,
  ForgePort,
  GitPort,
  GitRef,
  JsonSurface,
  PrBlock,
  ProcessPort,
  PrTitle,
  RelativePath,
  type ReleaseConfig,
  ReleaseConfigStore,
  RemoteName,
  RepoRoot,
  SurfaceStore,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { bumpCell, type BumpInput } from '@systemfsoftware/version-engine'
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

const RepoConfig = S.Struct({
  base: GitRef,
  branch: GitRef,
  changesetDir: RelativePath,
  changelogDir: RelativePath,
  pr: PrBlock,
})
type RepoConfig = S.Schema.Type<typeof RepoConfig>

const causeMessage = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

const configRefusalText = (refusal: {
  readonly _tag: string
  readonly path?: unknown
  readonly reason?: unknown
  readonly field?: unknown
}): string =>
  Match.value(refusal).pipe(
    Match.when({ _tag: 'ConfigUnreadable' }, (r) => `${String(r.path)}: cannot be read`),
    Match.when(
      { _tag: 'ConfigMalformed' },
      (r) => `${String(r.path)}: ${String(r.reason)}`,
    ),
    Match.when(
      { _tag: 'ConfigFieldMissing' },
      (r) => `${String(r.path)}: missing field ${String(r.field)}`,
    ),
    Match.when(
      { _tag: 'ConfigFieldInvalid' },
      (r) => `${String(r.path)}: invalid field ${String(r.field)}: ${String(r.reason)}`,
    ),
    Match.orElse((r) => `invalid config: ${r._tag}`),
  )

const resolveRepo = (
  flag: string | undefined,
): Effect.Effect<
  {
    readonly root: RepoRoot
    readonly config: RepoConfig
    readonly versioning: ReleaseConfig['versioning']
  },
  Error,
  WorkspaceStore | ReleaseConfigStore
> =>
  Effect.gen(function*() {
    const workspace = yield* WorkspaceStore
    const configs = yield* ReleaseConfigStore
    const root = flag === undefined
      ? workspace.root
      : yield* S.decodeUnknownEffect(RepoRoot)(
        dirname(resolve(Deno.cwd(), flag)),
      ).pipe(Effect.mapError((detail) => new Error(`invalid --config ${JSON.stringify(flag)}: ${detail.message}`)))
    const full = yield* configs.loadConfig(root).pipe(
      Effect.mapError((refusal) => new Error(configRefusalText(refusal))),
    )
    return {
      root,
      versioning: full.versioning,
      config: {
        base: full.base,
        branch: full.branch,
        changesetDir: full.changesetDir,
        changelogDir: full.changelogDir,
        pr: full.pr,
      },
    }
  })

const manifestSurface = (file: RelativePath): typeof JsonSurface.Type =>
  ({
    _tag: 'JsonSurface',
    kind: 'json',
    path: file,
  }) as typeof JsonSurface.Type

const bumpInput = (
  changelogDir: RelativePath,
  versioning: ReleaseConfig['versioning'],
): BumpInput =>
  versioning.strategy === 'pnpm'
    ? {
      strategy: 'pnpm',
      changelogDir,
      manifest: {
        file: RelativePath.make('package.json'),
        surface: manifestSurface(RelativePath.make('package.json')),
      },
      surfaces: [],
    }
    : {
      strategy: 'surfaces',
      changelogDir,
      rootChangelog: versioning.changelog,
      manifest: { file: versioning.manifest, surface: manifestSurface(versioning.manifest) },
      surfaces: versioning.surfaces.flatMap(
        (surface): ReadonlyArray<BumpInput['surfaces'][number]> => {
          if (surface.kind === 'json') return [{ file: surface.path, surface }]
          if (surface.kind === 'toml') {
            return surface.path === undefined ? [] : [{ file: surface.path, surface }]
          }
          return [{ file: surface.path, surface }]
        },
      ),
    }

const consumePendingIntents = (
  versioning: ReleaseConfig['versioning'],
  changelogDir: RelativePath,
): Effect.Effect<
  void,
  Error,
  Reporter | ChangesetStore | WorkspaceStore | SurfaceStore | ChangelogStore | ProcessPort
> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    const decision = yield* Cell.run(bumpCell, bumpInput(changelogDir, versioning)).pipe(
      Effect.mapError((refusal): Error => {
        const detail = Object.entries(refusal)
          .filter(([key]) => key !== '_tag')
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(' ')
        return new Error(detail.length === 0 ? refusal._tag : `${refusal._tag}: ${detail}`)
      }),
    )
    return yield* Match.value(decision).pipe(
      Match.tag('VersionBumped', () => reporter.emit('versioned packages')),
      Match.tag('VersionConsumed', () => reporter.emit('consumed intents without a version bump')),
      Match.tag('VersionIdle', () => reporter.note('no change intents; nothing to version')),
      Match.exhaustive,
    )
  })

const landVersionBump = (
  git: GitPort,
  branch: GitRef,
  title: PrTitle,
): Effect.Effect<void, Error> =>
  Effect.gen(function*() {
    yield* git.commitAll(title)
    yield* git.pushBranch(branch, RemoteName.make('origin'))
  }).pipe(Effect.mapError((refusal) => new Error(prRefusalText(refusal))))

const writeOutputs = (
  entries: ReadonlyArray<readonly [string, string]>,
  output: string | undefined,
): Effect.Effect<void, Error, Reporter> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    const block = entries.map(([key, value]) => `${key}=${value}`).join('\n')
    if (output === undefined) {
      yield* reporter.emit(block)
      return
    }
    yield* Effect.tryPromise({
      try: () => Deno.writeTextFile(output, `${block}\n`, { append: true }),
      catch: (cause) => new Error(`cannot write ${output}: ${causeMessage(cause)}`),
    })
  })

const planRefusalText = (
  refusal: { readonly _tag: string; readonly path?: unknown; readonly packages?: unknown },
): string =>
  Match.value(refusal).pipe(
    Match.when(
      { _tag: 'PlanDeferredUnknown' },
      (r) => `unknown deferred package(s): ${Array.isArray(r.packages) ? r.packages.join(', ') : String(r.packages)}`,
    ),
    Match.when({ _tag: 'PlanCapturedMalformed' }, (r) => `cannot read captured file: ${String(r.path)}`),
    Match.orElse((r) => `plan failed: ${r._tag}`),
  )

const plan = Command.make('plan', {
  deferred: Flag.string('deferred').pipe(Flag.optional),
  output: Flag.string('output').pipe(Flag.optional),
  remote: Flag.string('remote').pipe(Flag.optional),
  config: Flag.string('config').pipe(Flag.optional),
}, ({ deferred, output, remote, config }) =>
  Effect.gen(function*() {
    const deferredOpt = Option.getOrUndefined(deferred)
    const outputOpt = Option.getOrUndefined(output)
    const reporter = yield* Reporter
    const { config: resolved } = yield* resolveRepo(Option.getOrUndefined(config))
    const request = yield* S.decodeUnknownEffect(PlanRequest)({
      deferred: deferredOpt,
      remote: Option.getOrUndefined(remote),
      changelogDir: resolved.changelogDir,
    }).pipe(Effect.mapError((detail) => new Error(`invalid flags: ${detail.message}`)))
    const report = yield* Cell.run(planCell, request).pipe(
      Effect.mapError((refusal) => new Error(planRefusalText(refusal))),
    )
    for (const name of report.unpublished) {
      yield* reporter.annotateWarning(
        `${name} has never been published, and OIDC cannot debut a package. ` +
          'Run the bootstrap tool, register its trusted publisher, then re-run.',
      )
    }
    yield* reporter.note(
      `plan-release: pending_intents=${report.pendingIntents} this_cycle=${report.thisCycle} deferred=${report.deferred} -> phase=${report.phase}`,
    )
    if (report.phase === 'none') {
      yield* reporter.note('plan-release: nothing pending and nothing owed; nothing to do')
    }
    yield* writeOutputs(
      [
        ['phase', report.phase],
        ['pending_intents', String(report.pendingIntents)],
        ['this_cycle', String(report.thisCycle)],
        ['deferred', String(report.deferred)],
      ],
      outputOpt,
    )
  }))

const tagRefusalText = (
  refusal: { readonly _tag: string; readonly path?: unknown; readonly packages?: unknown },
): string =>
  Match.value(refusal).pipe(
    Match.when({ _tag: 'TagCapturedMalformed' }, (r) => `cannot read captured file: ${String(r.path)}`),
    Match.when({ _tag: 'TagExcludedMalformed' }, (r) => `cannot read exclude file: ${String(r.path)}`),
    Match.when(
      { _tag: 'PlanDeferredUnknown' },
      (r) => `unknown excluded package(s): ${Array.isArray(r.packages) ? r.packages.join(', ') : String(r.packages)}`,
    ),
    Match.orElse((r) => `tag failed: ${r._tag}`),
  )

const emitCapturedFile = (path: string): Effect.Effect<void, Error, Reporter> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    const text = yield* Effect.tryPromise({
      try: () => Deno.readTextFile(path),
      catch: (cause) => new Error(`cannot read ${path}: ${causeMessage(cause)}`),
    })
    yield* reporter.emit(text.trimEnd())
  })

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
  Effect.gen(function*() {
    const reporter = yield* Reporter
    const outputOpt = Option.getOrUndefined(output)
    const { config: resolved } = yield* resolveRepo(Option.getOrUndefined(config))
    const request = yield* S.decodeUnknownEffect(TagRequest)({
      captured: Option.getOrUndefined(captured),
      capturedFile: Option.getOrUndefined(capturedFile),
      exclude: Option.getOrUndefined(exclude),
      output: outputOpt,
      remote: Option.getOrUndefined(remote),
      dryRun,
      json,
      changelogDir: resolved.changelogDir,
    }).pipe(Effect.mapError((detail) => new Error(`invalid flags: ${detail.message}`)))
    const decision = yield* Cell.run(tagCell, request).pipe(
      Effect.mapError((refusal) => new Error(tagRefusalText(refusal))),
    )
    yield* Match.value(decision).pipe(
      Match.tag('TagPreview', (preview) =>
        Effect.gen(function*() {
          if (outputOpt !== undefined) {
            yield* reporter.note(`wrote ${preview.tags.length} captured package(s) to ${outputOpt}`)
          }
          if (json) {
            if (outputOpt !== undefined) {
              yield* emitCapturedFile(outputOpt)
            } else {
              yield* reporter.emit(JSON.stringify(preview.tags, null, 2))
            }
            return
          }
          for (const tagName of preview.tags) {
            yield* reporter.note(`would tag ${tagName}`)
          }
          yield* reporter.note(`dry run: ${preview.tags.length} tag(s)`)
        })),
      Match.tag('TagUpToDate', (upToDate) =>
        Effect.gen(function*() {
          if (outputOpt !== undefined) {
            yield* reporter.note(`wrote ${Number(upToDate.tags)} captured package(s) to ${outputOpt}`)
            if (json) {
              yield* emitCapturedFile(outputOpt)
              return
            }
            yield* reporter.note(`dry run: ${Number(upToDate.tags)} tag(s)`)
            return
          }
          if (json) {
            yield* reporter.emit('[]')
            return
          }
          if (dryRun) {
            yield* reporter.note(`dry run: ${Number(upToDate.tags)} tag(s)`)
            return
          }
          yield* reporter.emit('no new tags to push')
        })),
      Match.tag(
        'TagPushed',
        (pushed) => reporter.emit(`pushed ${pushed.tags.length} tag(s): ${pushed.tags.join(', ')}`),
      ),
      Match.exhaustive,
    )
  }))

const releaseRefusalText = (refusal: {
  readonly _tag: string
  readonly package?: unknown
  readonly version?: unknown
  readonly changelog?: unknown
}): string =>
  Match.value(refusal).pipe(
    Match.when(
      { _tag: 'ReleaseChangelogMissing' },
      (r) =>
        `Missing changelog for ${String(r.package)}@${String(r.version)}: ` +
        `expected ${String(r.changelog)} to hold the generated changelog. ` +
        'Did the version step run before this one?',
    ),
    Match.when(
      { _tag: 'ReleaseChangelogEmpty' },
      (r) =>
        `Empty changelog for ${String(r.package)}@${String(r.version)}: ` +
        `expected ${String(r.changelog)} to hold the generated changelog. ` +
        'Did the version step run before this one?',
    ),
    Match.orElse((r) => `release failed: ${r._tag}`),
  )

const releaseCommand = Command.make('release', {
  dryRun: Flag.boolean('dry-run').pipe(Flag.withDefault(false)),
  assert: Flag.boolean('assert').pipe(Flag.withDefault(false)),
  captured: Flag.string('captured').pipe(Flag.optional),
  capturedFile: Flag.string('captured-file').pipe(Flag.optional),
  config: Flag.string('config').pipe(Flag.optional),
}, ({ dryRun, assert, captured, capturedFile, config }) =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    const { config: resolved } = yield* resolveRepo(Option.getOrUndefined(config))
    const request = yield* S.decodeUnknownEffect(GithubReleaseRequest)({
      captured: Option.getOrUndefined(captured),
      capturedFile: Option.getOrUndefined(capturedFile),
      assert,
      dryRun,
      changelogDir: resolved.changelogDir,
    }).pipe(Effect.mapError((detail) => new Error(`invalid flags: ${detail.message}`)))
    const decision = yield* Cell.run(githubReleaseCell, request).pipe(
      Effect.mapError((refusal) => new Error(releaseRefusalText(refusal))),
    )
    yield* Match.value(decision).pipe(
      Match.tag('GithubReleaseEmpty', () => reporter.emit('no this-cycle releases — empty captured set')),
      Match.tag(
        'GithubReleaseAsserted',
        (asserted) => reporter.emit(`assert ok: ${asserted.count} changelog(s) present`),
      ),
      Match.tag('GithubReleasePreview', (preview) =>
        Effect.gen(function*() {
          for (const tagName of preview.tags) {
            yield* reporter.note(`would create release ${tagName}`)
          }
          yield* reporter.note(`dry run: ${preview.tags.length} release(s)`)
        })),
      Match.tag(
        'GithubReleaseSkipped',
        (skipped) => reporter.emit(`created 0 release(s), skipped ${skipped.tags.length}`),
      ),
      Match.tag(
        'GithubReleaseCreated',
        (created) => reporter.emit(`created ${created.created.length} release(s), skipped ${created.skipped}`),
      ),
      Match.exhaustive,
    )
  }))

const prRefusalText = (
  refusal: { readonly _tag: string; readonly path?: unknown; readonly branch?: unknown },
): string =>
  Match.value(refusal).pipe(
    Match.when(
      { _tag: 'PullRequestBodyUnreadable' },
      (r) => `cannot read body file: ${String(r.path)}`,
    ),
    Match.when({ _tag: 'PullRequestHeadInvalid' }, (r) => `invalid pull request head: ${String(r.branch)}`),
    Match.orElse((r) => `pr failed: ${r._tag}`),
  )

const pr = Command.make('pr', {
  title: Flag.string('title').pipe(Flag.optional),
  body: Flag.string('body').pipe(Flag.optional),
  bodyFile: Flag.string('body-file').pipe(Flag.optional),
  base: Flag.string('base').pipe(Flag.optional),
  branch: Flag.string('branch').pipe(Flag.optional),
  config: Flag.string('config').pipe(Flag.optional),
}, ({ title, body, bodyFile, base, branch, config }) =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    const { config: resolved, versioning } = yield* resolveRepo(Option.getOrUndefined(config))
    const bodyOpt = Option.getOrUndefined(body)
    const bodyFileRaw = Option.getOrUndefined(bodyFile)
    const bodyFileRel = bodyFileRaw === undefined
      ? undefined
      : relative(Deno.cwd(), resolve(Deno.cwd(), bodyFileRaw))
    const request = yield* S.decodeUnknownEffect(PullRequestRequest)({
      title: Option.getOrUndefined(title) ?? resolved.pr.title,
      body: bodyOpt ?? (bodyFileRel === undefined ? resolved.pr.body : undefined),
      bodyFile: bodyFileRel,
      base: Option.getOrUndefined(base) ?? resolved.base,
      branch: Option.getOrUndefined(branch) ?? resolved.branch,
      remote: undefined,
      labels: ['release'],
    }).pipe(Effect.mapError((detail) => new Error(`invalid flags: ${detail.message}`)))
    const decision = yield* Cell.run(pullRequestCell, request).pipe(
      Effect.mapError((refusal) => new Error(prRefusalText(refusal))),
    )
    yield* consumePendingIntents(versioning, resolved.changelogDir)
    const git = yield* GitPort
    yield* Match.value(decision).pipe(
      Match.tag('PullRequestCreated', (created) =>
        Effect.gen(function*() {
          yield* reporter.emit(`created release PR #${created.number}`)
          yield* landVersionBump(git, request.branch, request.title)
        })),
      Match.tag('PullRequestUpdated', (updated) =>
        Effect.gen(function*() {
          yield* reporter.emit(`updated release PR #${updated.number}`)
          yield* landVersionBump(git, request.branch, request.title)
        })),
      Match.tag('PullRequestClosed', (closed) =>
        Effect.gen(function*() {
          yield* reporter.emit('no pending change intents — nothing to release')
          yield* reporter.note(
            closed.branch.deleted
              ? `closed release PR #${closed.number} and deleted ${closed.branch.branch}`
              : `closed release PR #${closed.number}; ${closed.branch.branch} was already gone`,
          )
        })),
      Match.tag('PullRequestVacant', () => reporter.emit('no pending change intents — nothing to release')),
      Match.exhaustive,
    )
  }))

const release = Command.make('release').pipe(
  Command.withDescription('Plan release phases, open release PRs, tag and publish GitHub releases'),
  Command.withSubcommands([plan, pr, tag, releaseCommand]),
)

const Wiring = S.Struct({ changesetDir: RelativePath })

const FALLBACK_CHANGESET_DIR = '.changeset'

const wired = Effect.gen(function*() {
  const root = yield* S.decodeUnknownEffect(RepoRoot)(Deno.cwd()).pipe(Effect.orDie)
  const text = yield* Effect.promise(() => Deno.readTextFile(join(root, 'release.jsonc')).catch(() => null))
  if (text === null) {
    const changesetDir = yield* S.decodeUnknownEffect(RelativePath)(FALLBACK_CHANGESET_DIR).pipe(
      Effect.orDie,
    )
    return { root, changesetDir }
  }
  const decoded = yield* S.decodeUnknownEffect(Wiring)(parseJsonc(text)).pipe(Effect.orDie)
  return { root, changesetDir: decoded.changesetDir }
})

const MainLive: Layer.Layer<
  | ChangesetStore
  | ChangelogStore
  | CycleStore
  | ForgePort
  | GitPort
  | ProcessPort
  | ReleaseConfigStore
  | SurfaceStore
  | WorkspaceStore
> = Layer.unwrap(
  Effect.map(wired, ({ root, changesetDir }) => {
    const forge = Layer.provide(
      ForgeLive,
      Layer.succeed(ForgeConfig, {
        token: Deno.env.get('GITHUB_TOKEN'),
        baseUrl: Deno.env.get('GITHUB_API_URL'),
      }),
    )
    return Layer.mergeAll(
      forge,
      GitLive,
      ProcessLive,
      CycleStoreLive,
      ReleaseConfigStoreLive,
      WorkspaceStoreLive(root),
      ChangesetStoreLive({ root, changesetDir }),
      SurfaceStoreLive(root),
      ChangelogStoreLive(root),
    )
  }),
)

DenoRuntime.runMain(Effect.provide(program(release, '0.0.0'), MainLive))
