import type { ChangelogStorage, PackageName, PackageVersion } from './Workspace.schema.js'
import { RelativePath } from './Workspace.schema.js'

export const memberChangelogPathOf = (
  storage: ChangelogStorage,
  changelogDir: RelativePath,
  member: { readonly name: PackageName; readonly dir: RelativePath },
  version: PackageVersion,
): RelativePath => {
  if (storage === 'repository') return RelativePath.make(`${member.dir}/CHANGELOG.md`)
  return RelativePath.make(`${changelogDir}/${member.name.replaceAll('/', '!')}@${version}.md`)
}

export const parkedChangelogOf = (name: PackageName, version: PackageVersion, summary: string): string =>
  `# ${name}@${version}\n\n${summary}\n`

export const withVersionSection = (
  existing: string | undefined,
  name: PackageName,
  version: PackageVersion,
  summary: string,
): string => {
  const section = [`## ${version}`, '', summary.trim()]
  if (existing === undefined || existing.trim() === '') return [`# ${name}`, '', ...section, ''].join('\n')
  const lines = existing.replaceAll('\r\n', '\n').split('\n')
  if (lines.some((line) => line.trimEnd() === `## ${version}`)) return existing
  const eol = lineEndingOf(existing)
  const firstSection = lines.findIndex((line) => line.startsWith('## '))
  if (firstSection === -1) return [...trimmedLines(lines), '', ...section, ''].join(eol)
  const head = trimmedLines(lines.slice(0, firstSection))
  const sections = trimmedLines(lines.slice(firstSection))
  if (head.length === 0) return [...section, '', ...sections, ''].join(eol)
  return [...head, '', ...section, '', ...sections, ''].join(eol)
}

const lineEndingOf = (text: string): string => {
  if (text.includes('\r\n')) return '\r\n'
  return '\n'
}

const trimmedLines = (lines: ReadonlyArray<string>): ReadonlyArray<string> => {
  const text = lines.join('\n').trim()
  if (text === '') return []
  return text.split('\n')
}

export const releaseNotesOf = (
  storage: ChangelogStorage,
  changelog: string,
  version: PackageVersion,
): string | undefined => {
  if (storage === 'registry') return changelog
  const lines = changelog.replaceAll('\r\n', '\n').split('\n')
  const start = lines.findIndex((line) => line.trimEnd() === `## ${version}`)
  if (start === -1) return undefined
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  if (next === -1) return lines.slice(start).join('\n').trimEnd()
  return lines.slice(start, next).join('\n').trimEnd()
}
