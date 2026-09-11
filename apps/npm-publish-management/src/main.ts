import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { program, Reporter, ReporterLive } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { GitLive } from '@systemfsoftware/git-adapter'
import {
  publishPackagesCell,
  PublishRequest,
  publishStatusCell,
  stageNpmTrustCell,
  type StatusMode,
  type StatusReport,
  StatusRequest,
  type StatusRow,
  TrustRequest,
} from '@systemfsoftware/npm-publish-engine'
import { ProcessLive } from '@systemfsoftware/process-adapter'
import { RegistryConfig, RegistryLive } from '@systemfsoftware/registry-adapter'
import {
  type ConfigRefusal,
  CycleStore,
  FsPath,
  GitPort,
  type MemberRefusal,
  OwnerName,
  type PackageName,
  type PlanRefusal,
  ProcessPort,
  type PublishRefusal,
  type PublishStatusRefusal,
  RegistryPort,
  type ReleaseConfig,
  ReleaseConfigStore,
  RepoName,
  RepoRoot,
  type RepoSlug,
  type StatusClass,
  type TrustRefusal,
  type WorkspaceCommand,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { CycleStoreLive, ReleaseConfigStoreLive, WorkspaceStoreLive } from '@systemfsoftware/workspace-adapter'
import { Clock, Effect, FileSystem, Layer, Option, Path } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import { Command, Flag } from 'effect/unstable/cli'
import { type BoundaryRefusal, EmitUnwritable, RequestInvalid } from './boundary.schema.js'

const VERSION = '0.0.0'
const DEFAULT_JOBS = 4
const PUBLISH_NOTHING_OWED = 'every captured version is already on npm — nothing to publish'
const TRUST_IDLE = 'every package is published and attested — nothing to do'
const PREFLIGHT_OK = '\nPREFLIGHT OK: every publishable package exists on the registry.'
const CHECK_OK = '\nOK: every package is published and carries provenance attestations.'
const DEBUT_GUIDANCE = 'OIDC cannot debut a package; bootstrap each one, then re-run.'

const UNKNOWN_SLUG: RepoSlug = {
  owner: OwnerName.make('unknown'),
  repo: RepoName.make('unknown'),
}

const slugText = (slug: RepoSlug): string => `${slug.owner}/${slug.repo}`

const originSlug = (): Effect.Effect<RepoSlug, never, GitPort> =>
  Effect.flatMap(GitPort, (git) => git.repoSlug().pipe(Effect.orElseSucceed(() => UNKNOWN_SLUG)))

const loadConfig = (root: RepoRoot): Effect.Effect<ReleaseConfig, ConfigRefusal, ReleaseConfigStore> =>
  Effect.flatMap(ReleaseConfigStore, (store) => store.loadConfig(root))

const resolveRoot = (flag: Option.Option<string>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const resolved = path.resolve(Option.getOrUndefined(flag) ?? process.cwd())
    const stat = yield* fs.stat(resolved).pipe(Effect.option)
    const root = Option.match(stat, {
      onNone: () => path.dirname(resolved),
      onSome: (entry) =>
        Match.value(entry.type).pipe(
          Match.when('Directory', () => resolved),
          Match.orElse(() => path.dirname(resolved)),
        ),
    })
    return yield* S.decodeUnknownEffect(RepoRoot)(root).pipe(Effect.orDie)
  })

const readTextFile = (file: string): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(file).pipe(Effect.orElseSucceed(() => undefined)))

const readFiltersText = (
  flag: Option.Option<string>,
): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Option.match(flag, {
    onNone: () => Effect.succeed<string | undefined>(undefined),
    onSome: (file) => readTextFile(file),
  })

const decodeTarget = (flag: Option.Option<string>): Effect.Effect<Option.Option<FsPath>, BoundaryRefusal> =>
  Option.match(flag, {
    onNone: () => Effect.succeed(Option.none<FsPath>()),
    onSome: (value) =>
      S.decodeUnknownEffect(FsPath)(value).pipe(
        Effect.map(Option.some),
        Effect.mapError((issue) => RequestInvalid.make({ reason: issue.message })),
      ),
  })

