#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run=git,pnpm --allow-env
import { DenoRuntime } from '@effect/platform-deno'
import { dirname, join } from '@std/path'
import { gateChangesCell, newIntentCell } from '@systemfsoftware/changeset-engine'
import { program, Reporter } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { GitLive } from '@systemfsoftware/git-adapter'
import { ChangeEvidenceLive } from '@systemfsoftware/process-adapter'
import { GitRef, ReleaseConfigStore, RepoRoot, TaskName } from '@systemfsoftware/release-language'
import type { ChangesetStore, ConfigRefusal, MemberRefusal, NewIntentRefusal, RelativePath, WorkspaceStore } from '@systemfsoftware/release-language'
import { ChangesetStoreLive, ReleaseConfigStoreLive, WorkspaceStoreLive } from '@systemfsoftware/workspace-adapter'
import { Effect, Layer, Option } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import { Argument, Command, Flag } from 'effect/unstable/cli'

const MainLive = Layer.mergeAll(
  ReleaseConfigStoreLive,
  Layer.provide(ChangeEvidenceLive, GitLive),
)

interface StoreOptions {
  readonly root: RepoRoot
  readonly changesetDir: RelativePath
}

const provideStores = <I, A, E, R>(
  cell: Cell.Cell<I, A, E, R>,
  options: StoreOptions,
): Cell.Cell<I, A, E, Exclude<R, WorkspaceStore | ChangesetStore>> =>
  Cell.provide(
    cell,
    Layer.mergeAll(
      WorkspaceStoreLive(options.root),
      ChangesetStoreLive({ root: options.root, changesetDir: options.changesetDir }),
    ),
  )

const CONFIG_FILE = 'release.jsonc'

const resolveRoot = (configFlag: string | undefined): Effect.Effect<RepoRoot, string> =>
  Effect.gen(function*() {
    const start = configFlag === undefined
      ? Deno.cwd()
      : (yield* Effect.tryPromise({
        try: () => Deno.stat(configFlag).then((info) => info.isDirectory ? configFlag : dirname(configFlag)),
        catch: () => new Error(`cannot stat --config "${configFlag}"`),
      }).pipe(Effect.mapError((error) => error.message)))
    let dir = start
    while (true) {
      const found = yield* Effect.tryPromise({
        try: () => Deno.stat(join(dir, CONFIG_FILE)).then(() => true),
        catch: () => new Error('missing'),
      }).pipe(Effect.orElseSucceed(() => false))
      if (found) break
      const parent = dirname(dir)
      if (parent === dir) return yield* Effect.fail(`cannot find ${CONFIG_FILE} above ${start}`)
      dir = parent
    }
    return yield* S.decodeUnknownEffect(RepoRoot)(dir).pipe(
      Effect.mapError(() => `repository root "${dir}" is not an absolute path`),
    )
  })

const reportFailure = (message: string): Effect.Effect<void, never, Reporter> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    yield* reporter.annotateError(message)
    return yield* reporter.exitCode(1)
  })

const describeConfig = (refusal: ConfigRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('ConfigUnreadable', (unreadable) => `cannot read config ${unreadable.path}`),
    Match.tag('ConfigMalformed', (malformed) => `cannot parse config ${malformed.path}: ${malformed.reason}`),
    Match.tag(
      'ConfigFieldMissing',
      (missing) => `config ${missing.path} is missing required field "${missing.field}"`,
    ),
    Match.tag(
      'ConfigFieldInvalid',
      (invalid) => `config ${invalid.path} field "${invalid.field}" is invalid: ${invalid.reason}`,
    ),
    Match.exhaustive,
  )

