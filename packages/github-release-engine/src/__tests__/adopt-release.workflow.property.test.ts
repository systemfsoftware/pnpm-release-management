import { it } from '@effect/vitest'
import {
  type AdoptionFailure,
  CommitSha,
  FsPath,
  HttpUrl,
  LedgerEntry,
  PackageName,
  PackageVersion,
  RegistryDownloadFailed,
  RegistryFetchFailed,
  RegistryIntegrityMismatch,
  RegistryMetadataMalformed,
  RelativePath,
  ReleaseTag,
  TarballUnreadable,
} from '@systemfsoftware/release-language'
import { Result } from 'effect'
import * as Match from 'effect/Match'
import * as fc from 'effect/testing/FastCheck'
import { AdoptionCommand, adoptRelease } from '../adopt-release.workflow.js'

const nameArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/).map((name) => PackageName.make(name))
const versionArb = fc
  .tuple(fc.nat({ max: 5 }), fc.nat({ max: 5 }), fc.nat({ max: 5 }))
  .map(([major, minor, patch]) => PackageVersion.make(`${major}.${minor}.${patch}`))
const tagArb = fc.tuple(nameArb, versionArb).map(([name, version]) => ReleaseTag.make(`${name}@v${version}`))
const hashArb = fc.stringMatching(/^sha[0-9]{3}-[A-Za-z0-9+/=]{1,12}$/)
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

const refusalArb: fc.Arbitrary<AdoptionFailure> = fc.oneof(
  fc.record({ package: nameArb, version: versionArb, reason: fc.string() }).map((fields) =>
    RegistryFetchFailed.make(fields)
  ),
  fc.record({ package: nameArb, version: versionArb, reason: fc.string() }).map((fields) =>
    RegistryMetadataMalformed.make(fields)
  ),
  fc.record({ url: fc.constant(HttpUrl.make('http://127.0.0.1/404.tgz')), reason: fc.string() }).map((fields) =>
    RegistryDownloadFailed.make(fields)
  ),
  fc.record({ package: nameArb, version: versionArb, expected: hashArb, actual: hashArb }).map((fields) =>
    RegistryIntegrityMismatch.make(fields)
  ),
  fc.record({ path: fc.stringMatching(/^\S+$/), reason: fc.string() }).map((fields) =>
    TarballUnreadable.make({ path: FsPath.make(fields.path), reason: fields.reason })
  ),
)

const output = RelativePath.make('release-ledger.json')

it.prop(
  '∀failures_DecideAdoption_⊥RefusedWithFailures',
  [fc.array(refusalArb, { minLength: 1, maxLength: 3 }), fc.array(entryArb, { maxLength: 3 })],
  ([failures, entries]) => {
    const outcome = adoptRelease(AdoptionCommand.make({ entries: [...entries], failures: [...failures], output }))
    if (Result.isSuccess(outcome)) return false
    return Match.value(outcome.failure).pipe(
      Match.tag('AdoptionRefused', (refused) => refused.failures.length === failures.length),
      Match.exhaustive,
    )
  },
)

it.prop(
  '∀entries_DecideAdoption_≡EntryCountOrVacant',
  [fc.array(entryArb, { maxLength: 4 })],
  ([entries]) => {
    const outcome = adoptRelease(AdoptionCommand.make({ entries: [...entries], failures: [], output }))
    if (Result.isFailure(outcome)) return false
    return Match.value(outcome.success).pipe(
      Match.tag('AdoptionRecorded', (recorded) => recorded.entries === entries.length),
      Match.tag('AdoptionVacant', () => entries.length === 0),
      Match.exhaustive,
    )
  },
)