const writeEmitFile = (
  target: FsPath,
  text: string,
): Effect.Effect<void, BoundaryRefusal, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.writeFileString(target, text).pipe(
      Effect.mapError((error) => EmitUnwritable.make({ path: target, reason: error.message })),
    ))

const refuse = (text: string): Effect.Effect<void, never, Reporter> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    yield* reporter.annotateError(text)
    yield* reporter.exitCode(1)
  })

const configRefusalText = (refusal: ConfigRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('ConfigUnreadable', (unreadable) => `${unreadable.path}: cannot be read`),
    Match.tag('ConfigMalformed', (malformed) => `${malformed.path}: ${malformed.reason}`),
    Match.tag('ConfigFieldMissing', (missing) => `${missing.path}: missing field ${missing.field}`),
    Match.tag(
      'ConfigFieldInvalid',
      (invalid) => `${invalid.path}: invalid field ${invalid.field}: ${invalid.reason}`,
    ),
    Match.exhaustive,
  )

const boundaryRefusalText = (refusal: BoundaryRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('RequestInvalid', (invalid) => invalid.reason),
    Match.tag('EmitUnwritable', (unwritable) => `${unwritable.path}: ${unwritable.reason}`),
    Match.exhaustive,
  )

const planRefusalText = (refusal: PlanRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('PlanDeferredUnknown', (unknown) => `unknown deferred packages: ${unknown.packages.join(', ')}`),
    Match.tag(
      'PlanCapturedMalformed',
      (malformed) => `${malformed.path}: captured file is malformed or unreadable`,
    ),
    Match.exhaustive,
  )

const publishRefusalText = (refusal: PublishRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag(
      'PublishCapturedRequired',
      () => '--unpublished needs --captured <file> to know which versions this cycle owns',
    ),
    Match.tag('PublishFiltersUnreadable', (unreadable) => `${unreadable.path}: unable to read filters file`),
    Match.tag('PublishCommandRefused', (refused) => refused.reason),
    Match.exhaustive,
  )

const trustOnlyUnmatchedText = (unmatched: { readonly only: ReadonlyArray<PackageName> }): string =>
  `--only matched no publishable package: ${unmatched.only.join(', ')}`

const trustWorkspaceEmptyText = (): string => 'no publishable packages discovered (did the workspace resolve?)'

const trustRegistryUnreadableText = (unreadable: { readonly packages: ReadonlyArray<PackageName> }): string =>
  `registry unreadable: ${unreadable.packages.join(', ')}`

const trustPublishRefusedText = (refused: { readonly packages: ReadonlyArray<PackageName> }): string =>
  `failed: ${refused.packages.join(', ')}`

const trustLauncherMissingText = (missing: { readonly package: PackageName }): string =>
  `${missing.package} needs a distribution launcher manifest to be staged`

const trustRefusalText = (refusal: TrustRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('TrustOnlyUnmatched', trustOnlyUnmatchedText),
    Match.tag('TrustWorkspaceEmpty', trustWorkspaceEmptyText),
    Match.tag('TrustRegistryUnreadable', trustRegistryUnreadableText),
    Match.tag('TrustPublishRefused', trustPublishRefusedText),
    Match.tag('TrustLauncherMissing', trustLauncherMissingText),
    Match.exhaustive,
  )

const memberRefusalText = (refusal: MemberRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('ManifestUnreadable', (unreadable) => `${unreadable.path}: unable to read package manifest`),
    Match.tag('ManifestInvalid', (invalid) => `${invalid.path}: ${invalid.reason}`),
    Match.exhaustive,
  )

const preflightFailedText = (summary: string): string => `preflight failed — ${summary}. ${DEBUT_GUIDANCE}`

