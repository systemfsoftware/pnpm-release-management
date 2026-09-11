import { Reporter, type WorkspaceRootNotAbsolute } from '@systemfsoftware/cli-adapter'
import {
  type GithubReleaseDecision,
  type PlanReport,
  type PullRequestDecision,
  type TagDecision,
} from '@systemfsoftware/github-release-engine'
import {
  type ConfigRefusal,
  FsPath,
  type GithubReleaseRefusal,
  type IntentRefusal,
  type MemberRefusal,
  type PlanDeferredUnknown,
  type PlanRefusal,
  type PullRequestRefusal,
  type ReleaseTag,
  type TagRefusal,
} from '@systemfsoftware/release-language'
import type { VersionDecision } from '@systemfsoftware/version-engine'
import { Effect, FileSystem } from 'effect'
import * as Match from 'effect/Match'
import {
  type BoundaryRefusal,
  type BumpRefusal,
  OutputUnreadable,
  OutputUnwritable,
  type VersionStageRefused,
} from './boundary.schema.js'

type PlatformRefusal = ConfigRefusal | BoundaryRefusal | WorkspaceRootNotAbsolute

export type PlanFailure =
  | PlatformRefusal
  | IntentRefusal
  | MemberRefusal
  | PlanRefusal
  | TagRefusal

export type TagFailure =
  | PlatformRefusal
  | MemberRefusal
  | PlanDeferredUnknown
  | TagRefusal

export type ReleaseFailure =
  | PlatformRefusal
  | MemberRefusal
  | PlanRefusal
  | TagRefusal
  | GithubReleaseRefusal

export type PullRequestFailure =
  | PlatformRefusal
  | IntentRefusal
  | TagRefusal
  | PullRequestRefusal
  | VersionStageRefused

const refuse = (text: string): Effect.Effect<void, never, Reporter> =>
  Effect.flatMap(Reporter, (reporter) => Effect.andThen(reporter.annotateError(text), () => reporter.exitCode(1)))

const emit = (text: string): Effect.Effect<void, never, Reporter> =>
  Effect.flatMap(Reporter, (reporter) => reporter.emit(text))

const note = (text: string): Effect.Effect<void, never, Reporter> =>
  Effect.flatMap(Reporter, (reporter) => reporter.note(text))

const emitFile = (
  path: string,
): Effect.Effect<void, OutputUnreadable, Reporter | FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const text = yield* fs.readFileString(path).pipe(
      Effect.mapError((cause) => OutputUnreadable.make({ path: FsPath.make(path), reason: cause.message })),
    )
    yield* emit(text.trimEnd())
  })

const appendFile = (
  path: string,
  text: string,
): Effect.Effect<void, OutputUnwritable, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    yield* fs.writeFileString(path, `${text}\n`, { flag: 'a' }).pipe(
      Effect.mapError((cause) => OutputUnwritable.make({ path: FsPath.make(path), reason: cause.message })),
    )
  })

export const versionStageText = (refusal: BumpRefusal): string =>
  Match.value(refusal).pipe(
    Match.tagsExhaustive({
      ChangelogUnreadable: (unreadable) => `ChangelogUnreadable: path=${unreadable.path}`,
      ChangelogUnwritable: (unwritable) => `ChangelogUnwritable: path=${unwritable.path} reason=${unwritable.reason}`,
      IntentFrontmatterMalformed: (malformed) => `IntentFrontmatterMalformed: path=${malformed.path}`,
      IntentUnknownPackage: (unknown) => `IntentUnknownPackage: package=${unknown.package}`,
      IntentSlugTaken: (taken) => `IntentSlugTaken: slug=${taken.slug}`,
      ManifestUnreadable: (unreadable) => `ManifestUnreadable: path=${unreadable.path}`,
      ManifestInvalid: (invalid) => `ManifestInvalid: path=${invalid.path} reason=${invalid.reason}`,
      PublishCapturedRequired: (required) => `PublishCapturedRequired: flag=${required.flag}`,
      PublishFiltersUnreadable: (unreadable) => `PublishFiltersUnreadable: path=${unreadable.path}`,
      PublishCommandRefused: (refusedCommand) =>
        `PublishCommandRefused: command=${refusedCommand.command.program} ${
          refusedCommand.command.args.join(' ')
        } reason=${refusedCommand.reason}`,
      RootManifestUnwritable: (unwritable) => `RootManifestUnwritable: path=${unwritable.path}`,
      VersionIntentMalformed: (malformed) => `VersionIntentMalformed: path=${malformed.path}`,
      VersionSurfaceMissing: (missing) => `VersionSurfaceMissing: path=${missing.path}`,
      VersionUnknownPackage: (unknown) => `VersionUnknownPackage: package=${unknown.package}`,
    }),
  )

