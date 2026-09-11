import {
  type ChangelogRefusal,
  type ConfigRefusal,
  type IntentRefusal,
  type MemberRefusal,
  type PinDecision,
  type PinRefusal,
  type PublishRefusal,
  type RelativePath,
  type SyncActionUnknown,
  type SyncDecision,
  type SyncRefusal,
  type SyncStrategyMismatch,
  type SyncSurfacesDrifted,
  type SyncVersionMissing,
  type VersionDecision,
  type VersionRefusal,
} from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import type { Directive } from './directive.schema.js'
import type { ManifestPathRefused, SyncActionMissing, WorkspaceRootRefused } from './refusal.schema.js'

type EdgeRefusal = WorkspaceRootRefused | ManifestPathRefused | SyncActionMissing

type DeliveryRefusal =
  | PublishRefusal
  | PinRefusal
  | SyncStrategyMismatch
  | SyncVersionMissing
  | SyncActionUnknown
  | S.SchemaError

export type AppRefusal =
  | EdgeRefusal
  | ConfigRefusal
  | IntentRefusal
  | MemberRefusal
  | VersionRefusal
  | ChangelogRefusal
  | DeliveryRefusal

const refused = (...lines: ReadonlyArray<string>): ReadonlyArray<Directive> => [
  ...lines.map((line): Directive => ({ _tag: 'Fail', line })),
  { _tag: 'Exit', code: 1 },
]

const fields = (tag: string, entries: ReadonlyArray<readonly [string, string]>): string => {
  if (entries.length === 0) return tag
  return `${tag}: ${entries.map(([key, value]) => `${key}=${value}`).join(' ')}`
}

export const renderVersionDecision = (decision: VersionDecision): ReadonlyArray<Directive> =>
  Match.value(decision).pipe(
    Match.tag('VersionBumped', (): ReadonlyArray<Directive> => [
      { _tag: 'Say', line: 'versioned packages' },
    ]),
    Match.tag('VersionConsumed', (): ReadonlyArray<Directive> => [
      { _tag: 'Say', line: 'consumed intents without a version bump' },
    ]),
    Match.tag('VersionIdle', (): ReadonlyArray<Directive> => [
      { _tag: 'Note', line: 'no change intents; nothing to version' },
    ]),
    Match.exhaustive,
  )

export const renderSyncDecision = (decision: SyncDecision): ReadonlyArray<Directive> =>
  Match.value(decision).pipe(
    Match.tag('SyncAligned', (aligned): ReadonlyArray<Directive> => [
      { _tag: 'Say', line: `sync-versions: ok — ${aligned.version} across the manifest and every surface` },
    ]),
    Match.tag('SyncRealigned', (realigned): ReadonlyArray<Directive> => [
      { _tag: 'Say', line: `bumped to ${realigned.version}` },
    ]),
    Match.exhaustive,
  )

export const renderPinDecision = (
  decision: PinDecision,
  manifest: RelativePath,
  dryRun: boolean,
): ReadonlyArray<Directive> =>
  Match.value(decision).pipe(
    Match.tag('WorkspaceVersionAlreadyCurrent', (current): ReadonlyArray<Directive> => [
      { _tag: 'Say', line: `unchanged — ${current.pins.length} pin(s) already at ${current.version}` },
    ]),
    Match.tag('WorkspaceVersionRepinned', (pinned): ReadonlyArray<Directive> => {
      if (dryRun) return [{ _tag: 'Say', line: pinned.text }]
      return [
        {
          _tag: 'Note',
          line: `pinned ${pinned.pins.length} platform package(s) at ${pinned.version} in ${manifest}`,
        },
        { _tag: 'Say', line: `synced ${manifest}` },
      ]
    }),
    Match.exhaustive,
  )

const driftDirectives = (
  drifted: SyncSurfacesDrifted,
  manifest: RelativePath,
): ReadonlyArray<Directive> => [
  ...drifted.diffs.map((diff): Directive => ({
    _tag: 'Fail',
    line: `${diff.path} ${diff.found} != ${manifest} ${drifted.expected}`,
  })),
  { _tag: 'Note', line: '' },
  { _tag: 'Note', line: 'Run `version sync bump <version>` to bring every surface into line.' },
  {
    _tag: 'Fail',
    line: `${drifted.diffs.length} surface(s) drifted from ${manifest} at ${drifted.expected}`,
  },
  { _tag: 'Exit', code: 1 },
]

export const renderSyncRefusal = (
  refusal: SyncRefusal | VersionRefusal | S.SchemaError,
  manifest: RelativePath,
): ReadonlyArray<Directive> =>
  Match.value(refusal).pipe(
    Match.tag('SyncSurfacesDrifted', (drifted) => driftDirectives(drifted, manifest)),
    Match.orElse((rest) => renderRefusal(rest)),
  )

