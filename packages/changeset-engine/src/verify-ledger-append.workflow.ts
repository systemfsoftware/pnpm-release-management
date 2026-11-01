import { Workflow } from '@systemfsoftware/effect-cell-types'
import { DecisionTypeId, ReleaseLedgerEntry, ReleaseTag, type VersionState } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class LedgerAppendHeld extends S.TaggedClass<LedgerAppendHeld>()('LedgerAppendHeld', {
  entries: S.Finite,
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class LedgerAppendVacant extends S.TaggedClass<LedgerAppendVacant>()('LedgerAppendVacant', {}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export type LedgerAppendDecision = LedgerAppendHeld | LedgerAppendVacant

export class LedgerAppendRemoved extends S.TaggedError<LedgerAppendRemoved>()('LedgerAppendRemoved', {
  tag: ReleaseTag,
}) {}

export class LedgerAppendChanged extends S.TaggedError<LedgerAppendChanged>()('LedgerAppendChanged', {
  tag: ReleaseTag,
  recorded: S.String,
  current: S.String,
}) {}

export class LedgerAppendCommand extends S.TaggedClass<LedgerAppendCommand>()('LedgerAppendCommand', {
  base: S.Array(ReleaseLedgerEntry),
  head: S.Array(ReleaseLedgerEntry),
}) {}

const RemovedCase = S.TaggedStruct('Removed', { tag: ReleaseTag })
const ChangedCase = S.TaggedStruct('Changed', { tag: ReleaseTag, recorded: S.String, current: S.String })
const VacantCase = S.TaggedStruct('Vacant', {})
const HeldCase = S.TaggedStruct('Held', { entries: S.Finite })
const AppendCase = S.Union([RemovedCase, ChangedCase, VacantCase, HeldCase])
type AppendCase = S.Schema.Type<typeof AppendCase>

const comparePaths = (left: string, right: string): number => {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

const ordered = (files: Readonly<Record<string, string>>): Readonly<Record<string, string>> =>
  Object.fromEntries(Object.entries(files).sort(([left], [right]) => comparePaths(left, right)))

const canonicalState = (state: VersionState): unknown =>
  Match.value(state).pipe(
    Match.tag('published', (published) => ({
      kind: 'published',
      integrity: published.integrity,
      sha256: published.sha256,
      files: ordered(published.files),
    })),
    Match.tag('unpublished', (unpublished) => ({
      kind: 'unpublished',
      url: unpublished.url,
      status: unpublished.status,
      fetchedAt: unpublished.fetchedAt,
    })),
    Match.exhaustive,
  )

const fingerprint = (entry: ReleaseLedgerEntry): string =>
  JSON.stringify(
    Match.value(entry).pipe(
      Match.tag('published', (published) => ({
        kind: 'published',
        tag: published.tag,
        commit: published.commit,
        package: published.package,
        version: published.version,
        integrity: published.integrity,
        sha256: published.sha256,
        files: ordered(published.files),
      })),
      Match.tag('unpublished', (unpublished) => ({
        kind: 'unpublished',
        tag: unpublished.tag,
        commit: unpublished.commit,
        package: unpublished.package,
        version: unpublished.version,
        url: unpublished.url,
        status: unpublished.status,
        fetchedAt: unpublished.fetchedAt,
      })),
      Match.tag('mismatched', (mismatched) => ({
        kind: 'mismatched',
        tag: mismatched.tag,
        commit: mismatched.commit,
        package: mismatched.package,
        claimedVersion: mismatched.claimedVersion,
        manifestVersion: mismatched.manifestVersion,
        claimed: canonicalState(mismatched.claimed),
        manifest: canonicalState(mismatched.manifest),
      })),
      Match.exhaustive,
    ),
  )

const appendCaseOf = (command: LedgerAppendCommand): AppendCase => {
  if (command.base.length === 0 && command.head.length === 0) {
    return VacantCase.make({})
  }
  for (const entry of command.base) {
    const current = command.head.find((candidate) => candidate.tag === entry.tag)
    if (current === undefined) {
      return RemovedCase.make({ tag: entry.tag })
    }
    const recorded = fingerprint(entry)
    const now = fingerprint(current)
    if (recorded !== now) {
      return ChangedCase.make({ tag: entry.tag, recorded, current: now })
    }
  }
  return HeldCase.make({ entries: command.head.length })
}

export const verifyLedgerAppend: Workflow.Workflow<
  LedgerAppendCommand,
  LedgerAppendDecision,
  LedgerAppendRemoved | LedgerAppendChanged
> = Workflow.make(LedgerAppendCommand, (command) =>
  Match.value(appendCaseOf(command)).pipe(
    Match.tag('Removed', (removed) => Result.fail(LedgerAppendRemoved.make({ tag: removed.tag }))),
    Match.tag('Changed', (changed) =>
      Result.fail(
        LedgerAppendChanged.make({
          tag: changed.tag,
          recorded: changed.recorded,
          current: changed.current,
        }),
      )),
    Match.tag('Vacant', () => Result.succeed(LedgerAppendVacant.make({}))),
    Match.tag('Held', (held) => Result.succeed(LedgerAppendHeld.make({ entries: held.entries }))),
    Match.exhaustive,
  ))
