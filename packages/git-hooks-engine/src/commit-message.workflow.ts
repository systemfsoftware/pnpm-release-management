import { Workflow } from '@systemfsoftware/effect-cell-types'
import { DecisionTypeId } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { CommitMessageCommand } from './commit-message.schema.js'

export const CommitType = S.Literals([
  'ai',
  'api',
  'build',
  'chore',
  'ci',
  'deps',
  'docs',
  'e2e',
  'feat',
  'fix',
  'improvement',
  'perf',
  'refactor',
  'revert',
  'security',
  'style',
  'test',
])
export type CommitType = S.Schema.Type<typeof CommitType>

export const CommitScope = S.Literals([
  'ci',
  'deps',
  'docs',
  'e2e',
  'gate',
  'global',
  'nix',
  'plan',
  'publish',
  'release',
  'repo',
  'solutions',
  'tag',
  'version',
])
export type CommitScope = S.Schema.Type<typeof CommitScope>

export const CommitShape = S.Literals(['docs', 'test', 'CI', 'lockfile', 'tooling'])
export type CommitShape = S.Schema.Type<typeof CommitShape>

export const CommitIgnoreKind = S.Literals(['merge', 'revert', 'fixup', 'amend', 'release'])
export type CommitIgnoreKind = S.Schema.Type<typeof CommitIgnoreKind>

export class CommitAccepted extends S.TaggedClass<CommitAccepted>()(
  'CommitAccepted',
  { type: CommitType, scope: S.optional(CommitScope), subject: S.NonEmptyString },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class CommitIgnored extends S.TaggedClass<CommitIgnored>()('CommitIgnored', { kind: CommitIgnoreKind }) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export const CommitMessageDecision = S.Union([CommitAccepted, CommitIgnored])
export type CommitMessageDecision = S.Schema.Type<typeof CommitMessageDecision>

export class CommitEmpty extends S.TaggedClass<CommitEmpty>()('CommitEmpty', { staged: S.Natural }) {}

export class CommitHeaderMalformed extends S.TaggedClass<CommitHeaderMalformed>()(
  'CommitHeaderMalformed',
  { header: S.String },
) {}

export class CommitTypeUnknown extends S.TaggedClass<CommitTypeUnknown>()(
  'CommitTypeUnknown',
  { type: S.String },
) {}

export class CommitScopeUnknown extends S.TaggedClass<CommitScopeUnknown>()(
  'CommitScopeUnknown',
  { scope: S.String },
) {}

export class CommitSubjectEmpty extends S.TaggedClass<CommitSubjectEmpty>()(
  'CommitSubjectEmpty',
  { header: S.String },
) {}

export class CommitHeaderPunctuation extends S.TaggedClass<CommitHeaderPunctuation>()(
  'CommitHeaderPunctuation',
  { header: S.String },
) {}

export class CommitAiAttribution extends S.TaggedClass<CommitAiAttribution>()(
  'CommitAiAttribution',
  { lines: S.Natural },
) {}

export class CommitShapeMismatched extends S.TaggedClass<CommitShapeMismatched>()(
  'CommitShapeMismatched',
  { type: CommitType, shape: CommitShape, allowed: S.NonEmptyArray(CommitType) },
) {}

export class CommitProductionUntouched extends S.TaggedClass<CommitProductionUntouched>()(
  'CommitProductionUntouched',
  { type: S.Literals(['feat', 'fix']) },
) {}

export const CommitMessageRefusal = S.Union([
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
export type CommitMessageRefusal = S.Schema.Type<typeof CommitMessageRefusal>
export type CommitRefusal = CommitMessageRefusal

export class CommitRejected extends S.TaggedClass<CommitRejected>()(
  'CommitRejected',
  { refusal: CommitMessageRefusal, problem: S.String },
) {}

type ParsedHeader = { readonly type: string; readonly scope: string | undefined; readonly subject: string }
type IgnoreRule = { readonly pattern: RegExp; readonly kind: CommitIgnoreKind }
type ShapeRule = {
  readonly shape: CommitShape
  readonly matches: (path: string) => boolean
  readonly allowed: readonly [CommitType, ...CommitType[]]
}

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^()]*)\))?(?<breaking>!)?: (?<subject>.+)$/

const IGNORE_RULES: ReadonlyArray<IgnoreRule> = [
  { pattern: /^Merge pull request/, kind: 'merge' },
  { pattern: /^Merge (branch|remote-tracking branch)/, kind: 'merge' },
  { pattern: /^Automatic merge/, kind: 'merge' },
  { pattern: /^Merged? /, kind: 'merge' },
  { pattern: /^Revert/, kind: 'revert' },
  { pattern: /^(fixup|squash)!/, kind: 'fixup' },
  { pattern: /^amend!/, kind: 'amend' },
  { pattern: /^chore\(release\)/, kind: 'release' },
]

