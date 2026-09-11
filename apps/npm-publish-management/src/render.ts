import { Reporter, type WorkspaceRootNotAbsolute } from '@systemfsoftware/cli-adapter'
import type {
  PublishStatusRefusal,
  PublishWorkflowDecision,
  StatusMode,
  StatusReport,
  StatusRow,
  TrustWorkflowDecision,
} from '@systemfsoftware/npm-publish-engine'
import type {
  ConfigRefusal,
  GitPort,
  MemberRefusal,
  PackageName,
  PlanRefusal,
  PublishRefusal,
  RepoSlug,
  StatusClass,
  TrustRefusal,
  WorkspaceCommand,
} from '@systemfsoftware/release-language'
import { Clock, Effect, FileSystem, Option } from 'effect'
import * as Match from 'effect/Match'
import { originSlug, slugText, type StatusOutputMode, type StatusTargets, writeEmitFile } from './boundary.js'
import type { BoundaryRefusal } from './boundary.schema.js'

const PUBLISH_NOTHING_OWED = 'every captured version is already on npm — nothing to publish'
const TRUST_IDLE = 'every package is published and attested — nothing to do'
const PREFLIGHT_OK = '\nPREFLIGHT OK: every publishable package exists on the registry.'
const CHECK_OK = '\nOK: every package is published and carries provenance attestations.'

const DEBUT_GUIDANCE = 'OIDC cannot debut a package; bootstrap each one, then re-run.'

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

const errorLineOf = (count: number): ReadonlyArray<string> => {
  if (count > 0) return [`  error:       ${count}`]
  return []
}

const statusReportText = (report: StatusReport, registry: string, timestamp: string): string => {
  const sections = STATUS_ORDER.flatMap((klass) => [
    STATUS_HEADINGS[klass],
    ...rowsIn(report.rows, klass).map(statusRowText),
    '',
  ])
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
    ...errorLineOf(rowsIn(report.rows, 'error').length),
  ].join('\n')
}

const listText = (lines: ReadonlyArray<string>): string => {
  if (lines.length === 0) return ''
  return `${lines.join('\n')}\n`
}

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

interface RefusalLine {
  readonly line: string
  readonly bootstraps: ReadonlyArray<PackageName>
}

const refusalLine = (line: string): RefusalLine => ({ line, bootstraps: [] })

const preflightFailedText = (summary: string): string => `preflight failed — ${summary}. ${DEBUT_GUIDANCE}`

const configRefusalLine = (refusal: ConfigRefusal): RefusalLine =>
  Match.value(refusal).pipe(
    Match.tagsExhaustive({
      ConfigUnreadable: (unreadable) => refusalLine(`${unreadable.path}: cannot be read`),
      ConfigMalformed: (malformed) => refusalLine(`${malformed.path}: ${malformed.reason}`),
      ConfigFieldMissing: (missing) => refusalLine(`${missing.path}: missing field ${missing.field}`),
      ConfigFieldInvalid: (invalid) =>
        refusalLine(`${invalid.path}: invalid field ${invalid.field}: ${invalid.reason}`),
    }),
  )

const rootRefusalLine = (refusal: WorkspaceRootNotAbsolute): RefusalLine =>
  refusalLine(`workspace root "${refusal.given}" is not an absolute path`)

const boundaryRefusalLine = (refusal: BoundaryRefusal): RefusalLine =>
  Match.value(refusal).pipe(
    Match.tagsExhaustive({
      RequestInvalid: (invalid) => refusalLine(invalid.reason),
      EmitUnwritable: (unwritable) => refusalLine(`${unwritable.path}: ${unwritable.reason}`),
    }),
  )

const planRefusalLine = (refusal: PlanRefusal): RefusalLine =>
  Match.value(refusal).pipe(
    Match.tagsExhaustive({
      PlanDeferredUnknown: (unknown) => refusalLine(`unknown deferred packages: ${unknown.packages.join(', ')}`),
      PlanCapturedMalformed: (malformed) => refusalLine(`${malformed.path}: captured file is malformed or unreadable`),
    }),
  )

const publishRefusalLine = (refusal: PublishRefusal): RefusalLine =>
  Match.value(refusal).pipe(
    Match.tagsExhaustive({
      PublishCapturedRequired: () =>
        refusalLine('--unpublished needs --captured <file> to know which versions this cycle owns'),
      PublishFiltersUnreadable: (unreadable) => refusalLine(`${unreadable.path}: unable to read filters file`),
      PublishCommandRefused: (refused) => refusalLine(refused.reason),
    }),
  )

