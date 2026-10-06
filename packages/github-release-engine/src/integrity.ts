import type {
  PackageName,
  PackageVersion,
  ReleaseLedgerEntry,
  ReleaseTag,
  VersionBurned,
  VersionState,
} from '@systemfsoftware/release-language'
import {
  PublishedState,
  UnpublishedState,
  VersionBurned as VersionBurnedSchema,
} from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import { tagOf } from './cycle.js'

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