const DOC_PATTERNS: ReadonlyArray<RegExp> = [
  /\.mdx?$/,
  /^docs\//,
  /(^|\/)README\.md$/i,
  /(^|\/)AGENTS\.md$/i,
  /(^|\/)CLAUDE\.md$/i,
]

const TEST_PATTERNS: ReadonlyArray<RegExp> = [
  /\.(test|spec)\.(ts|mjs|cjs)$/,
  /(^|\/)__tests__\//,
  /(^|\/)tests\//,
  /(^|\/)e2e\//,
  /(^|\/)fixtures\//,
]

const CI_PATTERNS: ReadonlyArray<RegExp> = [
  /^\.github\/workflows\//,
  /^\.github\/actions\//,
  /^\.github\/dependabot\.ya?ml$/,
]

const LOCKFILE_PATTERNS: ReadonlyArray<RegExp> = [
  /(^|\/)deno\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)flake\.lock$/,
]

const TOOLING_PATTERNS: ReadonlyArray<RegExp> = [
  /^\.claude\//,
  /^\.githooks\//,
  /^nix\//,
  /^bin\//,
  /^flake\.nix$/,
  /^flake\.lock$/,
  /(^|\/)dprint\.json$/,
  /(^|\/)\.envrc$/,
  /(^|\/)\.gitignore$/,
  /(^|\/)deno\.json[c]?$/,
  /(^|\/)package\.json$/,
  /^scripts\/checks\//,
]

const AI_EMAILS: ReadonlyArray<RegExp> = [
  /noreply@anthropic\.com/i,
  /cursoragent@cursor\.com/i,
  /noreply@aider\.dev/i,
  /cascade@windsurf\.com/i,
  /noreply@codeium\.com/i,
  /clio-agent@sisyphuslabs\.ai/i,
  /factory-droid\[bot\]@users\.noreply\.github\.com/i,
]

const AI_MODELS: ReadonlyArray<RegExp> = [
  /\b(Claude\s+)?(Opus|Sonnet|Haiku)\b/i,
  /\bgpt-4o\b/i,
  /\bClaude\b.*\b3\.\d+\b/i,
]

const COAUTHOR_LINE = /^Co-?-?[Aa]uthored-by:.*$/
const COAUTHOR_LINES = /^Co-?-?[Aa]uthored-by:.*$/gmi
const PRODUCTION_TYPES: readonly ['feat', 'fix'] = ['feat', 'fix']

const matchesAny = (patterns: ReadonlyArray<RegExp>, path: string): boolean =>
  patterns.some((pattern) => pattern.test(path))

const isDoc = (path: string): boolean => matchesAny(DOC_PATTERNS, path)
const isTest = (path: string): boolean => matchesAny(TEST_PATTERNS, path)
const isCiPath = (path: string): boolean => matchesAny(CI_PATTERNS, path)
const isLockfile = (path: string): boolean => matchesAny(LOCKFILE_PATTERNS, path)
const isTooling = (path: string): boolean => matchesAny(TOOLING_PATTERNS, path)

const NON_PRODUCTION_SHAPES: ReadonlyArray<(path: string) => boolean> = [isDoc, isTest, isCiPath, isLockfile, isTooling]

const STAGED_SHAPES: ReadonlyArray<ShapeRule> = [
  { shape: 'docs', matches: isDoc, allowed: ['docs', 'chore', 'ai'] },
  { shape: 'test', matches: isTest, allowed: ['test', 'chore', 'e2e'] },
  { shape: 'CI', matches: isCiPath, allowed: ['ci', 'chore'] },
  { shape: 'lockfile', matches: isLockfile, allowed: ['deps', 'chore'] },
  { shape: 'tooling', matches: isTooling, allowed: ['chore', 'build', 'ci', 'deps', 'ai', 'security'] },
]

const isProductionSource = (path: string): boolean => NON_PRODUCTION_SHAPES.some((matches) => matches(path)) === false

const CREDIT_PROBES: ReadonlyArray<(raw: string) => boolean> = [
  (raw) => AI_EMAILS.some((pattern) => pattern.test(raw)),
  (raw) => (raw.match(COAUTHOR_LINES) ?? []).some((line) => AI_MODELS.some((pattern) => pattern.test(line))),
]

const CREDITED_LINE_PROBES: ReadonlyArray<(line: string) => boolean> = [
  (line) => AI_EMAILS.some((pattern) => pattern.test(line)),
  (line) => COAUTHOR_LINE.test(line) && AI_MODELS.some((pattern) => pattern.test(line)),
]

const isCreditedLine = (line: string): boolean => CREDITED_LINE_PROBES.some((probe) => probe(line))