const statusRefusalText = (refusal: PublishStatusRefusal, mode: StatusMode): string =>
  Match.value(refusal).pipe(
    Match.tag('PublishStatusEmpty', () => 'no publishable packages discovered — did the workspace resolve?'),
    Match.tag('PublishStatusUnreadable', (unreadable) =>
      Match.value(mode).pipe(
        Match.when('preflight', () =>
          preflightFailedText(
            `0 package(s) have never been published, ${unreadable.packages.length} unqueryable`,
          )),
        Match.when(
          'check',
          () => `FAIL: 0 unpublished, 0 without OIDC attestation, ${unreadable.packages.length} unqueryable`,
        ),
        Match.orElse(() => trustRegistryUnreadableText(unreadable)),
      )),
    Match.tag('PublishStatusUnpublished', (unpublished) =>
      Match.value(mode).pipe(
        Match.when('preflight', () =>
          preflightFailedText(
            `${unpublished.packages.length} package(s) have never been published, 0 unqueryable`,
          )),
        Match.orElse(() =>
          `FAIL: ${unpublished.packages.length} unpublished, 0 without OIDC attestation, 0 unqueryable`
        ),
      )),
    Match.tag(
      'PublishStatusUnattested',
      (unattested) => `FAIL: 0 unpublished, ${unattested.packages.length} without OIDC attestation, 0 unqueryable`,
    ),
    Match.exhaustive,
  )

type PublishFailure = ConfigRefusal | BoundaryRefusal | PlanRefusal | PublishRefusal | TrustRefusal

const publishFailureText = (refusal: PublishFailure): string =>
  Match.value(refusal).pipe(
    Match.tag('PlanDeferredUnknown', planRefusalText),
    Match.tag('PlanCapturedMalformed', planRefusalText),
    Match.tag('PublishCapturedRequired', publishRefusalText),
    Match.tag('PublishFiltersUnreadable', publishRefusalText),
    Match.tag('PublishCommandRefused', publishRefusalText),
    Match.tag('TrustOnlyUnmatched', trustRefusalText),
    Match.tag('TrustWorkspaceEmpty', trustRefusalText),
    Match.tag('TrustRegistryUnreadable', trustRefusalText),
    Match.tag('TrustPublishRefused', trustRefusalText),
    Match.tag('TrustLauncherMissing', trustRefusalText),
    Match.tag('ConfigUnreadable', configRefusalText),
    Match.tag('ConfigMalformed', configRefusalText),
    Match.tag('ConfigFieldMissing', configRefusalText),
    Match.tag('ConfigFieldInvalid', configRefusalText),
    Match.tag('RequestInvalid', boundaryRefusalText),
    Match.tag('EmitUnwritable', boundaryRefusalText),
    Match.exhaustive,
  )

type StatusFailure = ConfigRefusal | BoundaryRefusal | MemberRefusal | TrustRefusal | PublishStatusRefusal

const statusFailureText = (refusal: StatusFailure, mode: StatusMode): string =>
  Match.value(refusal).pipe(
    Match.tag('PublishStatusEmpty', (empty) => statusRefusalText(empty, mode)),
    Match.tag('PublishStatusUnreadable', (unreadable) => statusRefusalText(unreadable, mode)),
    Match.tag('PublishStatusUnpublished', (unpublished) => statusRefusalText(unpublished, mode)),
    Match.tag('PublishStatusUnattested', (unattested) => statusRefusalText(unattested, mode)),
    Match.tag('ManifestUnreadable', memberRefusalText),
    Match.tag('ManifestInvalid', memberRefusalText),
    Match.tag('TrustOnlyUnmatched', trustRefusalText),
    Match.tag('TrustWorkspaceEmpty', trustRefusalText),
    Match.tag('TrustRegistryUnreadable', trustRefusalText),
    Match.tag('TrustPublishRefused', trustRefusalText),
    Match.tag('TrustLauncherMissing', trustRefusalText),
    Match.tag('ConfigUnreadable', configRefusalText),
    Match.tag('ConfigMalformed', configRefusalText),
    Match.tag('ConfigFieldMissing', configRefusalText),
    Match.tag('ConfigFieldInvalid', configRefusalText),
    Match.tag('RequestInvalid', boundaryRefusalText),
    Match.tag('EmitUnwritable', boundaryRefusalText),
    Match.exhaustive,
  )

