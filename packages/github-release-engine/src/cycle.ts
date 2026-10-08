import type {
  ChangelogStorage,
  Member,
  PackageName,
  PackageVersion,
  RelativePath,
} from '@systemfsoftware/release-language'
import { CycleEntry, memberChangelogPathOf, ReleaseTag } from '@systemfsoftware/release-language'

export const tagOf = (name: PackageName, version: PackageVersion): ReleaseTag => ReleaseTag.make(`${name}@v${version}`)

export const cycleOf = (
  members: ReadonlyArray<Member>,
  remoteTags: ReadonlyArray<ReleaseTag>,
  legacyReleased: ReadonlyArray<PackageName>,
  changelogDir: RelativePath,
  storage: ChangelogStorage,
): ReadonlyArray<CycleEntry> =>
  members
    .filter((member) => member.publishable)
    .filter((member) => remoteTags.includes(tagOf(member.name, member.manifest.version)) === false)
    .filter((member) => legacyReleased.includes(member.name) === false)
    .map((member) =>
      CycleEntry.make({
        name: member.name,
        version: member.manifest.version,
        tag: tagOf(member.name, member.manifest.version),
        changelog: memberChangelogPathOf(storage, changelogDir, member, member.manifest.version),
      })
    )

export const dropExcluded = (
  cycle: ReadonlyArray<CycleEntry>,
  excluded: ReadonlyArray<PackageName>,
): ReadonlyArray<CycleEntry> => cycle.filter((entry) => excluded.includes(entry.name) === false)