const typeOf = (value: string): CommitType | undefined => {
  if (S.is(CommitType)(value)) return value
  return undefined
}

const scopeOf = (value: string | undefined): CommitScope | undefined => {
  if (value === undefined) return undefined
  if (S.is(CommitScope)(value)) return value
  return undefined
}

const subjectOf = (value: string): string | undefined => {
  if (S.is(S.NonEmptyString)(value) && value.trim().length > 0) return value
  return undefined
}

const waiverOf = (raw: string): CommitIgnoreKind | undefined =>
  IGNORE_RULES.find((rule) => rule.pattern.test(raw.trimStart()))?.kind

const headerOf = (raw: string): string => {
  const line = raw
    .split('\n')
    .filter((candidate) => candidate.trim().length > 0)
    .find((candidate) => candidate.startsWith('#') === false)
  if (line === undefined) return ''
  return line.trim()
}

const parsedHeaderOf = (header: string): ParsedHeader | undefined => {
  const groups = HEADER.exec(header)?.groups
  if (groups === undefined) return undefined
  const type = groups['type']
  const subject = groups['subject']
  if (type === undefined || subject === undefined) return undefined
  return { type, scope: groups['scope'], subject }
}

const shapeRuleOf = (staged: ReadonlyArray<string>, type: CommitType): ShapeRule | undefined => {
  if (staged.length === 0) return undefined
  return STAGED_SHAPES.filter((rule) => staged.every(rule.matches)).find((rule) =>
    rule.allowed.includes(type) === false
  )
}

const productionTypeOf = (
  staged: ReadonlyArray<string>,
  type: CommitType,
): 'feat' | 'fix' | undefined => {
  if (staged.length === 0) return undefined
  const candidate = PRODUCTION_TYPES.find((production) => production === type)
  if (candidate === undefined) return undefined
  if (staged.some(isProductionSource)) return undefined
  return candidate
}

const RefusedCase = S.TaggedStruct('CommitRefused', { refusal: CommitMessageRefusal })

const CommitCase = S.Union([CommitAccepted, CommitIgnored, RefusedCase])
type CommitCase = S.Schema.Type<typeof CommitCase>

const commitCaseOf = (command: CommitMessageCommand): CommitCase => {
  const waived = waiverOf(command.raw)
  if (waived !== undefined) return CommitIgnored.make({ kind: waived })
  const header = headerOf(command.raw)
  if (header.length === 0) return RefusedCase.make({ refusal: CommitEmpty.make({ staged: command.staged.length }) })
  const parsed = parsedHeaderOf(header)
  if (parsed === undefined) return RefusedCase.make({ refusal: CommitHeaderMalformed.make({ header }) })
  const type = typeOf(parsed.type)
  if (type === undefined) return RefusedCase.make({ refusal: CommitTypeUnknown.make({ type: parsed.type }) })
  const scope = scopeOf(parsed.scope)
  if (parsed.scope !== undefined && scope === undefined) {
    return RefusedCase.make({ refusal: CommitScopeUnknown.make({ scope: parsed.scope }) })
  }
  const subject = subjectOf(parsed.subject)
  if (subject === undefined) return RefusedCase.make({ refusal: CommitSubjectEmpty.make({ header }) })
  if (header.endsWith('.') || subject.trimEnd().endsWith('.')) {
    return RefusedCase.make({ refusal: CommitHeaderPunctuation.make({ header }) })
  }
  if (CREDIT_PROBES.some((probe) => probe(command.raw))) {
    const lines = command.raw.split('\n').filter(isCreditedLine).length
    return RefusedCase.make({ refusal: CommitAiAttribution.make({ lines }) })
  }
  const shapeRule = shapeRuleOf(command.staged, type)
  if (shapeRule !== undefined) {
    return RefusedCase.make({
      refusal: CommitShapeMismatched.make({ type, shape: shapeRule.shape, allowed: shapeRule.allowed }),
    })
  }
  const productionType = productionTypeOf(command.staged, type)
  if (productionType !== undefined) {
    return RefusedCase.make({ refusal: CommitProductionUntouched.make({ type: productionType }) })
  }
  return CommitAccepted.make({ type, scope, subject })
}

export const commitMessage = Workflow.make(
  CommitMessageCommand,
  (command): Result.Result<CommitMessageDecision, CommitRefusal> =>
    Match.value(commitCaseOf(command)).pipe(
      Match.tag('CommitAccepted', (accepted) => Result.succeed(accepted)),
      Match.tag('CommitIgnored', (ignored) => Result.succeed(ignored)),
      Match.tag('CommitRefused', (refused) => Result.fail(refused.refusal)),
      Match.exhaustive,
    ),
)