type CellRefusal<C> = C extends Cell.Cell<infer _Input, infer _Output, infer Refusal, infer _Services> ? Refusal
  : never

type TrustFailure = ConfigRefusal | BoundaryRefusal | CellRefusal<typeof stageNpmTrustCell>

const trustFailureText = (refusal: TrustFailure): string =>
  Match.value(refusal).pipe(
    Match.tag('ManifestUnreadable', memberRefusalText),
    Match.tag('ManifestInvalid', memberRefusalText),
    Match.tag('TrustOnlyUnmatched', trustOnlyUnmatchedText),
    Match.tag('TrustWorkspaceEmpty', trustWorkspaceEmptyText),
    Match.tag('TrustRegistryUnreadable', trustRegistryUnreadableText),
    Match.tag('TrustPublishRefused', trustPublishRefusedText),
    Match.tag('TrustLauncherMissing', trustLauncherMissingText),
    Match.tag('ConfigUnreadable', configRefusalText),
    Match.tag('ConfigMalformed', configRefusalText),
    Match.tag('ConfigFieldMissing', configRefusalText),
    Match.tag('ConfigFieldInvalid', configRefusalText),
    Match.tag('RequestInvalid', boundaryRefusalText),
    Match.tag('EmitUnwritable', boundaryRefusalText),
    Match.exhaustive,
  )

const workspaceCommandText = (command: WorkspaceCommand): string => `${command.program} ${command.args.join(' ')}`

type ReportedClass = Exclude<StatusClass, 'error'>

const STATUS_ORDER: ReadonlyArray<ReportedClass> = ['unpublished', 'no-oidc', 'stuck', 'ok']

const STATUS_HEADINGS: Readonly<Record<ReportedClass, string>> = {
  unpublished: '== UNPUBLISHED (404 on npm) ==',
  'no-oidc': '== PUBLISHED, NO OIDC ATTESTATION (latest has no provenance; trusted publisher likely unconfigured) ==',
  stuck: '== PUBLISHED + ATTESTED, BUT LOCAL AHEAD (stuck — versioned but not landed) ==',
  ok: '== PUBLISHED + ATTESTED, CURRENT ==',
}

const rowsIn = (rows: ReadonlyArray<StatusRow>, klass: StatusClass): ReadonlyArray<StatusRow> =>
  rows.filter((row) => row.class === klass)

const statusRowText = (row: StatusRow): string =>
  `  ${row.name.padEnd(55)} local ${row.local_version.padEnd(8)} npm ${
    row.npm_latest.padEnd(10)
  } provenance:${row.publishConfig_provenance}`

const statusReportText = (report: StatusReport, registry: string, timestamp: string): string => {
  const sections = STATUS_ORDER.flatMap((klass) => [
    STATUS_HEADINGS[klass],
    ...rowsIn(report.rows, klass).map(statusRowText),
    '',
  ])
  const errorCount = rowsIn(report.rows, 'error').length
  const errorLine = Match.value(errorCount > 0).pipe(
    Match.when(true, (): ReadonlyArray<string> => [`  error:       ${errorCount}`]),
    Match.when(false, (): ReadonlyArray<string> => []),
    Match.exhaustive,
  )
  return [
    `npm publish status — ${timestamp} — registry: ${registry}`,
    `packages: ${report.rows.length}`,
    '',
    ...sections,
    '== summary ==',
    `  unpublished: ${rowsIn(report.rows, 'unpublished').length}`,
    `  no-oidc:     ${rowsIn(report.rows, 'no-oidc').length}`,
    `  stuck:       ${rowsIn(report.rows, 'stuck').length}`,
    `  ok:          ${rowsIn(report.rows, 'ok').length}`,
    ...errorLine,
  ].join('\n')
}

