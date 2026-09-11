import { Workflow } from '@systemfsoftware/effect-cell-types'
import { CommitShape } from '@systemfsoftware/release-language'
import type { CommitIgnoreKind, CommitScope, CommitType } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export class CommitMessageCommand extends S.TaggedClass<CommitMessageCommand>()(
  'CommitMessageCommand',
  {
    raw: S.String,
    staged: S.Array(S.String),
  },
) {}

const DecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/git-hooks-engine/CommitDecision',
)
type DecisionTypeId = typeof DecisionTypeId

export class CommitAllowed extends S.TaggedClass<CommitAllowed>()(
  'CommitAllowed',
  {
    type: S.String,
    scope: S.optional(S.String),
    subject: S.String,
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class CommitWaived extends S.TaggedClass<CommitWaived>()(
  'CommitWaived',
  {
    kind: S.String,
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

const CommitEmpty = S.TaggedStruct('CommitEmpty', { staged: S.Finite })
const CommitHeaderMalformed = S.TaggedStruct('CommitHeaderMalformed', {
  header: S.String,
})
const CommitTypeUnknown = S.TaggedStruct('CommitTypeUnknown', {
  type: S.String,
})
const CommitScopeUnknown = S.TaggedStruct('CommitScopeUnknown', {
  scope: S.String,
})
const CommitSubjectEmpty = S.TaggedStruct('CommitSubjectEmpty', {
  header: S.String,
})
const CommitHeaderPunctuation = S.TaggedStruct('CommitHeaderPunctuation', {
  header: S.String,
})
const CommitAiAttribution = S.TaggedStruct('CommitAiAttribution', {
  lines: S.Finite,
})
const CommitShapeMismatched = S.TaggedStruct('CommitShapeMismatched', {
  type: S.String,
  shape: CommitShape,
  allowed: S.Array(S.String),
})
const CommitProductionUntouched = S.TaggedStruct('CommitProductionUntouched', {
  type: S.Literals(['feat', 'fix']),
})

const CommitRefusal = S.Union([
  CommitEmpty,
  CommitHeaderMalformed,
  CommitTypeUnknown,
  CommitScopeUnknown,
  CommitSubjectEmpty,
  CommitHeaderPunctuation,
  CommitAiAttribution,
  CommitShapeMismatched,
  CommitProductionUntouched,
])
export type CommitRefusal = S.Schema.Type<typeof CommitRefusal>

const TYPES: Readonly<Record<string, true>> = {
  ai: true,
  api: true,
  build: true,
  chore: true,
  ci: true,
  deps: true,
  docs: true,
  e2e: true,
  feat: true,
  fix: true,
  improvement: true,
  perf: true,
  refactor: true,
  revert: true,
  security: true,
  style: true,
  test: true,
}

const SCOPES: Readonly<Record<string, true>> = {
  ci: true,
  deps: true,
  docs: true,
  e2e: true,
  gate: true,
  global: true,
  nix: true,
  plan: true,
  publish: true,
  release: true,
  repo: true,
  solutions: true,
  tag: true,
  version: true,
}

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^()]*)\))?(?<breaking>!)?: (?<subject>.+)$/

type IgnoreEntry = {
  readonly pattern: RegExp
  readonly kind: CommitIgnoreKind
}

const DEFAULT_IGNORES: ReadonlyArray<IgnoreEntry> = [
  { pattern: /^Merge pull request/, kind: 'merge' },
  { pattern: /^Merge (branch|remote-tracking branch)/, kind: 'merge' },
  { pattern: /^Automatic merge/, kind: 'merge' },
  { pattern: /^Merged? /, kind: 'merge' },
  { pattern: /^Revert/, kind: 'revert' },
  { pattern: /^(fixup|squash)!/, kind: 'fixup' },
  { pattern: /^amend!/, kind: 'amend' },
  { pattern: /^chore\(release\)/, kind: 'release' },
]

