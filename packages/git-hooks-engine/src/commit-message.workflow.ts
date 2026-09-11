import { Workflow } from '@systemfsoftware/effect-cell-types'
import {
  CommitAiAttribution,
  CommitEmpty,
  CommitHeaderMalformed,
  CommitHeaderPunctuation,
  CommitIgnoreKind,
  CommitMessageRefusal,
  CommitProductionUntouched,
  CommitScope,
  CommitScopeUnknown,
  CommitShape,
  CommitShapeMismatched,
  CommitSubject,
  CommitSubjectEmpty,
  CommitType,
  CommitTypeUnknown,
  Count,
} from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const AiAttributionRefusal = CommitAiAttribution
const Counts = Count
const EmptyRefusal = CommitEmpty
const HeaderMalformedRefusal = CommitHeaderMalformed
const HeaderPunctuationRefusal = CommitHeaderPunctuation
const ProductionRefusal = CommitProductionUntouched
const Scopes = CommitScope
const ScopeUnknownRefusal = CommitScopeUnknown
const ShapeMismatchRefusal = CommitShapeMismatched
const Subjects = CommitSubject
const SubjectEmptyRefusal = CommitSubjectEmpty
const Types = CommitType
const TypeUnknownRefusal = CommitTypeUnknown

export class CommitMessageCommand extends S.TaggedClass<CommitMessageCommand>()(
  'CommitMessageCommand',
  {
    raw: S.String,
    staged: S.Array(S.String),
  },
) {}

const CommitDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/git-hooks-engine/CommitDecision',
)
type CommitDecisionTypeId = typeof CommitDecisionTypeId

export class CommitAllowed extends S.TaggedClass<CommitAllowed>()(
  'CommitAllowed',
  {
    type: CommitType,
    scope: S.optional(CommitScope),
    subject: CommitSubject,
  },
) {
  readonly [CommitDecisionTypeId] = CommitDecisionTypeId
}

export class CommitWaived extends S.TaggedClass<CommitWaived>()(
  'CommitWaived',
  {
    kind: CommitIgnoreKind,
  },
) {
  readonly [CommitDecisionTypeId] = CommitDecisionTypeId
}

export type CommitRefusal = CommitMessageRefusal

const AcceptedCase = S.TaggedStruct('CommitAccepted', {
  type: CommitType,
  scope: S.optional(CommitScope),
  subject: CommitSubject,
})

const WaivedCase = S.TaggedStruct('CommitWaived', { kind: CommitIgnoreKind })

const RefusedCase = S.TaggedStruct('CommitRefused', { refusal: CommitMessageRefusal })

const CommitCase = S.Union([AcceptedCase, WaivedCase, RefusedCase])
type CommitCase = S.Schema.Type<typeof CommitCase>

type ParsedHeader = {
  readonly type: string
  readonly scope: string | undefined
  readonly subject: string
}

type CommitHeaderStage = {
  readonly command: CommitMessageCommand
  readonly header: string
  readonly parsed: ParsedHeader
}

type CommitTypeStage = CommitHeaderStage & { readonly type: CommitType }
type CommitScopeStage = CommitTypeStage & { readonly scope: CommitScope | undefined }
type CommitSubjectStage = CommitScopeStage & { readonly subject: CommitSubject }

type IgnoreRule = {
  readonly pattern: RegExp
  readonly kind: CommitIgnoreKind
}

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

const NON_PRODUCTION_SHAPES: ReadonlyArray<(path: string) => boolean> = [
  isDoc,
  isTest,
  isCiPath,
  isLockfile,
  isTooling,
]

const STAGED_SHAPES: ReadonlyArray<ShapeRule> = [
  { shape: 'docs', matches: isDoc, allowed: ['docs', 'chore', 'ai'] },
  { shape: 'test', matches: isTest, allowed: ['test', 'chore', 'e2e'] },
  { shape: 'CI', matches: isCiPath, allowed: ['ci', 'chore'] },
  { shape: 'lockfile', matches: isLockfile, allowed: ['deps', 'chore'] },
  {
    shape: 'tooling',
    matches: isTooling,
    allowed: ['chore', 'build', 'ci', 'deps', 'ai', 'security'],
  },
]

const CREDIT_PROBES: ReadonlyArray<(raw: string) => boolean> = [
  (raw) => AI_EMAILS.some((pattern) => pattern.test(raw)),
  (raw) => coauthorLinesOf(raw).some((line) => AI_MODELS.some((pattern) => pattern.test(line))),
]

const CREDITED_LINE_PROBES: ReadonlyArray<(line: string) => boolean> = [
  (line) => AI_EMAILS.some((pattern) => pattern.test(line)),
  (line) =>
    [line]
      .filter((value) => COAUTHOR_LINE.test(value))
      .some((value) => AI_MODELS.some((pattern) => pattern.test(value))),
]

const countOf = (value: number): Count => Option.getOrThrow(Option.getSuccess(S.decodeUnknownResult(Counts)(value)))

