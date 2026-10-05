import { Reporter, type WorkspaceRootNotAbsolute } from '@systemfsoftware/cli-adapter'
import type {
  ChangelogRefusal,
  CommandRefusal,
  ConfigRefusal,
  IntentRefusal,
  MemberRefusal,
  RelativePath,
  VersionRefusal,
} from '@systemfsoftware/release-language'
import type {
  PinDecision,
  PinRefusal,
  SyncDecision,
  SyncRefusal,
  SyncSurfacesDrifted,
  VersionDecision,
} from '@systemfsoftware/version-engine'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import type { SchemaError } from 'effect/Schema'
import type { ManifestPathRefused, SyncActionMissing } from './refusal.schema.js'

export type AppRefusal =
  | WorkspaceRootNotAbsolute
  | ManifestPathRefused
  | SyncActionMissing
  | ConfigRefusal
  | IntentRefusal
  | MemberRefusal
  | VersionRefusal
  | ChangelogRefusal
  | CommandRefusal
  | PinRefusal
  | SchemaError

type SyncOutcomeRefusal = SyncRefusal | VersionRefusal | SchemaError

const fields = (tag: string, entries: ReadonlyArray<readonly [string, string]>): string =>
  `${tag}: ${entries.map(([key, value]) => `${key}=${value}`).join(' ')}`

const refuse = (line: string): Effect.Effect<void, never, Reporter> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    yield* reporter.annotateError(line)
    yield* reporter.exitCode(1)
  })

const driftRefusal = (
  drifted: SyncSurfacesDrifted,
  manifest: RelativePath,
): Effect.Effect<void, never, Reporter> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    yield* Effect.forEach(
      drifted.diffs,
      (diff) => reporter.annotateError(`${diff.path} ${diff.found} != ${manifest} ${drifted.expected}`),
      { discard: true },
    )
    yield* reporter.note('')
    yield* reporter.note('Run `version sync bump <version>` to bring every surface into line.')
    yield* reporter.annotateError(
      `${drifted.diffs.length} surface(s) drifted from ${manifest} at ${drifted.expected}`,
    )
    yield* reporter.exitCode(1)
  })

export const renderVersionDecision = (
  decision: VersionDecision,
): Effect.Effect<void, never, Reporter> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    yield* Match.value(decision).pipe(
      Match.tagsExhaustive({
        VersionBumped: () => reporter.emit('versioned packages'),
        VersionConsumed: () => reporter.emit('consumed intents without a version bump'),
        VersionIdle: () => reporter.note('no change intents; nothing to version'),
      }),
    )
  })

export const renderSyncDecision = (decision: SyncDecision): Effect.Effect<void, never, Reporter> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    yield* Match.value(decision).pipe(
      Match.tagsExhaustive({
        SyncAligned: (aligned) =>
          reporter.emit(`sync-versions: ok — ${aligned.version} across the manifest and every surface`),
        SyncRealigned: (realigned) => reporter.emit(`bumped to ${realigned.version}`),
      }),
    )
  })

export const renderPinDecision = (
  decision: PinDecision,
  manifest: RelativePath,
  dryRun: boolean,
): Effect.Effect<void, never, Reporter> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    yield* Match.value(decision).pipe(
      Match.tagsExhaustive({
        WorkspaceVersionAlreadyCurrent: (current) =>
          reporter.emit(`unchanged — ${current.pins.length} pin(s) already at ${current.version}`),
        WorkspaceVersionRepinned: (pinned) =>
          Effect.gen(function*() {
            if (dryRun) {
              yield* reporter.emit(pinned.text)
              return
            }
            yield* reporter.note(
              `pinned ${pinned.pins.length} platform package(s) at ${pinned.version} in ${manifest}`,
            )
            yield* reporter.emit(`synced ${manifest}`)
          }),
      }),
    )
  })