const describeNewIntentRefusal = (refusal: NewIntentRefusal | MemberRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('NewIntentInvalidBump', () => '--bump must be one of none | patch | minor | major'),
    Match.tag('NewIntentSummaryMissing', () => '--summary is required, and must be one line'),
    Match.tag('NewIntentPackagesEmpty', () => 'name at least one package'),
    Match.tag('IntentUnknownPackage', (unknown) => `not workspace packages: ${unknown.package}`),
    Match.tag('NewIntentPackageNameMalformed', (malformed) => `not workspace packages: ${malformed.given}`),
    Match.tag('IntentSlugTaken', (taken) => `changeset slug "${taken.slug}" is already taken`),
    Match.tag('ManifestUnreadable', (unreadable) => `cannot read workspace manifest ${unreadable.path}`),
    Match.tag(
      'ManifestInvalid',
      (invalid) => `cannot parse workspace manifest ${invalid.path}: ${invalid.reason}`,
    ),
    Match.exhaustive,
  )

const check = Command.make('check', {
  base: Argument.string('base-sha-or-ref').pipe(Argument.optional),
  baseFlag: Flag.string('base').pipe(Flag.optional),
  skipLiveness: Flag.boolean('skip-liveness').pipe(Flag.withDefault(false)),
  config: Flag.string('config').pipe(Flag.optional),
}, ({ base, baseFlag, skipLiveness, config }) =>
  Effect.gen(function*() {
    const ref = Option.getOrUndefined(base) ?? Option.getOrUndefined(baseFlag)
    if (ref === undefined) return yield* Effect.fail('usage: changeset-management check <base-sha-or-ref>')
    const root = yield* resolveRoot(Option.getOrUndefined(config))
    const configs = yield* ReleaseConfigStore
    const resolved = yield* configs.loadConfig(root).pipe(Effect.mapError(describeConfig))
    const baseRef = yield* S.decodeUnknownEffect(GitRef)(ref).pipe(
      Effect.mapError(() => `invalid base ref "${ref}"`),
    )
    const task = resolved.gate.strategy === 'turbo'
      ? (resolved.gate.task ?? (yield* S.decodeUnknownEffect(TaskName)('build').pipe(Effect.orDie)))
      : undefined
    const gate = provideStores(gateChangesCell, { root, changesetDir: resolved.changesetDir })
    const report = yield* Cell.run(gate, {
      root,
      ref: baseRef,
      strategy: resolved.gate.strategy,
      task,
      skipLiveness,
    }).pipe(
      Effect.mapError((failure) => `changeset gate failed: ${JSON.stringify(failure)}`),
    )
    const reporter = yield* Reporter
    if (report.ok) return yield* reporter.emit(report.text)
    yield* reporter.annotateError(report.text)
    return yield* reporter.exitCode(1)
  }).pipe(Effect.catch(reportFailure)))

const newIntent = Command.make('new', {
  names: Argument.variadic(Argument.string('package')),
  bump: Flag.string('bump').pipe(Flag.withAlias('b'), Flag.optional),
  summary: Flag.string('summary').pipe(Flag.withAlias('s'), Flag.optional),
  slug: Flag.string('slug').pipe(Flag.optional),
  config: Flag.string('config').pipe(Flag.optional),
}, ({ names, bump, summary, slug, config }) =>
  Effect.gen(function*() {
    const root = yield* resolveRoot(Option.getOrUndefined(config))
    const configs = yield* ReleaseConfigStore
    const resolved = yield* configs.loadConfig(root).pipe(Effect.mapError(describeConfig))
    const stage = provideStores(newIntentCell, { root, changesetDir: resolved.changesetDir })
    const decision = yield* Cell.run(stage, {
      packages: [...names],
      bump: Option.getOrUndefined(bump),
      summary: Option.getOrUndefined(summary),
      slug: Option.getOrUndefined(slug),
    }).pipe(Effect.mapError(describeNewIntentRefusal))
    const reporter = yield* Reporter
    yield* reporter.emit(join(root, decision.path))
  }).pipe(Effect.catch(reportFailure)))

const changeset = Command.make('changeset').pipe(
  Command.withDescription('Author and gate the change intents that drive a release'),
  Command.withSubcommands([newIntent, check]),
)

DenoRuntime.runMain(Effect.provide(program(changeset, '0.0.0'), MainLive))
