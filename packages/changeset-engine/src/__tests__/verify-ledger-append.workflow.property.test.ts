import { it } from '@effect/vitest'
import { CommitSha, LedgerEntry, PackageName, PackageVersion, ReleaseTag } from '@systemfsoftware/release-language'
import { Result } from 'effect'
import * as Match from 'effect/Match'
import * as fc from 'effect/testing/FastCheck'
import { LedgerAppendCommand, verifyLedgerAppend } from '../verify-ledger-append.workflow.js'

const nameArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/).map((name) => PackageName.make(name))
const versionArb = fc
  .tuple(fc.nat({ max: 5 }), fc.nat({ max: 5 }), fc.nat({ max: 5 }))
  .map(([major, minor, patch]) => PackageVersion.make(`${major}.${minor}.${patch}`))
const tagArb = fc.tuple(nameArb, versionArb).map(([name, version]) => ReleaseTag.make(`${name}@v${version}`))
const hashArb = fc.stringMatching(/^sha512-[A-Za-z0-9+/=]{1,12}$/)
const commitArb = fc.stringMatching(/^[0-9a-f]{4,40}$/).map((hash) => CommitSha.make(hash))
const fileArb = fc.stringMatching(/^package\/[a-z]{0,6}$/)

const entryArb: fc.Arbitrary<LedgerEntry> = fc.record({
  tag: tagArb,
  commit: commitArb,
  package: nameArb,
  version: versionArb,
  integrity: hashArb,
  sha256: hashArb,
  files: fc.uniqueArray(fc.tuple(fileArb, hashArb), { selector: ([path]) => path, maxLength: 3 }).map(
    (entries) => Object.fromEntries(entries),
  ),
})

const baseArb = fc.uniqueArray(entryArb, { selector: (entry) => entry.tag, minLength: 1, maxLength: 4 })

const commandOf = (base: ReadonlyArray<LedgerEntry>, head: ReadonlyArray<LedgerEntry>): LedgerAppendCommand =>
  LedgerAppendCommand.make({ base: [...base], head: [...head] })

it.prop(
  '∀superset_VerifyLedgerAppend_≠Removed',
  [baseArb, fc.array(entryArb, { maxLength: 3 })],
  ([base, extra]) => {
    const head = [...base, ...extra.filter((entry) => !base.some((known) => known.tag === entry.tag))]
    return Result.isSuccess(verifyLedgerAppend(commandOf(base, head)))
  },
)

it.prop(
  '∀removed_VerifyLedgerAppend_⊥NamesRemovedTag',
  [baseArb],
  ([base]) => {
    const [first, ...rest] = base
    if (first === undefined) return false
    const outcome = verifyLedgerAppend(commandOf(base, rest))
    if (Result.isSuccess(outcome)) return false
    return Match.value(outcome.failure).pipe(
      Match.tag('LedgerAppendRemoved', (removed) => removed.tag === first.tag),
      Match.tag('LedgerAppendChanged', () => false),
      Match.exhaustive,
    )
  },
)

it.prop(
  '∀changed_VerifyLedgerAppend_⊥NamesChangedTag',
  [baseArb, hashArb],
  ([base, changedIntegrity]) => {
    const [first, ...rest] = base
    if (first === undefined) return false
    const changed: LedgerEntry = { ...first, integrity: `${changedIntegrity}X` }
    const outcome = verifyLedgerAppend(commandOf(base, [changed, ...rest]))
    if (Result.isSuccess(outcome)) return false
    return Match.value(outcome.failure).pipe(
      Match.tag('LedgerAppendChanged', (changedFailure) => changedFailure.tag === first.tag),
      Match.tag('LedgerAppendRemoved', () => false),
      Match.exhaustive,
    )
  },
)
