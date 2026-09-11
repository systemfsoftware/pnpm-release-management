import type { WorkspaceRootNotAbsolute } from '@systemfsoftware/cli-adapter'
import type {
  ConfigRefusal,
  FsPath,
  GithubReleaseRefusal,
  IntentRefusal,
  MemberRefusal,
  PackageName,
  PlanDeferredUnknown,
  PlanRefusal,
  PullRequestRefusal,
  RelativePath,
  TagRefusal,
} from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import type { BoundaryRefusal, BumpRefusal, VersionStageRefused } from './Refusal.schema.js'

const refusedAt = (label: string, path: FsPath | RelativePath): string => `refused: ${label}, path: ${path}`

const refusedAs = (label: string): string => `refused: ${label}`

const changelogGone = (
  kind: 'Missing' | 'Empty',
  selected: {
    readonly package: PackageName
    readonly version: string
    readonly changelog: string
  },
): string =>
  `${kind} changelog for ${selected.package}@${selected.version}: ` +
  `expected ${selected.changelog} to hold the generated changelog. ` +
  'Did the version step run before this one?'

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
    Match.tag('InvalidFlags', (invalid) => `invalid flags: ${invalid.reason}`),
    Match.tag('OutputUnwritable', (unwritable) => `cannot write ${unwritable.path}: ${unwritable.reason}`),
    Match.tag('OutputUnreadable', (unreadable) => `cannot read ${unreadable.path}: ${unreadable.reason}`),
    Match.exhaustive,
  )

const platformRefusalText = (
  refusal: ConfigRefusal | BoundaryRefusal | WorkspaceRootNotAbsolute,
): string =>
  Match.value(refusal).pipe(
    Match.tag('ConfigUnreadable', (unreadable) => configRefusalText(unreadable)),
    Match.tag('ConfigMalformed', (malformed) => configRefusalText(malformed)),
    Match.tag('ConfigFieldMissing', (missing) => configRefusalText(missing)),
    Match.tag('ConfigFieldInvalid', (invalid) => configRefusalText(invalid)),
    Match.tag('InvalidFlags', (invalid) => boundaryRefusalText(invalid)),
    Match.tag('OutputUnwritable', (unwritable) => boundaryRefusalText(unwritable)),
    Match.tag('OutputUnreadable', (unreadable) => boundaryRefusalText(unreadable)),
    Match.tag('WorkspaceRootNotAbsolute', (notAbsolute) =>
      `refused: workspace-root-not-absolute, path: ${notAbsolute.given}`),
    Match.exhaustive,
  )

export const planFailureText = (
  refusal:
    | ConfigRefusal
    | BoundaryRefusal
    | WorkspaceRootNotAbsolute
    | IntentRefusal
    | MemberRefusal
    | PlanRefusal
    | TagRefusal,
): string =>
  Match.value(refusal).pipe(
    Match.tag('PlanDeferredUnknown', (unknown) => `unknown deferred package(s): ${unknown.packages.join(', ')}`),
    Match.tag('PlanCapturedMalformed', (malformed) => refusedAt('plan-captured-malformed', malformed.path)),
    Match.tag('IntentFrontmatterMalformed', (malformed) => refusedAt('intent-frontmatter-malformed', malformed.path)),
    Match.tag('IntentUnknownPackage', () => refusedAs('intent-unknown-package')),
    Match.tag('IntentSlugTaken', () => refusedAs('intent-slug-taken')),
    Match.tag('ManifestUnreadable', (unreadable) => refusedAt('manifest-unreadable', unreadable.path)),
    Match.tag('ManifestInvalid', (invalid) => refusedAt('manifest-invalid', invalid.path)),
    Match.tag('TagCapturedMalformed', (malformed) => refusedAt('tag-captured-malformed', malformed.path)),
    Match.tag('TagExcludedMalformed', (malformed) => refusedAt('tag-excluded-malformed', malformed.path)),
    Match.orElse(platformRefusalText),
  )

export const tagFailureText = (
  refusal:
    | ConfigRefusal
    | BoundaryRefusal
    | WorkspaceRootNotAbsolute
    | MemberRefusal
    | PlanDeferredUnknown
    | TagRefusal,
): string =>
  Match.value(refusal).pipe(
    Match.tag('TagCapturedMalformed', (malformed) => `cannot read captured file: ${malformed.path}`),
    Match.tag('TagExcludedMalformed', (malformed) => `cannot read exclude file: ${malformed.path}`),
    Match.tag('PlanDeferredUnknown', (unknown) => `unknown excluded package(s): ${unknown.packages.join(', ')}`),
    Match.tag('ManifestUnreadable', (unreadable) => refusedAt('manifest-unreadable', unreadable.path)),
    Match.tag('ManifestInvalid', (invalid) => refusedAt('manifest-invalid', invalid.path)),
    Match.orElse(platformRefusalText),
  )