const memberRefusalLine = (refusal: MemberRefusal): RefusalLine =>
  Match.value(refusal).pipe(
    Match.tagsExhaustive({
      ManifestUnreadable: (unreadable) => refusalLine(`${unreadable.path}: unable to read package manifest`),
      ManifestInvalid: (invalid) => refusalLine(`${invalid.path}: ${invalid.reason}`),
    }),
  )

const trustRefusalLine = (refusal: TrustRefusal): RefusalLine =>
  Match.value(refusal).pipe(
    Match.tagsExhaustive({
      TrustOnlyUnmatched: (unmatched) =>
        refusalLine(`--only matched no publishable package: ${unmatched.only.join(', ')}`),
      TrustWorkspaceEmpty: () => refusalLine('no publishable packages discovered (did the workspace resolve?)'),
      TrustRegistryUnreadable: (unreadable) => refusalLine(`registry unreadable: ${unreadable.packages.join(', ')}`),
      TrustPublishRefused: (refused) => refusalLine(`failed: ${refused.packages.join(', ')}`),
      TrustLauncherMissing: (missing) =>
        refusalLine(`${missing.package} needs a distribution launcher manifest to be staged`),
    }),
  )

const statusRefusalLine = (refusal: PublishStatusRefusal, mode: StatusMode): RefusalLine =>
  Match.value(refusal).pipe(
    Match.tagsExhaustive({
      PublishStatusEmpty: () => refusalLine('no publishable packages discovered — did the workspace resolve?'),
      PublishStatusUnreadable: (unreadable) => {
        if (mode === 'preflight') {
          return refusalLine(
            preflightFailedText(`0 package(s) have never been published, ${unreadable.packages.length} unqueryable`),
          )
        }
        if (mode === 'check') {
          return refusalLine(
            `FAIL: 0 unpublished, 0 without OIDC attestation, ${unreadable.packages.length} unqueryable`,
          )
        }
        return refusalLine(`registry unreadable: ${unreadable.packages.join(', ')}`)
      },
      PublishStatusUnpublished: (unpublished) => {
        if (mode === 'preflight') {
          return {
            line: preflightFailedText(
              `${unpublished.packages.length} package(s) have never been published, 0 unqueryable`,
            ),
            bootstraps: unpublished.packages,
          }
        }
        return refusalLine(
          `FAIL: ${unpublished.packages.length} unpublished, 0 without OIDC attestation, 0 unqueryable`,
        )
      },
      PublishStatusUnattested: (unattested) =>
        refusalLine(
          `FAIL: 0 unpublished, ${unattested.packages.length} without OIDC attestation, 0 unqueryable`,
        ),
    }),
  )

type PublishFailure =
  | ConfigRefusal
  | WorkspaceRootNotAbsolute
  | BoundaryRefusal
  | PlanRefusal
  | PublishRefusal
  | TrustRefusal

type StatusFailure =
  | ConfigRefusal
  | WorkspaceRootNotAbsolute
  | BoundaryRefusal
  | MemberRefusal
  | TrustRefusal
  | PublishStatusRefusal

type TrustFailure =
  | ConfigRefusal
  | WorkspaceRootNotAbsolute
  | BoundaryRefusal
  | MemberRefusal
  | TrustRefusal

const sharedRefusalLines = {
  ConfigUnreadable: configRefusalLine,
  ConfigMalformed: configRefusalLine,
  ConfigFieldMissing: configRefusalLine,
  ConfigFieldInvalid: configRefusalLine,
  WorkspaceRootNotAbsolute: rootRefusalLine,
  RequestInvalid: boundaryRefusalLine,
  EmitUnwritable: boundaryRefusalLine,
  TrustOnlyUnmatched: trustRefusalLine,
  TrustWorkspaceEmpty: trustRefusalLine,
  TrustRegistryUnreadable: trustRefusalLine,
  TrustPublishRefused: trustRefusalLine,
  TrustLauncherMissing: trustRefusalLine,
}

const memberRefusalLines = {
  ManifestUnreadable: memberRefusalLine,
  ManifestInvalid: memberRefusalLine,
}

const planAndPublishRefusalLines = {
  PlanDeferredUnknown: planRefusalLine,
  PlanCapturedMalformed: planRefusalLine,
  PublishCapturedRequired: publishRefusalLine,
  PublishFiltersUnreadable: publishRefusalLine,
  PublishCommandRefused: publishRefusalLine,
}

const publishFailureLine = (refusal: PublishFailure): RefusalLine =>
  Match.value(refusal).pipe(Match.tagsExhaustive({ ...sharedRefusalLines, ...planAndPublishRefusalLines }))

const trustFailureLine = (refusal: TrustFailure): RefusalLine =>
  Match.value(refusal).pipe(Match.tagsExhaustive({ ...sharedRefusalLines, ...memberRefusalLines }))

