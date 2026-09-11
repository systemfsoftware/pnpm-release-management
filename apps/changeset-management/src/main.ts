import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { gateChangesCell, type GateReport, newIntentCell } from '@systemfsoftware/changeset-engine'
import {
  program,
  Reporter,
  ReporterLive,
  resolveWorkspaceRoot,
  type WorkspaceRootNotAbsolute,
} from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { GitLive } from '@systemfsoftware/git-adapter'
import { ChangeEvidenceLive } from '@systemfsoftware/process-adapter'
import {
  type ConfigRefusal,
  type Gate,
  type GateRefusal,
  GitRef,
  type IntentRefusal,
  type MemberRefusal,
  type NewIntentDecision,
  type NewIntentRefusal,
  type ReleaseConfig,
  ReleaseConfigStore,
  RepoRoot,
  type TaskName,
} from '@systemfsoftware/release-language'
import { ChangesetStoreLive, ReleaseConfigStoreLive, WorkspaceStoreLive } from '@systemfsoftware/workspace-adapter'
import { Effect, type FileSystem, Layer, Option, Path } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import { Argument, Command, Flag } from 'effect/unstable/cli'
import { type BaseRefInvalid, type BaseRefMissing } from './Invocation.schema.js'

const VERSION = '0.0.0'

const AppLive = Layer.mergeAll(
  ReleaseConfigStoreLive,
  Layer.provide(ChangeEvidenceLive, GitLive),
).pipe(Layer.provide(NodeServices.layer))

interface WorkspaceContext {
  readonly root: RepoRoot
  readonly release: ReleaseConfig
}

interface StagedIntent {
  readonly root: RepoRoot
  readonly decision: NewIntentDecision
}

type AppRefusal =
  | ConfigRefusal
  | MemberRefusal
  | NewIntentRefusal
  | GateRefusal
  | IntentRefusal
  | WorkspaceRootNotAbsolute
  | BaseRefMissing
  | BaseRefInvalid

const describeRefusal = (refusal: AppRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('ConfigUnreadable', (unreadable) => `cannot read config ${unreadable.path}`),
    Match.tag(
      'ConfigMalformed',
      (malformed) => `cannot parse config ${malformed.path}: ${malformed.reason}`,
    ),
    Match.tag(
      'ConfigFieldMissing',
      (missing) => `config ${missing.path} is missing required field "${missing.field}"`,
    ),
    Match.tag(
      'ConfigFieldInvalid',
      (invalid) => `config ${invalid.path} field "${invalid.field}" is invalid: ${invalid.reason}`,
    ),
    Match.tag('ManifestUnreadable', (unreadable) => `cannot read workspace manifest ${unreadable.path}`),
    Match.tag(
      'ManifestInvalid',
      (invalid) => `cannot parse workspace manifest ${invalid.path}: ${invalid.reason}`,
    ),
    Match.tag(
      'IntentFrontmatterMalformed',
      (malformed) => `cannot parse changeset intent ${malformed.path}: malformed frontmatter`,
    ),
    Match.tag('IntentUnknownPackage', (unknown) => `not workspace packages: ${unknown.package}`),
    Match.tag('IntentSlugTaken', (taken) => `changeset slug "${taken.slug}" is already taken`),
    Match.tag('NewIntentInvalidBump', () => '--bump must be one of none | patch | minor | major'),
    Match.tag('NewIntentSummaryMissing', () => '--summary is required, and must be one line'),
    Match.tag('NewIntentPackagesEmpty', () => 'name at least one package'),
    Match.tag('NewIntentPackageNameMalformed', (malformed) => `not workspace packages: ${malformed.given}`),
    Match.tag(
      'GateUnknownPackage',
      (unknown) => `${unknown.path} names non-member package "${unknown.package}"`,
    ),
    Match.tag('GateIntentMissing', (missing) => `no intent names: ${missing.packages.join(', ')}`),
    Match.tag(
      'WorkspaceRootNotAbsolute',
      (notAbsolute) => `repository root "${notAbsolute.given}" is not an absolute path`,
    ),
    Match.tag('BaseRefMissing', () => 'usage: changeset-management check <base-sha-or-ref>'),
    Match.tag('BaseRefInvalid', (invalid) => `invalid base ref "${invalid.given}"`),
    Match.exhaustive,
  )

const announceRefusal = (refusal: AppRefusal): Effect.Effect<void, never, Reporter> =>
  Effect.flatMap(
    Reporter,
    (reporter) => Effect.flatMap(reporter.annotateError(describeRefusal(refusal)), () => reporter.exitCode(1)),
  )