const AI_EMAILS = [
  /noreply@anthropic\.com/i,
  /cursoragent@cursor\.com/i,
  /noreply@aider\.dev/i,
  /cascade@windsurf\.com/i,
  /noreply@codeium\.com/i,
  /clio-agent@sisyphuslabs\.ai/i,
  /factory-droid\[bot\]@users\.noreply\.github\.com/i,
]

const AI_MODELS = [/\b(Claude\s+)?(Opus|Sonnet|Haiku)\b/i, /\bgpt-4o\b/i, /\bClaude\b.*\b3\.\d+\b/i]

const COAUTHOR_LINE = /^Co-?-?[Aa]uthored-by:.*$/

const isDoc = (path: string): boolean =>
  /\.mdx?$/.test(path) || path.startsWith('docs/') || /(^|\/)README\.md$/i.test(path) ||
  /(^|\/)AGENTS\.md$/i.test(path) || /(^|\/)CLAUDE\.md$/i.test(path)

const isTest = (path: string): boolean =>
  /\.(test|spec)\.(ts|mjs|cjs)$/.test(path) || /(^|\/)__tests__\//.test(path) ||
  /(^|\/)tests\//.test(path) || /(^|\/)e2e\//.test(path) || /(^|\/)fixtures\//.test(path)

const isCI = (path: string): boolean =>
  path.startsWith('.github/workflows/') || path.startsWith('.github/actions/') ||
  /^\.github\/dependabot\.ya?ml$/.test(path)

const isLockfile = (path: string): boolean =>
  /(^|\/)deno\.lock$/.test(path) || /(^|\/)pnpm-lock\.yaml$/.test(path) || /(^|\/)flake\.lock$/.test(path)

const isTooling = (path: string): boolean =>
  path.startsWith('.claude/') || path.startsWith('.githooks/') || path.startsWith('nix/') ||
  path.startsWith('bin/') ||
  /^flake\.nix$/.test(path) || /^flake\.lock$/.test(path) || /(^|\/)dprint\.json$/.test(path) ||
  /(^|\/)\.envrc$/.test(path) || /(^|\/)\.gitignore$/.test(path) || /(^|\/)deno\.json[c]?$/.test(path) ||
  /(^|\/)package\.json$/.test(path) || path.startsWith('scripts/checks/')

type ShapeEntry = {
  readonly name: string
  readonly shape: CommitShape
  readonly match: (path: string) => boolean
  readonly allowed: Readonly<Record<string, true>>
}

const SHAPES: ReadonlyArray<ShapeEntry> = [
  { name: 'docs', shape: 'docs', match: isDoc, allowed: { docs: true, chore: true, ai: true } },
  { name: 'test', shape: 'test', match: isTest, allowed: { test: true, chore: true, e2e: true } },
  { name: 'CI', shape: 'CI', match: isCI, allowed: { ci: true, chore: true } },
  { name: 'lockfile', shape: 'lockfile', match: isLockfile, allowed: { deps: true, chore: true } },
  {
    name: 'tooling',
    shape: 'tooling',
    match: isTooling,
    allowed: { chore: true, build: true, ci: true, deps: true, ai: true, security: true },
  },
]

const isCommitType = (value: string): value is CommitType => Object.prototype.hasOwnProperty.call(TYPES, value)

const isCommitScope = (value: string): value is CommitScope => Object.prototype.hasOwnProperty.call(SCOPES, value)

const isFeatFix = (value: CommitType): value is 'feat' | 'fix' => value === 'feat' || value === 'fix'

const headerOf = (message: string): string =>
  message.split('\n').find((line) => line.trim().length > 0 && !line.startsWith('#'))?.trim() ?? ''

const coauthorLinesOf = (raw: string): ReadonlyArray<string> => raw.match(/^Co-?-?[Aa]uthored-by:.*$/gmi) ?? []

const hasAiCredit = (raw: string): boolean => {
  const coauthorLines = coauthorLinesOf(raw)
  return AI_EMAILS.some((pattern) => pattern.test(raw)) ||
    coauthorLines.some((line) => AI_MODELS.some((pattern) => pattern.test(line)))
}

