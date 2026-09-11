import { NodeRuntime, NodeServices } from '@effect/platform-node'
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
  type ConfigRefusal,
  CycleStore,
  ForgePort,
  type GithubReleaseRefusal,
  GitPort,
  GitRef,
  type IntentRefusal,
  JsonSurface,
  type MemberRefusal,
  type PlanDeferredUnknown,
  type PlanRefusal,
  PrBlock,
  ProcessPort,
  PrTitle,
  type PullRequestRefusal,
  RelativePath,
  type ReleaseConfig,
  ReleaseConfigStore,
  RemoteName,
  RepoRoot,
  SurfaceStore,
  type TagRefusal,
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
import { Effect, FileSystem, Layer, Option, Path } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import { Command, Flag } from 'effect/unstable/cli'
import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser'
import type { ParseError } from 'jsonc-parser'

type RepoConfig = {
  readonly base: GitRef
  readonly branch: GitRef
  readonly changesetDir: RelativePath
  readonly changelogDir: RelativePath
  readonly pr: PrBlock
}

const causeMessage = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message
  }
  if (typeof cause === 'string') {
    return cause
  }
  return 'unknown'
}

const parseJsoncStrict = (text: string): unknown => {
  const errors: Array<ParseError> = []
  const value: unknown = parseJsonc(text, errors)
  if (errors.length > 0) {
    const first = errors[0]
    if (first === undefined) {
      throw new Error('unknown parse error')
    }
    throw new Error(printParseErrorCode(first.error))
  }
  return value
}

const configRefusalText = (refusal: ConfigRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('ConfigUnreadable', (unreadable) => `${unreadable.path}: cannot be read`),
    Match.tag(
      'ConfigMalformed',
      (malformed) => `${malformed.path}: ${malformed.reason}`,
    ),
    Match.tag(
      'ConfigFieldMissing',
      (missing) => `${missing.path}: missing field ${missing.field}`,
    ),
    Match.tag(
      'ConfigFieldInvalid',
      (invalid) => `${invalid.path}: invalid field ${invalid.field}: ${invalid.reason}`,
    ),
    Match.exhaustive,
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
  WorkspaceStore | ReleaseConfigStore | Path.Path
> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const workspace = yield* WorkspaceStore
    const configs = yield* ReleaseConfigStore
    let root: RepoRoot
    if (flag === undefined) {
      root = workspace.root
    } else {
      root = yield* S.decodeUnknownEffect(RepoRoot)(
        path.dirname(path.resolve(process.cwd(), flag)),
      ).pipe(Effect.mapError((detail) => new Error(`invalid --config ${JSON.stringify(flag)}: ${detail.message}`)))
    }
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

const manifestSurface = (file: RelativePath): typeof JsonSurface.Type => ({
  kind: 'json',
  path: file,
})

const bumpInput = (
  changelogDir: RelativePath,
  versioning: ReleaseConfig['versioning'],
): BumpInput => {
  if (versioning.strategy === 'pnpm') {
    return {
      strategy: 'pnpm',
      changelogDir,
      manifest: {
        file: RelativePath.make('package.json'),
        surface: manifestSurface(RelativePath.make('package.json')),
      },
      surfaces: [],
    }
  }
  return {
    strategy: 'surfaces',
    changelogDir,
    rootChangelog: versioning.changelog,
    manifest: { file: versioning.manifest, surface: manifestSurface(versioning.manifest) },
    surfaces: versioning.surfaces.flatMap(
      (surface): ReadonlyArray<BumpInput['surfaces'][number]> => {
        if (surface.kind === 'json') return [{ file: surface.path, surface }]
        if (surface.kind === 'toml') {
          if (surface.path === undefined) {
            return []
          }
          return [{ file: surface.path, surface }]
        }
        return [{ file: surface.path, surface }]
      },
    ),
  }
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
        const entries: Array<readonly [string, unknown]> = Object.entries(refusal)
        const tagEntry = entries.find(([key]) => key === '_tag')
        const tagValue: unknown = tagEntry?.[1]
        let tagText: string
        if (typeof tagValue === 'string') {
          tagText = tagValue
        } else {
          tagText = 'unknown refusal'
        }
        const detail = entries
          .filter(([key]) => key !== '_tag')
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(' ')
        if (detail.length === 0) {
          return new Error(tagText)
        }
        return new Error(`${tagText}: ${detail}`)
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
): Effect.Effect<void, Error, Reporter | FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    const fs = yield* FileSystem.FileSystem
    const block = entries.map(([key, value]) => `${key}=${value}`).join('\n')
    if (output === undefined) {
      yield* reporter.emit(block)
      return
    }
    yield* fs.writeFileString(output, `${block}\n`, { flag: 'a' }).pipe(
      Effect.mapError((cause) => new Error(`cannot write ${output}: ${causeMessage(cause)}`)),
    )
  })

