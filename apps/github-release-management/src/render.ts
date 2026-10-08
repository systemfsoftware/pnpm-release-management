import { Reporter, type WorkspaceRootNotAbsolute } from '@systemfsoftware/cli-adapter'
import {
  AdoptionRefused,
  type AdoptionReport,
  type GithubReleaseDecision,
  type PlanReport,
  type PullRequestDecision,
  type TagDecision,
} from '@systemfsoftware/github-release-engine'
import {
  type AdoptionFailure,
  type ConfigRefusal,
  FsPath,
  type GithubReleaseRefusal,
  type GitRef,
  type IntegrityRefusal,
  type IntentRefusal,
  type LedgerIdentityRefusal,
  type LedgerRefusal,
  type LegacyTagUnverified,
  type MemberRefusal,
  type PlanDeferredUnknown,
  type PlanRefusal,
  type PullRequestRefusal,
  type ReleaseLedgerEntry,
  type ReleaseTag,
  type TagRefusal,
  type TarballRefusal,
  type VersionBurned,
  type VersionIntentMalformed,
  type VersionState,
  type VersionUnknownPackage,
} from '@systemfsoftware/release-language'
import { Effect, FileSystem } from 'effect'
import * as Match from 'effect/Match'
import { type BoundaryRefusal, OutputUnreadable, OutputUnwritable } from './boundary.schema.js'

type PlatformRefusal = ConfigRefusal | BoundaryRefusal | WorkspaceRootNotAbsolute

export type PlanFailure =
  | PlatformRefusal
  | IntentRefusal
  | MemberRefusal
  | PlanRefusal
  | TagRefusal
  | LegacyTagUnverified
  | IntegrityRefusal
  | LedgerRefusal
  | LedgerIdentityRefusal
  | VersionBurned
  | VersionIntentMalformed
  | VersionUnknownPackage

export type TagFailure =
  | PlatformRefusal
  | MemberRefusal
  | LedgerRefusal
  | PlanDeferredUnknown
  | TagRefusal
  | LegacyTagUnverified
  | TarballRefusal
  | VersionBurned

export type ReleaseFailure =
  | PlatformRefusal
  | MemberRefusal
  | PlanRefusal
  | TagRefusal
  | LegacyTagUnverified
  | GithubReleaseRefusal

export type PullRequestFailure =
  | PlatformRefusal
  | IntentRefusal
  | MemberRefusal
  | TagRefusal
  | PullRequestRefusal

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