export const renderPlanRefusal = (refusal: PlanFailure): Effect.Effect<void, never, Reporter> =>
  refuse(
    Match.value(refusal).pipe(
      Match.tagsExhaustive({
        ConfigUnreadable: (unreadable) => `${unreadable.path}: cannot be read`,
        ConfigMalformed: (malformed) => `${malformed.path}: ${malformed.reason}`,
        ConfigFieldMissing: (missing) => `${missing.path}: missing field ${missing.field}`,
        ConfigFieldInvalid: (invalid) => `${invalid.path}: invalid field ${invalid.field}: ${invalid.reason}`,
        InvalidFlags: (invalid) => `invalid flags: ${invalid.reason}`,
        OutputUnwritable: (unwritable) => `cannot write ${unwritable.path}: ${unwritable.reason}`,
        OutputUnreadable: (unreadable) => `cannot read ${unreadable.path}: ${unreadable.reason}`,
        WorkspaceRootNotAbsolute: (notAbsolute) => `refused: workspace-root-not-absolute, path: ${notAbsolute.given}`,
        IntentFrontmatterMalformed: (malformed) => `refused: intent-frontmatter-malformed, path: ${malformed.path}`,
        IntentUnknownPackage: () => 'refused: intent-unknown-package',
        IntentSlugTaken: () => 'refused: intent-slug-taken',
        ManifestUnreadable: (unreadable) => `refused: manifest-unreadable, path: ${unreadable.path}`,
        ManifestInvalid: (invalid) => `refused: manifest-invalid, path: ${invalid.path}`,
        PlanDeferredUnknown: (unknown) => `unknown deferred package(s): ${unknown.packages.join(', ')}`,
        PlanCapturedMalformed: (malformed) => `refused: plan-captured-malformed, path: ${malformed.path}`,
        TagCapturedMalformed: (malformed) => `refused: tag-captured-malformed, path: ${malformed.path}`,
        TagExcludedMalformed: (malformed) => `refused: tag-excluded-malformed, path: ${malformed.path}`,
      }),
    ),
  )

export const renderTagRefusal = (refusal: TagFailure): Effect.Effect<void, never, Reporter> =>
  refuse(
    Match.value(refusal).pipe(
      Match.tagsExhaustive({
        ConfigUnreadable: (unreadable) => `${unreadable.path}: cannot be read`,
        ConfigMalformed: (malformed) => `${malformed.path}: ${malformed.reason}`,
        ConfigFieldMissing: (missing) => `${missing.path}: missing field ${missing.field}`,
        ConfigFieldInvalid: (invalid) => `${invalid.path}: invalid field ${invalid.field}: ${invalid.reason}`,
        InvalidFlags: (invalid) => `invalid flags: ${invalid.reason}`,
        OutputUnwritable: (unwritable) => `cannot write ${unwritable.path}: ${unwritable.reason}`,
        OutputUnreadable: (unreadable) => `cannot read ${unreadable.path}: ${unreadable.reason}`,
        WorkspaceRootNotAbsolute: (notAbsolute) => `refused: workspace-root-not-absolute, path: ${notAbsolute.given}`,
        ManifestUnreadable: (unreadable) => `refused: manifest-unreadable, path: ${unreadable.path}`,
        ManifestInvalid: (invalid) => `refused: manifest-invalid, path: ${invalid.path}`,
        PlanDeferredUnknown: (unknown) => `unknown excluded package(s): ${unknown.packages.join(', ')}`,
        TagCapturedMalformed: (malformed) => `cannot read captured file: ${malformed.path}`,
        TagExcludedMalformed: (malformed) => `cannot read exclude file: ${malformed.path}`,
      }),
    ),
  )