const typeOf = (value: string): Option.Option<CommitType> => Option.getSuccess(S.decodeUnknownResult(Types)(value))

const scopeOf = (value: string): Option.Option<CommitScope> => Option.getSuccess(S.decodeUnknownResult(Scopes)(value))

const subjectOf = (value: string): Option.Option<CommitSubject> =>
  Option.filter(
    Option.getSuccess(S.decodeUnknownResult(Subjects)(value)),
    (subject) => subject.trim().length > 0,
  )

const coauthorLinesOf = (raw: string): ReadonlyArray<string> =>
  Option.getOrElse(Option.fromNullishOr(raw.match(COAUTHOR_LINES)), () => [])

const hasAiCredit = (raw: string): boolean => CREDIT_PROBES.some((probe) => probe(raw))

const isCreditedLine = (line: string): boolean => CREDITED_LINE_PROBES.some((probe) => probe(line))

const aiEvidenceOf = (raw: string): Option.Option<Count> =>
  Match.value(hasAiCredit(raw)).pipe(
    Match.when(true, () => Option.some(countOf(raw.split('\n').filter(isCreditedLine).length))),
    Match.when(false, () => Option.none<Count>()),
    Match.exhaustive,
  )

const waiverOf = (raw: string): Option.Option<CommitIgnoreKind> =>
  Option.map(
    Option.fromNullishOr(
      IGNORE_RULES.find((rule) => rule.pattern.test(raw.trimStart())),
    ),
    (rule) => rule.kind,
  )

const headerOf = (raw: string): string =>
  Option.getOrElse(
    Option.map(
      Option.fromNullishOr(
        raw.split('\n').filter((line) => line.trim().length > 0).find((line) => !line.startsWith('#')),
      ),
      (line) => line.trim(),
    ),
    () => '',
  )

const parsedOf = (header: string): Option.Option<ParsedHeader> =>
  Option.flatMap(
    Option.fromNullishOr(HEADER.exec(header)),
    (match) =>
      Option.flatMap(Option.fromNullishOr(match.groups), (groups) =>
        Option.map(
          Option.all({
            type: Option.fromNullishOr(groups['type']),
            subject: Option.fromNullishOr(groups['subject']),
          }),
          (required) => ({
            type: required.type,
            scope: groups['scope'],
            subject: required.subject,
          }),
        )),
  )

const headerRefusalOf = (
  command: CommitMessageCommand,
  header: string,
): CommitMessageRefusal =>
  Match.value(Option.fromNullishOr(header[0])).pipe(
    Match.tag('None', () => EmptyRefusal.make({ staged: countOf(command.staged.length) })),
    Match.tag('Some', () => HeaderMalformedRefusal.make({ header })),
    Match.exhaustive,
  )

const stagedPathsOf = (
  staged: ReadonlyArray<string>,
): Option.Option<ReadonlyArray<string>> => Option.liftPredicate(staged, (values) => values.length > 0)

const shapeRuleOf = (
  staged: ReadonlyArray<string>,
  type: CommitType,
): Option.Option<ShapeRule> =>
  Option.flatMap(stagedPathsOf(staged), (values) =>
    Option.fromNullishOr(
      STAGED_SHAPES
        .filter((rule) => values.every(rule.matches))
        .find((rule) => !rule.allowed.includes(type)),
    ))

const productionTypeOf = (
  staged: ReadonlyArray<string>,
  type: CommitType,
): Option.Option<'feat' | 'fix'> =>
  Option.flatMap(stagedPathsOf(staged), (values) =>
    Option.flatMap(
      Option.fromNullishOr(PRODUCTION_TYPES.find((candidate) => candidate === type)),
      (candidate) => Option.liftPredicate(candidate, () => !values.some(isProductionSource)),
    ))

const isProductionSource = (path: string): boolean => !NON_PRODUCTION_SHAPES.some((matches) => matches(path))

const headerStageOf = (
  command: CommitMessageCommand,
): Result.Result<CommitHeaderStage, CommitMessageRefusal> => {
  const header = headerOf(command.raw)
  return Match.value(parsedOf(header)).pipe(
    Match.tag('None', () => Result.fail(headerRefusalOf(command, header))),
    Match.tag('Some', (parsed) => Result.succeed({ command, header, parsed: parsed.value })),
    Match.exhaustive,
  )
}

const typedStageOf = (
  stage: CommitHeaderStage,
): Result.Result<CommitTypeStage, CommitMessageRefusal> =>
  Match.value(typeOf(stage.parsed.type)).pipe(
    Match.tag('None', () => Result.fail(TypeUnknownRefusal.make({ type: stage.parsed.type }))),
    Match.tag('Some', (type) => Result.succeed({ ...stage, type: type.value })),
    Match.exhaustive,
  )

