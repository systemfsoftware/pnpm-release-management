import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { gateChangesCell, newIntentCell } from '@systemfsoftware/changeset-engine'
import { program, Reporter } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { GitLive } from '@systemfsoftware/git-adapter'
import { ChangeEvidenceLive } from '@systemfsoftware/process-adapter'
import { GitRef, ReleaseConfigStore, RepoRoot, TaskName } from '@systemfsoftware/release-language'
import type {
  ChangesetStore,
  ConfigRefusal,
  MemberRefusal,
  NewIntentRefusal,
  RelativePath,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { ChangesetStoreLive, ReleaseConfigStoreLive, WorkspaceStoreLive } from '@systemfsoftware/workspace-adapter'
import { Effect, FileSystem, Layer, Option, Path } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import { Argument, Command, Flag } from 'effect/unstable/cli'
import { ChildProcessSpawner } from 'effect/unstable/process'
const MainLive = Layer.mergeAll(
  ReleaseConfigStoreLive,
  Layer.provide(ChangeEvidenceLive, GitLive),
  Path.layer,
).pipe(Layer.provide(NodeServices.layer))

interface StoreOptions {
  readonly root: RepoRoot
  readonly changesetDir: RelativePath
}

const provideStores = <I, A, E, R>(
  cell: Cell.Cell<I, A, E, R>,
  options: StoreOptions,
): Cell.Cell<
  I,
  A,
  E,
  | Exclude<R, WorkspaceStore | ChangesetStore>
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
> =>
  Cell.provide(
    cell,
    Layer.mergeAll(
      WorkspaceStoreLive(options.root),
      ChangesetStoreLive({ root: options.root, changesetDir: options.changesetDir }),
    ),
  )

const CONFIG_FILE = 'release.jsonc'

const resolveRoot = (
  configFlag: string | undefined,
): Effect.Effect<RepoRoot, string, Path.Path | FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    let start: string
    if (configFlag === undefined) {
      start = process.cwd()
    } else {
      const stat = yield* fs.stat(configFlag).pipe(
        Effect.mapError(() => `cannot stat --config "${configFlag}"`),
      )
      if (stat.type === 'Directory') {
        start = configFlag
      } else {
        start = path.dirname(configFlag)
      }
    }
    let dir = start
    let found = false
    do {
      found = yield* fs.stat(path.join(dir, CONFIG_FILE)).pipe(
        Effect.map(() => true),
        Effect.orElseSucceed(() => false),
      )
      if (!found) {
        const parent = path.dirname(dir)
        if (parent === dir) {
          return yield* Effect.fail(`cannot find ${CONFIG_FILE} above ${start}`)
        }
        dir = parent
      }
    } while (!found)
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
    let task: TaskName | undefined
    if (resolved.gate.strategy === 'turbo') {
      const configured = resolved.gate.task
      if (configured === undefined) {
        task = yield* S.decodeUnknownEffect(TaskName)('build').pipe(Effect.orDie)
      } else {
        task = configured
      }
    } else {
      task = undefined
    }
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
  }).pipe(Effect.catchIf((): boolean => true, reportFailure)))

const newIntent = Command.make('new', {
  names: Argument.variadic(Argument.string('package')),
  bump: Flag.string('bump').pipe(Flag.withAlias('b'), Flag.optional),
  summary: Flag.string('summary').pipe(Flag.withAlias('s'), Flag.optional),
  slug: Flag.string('slug').pipe(Flag.optional),
  config: Flag.string('config').pipe(Flag.optional),
}, ({ names, bump, summary, slug, config }) =>
  Effect.gen(function*() {
    const path = yield* Path.Path
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
    yield* reporter.emit(path.join(root, decision.path))
  }).pipe(Effect.catchIf((): boolean => true, reportFailure)))

const changeset = Command.make('changeset').pipe(
  Command.withDescription('Author and gate the change intents that drive a release'),
  Command.withSubcommands([newIntent, check]),
)

NodeRuntime.runMain(Effect.provide(program(changeset, '0.0.0'), Layer.mergeAll(MainLive, NodeServices.layer)))
