import {
  Count,
  PackageName,
  PackageVersion,
  type PlannedBump,
  type PlannedRelease,
} from '@systemfsoftware/release-language'

type DependencyGroup = { readonly [name: string]: string }

export type PackageEntry = {
  readonly packageJson: {
    readonly name: string
    readonly dependencies?: DependencyGroup | undefined
    readonly devDependencies?: DependencyGroup | undefined
    readonly peerDependencies?: DependencyGroup | undefined
    readonly optionalDependencies?: DependencyGroup | undefined
  }
}

export type PlanChangeset = {
  readonly id: string
  readonly summary: string
}

type ReleasableInput = {
  readonly name: string
  readonly type: 'major' | 'minor' | 'patch'
  readonly oldVersion: string
  readonly newVersion: string
  readonly changesets: ReadonlyArray<string>
}

type NoneInput = {
  readonly name: string
  readonly type: 'none'
  readonly oldVersion?: string | undefined
  readonly newVersion?: string | undefined
  readonly changesets: ReadonlyArray<string>
}

export type PlanReleaseInput = ReleasableInput | NoneInput

const dependencyNamesOf = (pkg: PackageEntry): ReadonlyArray<string> => {
  const names: Array<string> = []
  const groups = [
    pkg.packageJson.dependencies,
    pkg.packageJson.devDependencies,
    pkg.packageJson.peerDependencies,
    pkg.packageJson.optionalDependencies,
  ]
  for (const deps of groups) {
    if (deps === undefined) continue
    for (const name of Object.keys(deps)) names.push(name)
  }
  return names
}

const newVersionOf = (releases: ReadonlyArray<ReleasableInput>, name: string): string => {
  for (const release of releases) {
    if (release.name === name) return release.newVersion
  }
  return ''
}

const dependencyLineOf = (
  release: ReleasableInput,
  releases: ReadonlyArray<ReleasableInput>,
  dependenciesByName: ReadonlyMap<string, ReadonlyArray<string>>,
): string => {
  const dependencies = dependenciesByName.get(release.name) ?? []
  const released = new Set<string>()
  for (const candidate of releases) released.add(candidate.name)
  const first = dependencies
    .filter((name) => name !== release.name && released.has(name))
    .sort()
    .at(0)
  if (first === undefined) return 'Updated dependencies'
  return `Updated dependency ${first} to ${newVersionOf(releases, first)}`
}

export const projectPlan = (args: {
  readonly packages: ReadonlyArray<PackageEntry>
  readonly changesets: ReadonlyArray<PlanChangeset>
  readonly releases: ReadonlyArray<PlanReleaseInput>
  readonly count: number
}): PlannedBump => {
  const releasable = args.releases.filter((release): release is ReleasableInput => release.type !== 'none')
  const summaryById = new Map<string, string>()
  for (const changeset of args.changesets) summaryById.set(changeset.id, changeset.summary)
  const dependenciesByName = new Map<string, ReadonlyArray<string>>()
  for (const pkg of args.packages) dependenciesByName.set(pkg.packageJson.name, dependencyNamesOf(pkg))

  const releases: Array<PlannedRelease> = []
  for (const release of releasable) {
    const own = release.changesets
      .map((id) => summaryById.get(id))
      .filter((summary): summary is string => summary !== undefined)
    let summary = own.join(' ')
    if (own.length === 0) summary = dependencyLineOf(release, releasable, dependenciesByName)
    releases.push({
      name: PackageName.make(release.name),
      type: release.type,
      oldVersion: PackageVersion.make(release.oldVersion),
      newVersion: PackageVersion.make(release.newVersion),
      summary,
    })
  }
  return { changesets: Count.make(args.count), releases }
}