const scopedStageOf = (
  stage: CommitTypeStage,
): Result.Result<CommitScopeStage, CommitMessageRefusal> =>
  Match.value(Option.fromNullishOr(stage.parsed.scope)).pipe(
    Match.tag('None', () => Result.succeed({ ...stage, scope: undefined })),
    Match.tag('Some', (scope) =>
      Match.value(scopeOf(scope.value)).pipe(
        Match.tag('None', () => Result.fail(ScopeUnknownRefusal.make({ scope: scope.value }))),
        Match.tag('Some', (valid) => Result.succeed({ ...stage, scope: valid.value })),
        Match.exhaustive,
      )),
    Match.exhaustive,
  )

const subjectStageOf = (
  stage: CommitScopeStage,
): Result.Result<CommitSubjectStage, CommitMessageRefusal> =>
  Match.value(subjectOf(stage.parsed.subject)).pipe(
    Match.tag('None', () => Result.fail(SubjectEmptyRefusal.make({ header: stage.header }))),
    Match.tag('Some', (subject) => Result.succeed({ ...stage, subject: subject.value })),
    Match.exhaustive,
  )

const punctuatedStageOf = (
  stage: CommitSubjectStage,
): Result.Result<CommitSubjectStage, CommitMessageRefusal> =>
  Match.value(
    Option.fromNullishOr(
      [stage.header, stage.subject.trimEnd()].find((value) => value.endsWith('.')),
    ),
  ).pipe(
    Match.tag('Some', () => Result.fail(HeaderPunctuationRefusal.make({ header: stage.header }))),
    Match.tag('None', () => Result.succeed(stage)),
    Match.exhaustive,
  )

const attributedStageOf = (
  stage: CommitSubjectStage,
): Result.Result<CommitSubjectStage, CommitMessageRefusal> =>
  Match.value(aiEvidenceOf(stage.command.raw)).pipe(
    Match.tag('Some', (lines) => Result.fail(AiAttributionRefusal.make({ lines: lines.value }))),
    Match.tag('None', () => Result.succeed(stage)),
    Match.exhaustive,
  )

const shapedStageOf = (
  stage: CommitSubjectStage,
): Result.Result<CommitSubjectStage, CommitMessageRefusal> =>
  Match.value(shapeRuleOf(stage.command.staged, stage.type)).pipe(
    Match.tag('Some', (rule) =>
      Result.fail(
        ShapeMismatchRefusal.make({
          type: stage.type,
          shape: rule.value.shape,
          allowed: rule.value.allowed,
        }),
      )),
    Match.tag('None', () => Result.succeed(stage)),
    Match.exhaustive,
  )

const producedStageOf = (
  stage: CommitSubjectStage,
): Result.Result<CommitSubjectStage, CommitMessageRefusal> =>
  Match.value(productionTypeOf(stage.command.staged, stage.type)).pipe(
    Match.tag('Some', (candidate) => Result.fail(ProductionRefusal.make({ type: candidate.value }))),
    Match.tag('None', () => Result.succeed(stage)),
    Match.exhaustive,
  )

const verdictOf = (
  command: CommitMessageCommand,
): Result.Result<CommitSubjectStage, CommitMessageRefusal> =>
  Result.gen(function*() {
    const header = yield* headerStageOf(command)
    const typed = yield* typedStageOf(header)
    const scoped = yield* scopedStageOf(typed)
    const subjected = yield* subjectStageOf(scoped)
    const punctuated = yield* punctuatedStageOf(subjected)
    const attributed = yield* attributedStageOf(punctuated)
    const shaped = yield* shapedStageOf(attributed)
    return yield* producedStageOf(shaped)
  })

const verdictCaseOf = (command: CommitMessageCommand): CommitCase =>
  Match.value(verdictOf(command)).pipe(
    Match.tag('Success', (success) =>
      AcceptedCase.make({
        type: success.success.type,
        scope: success.success.scope,
        subject: success.success.subject,
      })),
    Match.tag('Failure', (failure) => RefusedCase.make({ refusal: failure.failure })),
    Match.exhaustive,
  )

const classifyCommitMessage = (command: CommitMessageCommand): CommitCase =>
  Match.value(waiverOf(command.raw)).pipe(
    Match.tag('Some', (kind) => WaivedCase.make({ kind: kind.value })),
    Match.tag('None', () => verdictCaseOf(command)),
    Match.exhaustive,
  )

export const commitMessage = Workflow.make(
  CommitMessageCommand,
  (command): Result.Result<CommitAllowed | CommitWaived, CommitRefusal> =>
    Match.value(classifyCommitMessage(command)).pipe(
      Match.tag('CommitWaived', (waived) => Result.succeed(CommitWaived.make({ kind: waived.kind }))),
      Match.tag('CommitAccepted', (accepted) =>
        Result.succeed(
          CommitAllowed.make({
            type: accepted.type,
            scope: accepted.scope,
            subject: accepted.subject,
          }),
        )),
      Match.tag('CommitRefused', (refused) => Result.fail(refused.refusal)),
      Match.exhaustive,
    ),
)
