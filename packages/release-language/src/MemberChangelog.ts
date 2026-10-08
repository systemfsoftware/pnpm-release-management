import type { ChangelogStorage, PackageName, PackageVersion } from './Workspace.schema.js'
import { RelativePath } from './Workspace.schema.js'

export const memberChangelogPathOf = (
  storage: ChangelogStorage,
  changelogDir: RelativePath,
  member: { readonly name: PackageName; readonly dir: RelativePath },
  version: PackageVersion,
): RelativePath =>
  storage === 'repository'
    ? RelativePath.make(`${member.dir}/CHANGELOG.md`)
    : RelativePath.make(`${changelogDir}/${member.name.replaceAll('/', '!')}@${version}.md`)

export const parkedChangelogOf = (name: PackageName, version: PackageVersion, summary: string): string =>
  `# ${name}@${version}\n\n${summary}\n`

export const withVersionSection = (
  existing: string | undefined,
  name: PackageName,
  version: PackageVersion,
  summary: string,
): string => {
  const section = `## ${version}\n\n${summary.trim()}\n`
  if (existing === undefined || existing.trim() === '') return `# ${name}\n\n${section}`
  const lines = existing.split('\n')
  const title = lines[0]?.startsWith('# ') === true ? lines[0] : undefined
  const rest = (title === undefined ? lines : lines.slice(1)).join('\n').trim()
  const body = rest === '' ? section : `${section}\n${rest}\n`
  return title === undefined ? body : `${title}\n\n${body}`
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
