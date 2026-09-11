import { Reporter } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import {
  publishPackagesCell,
  stageNpmTrustCell,
  type StatusMode,
  type StatusReport,
} from '@systemfsoftware/npm-publish-engine'
import type { GitPort, PackageName } from '@systemfsoftware/release-language'
import { Clock, Effect, FileSystem, Option } from 'effect'
import * as Match from 'effect/Match'
import type { BoundaryRefusal } from './boundary.schema.js'
import {
  type PublishFailure,
  publishFailureText,
  type StatusFailure,
  statusFailureText,
  type TrustFailure,
  trustFailureText,
} from './refusal.js'
import {
  bootstrapInstructionsText,
  CHECK_OK,
  deferredNamesText,
  filterFlagsText,
  PREFLIGHT_OK,
  PUBLISH_NOTHING_OWED,
  statusReportText,
  TRUST_IDLE,
  workspaceCommandText,
} from './render.js'
import { type StatusOutputMode, type StatusTargets, writeEmitFile } from './request.js'
import { originSlug } from './workspace.js'

type CellOutput<C> = C extends Cell.Cell<infer _Input, infer Output, infer _Refusal, infer _Services> ? Output : never

export interface StatusOutcome {
  readonly report: StatusReport
  readonly output: StatusOutputMode
  readonly targets: StatusTargets
  readonly registry: string
  readonly check: boolean
}

const refuse = (text: string): Effect.Effect<void, never, Reporter> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    yield* reporter.annotateError(text)
    yield* reporter.exitCode(1)
  })

export const refusePublish = (refusal: PublishFailure): Effect.Effect<void, never, Reporter> =>
  refuse(publishFailureText(refusal))

export const refuseTrust = (refusal: TrustFailure): Effect.Effect<void, never, Reporter> =>
  refuse(trustFailureText(refusal))

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

export const refuseStatus = (
  refusal: StatusFailure,
  mode: StatusMode,
): Effect.Effect<void, never, Reporter | GitPort> =>
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

export const announcePublish = (
  decision: CellOutput<typeof publishPackagesCell>,
): Effect.Effect<void, never, Reporter> =>
  Effect.flatMap(Reporter, (reporter) =>
    Match.value(decision).pipe(
      Match.tag('PublishDispatched', (dispatched) => reporter.note(workspaceCommandText(dispatched.command))),
      Match.tag('PublishDryRun', (preview) => reporter.emit(workspaceCommandText(preview.command))),
      Match.tag('PublishNothingOwed', () => reporter.emit(PUBLISH_NOTHING_OWED)),
      Match.exhaustive,
    ))

export const announceTrust = (
  decision: CellOutput<typeof stageNpmTrustCell>,
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

export const announceStatus = (
  outcome: StatusOutcome,
): Effect.Effect<void, BoundaryRefusal, Reporter | FileSystem.FileSystem> =>
  Effect.flatMap(Reporter, (reporter) =>
    Match.value(outcome.output).pipe(
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
      Match.orElse(() =>
        Effect.gen(function*() {
          const now = yield* Clock.currentTimeMillis
          yield* reporter.emit(statusReportText(outcome.report, outcome.registry, new Date(now).toISOString()))
          yield* Match.value(outcome.check).pipe(
            Match.when(true, () => reporter.emit(CHECK_OK)),
            Match.orElse(() => Effect.void),
          )
        })
      ),
    ))