export const renderRefusal = (refusal: AppRefusal): ReadonlyArray<Directive> =>
  Match.value(refusal).pipe(
    Match.tag('WorkspaceRootRefused', (refusedRoot) =>
      refused(`cannot read workspace root ${refusedRoot.given}: ${refusedRoot.reason}`)),
    Match.tag('ManifestPathRefused', (refusedPath) =>
      refused(
        `sync-root-manifest: --manifest must name a file inside the repository (got ${refusedPath.given})`,
      )),
    Match.tag('SyncActionMissing', () =>
      refused('usage: sync-versions.ts <check|bump> [version]')),
    Match.tag('ConfigUnreadable', (unreadable) => refused(fields('ConfigUnreadable', [['path', unreadable.path]]))),
    Match.tag('ConfigMalformed', (malformed) =>
      refused(fields('ConfigMalformed', [['path', malformed.path], ['reason', malformed.reason]]))),
    Match.tag('ConfigFieldMissing', (missing) =>
      refused(fields('ConfigFieldMissing', [['path', missing.path], ['field', missing.field]]))),
    Match.tag('ConfigFieldInvalid', (invalid) =>
      refused(
        fields('ConfigFieldInvalid', [
          ['path', invalid.path],
          ['field', invalid.field],
          ['reason', invalid.reason],
        ]),
      )),
    Match.tag('IntentFrontmatterMalformed', (malformed) =>
      refused(fields('IntentFrontmatterMalformed', [['path', malformed.path]]))),
    Match.tag('IntentUnknownPackage', (unknown) =>
      refused(fields('IntentUnknownPackage', [['package', unknown.package]]))),
    Match.tag('IntentSlugTaken', (taken) =>
      refused(fields('IntentSlugTaken', [['slug', taken.slug]]))),
    Match.tag('ManifestUnreadable', (unreadable) =>
      refused(fields('ManifestUnreadable', [['path', unreadable.path]]))),
    Match.tag('ManifestInvalid', (invalid) =>
      refused(fields('ManifestInvalid', [['path', invalid.path], ['reason', invalid.reason]]))),
    Match.tag('VersionIntentMalformed', (malformed) =>
      refused(fields('VersionIntentMalformed', [['path', malformed.path]]))),
    Match.tag('VersionUnknownPackage', (unknown) =>
      refused(fields('VersionUnknownPackage', [['package', unknown.package]]))),
    Match.tag('VersionSurfaceMissing', (missing) =>
      refused(fields('VersionSurfaceMissing', [['path', missing.path]]))),
    Match.tag('RootManifestUnwritable', (unwritable) =>
      refused(fields('RootManifestUnwritable', [['path', unwritable.path]]))),
    Match.tag('ChangelogUnreadable', (unreadable) =>
      refused(fields('ChangelogUnreadable', [['path', unreadable.path]]))),
    Match.tag('ChangelogUnwritable', (unwritable) =>
      refused(fields('ChangelogUnwritable', [['path', unwritable.path], ['reason', unwritable.reason]]))),
    Match.orElse((rest) =>
      renderDeliveryRefusal(rest)
    ),
  )

const renderDeliveryRefusal = (refusal: DeliveryRefusal): ReadonlyArray<Directive> =>
  Match.value(refusal).pipe(
    Match.tag('PublishCapturedRequired', () => refused('PublishCapturedRequired: flag=--captured')),
    Match.tag('PublishFiltersUnreadable', (unreadable) =>
      refused(fields('PublishFiltersUnreadable', [['path', unreadable.path]]))),
    Match.tag('PublishCommandRefused', (command) =>
      refused(
        fields('PublishCommandRefused', [
          ['command', `${command.command.program} ${command.command.args.join(' ')}`],
          ['reason', command.reason],
        ]),
      )),
    Match.tag('PinVersionUnusable', (unusable) =>
      refused(`sync-root-manifest: invalid version ${JSON.stringify(unusable.given)} — pass --version x.y.z`)),
    Match.tag('PinDistributionMissing', () =>
      refused(
        'sync-root-manifest needs a "distribution" block — this repository ships no platform packages',
      )),
    Match.tag('PinManifestInvalid', (invalid) =>
      refused(fields('PinManifestInvalid', [['path', invalid.path], ['reason', invalid.reason]]))),
    Match.tag('SyncStrategyMismatch', () =>
      refused('sync-versions only applies to a "surfaces" versioning config')),
    Match.tag('SyncVersionMissing', () =>
      refused('usage: sync-versions.ts bump <version>')),
    Match.tag('SyncActionUnknown', () =>
      refused('usage: sync-versions.ts <check|bump> [version]')),
    Match.tag('SchemaError', (schema) =>
      refused(fields('SchemaError', [['message', schema.message]]))),
    Match.exhaustive,
  )