const legacyTagUnverifiedText = (unverified: LegacyTagUnverified): string =>
  `refused: legacy-tag-unverified, tag: ${unverified.tag}, package: ${unverified.package}@${unverified.version}, reason: ${unverified.reason}`

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
        CommandUnstartable: (unstartable) => `${unstartable.command} could not be started: ${unstartable.reason}`,
        PlanDeferredUnknown: (unknown) => `unknown deferred package(s): ${unknown.packages.join(', ')}`,
        PlanCapturedMalformed: (malformed) => `refused: plan-captured-malformed, path: ${malformed.path}`,
        TagCapturedMalformed: (malformed) => `refused: tag-captured-malformed, path: ${malformed.path}`,
        TagExcludedMalformed: (malformed) => `refused: tag-excluded-malformed, path: ${malformed.path}`,
        TagGitFailed: (failed) => `git command failed: ${failed.command}\n${failed.stderr}`,
        LegacyTagUnverified: legacyTagUnverifiedText,
        TagIntegrityMismatch: (mismatch) =>
          `refused: tag-integrity-mismatch, package: ${mismatch.package}@${mismatch.version}, recorded: ${mismatch.recorded}, current: ${mismatch.current}, file: ${mismatch.file}`,
        IntegrityNothingToVerify: () => 'refused: integrity-nothing-to-verify',
        IntegrityFilesEmpty: (empty) =>
          `refused: integrity-files-empty, package: ${empty.package}@${empty.version}, side: ${empty.side}`,
        TagAnnotationMalformed: (malformed) =>
          `refused: tag-annotation-malformed, tag: ${malformed.tag}, reason: ${malformed.reason}`,
        TagAnnotationLightweight: (lightweight) => `refused: tag-annotation-lightweight, tag: ${lightweight.tag}`,
        TarballMissing: (missing) => `refused: tarball-missing, package: ${missing.package}@${missing.version}`,
        TarballUnreadable: (unreadable) =>
          `refused: tarball-unreadable, path: ${unreadable.path}, reason: ${unreadable.reason}`,
        LedgerUnreadable: (unreadable) => `cannot read release ledger ${unreadable.path}: ${unreadable.reason}`,
        LedgerMalformed: (malformed) => `cannot parse release ledger ${malformed.path}: ${malformed.reason}`,
        LedgerUnwritable: (unwritable) => `cannot write release ledger ${unwritable.path}: ${unwritable.reason}`,
        LedgerTagMissing: (missing) => `refused: ledger-tag-missing, tag: ${missing.tag}`,
        LedgerTagMoved: (moved) =>
          `refused: ledger-tag-moved, tag: ${moved.tag}, recorded: ${moved.recorded}, current: ${moved.current}`,
        LedgerEntryMismatch: (mismatch) =>
          `refused: ledger-entry-mismatch, tag: ${mismatch.tag}, recorded: ${mismatch.recorded}, current: ${mismatch.current}`,
        VersionBurned: (burned) =>
          `refused: version-burned, package: ${burned.package}@${burned.version}, url: ${burned.url}, status: ${burned.status}, fetchedAt: ${burned.fetchedAt}`,
        VersionIntentMalformed: (malformed) => `refused: version-intent-malformed, path: ${malformed.path}`,
        VersionUnknownPackage: (unknown) => `refused: version-unknown-package, package: ${unknown.package}`,
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
        CommandUnstartable: (unstartable) => `${unstartable.command} could not be started: ${unstartable.reason}`,
        PlanDeferredUnknown: (unknown) => `unknown excluded package(s): ${unknown.packages.join(', ')}`,
        LedgerUnreadable: (unreadable) => `cannot read release ledger ${unreadable.path}: ${unreadable.reason}`,
        LedgerMalformed: (malformed) => `cannot parse release ledger ${malformed.path}: ${malformed.reason}`,
        LedgerUnwritable: (unwritable) => `cannot write release ledger ${unwritable.path}: ${unwritable.reason}`,
        TagCapturedMalformed: (malformed) => `cannot read captured file: ${malformed.path}`,
        TagExcludedMalformed: (malformed) => `cannot read exclude file: ${malformed.path}`,
        TagGitFailed: (failed) => `git command failed: ${failed.command}\n${failed.stderr}`,
        LegacyTagUnverified: legacyTagUnverifiedText,
        TarballMissing: (missing) => `refused: tarball-missing, package: ${missing.package}@${missing.version}`,
        TarballUnreadable: (unreadable) =>
          `refused: tarball-unreadable, path: ${unreadable.path}, reason: ${unreadable.reason}`,
        VersionBurned: (burned) =>
          `refused: version-burned, package: ${burned.package}@${burned.version}, url: ${burned.url}, status: ${burned.status}, fetchedAt: ${burned.fetchedAt}`,
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
        CommandUnstartable: (unstartable) => `${unstartable.command} could not be started: ${unstartable.reason}`,
        PlanDeferredUnknown: (unknown) => `refused: plan-deferred-unknown, packages: ${unknown.packages.join(', ')}`,
        PlanCapturedMalformed: (malformed) => `refused: plan-captured-malformed, path: ${malformed.path}`,
        TagCapturedMalformed: (malformed) => `refused: tag-captured-malformed, path: ${malformed.path}`,
        TagExcludedMalformed: (malformed) => `refused: tag-excluded-malformed, path: ${malformed.path}`,
        TagGitFailed: (failed) => `git command failed: ${failed.command}\n${failed.stderr}`,
        LegacyTagUnverified: legacyTagUnverifiedText,
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
        ManifestUnreadable: (unreadable) => `refused: manifest-unreadable, path: ${unreadable.path}`,
        ManifestInvalid: (invalid) => `refused: manifest-invalid, path: ${invalid.path}`,
        CommandUnstartable: (unstartable) => `${unstartable.command} could not be started: ${unstartable.reason}`,
        IntentSlugTaken: () => 'refused: intent-slug-taken',
        TagCapturedMalformed: (malformed) => `refused: tag-captured-malformed, path: ${malformed.path}`,
        TagExcludedMalformed: (malformed) => `refused: tag-excluded-malformed, path: ${malformed.path}`,
        TagGitFailed: (failed) => `git command failed: ${failed.command}\n${failed.stderr}`,
        PullRequestBodyUnreadable: (unreadable) => `cannot read body file: ${unreadable.path}`,
        PullRequestHeadInvalid: (invalid) => `invalid pull request head: ${invalid.branch}`,
        PullRequestUnversioned: (unversioned) =>
          `refused: pull-request-unversioned, pending intents: ${unversioned.pending}. Run \`version-management bump\` first: pr opens the release PR from the bumped tree`,
        PullRequestTreeUnreadable: (unreadable) => `cannot read the working tree: ${unreadable.reason}`,
        PullRequestGitFailed: (failed) => `git command failed: ${failed.command}\n${failed.stderr}`,
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
      (name) => note(`${name} is listed as deferred but is not a package in this workspace; ignoring it.`),
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

