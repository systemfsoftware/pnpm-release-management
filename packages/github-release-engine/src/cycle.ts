import type { ChangelogStorage, Member, PackageName, PackageVersion } from '@systemfsoftware/release-language'
import { CycleEntry, RelativePath, ReleaseTag } from '@systemfsoftware/release-language'

export const tagOf = (name: PackageName, version: PackageVersion): ReleaseTag => ReleaseTag.make(`${name}@v${version}`)

export const changelogOf = (
  storage: ChangelogStorage,
  changelogDir: RelativePath,
  member: Member,
): RelativePath => {
  if (storage === 'repository') return RelativePath.make(`${member.dir}/CHANGELOG.md`)
  return RelativePath.make(`${changelogDir}/${member.name.replace('/', '!')}@${member.manifest.version}.md`)
}

export const releaseNotesOf = (
  storage: ChangelogStorage,
  changelog: string,
  version: PackageVersion,
): string | undefined => {
  if (storage === 'registry') return changelog
  const lines = changelog.split('\n')
  const start = lines.findIndex((line) => line.trimEnd() === `## ${version}`)
  if (start === -1) return undefined
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  if (next === -1) return lines.slice(start).join('\n').trimEnd()
  return lines.slice(start, next).join('\n').trimEnd()
}

export const cycleOf = (
  members: ReadonlyArray<Member>,
  remoteTags: ReadonlyArray<ReleaseTag>,
  changelogDir: RelativePath,
  storage: ChangelogStorage,
): ReadonlyArray<CycleEntry> =>
  members
    .filter((member) => member.publishable)
    .filter((member) => remoteTags.includes(tagOf(member.name, member.manifest.version)) === false)
    .map((member) =>
      CycleEntry.make({
        name: member.name,
        version: member.manifest.version,
        tag: tagOf(member.name, member.manifest.version),
        changelog: changelogOf(storage, changelogDir, member),
      })
    )

export const dropExcluded = (
  cycle: ReadonlyArray<CycleEntry>,
  excluded: ReadonlyArray<PackageName>,
): ReadonlyArray<CycleEntry> => cycle.filter((entry) => excluded.includes(entry.name) === false)