const listText = (lines: ReadonlyArray<string>): string =>
  Match.value(lines.length).pipe(
    Match.when(0, () => ''),
    Match.orElse(() => `${lines.join('\n')}\n`),
  )

const filterFlagsText = (deferred: ReadonlyArray<PackageName>): string =>
  listText(deferred.map((name) => `--filter=${name}`))

const deferredNamesText = (deferred: ReadonlyArray<PackageName>): string => listText([...deferred])

const bootstrapInstructionsText = (deferred: ReadonlyArray<PackageName>, slug: RepoSlug): string =>
  deferred
    .map((name) =>
      [
        '',
        `  ${name}`,
        `    corepack pnpm --filter ${name} build`,
        `    corepack pnpm --filter ${name} publish --access public --no-git-checks`,
        `    npm trust github ${name} --repo ${slugText(slug)} --file release.yml --allow-publish --yes`,
      ].join('\n')
    )
    .join('\n')

const preflightBootstrapsOf = (
  refusal: StatusFailure,
  mode: StatusMode,
): Option.Option<ReadonlyArray<PackageName>> =>
  Match.value(mode).pipe(
    Match.when('preflight', () =>
      Match.value(refusal).pipe(
        Match.tag('PublishStatusUnpublished', (unpublished) => Option.some(unpublished.packages)),
        Match.orElse(() => Option.none<ReadonlyArray<PackageName>>()),
      )),
    Match.orElse(() => Option.none<ReadonlyArray<PackageName>>()),
  )

const refuseStatus = (refusal: StatusFailure, mode: StatusMode): Effect.Effect<void, never, Reporter | GitPort> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    yield* reporter.annotateError(statusFailureText(refusal, mode))
    yield* Option.match(preflightBootstrapsOf(refusal, mode), {
      onNone: () => Effect.void,
      onSome: (deferred) =>
        Effect.gen(function*() {
          const slug = yield* originSlug()
          yield* reporter.note(bootstrapInstructionsText(deferred, slug))
        }),
    })
    yield* reporter.exitCode(1)
  })

interface CommandLiveOptions {
  readonly root: RepoRoot
  readonly registry: string
}

const commandLive = (
  options: CommandLiveOptions,
): Layer.Layer<WorkspaceStore | CycleStore | ProcessPort | RegistryPort, never, never> =>
  Layer.mergeAll(
    WorkspaceStoreLive(options.root),
    CycleStoreLive,
    Layer.provideMerge(
      RegistryLive,
      Layer.mergeAll(
        ProcessLive,
        Layer.succeed(RegistryConfig, { baseUrl: options.registry, root: options.root }),
      ),
    ),
  ).pipe(Layer.provide(NodeServices.layer))

const rootLive: Layer.Layer<
  ReleaseConfigStore | GitPort | Reporter | NodeServices.NodeServices,
  never,
  never
> = Layer.mergeAll(ReleaseConfigStoreLive, GitLive, ReporterLive).pipe(Layer.provideMerge(NodeServices.layer))

const statusModeOf = (preflight: boolean, check: boolean): StatusMode =>
  Match.value({ preflight, check }).pipe(
    Match.when({ preflight: true }, (): StatusMode => 'preflight'),
    Match.when({ check: true }, (): StatusMode => 'check'),
    Match.orElse((): StatusMode => 'report'),
  )

type StatusOutputMode = 'emit-files' | 'json' | 'preflight' | 'report'

const statusOutputModeOf = (options: {
  readonly json: boolean
  readonly preflight: boolean
  readonly emit: boolean
}): StatusOutputMode =>
  Match.value(options).pipe(
    Match.when({ emit: true }, (): StatusOutputMode => 'emit-files'),
    Match.when({ json: true }, (): StatusOutputMode => 'json'),
    Match.when({ preflight: true }, (): StatusOutputMode => 'preflight'),
    Match.orElse((): StatusOutputMode => 'report'),
  )

const jobsOf = (flag: Option.Option<string>): number =>
  Option.getOrElse(Option.map(flag, (value) => Number(value)), () => DEFAULT_JOBS)