export type AdoptFailure = PlatformRefusal | MemberRefusal | TagRefusal | LedgerRefusal | AdoptionRefused

export const renderAdoptRefusal = (refusal: AdoptFailure): Effect.Effect<void, never, Reporter> =>
  refuse(
    Match.value(refusal).pipe(
      Match.tagsExhaustive({
        AdoptionRefused: (refused) =>
          [
            ...refused.failures.map(adoptionFailureText),
            ...ledgerEntryNotes(refused.ledgered),
            ...refused.excluded.map((entry) => `${entry.tag}: ${entry.reason}`),
            adoptionCountsLine(refused.ledgered, refused.failures.length),
          ].join('\n'),
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
        CommandUnstartable: (unstartable) => `${unstartable.command} could not be started: ${unstartable.reason}`,
        TagCapturedMalformed: (malformed) => `refused: tag-captured-malformed, path: ${malformed.path}`,
        TagExcludedMalformed: (malformed) => `refused: tag-excluded-malformed, path: ${malformed.path}`,
        TagGitFailed: (failed) => `git command failed: ${failed.command}\n${failed.stderr}`,
        LedgerUnreadable: (unreadable) => `cannot read release ledger ${unreadable.path}: ${unreadable.reason}`,
        LedgerMalformed: (malformed) => `cannot parse release ledger ${malformed.path}: ${malformed.reason}`,
        LedgerUnwritable: (unwritable) => `cannot write release ledger ${unwritable.path}: ${unwritable.reason}`,
      }),
    ),
  )

const adoptionFailureText = (failure: AdoptionFailure): string =>
  Match.value(failure).pipe(
    Match.tagsExhaustive({
      RegistryFetchFailed: (fetched) => `${fetched.package}@${fetched.version}: ${fetched.reason}`,
      RegistryMetadataMalformed: (malformed) => `${malformed.package}@${malformed.version}: ${malformed.reason}`,
      RegistryIntegrityMismatch: (mismatch) =>
        `${mismatch.package}@${mismatch.version}: dist.integrity ${mismatch.expected} but the download hashes to ${mismatch.actual}`,
      AdoptionTagUnresolved: (unresolved) => `${unresolved.tag}: ${unresolved.reason}`,
    }),
  )

const ledgerCounts = (
  entries: ReadonlyArray<ReleaseLedgerEntry>,
): { readonly published: number; readonly unpublished: number; readonly mismatched: number } => {
  let published = 0
  let unpublished = 0
  let mismatched = 0
  for (const entry of entries) {
    Match.value(entry).pipe(
      Match.tag('published', () => (published += 1)),
      Match.tag('unpublished', () => (unpublished += 1)),
      Match.tag('mismatched', () => (mismatched += 1)),
      Match.exhaustive,
    )
  }
  return { published, unpublished, mismatched }
}

