import type {
  PackageName,
  PackageVersion,
  ReleaseLedgerEntry,
  ReleaseTag,
  VersionBurned,
  VersionState,
} from '@systemfsoftware/release-language'
import {
  Count,
  IntegrityFilesEmpty,
  IntegrityNothingToVerify,
  PublishedState,
  TagIntegrityMismatch,
  UnpublishedState,
  VersionBurned as VersionBurnedSchema,
} from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import { tagOf } from './cycle.js'
import { type IntegrityCheck } from './integrity.schema.js'

export interface IntegrityCandidate {
  readonly name: PackageName
  readonly version: PackageVersion
}

export interface IdentityCandidate {
  readonly name: PackageName
  readonly version: PackageVersion
  readonly publishable: boolean
}

export const identityCandidates = (
  members: ReadonlyArray<IdentityCandidate>,
  remoteTags: ReadonlyArray<ReleaseTag>,
): ReadonlyArray<IdentityCandidate> =>
  members.filter((member) => member.publishable && remoteTags.includes(tagOf(member.name, member.version)))

export const stateForVersion = (
  entries: ReadonlyArray<ReleaseLedgerEntry>,
  name: PackageName,
  version: PackageVersion,
): VersionState | undefined => {
  for (const entry of entries) {
    const state = Match.value(entry).pipe(
      Match.tag('published', (published) => {
        if (published.package !== name || published.version !== version) return undefined
        return PublishedState.make({
          integrity: published.integrity,
          sha256: published.sha256,
          files: published.files,
        })
      }),
      Match.tag('unpublished', (unpublished) => {
        if (unpublished.package !== name || unpublished.version !== version) return undefined
        return UnpublishedState.make({
          url: unpublished.url,
          status: unpublished.status,
          fetchedAt: unpublished.fetchedAt,
        })
      }),
      Match.tag('mismatched', (mismatched) => {
        if (mismatched.package !== name) return undefined
        if (mismatched.claimedVersion === version) return mismatched.claimed
        if (mismatched.manifestVersion === version) return mismatched.manifest
        return undefined
      }),
      Match.exhaustive,
    )
    if (state !== undefined) return state
  }
  return undefined
}

export const tagEntryOf = (
  entries: ReadonlyArray<ReleaseLedgerEntry>,
  tag: ReleaseTag,
): ReleaseLedgerEntry | undefined => entries.find((entry) => entry.tag === tag)

export const burnedOf = (
  name: PackageName,
  version: PackageVersion,
  state: VersionState,
): VersionBurned | undefined =>
  Match.value(state).pipe(
    Match.tag('unpublished', (unpublished) =>
      VersionBurnedSchema.make({
        package: name,
        version,
        url: unpublished.url,
        status: unpublished.status,
        fetchedAt: unpublished.fetchedAt,
      })),
    Match.tag('published', () => undefined),
    Match.exhaustive,
  )

export const publishedRecorded = (
  state: VersionState,
): { readonly integrity: string; readonly files: Readonly<Record<string, string>> } | undefined =>
  Match.value(state).pipe(
    Match.tag('published', (published) => ({ integrity: published.integrity, files: published.files })),
    Match.tag('unpublished', () => undefined),
    Match.exhaustive,
  )

export const exemptNames = (
  candidates: ReadonlyArray<IntegrityCandidate>,
  releases: ReadonlyArray<{ readonly name: PackageName }>,
): ReadonlyArray<PackageName> =>
  candidates
    .filter((candidate) => releases.some((release) => release.name === candidate.name))
    .map((candidate) => candidate.name)

const firstDifferingFile = (
  recorded: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
): string | undefined => {
  const paths = [...Object.keys(recorded), ...Object.keys(current)].sort()
  return paths.find((path) => recorded[path] !== current[path])
}

const emptySideOf = (check: IntegrityCheck): 'recorded' | 'current' | undefined => {
  if (Object.keys(check.recorded.files).length === 0) {
    return 'recorded'
  }
  if (Object.keys(check.current.files).length === 0) {
    return 'current'
  }
  return undefined
}

export const verifyIntegrity = (
  checks: ReadonlyArray<IntegrityCheck>,
): Result.Result<Count, IntegrityNothingToVerify | IntegrityFilesEmpty | TagIntegrityMismatch> => {
  if (checks.length === 0) {
    return Result.fail(IntegrityNothingToVerify.make({}))
  }
  for (const check of checks) {
    const side = emptySideOf(check)
    if (side !== undefined) {
      return Result.fail(IntegrityFilesEmpty.make({ package: check.package, version: check.version, side }))
    }
  }
  const mismatch = checks.find((check) => {
    const file = firstDifferingFile(check.recorded.files, check.current.files)
    return file !== undefined || check.recorded.integrity !== check.current.integrity
  })
  if (mismatch !== undefined) {
    return Result.fail(
      TagIntegrityMismatch.make({
        package: mismatch.package,
        version: mismatch.version,
        recorded: mismatch.recorded.integrity,
        current: mismatch.current.integrity,
        file: firstDifferingFile(mismatch.recorded.files, mismatch.current.files) ?? '',
      }),
    )
  }
  return Result.succeed(Count.make(checks.length))
}