const statusFailureLine = (refusal: StatusFailure, mode: StatusMode): RefusalLine =>
  Match.value(refusal).pipe(
    Match.tagsExhaustive({
      ...sharedRefusalLines,
      ...memberRefusalLines,
      PublishStatusEmpty: (status) => statusRefusalLine(status, mode),
      PublishStatusUnreadable: (status) => statusRefusalLine(status, mode),
      PublishStatusUnpublished: (status) => statusRefusalLine(status, mode),
      PublishStatusUnattested: (status) => statusRefusalLine(status, mode),
    }),
  )

const refuse = (rendered: RefusalLine): Effect.Effect<void, never, Reporter> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    yield* reporter.annotateError(rendered.line)
    yield* reporter.exitCode(1)
  })

export const refusePublish = (refusal: PublishFailure): Effect.Effect<void, never, Reporter> =>
  refuse(publishFailureLine(refusal))

export const refuseTrust = (refusal: TrustFailure): Effect.Effect<void, never, Reporter> =>
  refuse(trustFailureLine(refusal))

export const refuseStatus = (
  refusal: StatusFailure,
  mode: StatusMode,
): Effect.Effect<void, never, Reporter | GitPort> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    const rendered = statusFailureLine(refusal, mode)
    yield* reporter.annotateError(rendered.line)
    if (rendered.bootstraps.length > 0) {
      const slug = yield* originSlug()
      yield* reporter.note(bootstrapInstructionsText(rendered.bootstraps, slug))
    }
    yield* reporter.exitCode(1)
  })

export const announcePublish = (decision: PublishWorkflowDecision): Effect.Effect<void, never, Reporter> =>
  Effect.flatMap(Reporter, (reporter) =>
    Match.value(decision).pipe(
      Match.tag('PublishDispatched', (dispatched) => reporter.note(workspaceCommandText(dispatched.command))),
      Match.tag('PublishDryRun', (preview) => reporter.emit(workspaceCommandText(preview.command))),
      Match.tag('PublishNothingOwed', () => reporter.emit(PUBLISH_NOTHING_OWED)),
      Match.exhaustive,
    ))

export const announceTrust = (
  decision: TrustWorkflowDecision,
  jobs: number,
): Effect.Effect<void, never, Reporter> =>
  Effect.flatMap(Reporter, (reporter) =>
    Match.value(decision).pipe(
      Match.tag('TrustComplete', (complete) =>
        reporter.note(
          `processing ${complete.processed} package(s) with --jobs ${jobs}: ${complete.debuts} debut, ${
            complete.processed - complete.debuts
          } untrusted`,
        )),
      Match.tag('TrustIdle', () => reporter.note(TRUST_IDLE)),
      Match.exhaustive,
    ))

interface StatusOutcome {
  readonly report: StatusReport
  readonly output: StatusOutputMode
  readonly targets: StatusTargets
  readonly registry: string
  readonly check: boolean
}

export const announceStatus = (
  outcome: StatusOutcome,
): Effect.Effect<void, BoundaryRefusal, Reporter | FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    yield* Match.value(outcome.output).pipe(
      Match.when('emit-files', () =>
        Effect.gen(function*() {
          yield* Option.match(outcome.targets.filters, {
            onNone: () => Effect.void,
            onSome: (target) =>
              Effect.gen(function*() {
                yield* writeEmitFile(target, filterFlagsText(outcome.report.deferred))
                yield* reporter.note(`wrote ${outcome.report.deferred.length} filter(s) to ${target}`)
              }),
          })
          yield* Option.match(outcome.targets.deferred, {
            onNone: () => Effect.void,
            onSome: (target) =>
              Effect.gen(function*() {
                yield* writeEmitFile(target, deferredNamesText(outcome.report.deferred))
                yield* reporter.note(`wrote ${outcome.report.deferred.length} deferred name(s) to ${target}`)
              }),
          })
          yield* Effect.forEach(
            outcome.report.deferred,
            (name) => reporter.note(`  deferred: ${name}`),
            { discard: true },
          )
        })),
      Match.when(
        'json',
        () => Effect.forEach(outcome.report.rows, (row) => reporter.emit(JSON.stringify(row)), { discard: true }),
      ),
      Match.when('preflight', () => reporter.emit(PREFLIGHT_OK)),
      Match.when('report', () =>
        Effect.gen(function*() {
          const now = yield* Clock.currentTimeMillis
          yield* reporter.emit(statusReportText(outcome.report, outcome.registry, new Date(now).toISOString()))
          if (outcome.check) {
            yield* reporter.emit(CHECK_OK)
          }
        })),
      Match.exhaustive,
    )
  })
