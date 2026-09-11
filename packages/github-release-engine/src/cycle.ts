import type { Member, PackageName, PackageVersion } from '@systemfsoftware/release-language'
import { CycleEntry, RelativePath, ReleaseTag } from '@systemfsoftware/release-language'

export const tagOf = (name: PackageName, version: PackageVersion): ReleaseTag => ReleaseTag.make(`${name}@v${version}`)

export const changelogOf = (
  changelogDir: RelativePath,
  name: PackageName,
  version: PackageVersion,
): RelativePath => RelativePath.make(`${changelogDir}/${name.replace('/', '!')}@${version}.md`)

export const cycleOf = (
  members: ReadonlyArray<Member>,
  remoteTags: ReadonlyArray<ReleaseTag>,
  changelogDir: RelativePath,
): ReadonlyArray<CycleEntry> =>
  members
    .filter((member) => member.publishable)
    .filter((member) => remoteTags.includes(tagOf(member.name, member.manifest.version)) === false)
    .map((member) =>
      CycleEntry.make({
        name: member.name,
        version: member.manifest.version,
        tag: tagOf(member.name, member.manifest.version),
        changelog: changelogOf(changelogDir, member.name, member.manifest.version),
      })
    )

export const dropExcluded = (
  cycle: ReadonlyArray<CycleEntry>,
  excluded: ReadonlyArray<PackageName>,
): ReadonlyArray<CycleEntry> => cycle.filter((entry) => excluded.includes(entry.name) === false)
