#!/usr/bin/env -S deno run --allow-read --allow-write=/tmp --allow-run=git,pnpm,npm,corepack --allow-net=registry.npmjs.org --allow-env
import { DenoRuntime } from '@effect/platform-deno'
import { parse as parseJsonc } from '@std/jsonc'
import { join } from '@std/path'
import { program, Reporter } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import {
  bootstrapNpmTrustCell,
  publishPackagesCell,
  PublishRequest,
  publishStatusCell,
  StatusRequest,
  TrustRequest,
} from '@systemfsoftware/npm-publish-engine'
import { ProcessLive } from '@systemfsoftware/process-adapter'
import { RegistryConfig, RegistryLive } from '@systemfsoftware/registry-adapter'
import * as Lang from '@systemfsoftware/release-language'
import type {
  CycleStore,
  ProcessPort,
  RegistryPort,
  RepoRoot,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { CycleStoreLive, WorkspaceStoreLive } from '@systemfsoftware/workspace-adapter'
import { Effect, Layer, Option } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import { Command, Flag } from 'effect/unstable/cli'
interface MainLiveOptions {
  readonly root: RepoRoot
  readonly baseUrl: string
}

const makeMainLive = (
  options: MainLiveOptions,
): Layer.Layer<RegistryPort | ProcessPort | WorkspaceStore | CycleStore, never, never> =>
  Layer.mergeAll(
    WorkspaceStoreLive(options.root),
    CycleStoreLive,
    ProcessLive,
    Layer.provide(
      RegistryLive,
      Layer.mergeAll(
        Layer.succeed(RegistryConfig, { baseUrl: options.baseUrl, root: options.root }),
        ProcessLive,
      ),
    ),
  )

const DEFAULT_REGISTRY = 'https://registry.npmjs.org'

const loadBoundary = (configFlag: Option.Option<string>) =>
  Effect.gen(function*() {
    const root = yield* S.decodeUnknownEffect(Lang.RepoRoot)(Deno.cwd()).pipe(Effect.orDie)
    const configPath = Option.getOrUndefined(configFlag) ?? join(root, 'release.jsonc')
    const text = yield* Effect.tryPromise({
      try: () => Deno.readTextFile(configPath),
      catch: (cause) => new Error(`${configPath}: ${cause instanceof Error ? cause.message : String(cause)}`),
    })
    let parsed: unknown
    try {
      parsed = parseJsonc(text)
    } catch (cause) {
      return yield* Effect.fail(
        new Error(`${configPath}: ${cause instanceof Error ? cause.message : String(cause)}`),
      )
    }
    const config = yield* S.decodeUnknownEffect(Lang.ReleaseConfig)(parsed).pipe(
      Effect.mapError((cause) => new Error(`${configPath}: ${cause.message}`)),
    )
    return { root, config }
  })

const resolveSlug: Effect.Effect<string, never, never> = Effect.gen(function*() {
  const output = yield* Effect.option(Effect.tryPromise({
    try: () =>
      new Deno.Command('git', {
        args: ['config', '--get', 'remote.origin.url'],
        stdout: 'piped',
        stderr: 'piped',
      }).output(),
    catch: (cause) => cause,
  }))
  if (Option.isNone(output) || !output.value.success) return 'unknown/unknown'
  const raw = new TextDecoder().decode(output.value.stdout).trim().replace(/\.git$/, '')
  const ssh = raw.match(/^[^@]+@[^:]+:(.+)$/)
  const path = (ssh?.[1] ?? raw.replace(/^https?:\/\/[^/]+\//, '')).replace(/^\/+/, '')
  const parts = path.split('/').filter((part) => part.length > 0)
  if (parts.length < 2) return 'unknown/unknown'
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
})

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
      const { root, config: resolved } = yield* loadBoundary(config)
      const registryValue = Option.getOrUndefined(registry) ?? resolved.registry ?? DEFAULT_REGISTRY
      const filtersPath = Option.getOrUndefined(filters)
      const filtersText = filtersPath === undefined
        ? undefined
        : yield* Effect.tryPromise({
          try: () => Deno.readTextFile(filtersPath),
          catch: (cause) => new Error(`${filtersPath}: ${cause instanceof Error ? cause.message : String(cause)}`),
        })
      const request = yield* S.decodeUnknownEffect(PublishRequest)({
        capturedPath: Option.getOrUndefined(captured) ?? Option.getOrUndefined(capturedFile),
        unpublishedOnly: unpublished,
        filtersPath,
        filtersText,
        registry: registryValue,
        provenance: !noProvenance && resolved.provenance,
        publishArgs: [...resolved.publishArgs],
        dryRun,
      }).pipe(Effect.mapError((cause) => new Error(cause.message)))
      const runnable = Cell.provide(publishPackagesCell, makeMainLive({ root, baseUrl: registryValue }))
      const decision = yield* Cell.run(runnable, request).pipe(
        Effect.mapError((refusal): Error =>
          Match.value(refusal).pipe(
            Match.tag(
              'PublishCapturedRequired',
              () =>
                new Error(
                  '--unpublished needs --captured <file> to know which versions this cycle owns',
                ),
            ),
            Match.tag(
              'PublishFiltersUnreadable',
              (unreadable) => new Error(`${unreadable.path}: unable to read filters file`),
            ),
            Match.tag('PublishCommandRefused', (refused) => new Error(refused.reason)),
            Match.tag(
              'PlanCapturedMalformed',
              (malformed) => new Error(`${malformed.path}: captured file is malformed or unreadable`),
            ),
            Match.tag(
              'PlanDeferredUnknown',
              (unknown) => new Error(`unknown deferred packages: ${unknown.packages.join(', ')}`),
            ),
            Match.tag(
              'TrustRegistryUnreadable',
              (unreadable) => new Error(`registry unreadable: ${unreadable.packages.join(', ')}`),
            ),
            Match.tag(
              'TrustOnlyUnmatched',
              (unmatched) => new Error(`--only matched no publishable package: ${unmatched.only.join(', ')}`),
            ),
            Match.tag(
              'TrustWorkspaceEmpty',
              () => new Error('no publishable packages discovered (did the workspace resolve?)'),
            ),
            Match.tag('TrustPublishRefused', (refused) => new Error(`failed: ${refused.packages.join(', ')}`)),
            Match.tag(
              'TrustLauncherMissing',
              (missing) => new Error(`${missing.package} needs a distribution launcher manifest to be staged`),
            ),
            Match.exhaustive,
          )
        ),
      )
      yield* Match.value(decision).pipe(
        Match.tag(
          'PublishDispatched',
          (dispatched) => reporter.note(`${dispatched.command.program} ${dispatched.command.args.join(' ')}`),
        ),
        Match.tag(
          'PublishDryRun',
          (preview) => reporter.emit(`${preview.command.program} ${preview.command.args.join(' ')}`),
        ),
        Match.tag(
          'PublishNothingOwed',
          () => reporter.emit('every captured version is already on npm — nothing to publish'),
        ),
        Match.exhaustive,
      )
    }),
)

