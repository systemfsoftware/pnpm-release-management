import type { PackageName, PackageVersion, ReleaseTag } from '@systemfsoftware/release-language'
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

export const exemptNames = (
  candidates: ReadonlyArray<IntegrityCandidate>,
  releases: ReadonlyArray<{ readonly name: PackageName }>,
): ReadonlyArray<PackageName> =>
  candidates
    .filter((candidate) => releases.some((release) => release.name === candidate.name))
    .map((candidate) => candidate.name)