const publish = Command.make(
  'publish',
  {
    dryRun: Flag.boolean('dry-run').pipe(Flag.withDefault(false)),
    unpublished: Flag.boolean('unpublished').pipe(Flag.withDefault(false)),
    noProvenance: Flag.boolean('no-provenance').pipe(Flag.withDefault(false)),
    captured: Flag.string('captured').pipe(Flag.optional),
    capturedFile: Flag.string('captured-file').pipe(Flag.optional),
    filters: Flag.string('filters').pipe(Flag.optional),
    registry: Flag.string('registry').pipe(Flag.optional),
    config: Flag.string('config').pipe(Flag.optional),
  },
  ({ dryRun, unpublished, noProvenance, captured, capturedFile, filters, registry, config }) =>
    Effect.gen(function*() {
      const reporter = yield* Reporter
      const root = yield* resolveRoot(config)
      const resolved = yield* loadConfig(root)
      const registryValue = Option.getOrUndefined(registry) ?? resolved.registry
      const filtersText = yield* readFiltersText(filters)
      const request = yield* S.decodeUnknownEffect(PublishRequest)({
        capturedPath: Option.getOrUndefined(captured) ?? Option.getOrUndefined(capturedFile),
        unpublishedOnly: unpublished,
        filtersPath: Option.getOrUndefined(filters),
        filtersText,
        registry: registryValue,
        provenance: !noProvenance && resolved.provenance,
        publishArgs: [...resolved.publishArgs],
        dryRun,
      }).pipe(Effect.mapError((issue) => RequestInvalid.make({ reason: issue.message })))
      const live = commandLive({ root, registry: registryValue })
      const decision = yield* Cell.run(Cell.provide(publishPackagesCell, live), request)
      yield* Match.value(decision).pipe(
        Match.tag('PublishDispatched', (dispatched) => reporter.note(workspaceCommandText(dispatched.command))),
        Match.tag('PublishDryRun', (preview) => reporter.emit(workspaceCommandText(preview.command))),
        Match.tag('PublishNothingOwed', () => reporter.emit(PUBLISH_NOTHING_OWED)),
        Match.exhaustive,
      )
    }).pipe(
      Effect.matchEffect({
        onFailure: (refusal) => refuse(publishFailureText(refusal)),
        onSuccess: () => Effect.void,
      }),
    ),
)

const status = Command.make(
  'status',
  {
    json: Flag.boolean('json').pipe(Flag.withDefault(false)),
    preflight: Flag.boolean('preflight').pipe(Flag.withDefault(false)),
    check: Flag.boolean('check').pipe(Flag.withDefault(false)),
    emitFilters: Flag.string('emit-filters').pipe(Flag.optional),
    emitDeferred: Flag.string('emit-deferred').pipe(Flag.optional),
    registry: Flag.string('registry').pipe(Flag.optional),
    config: Flag.string('config').pipe(Flag.optional),
  },
  ({ json, preflight, check, emitFilters, emitDeferred, registry, config }) => {
    const mode = statusModeOf(preflight, check)
    return Effect.gen(function*() {
      const reporter = yield* Reporter
      const root = yield* resolveRoot(config)
      const resolved = yield* loadConfig(root)
      const registryValue = Option.getOrUndefined(registry) ?? resolved.registry
      const filtersTarget = yield* decodeTarget(emitFilters)
      const deferredTarget = yield* decodeTarget(emitDeferred)
      const request = yield* S.decodeUnknownEffect(StatusRequest)({ mode }).pipe(
        Effect.mapError((issue) => RequestInvalid.make({ reason: issue.message })),
      )
      const report = yield* Cell.run(
        Cell.provide(publishStatusCell, commandLive({ root, registry: registryValue })),
        request,
      )
      const output = statusOutputModeOf({
        json,
        preflight,
        emit: Option.isSome(filtersTarget) || Option.isSome(deferredTarget),
      })
      yield* Match.value(output).pipe(
        Match.when('emit-files', () =>
          Effect.gen(function*() {
            yield* Option.match(filtersTarget, {
              onNone: () => Effect.void,
              onSome: (target) =>
                Effect.gen(function*() {
                  yield* writeEmitFile(target, filterFlagsText(report.deferred))
                  yield* reporter.note(`wrote ${report.deferred.length} filter(s) to ${target}`)
                }),
            })
            yield* Option.match(deferredTarget, {
              onNone: () => Effect.void,
              onSome: (target) =>
                Effect.gen(function*() {
                  yield* writeEmitFile(target, deferredNamesText(report.deferred))
                  yield* reporter.note(`wrote ${report.deferred.length} deferred name(s) to ${target}`)
                }),
            })
            yield* Effect.forEach(
              report.deferred,
              (name) => reporter.note(`  deferred: ${name}`),
              { discard: true },
            )
          })),
        Match.when(
          'json',
          () => Effect.forEach(report.rows, (row) => reporter.emit(JSON.stringify(row)), { discard: true }),
        ),
        Match.when('preflight', () => reporter.emit(PREFLIGHT_OK)),
        Match.orElse(() =>
          Effect.gen(function*() {
            const now = yield* Clock.currentTimeMillis
            yield* reporter.emit(statusReportText(report, registryValue, new Date(now).toISOString()))
            yield* Match.value(check).pipe(
              Match.when(true, () => reporter.emit(CHECK_OK)),
              Match.orElse(() => Effect.void),
            )
          })
        ),
      )
    }).pipe(
      Effect.matchEffect({
        onFailure: (refusal) => refuseStatus(refusal, mode),
        onSuccess: () => Effect.void,
      }),
    )
  },
)

