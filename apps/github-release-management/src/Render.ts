import type { PlanReport } from '@systemfsoftware/github-release-engine'
import type {
  GithubReleaseDecision,
  PullRequestDecision,
  ReleaseTag,
  TagDecision,
  VersionDecision,
} from '@systemfsoftware/release-language'
import { Option } from 'effect'
import * as Match from 'effect/Match'
import { append, contents, err, out } from './Lines.js'
import type { Line } from './Lines.schema.js'

export interface TagReportOptions {
  readonly output: string | undefined
  readonly json: boolean
  readonly dryRun: boolean
}

const capturedLines = (count: number, output: string | undefined): ReadonlyArray<Line> =>
  Option.match(Option.fromNullishOr(output), {
    onNone: (): ReadonlyArray<Line> => [],
    onSome: (path) => [err(`wrote ${count} captured package(s) to ${path}`)],
  })

const previewLines = (
  tags: ReadonlyArray<ReleaseTag>,
  options: TagReportOptions,
): ReadonlyArray<Line> =>
  Match.value(options.json).pipe(
    Match.when(true, (): ReadonlyArray<Line> =>
      capturedLines(tags.length, options.output).concat(
        Option.match(Option.fromNullishOr(options.output), {
          onNone: (): ReadonlyArray<Line> => [out(JSON.stringify(tags, null, 2))],
          onSome: (path) => [contents(path)],
        }),
      )),
    Match.when(false, (): ReadonlyArray<Line> =>
      capturedLines(tags.length, options.output)
        .concat(tags.map((tag) => err(`would tag ${tag}`)))
        .concat([err(`dry run: ${tags.length} tag(s)`)])),
    Match.exhaustive,
  )

const upToDateLines = (count: number, options: TagReportOptions): ReadonlyArray<Line> =>
  Option.match(Option.fromNullishOr(options.output), {
    onNone: (): ReadonlyArray<Line> =>
      Match.value(options.json).pipe(
        Match.when(true, (): ReadonlyArray<Line> => [out('[]')]),
        Match.when(false, (): ReadonlyArray<Line> =>
          Match.value(options.dryRun).pipe(
            Match.when(true, (): ReadonlyArray<Line> => [err(`dry run: ${count} tag(s)`)]),
            Match.when(false, (): ReadonlyArray<Line> => [out('no new tags to push')]),
            Match.exhaustive,
          )),
        Match.exhaustive,
      ),
    onSome: (output) =>
      capturedLines(count, output).concat([
        Match.value(options.json).pipe(
          Match.when(true, (): Line => contents(output)),
          Match.when(false, (): Line => err(`dry run: ${count} tag(s)`)),
          Match.exhaustive,
        ),
      ]),
  })

export const tagLines = (
  decision: TagDecision,
  options: TagReportOptions,
): ReadonlyArray<Line> =>
  Match.value(decision).pipe(
    Match.tag('TagPreview', (preview) => previewLines(preview.tags, options)),
    Match.tag('TagUpToDate', (upToDate) => upToDateLines(Number(upToDate.tags), options)),
    Match.tag('TagPushed', (pushed) => [
      out(`pushed ${pushed.tags.length} tag(s): ${pushed.tags.join(', ')}`),
    ]),
    Match.exhaustive,
  )

const phaseBlock = (report: PlanReport): string =>
  [
    `phase=${report.phase}`,
    `pending_intents=${report.pendingIntents}`,
    `this_cycle=${report.thisCycle}`,
    `deferred=${report.deferred}`,
  ].join('\n')

const phaseNotice = (report: PlanReport): ReadonlyArray<Line> =>
  Match.value(report.phase).pipe(
    Match.when('version', (): ReadonlyArray<Line> => []),
    Match.when('publish', (): ReadonlyArray<Line> => []),
    Match.when('none', (): ReadonlyArray<Line> => [
      err('plan-release: nothing pending and nothing owed; nothing to do'),
    ]),
    Match.exhaustive,
  )

export const planLines = (report: PlanReport, output: string | undefined): ReadonlyArray<Line> =>
  report.unpublished
    .map((name) =>
      err(
        `${name} has never been published, and OIDC cannot debut a package. ` +
          'Run the bootstrap tool, register its trusted publisher, then re-run.',
      )
    )
    .concat([
      err(
        `plan-release: pending_intents=${report.pendingIntents} this_cycle=${report.thisCycle} ` +
          `deferred=${report.deferred} -> phase=${report.phase}`,
      ),
    ])
    .concat(phaseNotice(report))
    .concat(Option.match(Option.fromNullishOr(output), {
      onNone: (): ReadonlyArray<Line> => [out(phaseBlock(report))],
      onSome: (path) => [append(path, phaseBlock(report))],
    }))

export const releaseLines = (decision: GithubReleaseDecision): ReadonlyArray<Line> =>
  Match.value(decision).pipe(
    Match.tag('GithubReleaseEmpty', (): ReadonlyArray<Line> => [
      out('no this-cycle releases — empty captured set'),
    ]),
    Match.tag('GithubReleaseAsserted', (asserted) => [
      out(`assert ok: ${asserted.count} changelog(s) present`),
    ]),
    Match.tag('GithubReleasePreview', (preview) =>
      preview.tags
        .map((tag) => err(`would create release ${tag}`))
        .concat([err(`dry run: ${preview.tags.length} release(s)`)])),
    Match.tag('GithubReleaseSkipped', (skipped) => [
      out(`created 0 release(s), skipped ${skipped.tags.length}`),
    ]),
    Match.tag('GithubReleaseCreated', (created) => [
      out(`created ${created.created.length} release(s), skipped ${created.skipped}`),
    ]),
    Match.exhaustive,
  )

export const prLines = (decision: PullRequestDecision): ReadonlyArray<Line> =>
  Match.value(decision).pipe(
    Match.tag('PullRequestCreated', (created) => [out(`created release PR #${created.number}`)]),
    Match.tag('PullRequestUpdated', (updated) => [out(`updated release PR #${updated.number}`)]),
    Match.tag('PullRequestClosed', (closed) => [
      out('no pending change intents — nothing to release'),
      ...Match.value(closed.branch.deleted).pipe(
        Match.when(true, (): ReadonlyArray<Line> => [
          err(`closed release PR #${closed.number} and deleted ${closed.branch.branch}`),
        ]),
        Match.when(false, (): ReadonlyArray<Line> => [
          err(`closed release PR #${closed.number}; ${closed.branch.branch} was already gone`),
        ]),
        Match.exhaustive,
      ),
    ]),
    Match.tag('PullRequestVacant', (): ReadonlyArray<Line> => [
      out('no pending change intents — nothing to release'),
    ]),
    Match.exhaustive,
  )

export const versionLines = (decision: VersionDecision): ReadonlyArray<Line> =>
  Match.value(decision).pipe(
    Match.tag('VersionBumped', (): ReadonlyArray<Line> => [out('versioned packages')]),
    Match.tag('VersionConsumed', (): ReadonlyArray<Line> => [
      out('consumed intents without a version bump'),
    ]),
    Match.tag('VersionIdle', (): ReadonlyArray<Line> => [
      err('no change intents; nothing to version'),
    ]),
    Match.exhaustive,
  )