export const renderReleaseRefusal = (refusal: ReleaseFailure): Effect.Effect<void, never, Reporter> =>
  refuse(
    Match.value(refusal).pipe(
      Match.tagsExhaustive({
        ConfigUnreadable: (unreadable) => `${unreadable.path}: cannot be read`,
        ConfigMalformed: (malformed) => `${malformed.path}: ${malformed.reason}`,
        ConfigFieldMissing: (missing) => `${missing.path}: missing field ${missing.field}`,
        ConfigFieldInvalid: (invalid) => `${invalid.path}: invalid field ${invalid.field}: ${invalid.reason}`,
        InvalidFlags: (invalid) => `invalid flags: ${invalid.reason}`,
        OutputUnwritable: (unwritable) => `cannot write ${unwritable.path}: ${unwritable.reason}`,
        OutputUnreadable: (unreadable) => `cannot read ${unreadable.path}: ${unreadable.reason}`,
        WorkspaceRootNotAbsolute: (notAbsolute) => `refused: workspace-root-not-absolute, path: ${notAbsolute.given}`,
        ManifestUnreadable: (unreadable) => `refused: manifest-unreadable, path: ${unreadable.path}`,
        ManifestInvalid: (invalid) => `refused: manifest-invalid, path: ${invalid.path}`,
        PlanDeferredUnknown: (unknown) => `refused: plan-deferred-unknown, packages: ${unknown.packages.join(', ')}`,
        PlanCapturedMalformed: (malformed) => `refused: plan-captured-malformed, path: ${malformed.path}`,
        TagCapturedMalformed: (malformed) => `refused: tag-captured-malformed, path: ${malformed.path}`,
        TagExcludedMalformed: (malformed) => `refused: tag-excluded-malformed, path: ${malformed.path}`,
        ReleaseChangelogMissing: (missing) =>
          `Missing changelog for ${missing.package}@${missing.version}: expected ${missing.changelog} to hold the generated changelog. Did the version step run before this one?`,
        ReleaseChangelogEmpty: (empty) =>
          `Empty changelog for ${empty.package}@${empty.version}: expected ${empty.changelog} to hold the generated changelog. Did the version step run before this one?`,
      }),
    ),
  )

export const renderPullRequestRefusal = (
  refusal: PullRequestFailure,
): Effect.Effect<void, never, Reporter> =>
  refuse(
    Match.value(refusal).pipe(
      Match.tagsExhaustive({
        ConfigUnreadable: (unreadable) => `${unreadable.path}: cannot be read`,
        ConfigMalformed: (malformed) => `${malformed.path}: ${malformed.reason}`,
        ConfigFieldMissing: (missing) => `${missing.path}: missing field ${missing.field}`,
        ConfigFieldInvalid: (invalid) => `${invalid.path}: invalid field ${invalid.field}: ${invalid.reason}`,
        InvalidFlags: (invalid) => `invalid flags: ${invalid.reason}`,
        OutputUnwritable: (unwritable) => `cannot write ${unwritable.path}: ${unwritable.reason}`,
        OutputUnreadable: (unreadable) => `cannot read ${unreadable.path}: ${unreadable.reason}`,
        WorkspaceRootNotAbsolute: (notAbsolute) => `refused: workspace-root-not-absolute, path: ${notAbsolute.given}`,
        IntentFrontmatterMalformed: (malformed) => `refused: intent-frontmatter-malformed, path: ${malformed.path}`,
        IntentUnknownPackage: () => 'refused: intent-unknown-package',
        IntentSlugTaken: () => 'refused: intent-slug-taken',
        TagCapturedMalformed: (malformed) => `refused: tag-captured-malformed, path: ${malformed.path}`,
        TagExcludedMalformed: (malformed) => `refused: tag-excluded-malformed, path: ${malformed.path}`,
        PullRequestBodyUnreadable: (unreadable) => `cannot read body file: ${unreadable.path}`,
        PullRequestHeadInvalid: (invalid) => `invalid pull request head: ${invalid.branch}`,
        VersionStageRefused: (stage) => versionStageText(stage.refusal),
      }),
    ),
  )

export interface TagOptions {
  readonly output: string | undefined
  readonly json: boolean
  readonly dryRun: boolean
}

const previewLines = (
  tags: ReadonlyArray<ReleaseTag>,
  options: TagOptions,
): Effect.Effect<void, OutputUnreadable | OutputUnwritable, Reporter | FileSystem.FileSystem> =>
  Effect.gen(function*() {
    if (options.output !== undefined) {
      yield* note(`wrote ${tags.length} captured package(s) to ${options.output}`)
    }
    if (options.json) {
      if (options.output === undefined) {
        yield* emit(JSON.stringify(tags, null, 2))
        return
      }
      yield* emitFile(options.output)
      return
    }
    yield* Effect.forEach(tags, (tag) => note(`would tag ${tag}`), { discard: true })
    yield* note(`dry run: ${tags.length} tag(s)`)
  })