const trust = Command.make(
  'trust',
  {
    dryRun: Flag.boolean('dry-run').pipe(Flag.withDefault(false)),
    only: Flag.string('only').pipe(Flag.withAlias('o'), Flag.optional),
    jobs: Flag.string('jobs').pipe(Flag.optional),
    file: Flag.string('file').pipe(Flag.optional),
    registry: Flag.string('registry').pipe(Flag.optional),
    config: Flag.string('config').pipe(Flag.optional),
  },
  ({ dryRun, only, jobs, file, registry, config }) =>
    Effect.gen(function*() {
      const reporter = yield* Reporter
      const root = yield* resolveRoot(config)
      const resolved = yield* loadConfig(root)
      const registryValue = Option.getOrUndefined(registry) ?? resolved.registry
      const jobsValue = jobsOf(jobs)
      const slug = yield* originSlug()
      const request = yield* S.decodeUnknownEffect(TrustRequest)({
        only: (Option.getOrUndefined(only) ?? '')
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name.length > 0),
        jobs: jobsValue,
        dryRun,
        registry: registryValue,
        workflowFile: Option.getOrUndefined(file),
        slug: slugText(slug),
        launcherManifest: resolved.distribution?.launcherManifest,
      }).pipe(Effect.mapError((issue) => RequestInvalid.make({ reason: issue.message })))
      const decision = yield* Cell.run(
        Cell.provide(stageNpmTrustCell, commandLive({ root, registry: registryValue })),
        request,
      )
      yield* Match.value(decision).pipe(
        Match.tag('TrustComplete', (complete) =>
          reporter.note(
            `processing ${complete.processed} package(s) with --jobs ${jobsValue}: ${complete.debuts} debut, ${
              complete.processed - complete.debuts
            } untrusted`,
          )),
        Match.tag('TrustIdle', () => reporter.note(TRUST_IDLE)),
        Match.exhaustive,
      )
    }).pipe(
      Effect.matchEffect({
        onFailure: (refusal) => refuse(trustFailureText(refusal)),
        onSuccess: () => Effect.void,
      }),
    ),
)

const npm = Command.make('npm').pipe(
  Command.withDescription('Publish packages to npm and manage trusted publishing'),
  Command.withSubcommands([publish, status, trust]),
)

NodeRuntime.runMain(Effect.provide(program(npm, VERSION), rootLive))