const stateText = (state: VersionState): string =>
  Match.value(state).pipe(
    Match.tag('published', () => 'published'),
    Match.tag('unpublished', (unpublished) => `unpublished (${unpublished.url} -> ${unpublished.status})`),
    Match.exhaustive,
  )

const ledgerEntryNotes = (entries: ReadonlyArray<ReleaseLedgerEntry>): ReadonlyArray<string> =>
  entries.flatMap((entry) =>
    Match.value(entry).pipe(
      Match.tag('published', () => []),
      Match.tag('unpublished', (unpublished) => [
        `${unpublished.tag}: ${unpublished.package}@${unpublished.version} unpublished (${unpublished.url} -> ${unpublished.status})`,
      ]),
      Match.tag('mismatched', (mismatched) => [
        `mismatched ${mismatched.tag}: claims ${mismatched.claimedVersion} ${
          stateText(mismatched.claimed)
        }, manifest ${mismatched.manifestVersion} ${stateText(mismatched.manifest)}`,
      ]),
      Match.exhaustive,
    )
  )

const adoptionCountsLine = (entries: ReadonlyArray<ReleaseLedgerEntry>, errors: number): string => {
  const counts = ledgerCounts(entries)
  return `adopted ${counts.published} published, ${counts.unpublished} unpublished, ${counts.mismatched} mismatched, ${errors} errors`
}

export const renderAdoption = (report: AdoptionReport): Effect.Effect<void, never, Reporter> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    for (const line of ledgerEntryNotes(report.entries)) {
      yield* reporter.emit(line)
    }
    for (const entry of report.excluded) {
      yield* reporter.note(`${entry.tag}: ${entry.reason}`)
    }
    yield* reporter.emit(adoptionCountsLine(report.entries, 0))
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

const pullRequestLines = (decision: PullRequestDecision): Effect.Effect<void, never, Reporter> =>
  Match.value(decision).pipe(
    Match.tagsExhaustive({
      PullRequestCreated: (created) => emit(`created release PR #${created.number}`),
      PullRequestUpdated: (updated) => emit(`updated release PR #${updated.number}`),
      PullRequestClosed: (closed) =>
        Effect.gen(function*() {
          yield* emit('no version changes on the tree — nothing to release')
          if (closed.branch.deleted) {
            yield* note(`closed release PR #${closed.number} and deleted ${closed.branch.branch}`)
            return
          }
          yield* note(`closed release PR #${closed.number}; ${closed.branch.branch} was already gone`)
        }),
      PullRequestVacant: () => emit('no version changes on the tree — nothing to release'),
    }),
  )

const pullRequestOutputs = (decision: PullRequestDecision, branch: GitRef): ReadonlyArray<string> =>
  Match.value(decision).pipe(
    Match.tagsExhaustive({
      PullRequestCreated: (created) => ['outcome=created', `number=${created.number}`, `branch=${branch}`],
      PullRequestUpdated: (updated) => ['outcome=updated', `number=${updated.number}`, `branch=${branch}`],
      PullRequestClosed: (closed) => ['outcome=closed', `number=${closed.number}`, `branch=${closed.branch.branch}`],
      PullRequestVacant: (vacant) => ['outcome=vacant', `branch=${vacant.branch}`],
    }),
  )

export interface PullRequestOptions {
  readonly branch: GitRef
  readonly output: string | undefined
}

export const renderPullRequest = (
  decision: PullRequestDecision,
  options: PullRequestOptions,
): Effect.Effect<void, OutputUnwritable, Reporter | FileSystem.FileSystem> =>
  Effect.gen(function*() {
    yield* pullRequestLines(decision)
    if (options.output === undefined) return
    yield* appendFile(options.output, pullRequestOutputs(decision, options.branch).join('\n'))
  })