export const renderRefusal = (refusal: AppRefusal): Effect.Effect<void, never, Reporter> =>
  Match.value(refusal).pipe(
    Match.tagsExhaustive({
      WorkspaceRootNotAbsolute: (notAbsolute) => refuse(`cannot read workspace root ${notAbsolute.given}`),
      ManifestPathRefused: (refusedPath) =>
        refuse(
          `sync-root-manifest: --manifest must name a file inside the repository (got ${refusedPath.given})`,
        ),
      SyncActionMissing: () => refuse('usage: sync-versions.ts <check|bump> [version]'),
      ConfigUnreadable: (unreadable) => refuse(fields('ConfigUnreadable', [['path', unreadable.path]])),
      ConfigMalformed: (malformed) =>
        refuse(fields('ConfigMalformed', [['path', malformed.path], ['reason', malformed.reason]])),
      ConfigFieldMissing: (missing) =>
        refuse(fields('ConfigFieldMissing', [['path', missing.path], ['field', missing.field]])),
      ConfigFieldInvalid: (invalid) =>
        refuse(
          fields('ConfigFieldInvalid', [
            ['path', invalid.path],
            ['field', invalid.field],
            ['reason', invalid.reason],
          ]),
        ),
      IntentFrontmatterMalformed: (malformed) =>
        refuse(fields('IntentFrontmatterMalformed', [['path', malformed.path]])),
      IntentUnknownPackage: (unknown) => refuse(fields('IntentUnknownPackage', [['package', unknown.package]])),
      IntentSlugTaken: (taken) => refuse(fields('IntentSlugTaken', [['slug', taken.slug]])),
      ManifestUnreadable: (unreadable) => refuse(fields('ManifestUnreadable', [['path', unreadable.path]])),
      ManifestInvalid: (invalid) =>
        refuse(fields('ManifestInvalid', [['path', invalid.path], ['reason', invalid.reason]])),
      VersionIntentMalformed: (malformed) => refuse(fields('VersionIntentMalformed', [['path', malformed.path]])),
      VersionUnknownPackage: (unknown) => refuse(fields('VersionUnknownPackage', [['package', unknown.package]])),
      VersionSurfaceMissing: (missing) => refuse(fields('VersionSurfaceMissing', [['path', missing.path]])),
      RootManifestUnwritable: (unwritable) => refuse(fields('RootManifestUnwritable', [['path', unwritable.path]])),
      ChangelogUnreadable: (unreadable) => refuse(fields('ChangelogUnreadable', [['path', unreadable.path]])),
      ChangelogUnwritable: (unwritable) =>
        refuse(
          fields('ChangelogUnwritable', [
            ['path', unwritable.path],
            ['reason', unwritable.reason],
          ]),
        ),
      CommandRefused: (command) =>
        refuse(
          fields('CommandRefused', [
            ['command', `${command.command.program} ${command.command.args.join(' ')}`],
            ['reason', command.reason],
          ]),
        ),
      PinVersionUnusable: (unusable) =>
        refuse(
          `sync-root-manifest: invalid version ${JSON.stringify(unusable.given)} — pass --version x.y.z`,
        ),
      PinDistributionMissing: () =>
        refuse(
          'sync-root-manifest needs a "distribution" block — this repository ships no platform packages',
        ),
      PinManifestInvalid: (invalid) =>
        refuse(fields('PinManifestInvalid', [['path', invalid.path], ['reason', invalid.reason]])),
      SchemaError: (schema) => refuse(fields('SchemaError', [['message', schema.message]])),
    }),
  )

export const renderSyncRefusal = (
  refusal: SyncOutcomeRefusal,
  manifest: RelativePath,
): Effect.Effect<void, never, Reporter> =>
  Match.value(refusal).pipe(
    Match.tagsExhaustive({
      SyncSurfacesDrifted: (drifted) => driftRefusal(drifted, manifest),
      SyncStrategyMismatch: () => refuse('sync-versions only applies to a "surfaces" versioning config'),
      SyncVersionMissing: () => refuse('usage: sync-versions.ts bump <version>'),
      SyncActionUnknown: () => refuse('usage: sync-versions.ts <check|bump> [version]'),
      VersionIntentMalformed: (malformed) => refuse(fields('VersionIntentMalformed', [['path', malformed.path]])),
      VersionUnknownPackage: (unknown) => refuse(fields('VersionUnknownPackage', [['package', unknown.package]])),
      VersionSurfaceMissing: (missing) => refuse(fields('VersionSurfaceMissing', [['path', missing.path]])),
      RootManifestUnwritable: (unwritable) => refuse(fields('RootManifestUnwritable', [['path', unwritable.path]])),
      SchemaError: (schema) => refuse(fields('SchemaError', [['message', schema.message]])),
    }),
  )