const aiEvidenceLines = (raw: string): number =>
  raw.split('\n').filter((line) =>
    AI_EMAILS.some((pattern) => pattern.test(line)) ||
    (COAUTHOR_LINE.test(line) && AI_MODELS.some((pattern) => pattern.test(line)))
  ).length

const hasProductionSource = (files: ReadonlyArray<string>): boolean =>
  files.some((file) => !isDoc(file) && !isTest(file) && !isCI(file) && !isLockfile(file) && !isTooling(file))

type CommitVerdict = CommitAllowed | CommitWaived | CommitRefusal

const classifyIgnored = (raw: string): CommitWaived | undefined => {
  const ignored = DEFAULT_IGNORES.find((entry) => entry.pattern.test(raw.trimStart()))
  if (ignored === undefined) return undefined
  return CommitWaived.make({ kind: ignored.kind })
}

const classifyStaged = (
  type: CommitType,
  staged: ReadonlyArray<string>,
): CommitVerdict | undefined => {
  if (staged.length === 0) return undefined
  const shape = SHAPES.find((entry) => staged.every(entry.match) && !(type in entry.allowed))
  if (shape !== undefined) {
    return {
      _tag: 'CommitShapeMismatched',
      type,
      shape: shape.shape,
      allowed: Object.keys(shape.allowed),
    }
  }
  if (isFeatFix(type) && !hasProductionSource(staged)) {
    return { _tag: 'CommitProductionUntouched', type }
  }
  return undefined
}

const classify = (command: CommitMessageCommand): CommitVerdict => {
  const waived = classifyIgnored(command.raw)
  if (waived !== undefined) return waived
  const raw = command.raw
  const staged = command.staged
  const header = headerOf(raw)
  if (header.length === 0) return { _tag: 'CommitEmpty', staged: staged.length }
  const match = HEADER.exec(header)
  if (match?.groups === undefined) return { _tag: 'CommitHeaderMalformed', header }
  const { type, scope, subject } = match.groups
  if (typeof type !== 'string' || typeof subject !== 'string') {
    return { _tag: 'CommitHeaderMalformed', header }
  }
  if (!isCommitType(type)) return { _tag: 'CommitTypeUnknown', type }
  if (scope !== undefined && !isCommitScope(scope)) return { _tag: 'CommitScopeUnknown', scope }
  if (subject.trim().length === 0) return { _tag: 'CommitSubjectEmpty', header }
  if (header.endsWith('.') || subject.trimEnd().endsWith('.')) {
    return { _tag: 'CommitHeaderPunctuation', header }
  }
  if (hasAiCredit(raw)) return { _tag: 'CommitAiAttribution', lines: aiEvidenceLines(raw) }
  const stagedVerdict = classifyStaged(type, staged)
  if (stagedVerdict !== undefined) return stagedVerdict
  if (scope === undefined) return CommitAllowed.make({ type, subject })
  return CommitAllowed.make({ type, scope, subject })
}

export const commitMessage = Workflow.make(
  CommitMessageCommand,
  (command: CommitMessageCommand): Result.Result<CommitAllowed | CommitWaived, CommitRefusal> =>
    Match.value(classify(command)).pipe(
      Match.tag('CommitWaived', (decision) => Result.succeed(decision)),
      Match.tag('CommitAllowed', (decision) => Result.succeed(decision)),
      Match.tag('CommitEmpty', (refusal) => Result.fail(refusal)),
      Match.tag('CommitHeaderMalformed', (refusal) => Result.fail(refusal)),
      Match.tag('CommitTypeUnknown', (refusal) => Result.fail(refusal)),
      Match.tag('CommitScopeUnknown', (refusal) => Result.fail(refusal)),
      Match.tag('CommitSubjectEmpty', (refusal) => Result.fail(refusal)),
      Match.tag('CommitHeaderPunctuation', (refusal) => Result.fail(refusal)),
      Match.tag('CommitAiAttribution', (refusal) => Result.fail(refusal)),
      Match.tag('CommitShapeMismatched', (refusal) => Result.fail(refusal)),
      Match.tag('CommitProductionUntouched', (refusal) => Result.fail(refusal)),
      Match.exhaustive,
    ),
)
