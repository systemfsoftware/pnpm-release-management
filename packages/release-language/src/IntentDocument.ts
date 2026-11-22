import { Option } from 'effect'
import * as S from 'effect/Schema'
import { type Bump, type Intent, IntentFrontmatter, IntentSummary } from './Intent.schema.js'
import { PackageName, RelativePath } from './Workspace.schema.js'

const FENCE = /^---\s*$/
const ENTRY = /^\s*["']?([^"'\s:]+)["']?\s*:\s*([^\s]+)\s*$/
const INTENT_SUFFIX = '.md'
const README_FILE = 'readme.md'
const AGENT_FILES: ReadonlyArray<string> = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']

interface Document {
  readonly frontmatter: string
  readonly body: string
}

const splitDocument = (text: string): Document | undefined => {
  const [first, ...rest] = text.split('\n')
  if (first === undefined || !FENCE.test(first)) return undefined
  const closing = rest.findIndex((line) => FENCE.test(line))
  if (closing === -1) return undefined
  return {
    frontmatter: rest.slice(0, closing).join('\n'),
    body: rest.slice(closing + 1).join('\n'),
  }
}

const parseFrontmatter = (frontmatter: string): Record<string, string> | undefined => {
  const entries: Record<string, string> = {}
  let seen = false
  for (const line of frontmatter.split('\n')) {
    if (line.trim() === '') continue
    const match = ENTRY.exec(line)
    if (match === null) return undefined
    const name = match.at(1)
    const bump = match.at(2)
    if (name === undefined || bump === undefined) return undefined
    entries[name] = bump
    seen = true
  }
  if (!seen) return undefined
  return entries
}

export const parseIntentDocument = (file: RelativePath, text: string): Intent | undefined => {
  const document = splitDocument(text)
  if (document === undefined) return undefined
  const raw = parseFrontmatter(document.frontmatter)
  if (raw === undefined) return undefined
  const frontmatter = S.decodeUnknownOption(IntentFrontmatter)(raw)
  if (Option.isNone(frontmatter)) return undefined
  const packages: Array<{ readonly name: PackageName; readonly bump: Bump }> = []
  for (const [given, bump] of Object.entries(frontmatter.value)) {
    const name = S.decodeUnknownOption(PackageName)(given)
    if (Option.isNone(name)) return undefined
    packages.push({ name: name.value, bump })
  }
  const body: Array<string> = []
  for (const line of document.body.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed !== '') body.push(trimmed)
  }
  const summary = S.decodeUnknownOption(IntentSummary)(body.join(' '))
  if (Option.isNone(summary)) return undefined
  return { path: file, packages, summary: summary.value }
}

export const isIntentFileName = (name: string): boolean =>
  name.endsWith(INTENT_SUFFIX) &&
  !name.startsWith('.') &&
  name.toLowerCase() !== README_FILE &&
  !AGENT_FILES.includes(name)

export const isIntentPath = (changesetDir: RelativePath, file: string): boolean => {
  const prefix = `${changesetDir}/`
  if (!file.startsWith(prefix)) return false
  const name = file.slice(prefix.length)
  return !name.includes('/') && isIntentFileName(name)
}

export const normalChangesetDir = (dir: string): RelativePath => {
  const parts = dir.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.length === 0) return RelativePath.make(dir)
  return RelativePath.make(parts.join('/'))
}

const BUMP_RANK: Record<Bump, number> = { none: 0, patch: 1, minor: 2, major: 3 }

export const bumpRank = (bump: Bump): number => BUMP_RANK[bump]