interface StatusRowView {
  readonly name: string
  readonly local_version: string
  readonly npm_latest: string
  readonly class: string
  readonly publishConfig_provenance: 'yes' | 'no'
}

const statusHeadings: Readonly<Record<string, string>> = {
  unpublished: '== UNPUBLISHED (404 on npm) ==',
  'no-oidc': '== PUBLISHED, NO OIDC ATTESTATION (latest has no provenance; trusted publisher likely unconfigured) ==',
  stuck: '== PUBLISHED + ATTESTED, BUT LOCAL AHEAD (stuck — versioned but not landed) ==',
  ok: '== PUBLISHED + ATTESTED, CURRENT ==',
}

const renderStatusReport = (rows: ReadonlyArray<StatusRowView>, registry: string): string => {
  const of = (klass: string) => rows.filter((row) => row.class === klass)
  const lines: Array<string> = [
    `npm publish status — ${new Date().toISOString()} — registry: ${registry}`,
    `packages: ${rows.length}`,
    '',
  ]
  for (const key of ['unpublished', 'no-oidc', 'stuck', 'ok']) {
    lines.push(statusHeadings[key])
    for (const row of of(key)) {
      lines.push(
        `  ${row.name.padEnd(55)} local ${row.local_version.padEnd(8)} npm ${
          row.npm_latest.padEnd(10)
        } provenance:${row.publishConfig_provenance}`,
      )
    }
    lines.push('')
  }
  lines.push(
    '== summary ==',
    `  unpublished: ${of('unpublished').length}`,
    `  no-oidc:     ${of('no-oidc').length}`,
    `  stuck:       ${of('stuck').length}`,
    `  ok:          ${of('ok').length}`,
  )
  if (of('error').length > 0) lines.push(`  error:       ${of('error').length}`)
  return lines.join('\n')
}

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
  ({ json, preflight, check, emitFilters, emitDeferred, registry, config }) =>
    Effect.gen(function*() {
      const reporter = yield* Reporter
      const { root, config: resolved } = yield* loadBoundary(config)
      const registryValue = Option.getOrUndefined(registry) ?? resolved.registry ?? DEFAULT_REGISTRY
      const request = yield* S.decodeUnknownEffect(StatusRequest)({
        mode: preflight ? 'preflight' : check ? 'check' : 'report',
      }).pipe(Effect.mapError((cause) => new Error(cause.message)))
      const runnable = Cell.provide(publishStatusCell, makeMainLive({ root, baseUrl: registryValue }))
      const report = yield* Cell.run(runnable, request).pipe(
        Effect.mapError((refusal): Error =>
          Match.value(refusal).pipe(
            Match.tag(
              'PublishStatusEmpty',
              () => new Error('no publishable packages discovered — did the workspace resolve?'),
            ),
            Match.tag('PublishStatusUnreadable', (unreadable) =>
              new Error(
                preflight
                  ? `preflight failed — 0 package(s) have never been published, ${unreadable.packages.length} unqueryable. OIDC cannot debut a package; bootstrap each one, then re-run.`
                  : check
                  ? `FAIL: 0 unpublished, 0 without OIDC attestation, ${unreadable.packages.length} unqueryable`
                  : `registry unreadable: ${unreadable.packages.join(', ')}`,
              )),
            Match.tag(
              'PublishStatusUnpublished',
              (unpublished) =>
                new Error(
                  preflight
                    ? `preflight failed — ${unpublished.packages.length} package(s) have never been published, 0 unqueryable. OIDC cannot debut a package; bootstrap each one, then re-run.`
                    : `FAIL: ${unpublished.packages.length} unpublished, 0 without OIDC attestation, 0 unqueryable`,
                ),
            ),
            Match.tag(
              'PublishStatusUnattested',
              (unattested) =>
                new Error(
                  `FAIL: 0 unpublished, ${unattested.packages.length} without OIDC attestation, 0 unqueryable`,
                ),
            ),
            Match.tag(
              'ManifestUnreadable',
              (unreadable) => new Error(`${unreadable.path}: unable to read package manifest`),
            ),
            Match.tag('ManifestInvalid', (invalid) => new Error(`${invalid.path}: ${invalid.reason}`)),
            Match.tag(
              'TrustRegistryUnreadable',
              (unreadable) => new Error(`registry unreadable: ${unreadable.packages.join(', ')}`),
            ),
            Match.tag(
              'TrustOnlyUnmatched',
              (unmatched) => new Error(`--only matched no publishable package: ${unmatched.only.join(', ')}`),
            ),
            Match.tag(
              'TrustWorkspaceEmpty',
              () => new Error('no publishable packages discovered (did the workspace resolve?)'),
            ),
            Match.tag('TrustPublishRefused', (refused) => new Error(`failed: ${refused.packages.join(', ')}`)),
            Match.tag(
              'TrustLauncherMissing',
              (missing) => new Error(`${missing.package} needs a distribution launcher manifest to be staged`),
            ),
            Match.exhaustive,
          )
        ),
      )
      const filtersPath = Option.getOrUndefined(emitFilters)
      const deferredPath = Option.getOrUndefined(emitDeferred)
      if (filtersPath !== undefined || deferredPath !== undefined) {
        if (filtersPath !== undefined) {
          const text = report.deferred.length === 0
            ? ''
            : `${report.deferred.map((name) => `--filter=${name}`).join('\n')}\n`
          yield* Effect.tryPromise({
            try: () => Deno.writeTextFile(filtersPath, text),
            catch: (cause) => new Error(`${filtersPath}: ${cause instanceof Error ? cause.message : String(cause)}`),
          })
          yield* reporter.note(`wrote ${report.deferred.length} filter(s) to ${filtersPath}`)
        }
        if (deferredPath !== undefined) {
          const text = report.deferred.length === 0 ? '' : `${report.deferred.join('\n')}\n`
          yield* Effect.tryPromise({
            try: () => Deno.writeTextFile(deferredPath, text),
            catch: (cause) =>
              new Error(
                `${deferredPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
              ),
          })
          yield* reporter.note(`wrote ${report.deferred.length} deferred name(s) to ${deferredPath}`)
        }
        for (const name of report.deferred) yield* reporter.note(`  deferred: ${name}`)
        return
      }
      if (json) {
        for (const row of report.rows) yield* reporter.emit(JSON.stringify(row))
        return
      }
      if (preflight) {
        if (report.deferred.length === 0) {
          yield* reporter.emit('\nPREFLIGHT OK: every publishable package exists on the registry.')
          return
        }
        const slug = yield* resolveSlug
        yield* reporter.annotateError(
          `preflight failed — ${report.deferred.length} package(s) have never been published, 0 unqueryable. OIDC cannot debut a package; bootstrap each one, then re-run.`,
        )
        for (const name of report.deferred) {
          yield* reporter.note('')
          yield* reporter.note(`  ${name}`)
          yield* reporter.note(`    corepack pnpm --filter ${name} build`)
          yield* reporter.note(`    corepack pnpm --filter ${name} publish --access public --no-git-checks`)
          yield* reporter.note(
            `    npm trust github ${name} --repo ${slug} --file release.yml --allow-publish --yes`,
          )
        }
        yield* reporter.exitCode(1)
        return
      }
      yield* reporter.emit(renderStatusReport(report.rows, registryValue))
      if (check) {
        yield* reporter.emit('\nOK: every package is published and carries provenance attestations.')
      }
    }),
)

const trust = Command.make('trust', {
  dryRun: Flag.boolean('dry-run').pipe(Flag.withDefault(false)),
  only: Flag.string('only').pipe(Flag.withAlias('o'), Flag.optional),
  jobs: Flag.string('jobs').pipe(Flag.optional),
  file: Flag.string('file').pipe(Flag.optional),
  registry: Flag.string('registry').pipe(Flag.optional),
  config: Flag.string('config').pipe(Flag.optional),
}, ({ dryRun, only, jobs, file, registry, config }) =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    const { root, config: resolved } = yield* loadBoundary(config)
    const registryValue = Option.getOrUndefined(registry) ?? resolved.registry ?? DEFAULT_REGISTRY
    const jobsValue = Math.max(1, Number(Option.getOrUndefined(jobs) ?? '4') || 4)
    const slug = yield* resolveSlug
    const request = yield* S.decodeUnknownEffect(TrustRequest)({
      only: (Option.getOrUndefined(only) ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0),
      jobs: jobsValue,
      dryRun,
      registry: registryValue,
      workflowFile: Option.getOrUndefined(file),
      slug,
      launcherManifest: resolved.distribution?.launcherManifest,
    }).pipe(Effect.mapError((cause) => new Error(cause.message)))
    const runnable = Cell.provide(bootstrapNpmTrustCell, makeMainLive({ root, baseUrl: registryValue }))
    const decision = yield* Cell.run(runnable, request).pipe(
      Effect.mapError((refusal): Error =>
        Match.value(refusal).pipe(
          Match.tag(
            'TrustOnlyUnmatched',
            (unmatched) => new Error(`--only matched no publishable package: ${unmatched.only.join(', ')}`),
          ),
          Match.tag(
            'TrustWorkspaceEmpty',
            () => new Error('no publishable packages discovered (did the workspace resolve?)'),
          ),
          Match.tag(
            'TrustRegistryUnreadable',
            (unreadable) => new Error(`registry unreadable: ${unreadable.packages.join(', ')}`),
          ),
          Match.tag('TrustPublishRefused', (refused) => new Error(`failed: ${refused.packages.join(', ')}`)),
          Match.tag(
            'TrustLauncherMissing',
            (missing) => new Error(`${missing.package} needs a distribution launcher manifest to be staged`),
          ),
          Match.tag(
            'ManifestUnreadable',
            (unreadable) => new Error(`${unreadable.path}: unable to read package manifest`),
          ),
          Match.tag('ManifestInvalid', (invalid) => new Error(`${invalid.path}: ${invalid.reason}`)),
          Match.exhaustive,
        )
      ),
    )
    yield* Match.value(decision).pipe(
      Match.tag('TrustComplete', (complete) =>
        reporter.note(
          `processing ${complete.processed} package(s) with --jobs ${jobsValue}: ${complete.debuts} debut, ${
            complete.processed - complete.debuts
          } untrusted`,
        )),
      Match.tag('TrustIdle', () => reporter.note('every package is published and attested — nothing to do')),
      Match.exhaustive,
    )
  }))

const npm = Command.make('npm').pipe(
  Command.withDescription('Publish packages to npm and manage trusted publishing'),
  Command.withSubcommands([publish, status, trust]),
)

DenoRuntime.runMain(program(npm, '0.0.0'))
