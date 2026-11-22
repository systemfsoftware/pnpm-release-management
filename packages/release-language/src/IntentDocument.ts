import { Option } from 'effect'
import * as S from 'effect/Schema'
import { type Bump, type Intent, IntentFrontmatter, IntentSummary } from './Intent.schema.js'
import { PackageName, type RelativePath } from './Workspace.schema.js'

const FENCE = /^---\s*$/
const ENTRY = /^\s*["']?([^"'\s:]+)["']?\s*:\s*([^\s]+)\s*$/

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