const describeCellRefusal = (
  refusal:
    | PlanRefusal
    | IntentRefusal
    | MemberRefusal
    | TagRefusal
    | PlanDeferredUnknown
    | GithubReleaseRefusal
    | PullRequestRefusal,
): string => {
  const kebab = refusal._tag.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  const fields: Record<string, unknown> = { ...refusal }
  const pathField = fields['path']
  if (typeof pathField === 'string') {
    return `refused: ${kebab}, path: ${pathField}`
  }
  const packagesField = fields['packages']
  if (Array.isArray(packagesField) && packagesField.every((entry) => typeof entry === 'string')) {
    return `refused: ${kebab}, packages: ${packagesField.join(', ')}`
  }
  return `refused: ${kebab}`
}

const planRefusalText = (refusal: PlanRefusal | IntentRefusal | MemberRefusal | TagRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('PlanDeferredUnknown', (unknown) => {
      if (Array.isArray(unknown.packages)) {
        return `unknown deferred package(s): ${unknown.packages.join(', ')}`
      }
      return `unknown deferred package(s): ${String(unknown.packages)}`
    }),
    Match.tag('PlanCapturedMalformed', (malformed) => `cannot read captured file: ${malformed.path}`),
    Match.orElse(describeCellRefusal),
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

const tagRefusalText = (refusal: MemberRefusal | TagRefusal | PlanDeferredUnknown): string =>
  Match.value(refusal).pipe(
    Match.tag('TagCapturedMalformed', (malformed) => `cannot read captured file: ${malformed.path}`),
    Match.tag('TagExcludedMalformed', (excluded) => `cannot read exclude file: ${excluded.path}`),
    Match.tag('PlanDeferredUnknown', (unknown) => {
      if (Array.isArray(unknown.packages)) {
        return `unknown excluded package(s): ${unknown.packages.join(', ')}`
      }
      return `unknown excluded package(s): ${String(unknown.packages)}`
    }),
    Match.orElse(describeCellRefusal),
  )

const emitCapturedFile = (
  path: string,
): Effect.Effect<void, Error, Reporter | FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(path).pipe(
      Effect.mapError((cause) => new Error(`cannot read ${path}: ${causeMessage(cause)}`)),
    )
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

const releaseRefusalText = (
  refusal: MemberRefusal | TagRefusal | PlanRefusal | GithubReleaseRefusal,
): string =>
  Match.value(refusal).pipe(
    Match.tag(
      'ReleaseChangelogMissing',
      (missing) =>
        `Missing changelog for ${missing.package}@${missing.version}: ` +
        `expected ${missing.changelog} to hold the generated changelog. ` +
        'Did the version step run before this one?',
    ),
    Match.tag(
      'ReleaseChangelogEmpty',
      (empty) =>
        `Empty changelog for ${empty.package}@${empty.version}: ` +
        `expected ${empty.changelog} to hold the generated changelog. ` +
        'Did the version step run before this one?',
    ),
    Match.orElse(describeCellRefusal),
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

const prRefusalText = (refusal: IntentRefusal | TagRefusal | PullRequestRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag(
      'PullRequestBodyUnreadable',
      (unreadable) => `cannot read body file: ${unreadable.path}`,
    ),
    Match.tag('PullRequestHeadInvalid', (invalid) => `invalid pull request head: ${invalid.branch}`),
    Match.orElse(describeCellRefusal),
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
    const path = yield* Path.Path
    const reporter = yield* Reporter
    const { config: resolved, versioning } = yield* resolveRepo(Option.getOrUndefined(config))
    const bodyOpt = Option.getOrUndefined(body)
    const bodyFileRaw = Option.getOrUndefined(bodyFile)
    let bodyFileRel: string | undefined
    if (bodyFileRaw === undefined) {
      bodyFileRel = undefined
    } else {
      bodyFileRel = path.relative(process.cwd(), path.resolve(process.cwd(), bodyFileRaw))
    }
    let bodyValue: string | undefined
    if (bodyOpt !== undefined) {
      bodyValue = bodyOpt
    } else if (bodyFileRel === undefined) {
      bodyValue = resolved.pr.body
    } else {
      bodyValue = undefined
    }
    const request = yield* S.decodeUnknownEffect(PullRequestRequest)({
      title: Option.getOrUndefined(title) ?? resolved.pr.title,
      body: bodyValue,
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
          if (closed.branch.deleted) {
            yield* reporter.note(
              `closed release PR #${closed.number} and deleted ${closed.branch.branch}`,
            )
          } else {
            yield* reporter.note(
              `closed release PR #${closed.number}; ${closed.branch.branch} was already gone`,
            )
          }
        })),
      Match.tag('PullRequestVacant', () => reporter.emit('no pending change intents — nothing to release')),
      Match.exhaustive,
    )
  }))