const announceGate = (report: GateReport): Effect.Effect<void, never, Reporter> =>
  Effect.flatMap(Reporter, (reporter) =>
    Match.value(report.ok).pipe(
      Match.when(true, () => reporter.emit(report.text)),
      Match.orElse(() => Effect.flatMap(reporter.annotateError(report.text), () => reporter.exitCode(1))),
    ))

const announceStaged = (staged: StagedIntent): Effect.Effect<void, never, Path.Path | Reporter> =>
  Effect.flatMap(
    Path.Path,
    (path) => Effect.flatMap(Reporter, (reporter) => reporter.emit(path.join(staged.root, staged.decision.path))),
  )

const releaseWorkspaceOf = (
  config: Option.Option<string>,
): Effect.Effect<
  WorkspaceContext,
  ConfigRefusal | WorkspaceRootNotAbsolute,
  ReleaseConfigStore | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const root = yield* resolveWorkspaceRoot(config)
    const store = yield* ReleaseConfigStore
    const release = yield* store.loadConfig(root)
    return { root, release }
  })

const storesOf = (context: WorkspaceContext) =>
  Layer.mergeAll(
    WorkspaceStoreLive(context.root),
    ChangesetStoreLive({ root: context.root, changesetDir: context.release.changesetDir }),
  )

const baseRefOf = (
  positional: Option.Option<string>,
  flag: Option.Option<string>,
): Effect.Effect<GitRef, BaseRefMissing | BaseRefInvalid> =>
  Option.match(Option.orElse(positional, () => flag), {
    onNone: () => Effect.fail<BaseRefMissing>({ _tag: 'BaseRefMissing' }),
    onSome: (given) =>
      S.decodeUnknownEffect(GitRef)(given).pipe(
        Effect.mapError((): BaseRefInvalid => ({ _tag: 'BaseRefInvalid', given })),
      ),
  })

const taskOf = (gate: Gate): TaskName | undefined =>
  Match.value(gate).pipe(
    Match.discriminatorsExhaustive('strategy')({
      turbo: (turbo) => turbo.task,
      paths: () => undefined,
    }),
  )

const newIntent = Command.make('new', {
  names: Argument.variadic(Argument.string('package')),
  bump: Flag.string('bump').pipe(Flag.withAlias('b'), Flag.optional),
  summary: Flag.string('summary').pipe(Flag.withAlias('s'), Flag.optional),
  slug: Flag.string('slug').pipe(Flag.optional),
  config: Flag.string('config').pipe(Flag.optional),
}, ({ names, bump, summary, slug, config }) => {
  const staged = Effect.flatMap(releaseWorkspaceOf(config), (context) =>
    Effect.map(
      Cell.run(Cell.provide(newIntentCell, storesOf(context)), {
        packages: names,
        bump: Option.getOrUndefined(bump),
        summary: Option.getOrUndefined(summary),
        slug: Option.getOrUndefined(slug),
      }),
      (decision) => ({ root: context.root, decision }),
    ))
  return Effect.matchEffect(staged, { onFailure: announceRefusal, onSuccess: announceStaged })
})

const check = Command.make('check', {
  base: Argument.string('base-sha-or-ref').pipe(Argument.optional),
  baseFlag: Flag.string('base').pipe(Flag.optional),
  skipLiveness: Flag.boolean('skip-liveness').pipe(Flag.withDefault(false)),
  config: Flag.string('config').pipe(Flag.optional),
}, ({ base, baseFlag, skipLiveness, config }) => {
  const gate = Effect.flatMap(
    baseRefOf(base, baseFlag),
    (ref) =>
      Effect.flatMap(
        releaseWorkspaceOf(config),
        (context) =>
          Cell.run(Cell.provide(gateChangesCell, storesOf(context)), {
            root: context.root,
            ref,
            strategy: context.release.gate.strategy,
            task: taskOf(context.release.gate),
            skipLiveness,
          }),
      ),
  )
  return Effect.matchEffect(gate, { onFailure: announceRefusal, onSuccess: announceGate })
})

const changeset = Command.make('changeset').pipe(
  Command.withDescription('Author and gate the change intents that drive a release'),
  Command.withSubcommands([newIntent, check]),
)

NodeRuntime.runMain(
  Effect.provide(
    program(changeset, VERSION),
    Layer.mergeAll(AppLive, ReporterLive, NodeServices.layer),
  ),
)
