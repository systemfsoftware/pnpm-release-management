import type { PackageName, PackageVersion } from '@systemfsoftware/release-language'

export interface IntegrityCandidate {
  readonly name: PackageName
  readonly version: PackageVersion
}

export const exemptNames = (
  candidates: ReadonlyArray<IntegrityCandidate>,
  releases: ReadonlyArray<{ readonly name: PackageName }>,
): ReadonlyArray<PackageName> =>
  candidates
    .filter((candidate) => releases.some((release) => release.name === candidate.name))
    .map((candidate) => candidate.name)