const release = Command.make('release').pipe(
  Command.withDescription('Plan release phases, open release PRs, tag and publish GitHub releases'),
  Command.withSubcommands([plan, pr, tag, releaseCommand]),
)

const FALLBACK_CHANGESET_DIR = '.changeset'

const wired: Effect.Effect<
  { readonly root: RepoRoot; readonly changesetDir: RelativePath },
  never,
  Path.Path | FileSystem.FileSystem
> = Effect.gen(
  function*() {
    const path = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const root = yield* S.decodeUnknownEffect(RepoRoot)(process.cwd()).pipe(Effect.orDie)
    const text = yield* fs.readFileString(path.join(root, 'release.jsonc')).pipe(
      Effect.orElseSucceed(() => null),
    )
    if (text === null) {
      const changesetDir = yield* S.decodeUnknownEffect(RelativePath)(FALLBACK_CHANGESET_DIR).pipe(
        Effect.orDie,
      )
      return { root, changesetDir }
    }
    const parsed: unknown = parseJsoncStrict(text)
    let dirText = FALLBACK_CHANGESET_DIR
    if (typeof parsed === 'object' && parsed !== null && 'changesetDir' in parsed) {
      const value: unknown = parsed.changesetDir
      if (typeof value === 'string') {
        dirText = value
      }
    }
    const changesetDir = yield* S.decodeUnknownEffect(RelativePath)(dirText).pipe(Effect.orDie)
    return { root, changesetDir }
  },
)

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
  | Path.Path
> = Layer.unwrap(
  Effect.map(Effect.provide(wired, NodeServices.layer), ({ root, changesetDir }) => {
    const forge = Layer.provide(
      ForgeLive,
      Layer.succeed(ForgeConfig, {
        token: process.env['GITHUB_TOKEN'],
        baseUrl: process.env['GITHUB_API_URL'],
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
      Path.layer,
    ).pipe(Layer.provide(NodeServices.layer))
  }),
)

NodeRuntime.runMain(Effect.provide(program(release, '0.0.0'), Layer.mergeAll(MainLive, NodeServices.layer)))