const upToDateLines = (
  count: number,
  options: TagOptions,
): Effect.Effect<void, OutputUnreadable, Reporter | FileSystem.FileSystem> =>
  Effect.gen(function*() {
    if (options.output !== undefined) {
      yield* note(`wrote ${count} captured package(s) to ${options.output}`)
      if (options.json) {
        yield* emitFile(options.output)
        return
      }
      yield* note(`dry run: ${count} tag(s)`)
      return
    }
    if (options.json) {
      yield* emit('[]')
      return
    }
    if (options.dryRun) {
      yield* note(`dry run: ${count} tag(s)`)
      return
    }
    yield* emit('no new tags to push')
  })

export const renderTag = (
  decision: TagDecision,
  options: TagOptions,
): Effect.Effect<void, OutputUnreadable | OutputUnwritable, Reporter | FileSystem.FileSystem> =>
  Match.value(decision).pipe(
    Match.tagsExhaustive({
      TagPreview: (preview) => previewLines(preview.tags, options),
      TagUpToDate: (upToDate) => upToDateLines(upToDate.tags, options),
      TagPushed: (pushed) => emit(`pushed ${pushed.tags.length} tag(s): ${pushed.tags.join(', ')}`),
    }),
  )

export const renderPlan = (
  report: PlanReport,
  output: string | undefined,
): Effect.Effect<void, OutputUnwritable, Reporter | FileSystem.FileSystem> =>
  Effect.gen(function*() {
    yield* Effect.forEach(
      report.unpublished,
      (name) =>
        note(
          `${name} has never been published, and OIDC cannot debut a package. ` +
            'Run the bootstrap tool, register its trusted publisher, then re-run.',
        ),
      { discard: true },
    )
    yield* note(
      `plan-release: pending_intents=${report.pendingIntents} this_cycle=${report.thisCycle} ` +
        `deferred=${report.deferred} -> phase=${report.phase}`,
    )
    if (report.phase === 'none') {
      yield* note('plan-release: nothing pending and nothing owed; nothing to do')
    }
    const block = [
      `phase=${report.phase}`,
      `pending_intents=${report.pendingIntents}`,
      `this_cycle=${report.thisCycle}`,
      `deferred=${report.deferred}`,
    ].join('\n')
    if (output === undefined) {
      yield* emit(block)
      return
    }
    yield* appendFile(output, block)
  })

export const renderRelease = (decision: GithubReleaseDecision): Effect.Effect<void, never, Reporter> =>
  Match.value(decision).pipe(
    Match.tagsExhaustive({
      GithubReleaseEmpty: () => emit('no this-cycle releases — empty captured set'),
      GithubReleaseAsserted: (asserted) => emit(`assert ok: ${asserted.count} changelog(s) present`),
      GithubReleasePreview: (preview) =>
        Effect.gen(function*() {
          yield* Effect.forEach(
            preview.tags,
            (tag) => note(`would create release ${tag}`),
            { discard: true },
          )
          yield* note(`dry run: ${preview.tags.length} release(s)`)
        }),
      GithubReleaseSkipped: (skipped) => emit(`created 0 release(s), skipped ${skipped.tags.length}`),
      GithubReleaseCreated: (created) =>
        emit(`created ${created.created.length} release(s), skipped ${created.skipped}`),
    }),
  )

export const renderPullRequest = (decision: PullRequestDecision): Effect.Effect<void, never, Reporter> =>
  Match.value(decision).pipe(
    Match.tagsExhaustive({
      PullRequestCreated: (created) => emit(`created release PR #${created.number}`),
      PullRequestUpdated: (updated) => emit(`updated release PR #${updated.number}`),
      PullRequestClosed: (closed) =>
        Effect.gen(function*() {
          yield* emit('no pending change intents — nothing to release')
          if (closed.branch.deleted) {
            yield* note(`closed release PR #${closed.number} and deleted ${closed.branch.branch}`)
            return
          }
          yield* note(`closed release PR #${closed.number}; ${closed.branch.branch} was already gone`)
        }),
      PullRequestVacant: () => emit('no pending change intents — nothing to release'),
    }),
  )

export const renderVersion = (decision: VersionDecision): Effect.Effect<void, never, Reporter> =>
  Match.value(decision).pipe(
    Match.tagsExhaustive({
      VersionBumped: () => emit('versioned packages'),
      VersionConsumed: () => emit('consumed intents without a version bump'),
      VersionIdle: () => note('no change intents; nothing to version'),
    }),
  )
