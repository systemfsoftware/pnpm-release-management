import type { Member, PackageName, PackageVersion } from '@systemfsoftware/release-language'
import { CycleEntry, RelativePath, ReleaseTag } from '@systemfsoftware/release-language'

export const tagFor = (name: PackageName, version: PackageVersion): ReleaseTag => ReleaseTag.make(`${name}@v${version}`)

export const changelogPath = (
  dir: RelativePath,
  name: PackageName,
  version: PackageVersion,
): RelativePath => RelativePath.make(`${dir}/${name.replace('/', '!')}@${version}.md`)

export const computeCycle = (
  members: ReadonlyArray<Member>,
  remoteTags: ReadonlyArray<ReleaseTag>,
  changelogDir: RelativePath,
): Array<CycleEntry> =>
  members
    .filter((member) => member.publishable)
    .filter((member) => !remoteTags.includes(tagFor(member.name, member.manifest.version)))
    .map((member) =>
      CycleEntry.make({
        name: member.name,
        version: member.manifest.version,
        tag: tagFor(member.name, member.manifest.version),
        changelog: changelogPath(changelogDir, member.name, member.manifest.version),
      })
    )

export const dropExcluded = (
  cycle: ReadonlyArray<CycleEntry>,
  excluded: ReadonlyArray<PackageName>,
): Array<CycleEntry> => cycle.filter((entry) => !excluded.includes(entry.name))

export const nonEmptyArray = <A>(list: ReadonlyArray<A>): [A, ...Array<A>] => {
  const [first, ...rest] = list
  if (first === undefined) {
    throw new Error('nonEmptyArray: empty list')
  }
  return [first, ...rest]
}