export const releaseFailureText = (
  refusal:
    | ConfigRefusal
    | BoundaryRefusal
    | WorkspaceRootNotAbsolute
    | GithubReleaseRefusal
    | MemberRefusal
    | PlanRefusal
    | TagRefusal,
): string =>
  Match.value(refusal).pipe(
    Match.tag('ReleaseChangelogMissing', (missing) => changelogGone('Missing', missing)),
    Match.tag('ReleaseChangelogEmpty', (empty) => changelogGone('Empty', empty)),
    Match.tag(
      'PlanDeferredUnknown',
      (unknown) => `refused: plan-deferred-unknown, packages: ${unknown.packages.join(', ')}`,
    ),
    Match.tag('PlanCapturedMalformed', (malformed) => refusedAt('plan-captured-malformed', malformed.path)),
    Match.tag('ManifestUnreadable', (unreadable) => refusedAt('manifest-unreadable', unreadable.path)),
    Match.tag('ManifestInvalid', (invalid) => refusedAt('manifest-invalid', invalid.path)),
    Match.tag('TagCapturedMalformed', (malformed) => refusedAt('tag-captured-malformed', malformed.path)),
    Match.tag('TagExcludedMalformed', (malformed) => refusedAt('tag-excluded-malformed', malformed.path)),
    Match.orElse(platformRefusalText),
  )

export const prFailureText = (
  refusal:
    | ConfigRefusal
    | BoundaryRefusal
    | WorkspaceRootNotAbsolute
    | IntentRefusal
    | PullRequestRefusal
    | TagRefusal
    | VersionStageRefused,
): string =>
  Match.value(refusal).pipe(
    Match.tag('PullRequestBodyUnreadable', (unreadable) => `cannot read body file: ${unreadable.path}`),
    Match.tag('PullRequestHeadInvalid', (invalid) => `invalid pull request head: ${invalid.branch}`),
    Match.tag('IntentFrontmatterMalformed', (malformed) => refusedAt('intent-frontmatter-malformed', malformed.path)),
    Match.tag('IntentUnknownPackage', () => refusedAs('intent-unknown-package')),
    Match.tag('IntentSlugTaken', () => refusedAs('intent-slug-taken')),
    Match.tag('TagCapturedMalformed', (malformed) => refusedAt('tag-captured-malformed', malformed.path)),
    Match.tag('TagExcludedMalformed', (malformed) => refusedAt('tag-excluded-malformed', malformed.path)),
    Match.tag('VersionStageRefused', (stage) => versionStageText(stage.refusal)),
    Match.orElse(platformRefusalText),
  )

export const versionStageText = (refusal: BumpRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('ChangelogUnreadable', (unreadable) => `ChangelogUnreadable: path=${unreadable.path}`),
    Match.tag(
      'ChangelogUnwritable',
      (unwritable) => `ChangelogUnwritable: path=${unwritable.path} reason=${unwritable.reason}`,
    ),
    Match.tag('IntentFrontmatterMalformed', (malformed) => `IntentFrontmatterMalformed: path=${malformed.path}`),
    Match.tag('IntentUnknownPackage', (unknown) => `IntentUnknownPackage: package=${unknown.package}`),
    Match.tag('IntentSlugTaken', (taken) => `IntentSlugTaken: slug=${taken.slug}`),
    Match.tag('ManifestUnreadable', (unreadable) => `ManifestUnreadable: path=${unreadable.path}`),
    Match.tag('ManifestInvalid', (invalid) => `ManifestInvalid: path=${invalid.path} reason=${invalid.reason}`),
    Match.tag('PublishCapturedRequired', (required) => `PublishCapturedRequired: flag=${required.flag}`),
    Match.tag('PublishFiltersUnreadable', (unreadable) => `PublishFiltersUnreadable: path=${unreadable.path}`),
    Match.tag(
      'PublishCommandRefused',
      (refused) =>
        `PublishCommandRefused: command=${refused.command.program} ${
          refused.command.args.join(' ')
        } reason=${refused.reason}`,
    ),
    Match.tag('RootManifestUnwritable', (unwritable) => `RootManifestUnwritable: path=${unwritable.path}`),
    Match.tag('SchemaError', (error) => `SchemaError: ${error.message}`),
    Match.tag('VersionIntentMalformed', (malformed) => `VersionIntentMalformed: path=${malformed.path}`),
    Match.tag('VersionSurfaceMissing', (missing) => `VersionSurfaceMissing: path=${missing.path}`),
    Match.tag('VersionUnknownPackage', (unknown) => `VersionUnknownPackage: package=${unknown.package}`),
    Match.exhaustive,
  )
