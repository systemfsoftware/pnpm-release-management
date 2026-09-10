import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import { CommitMessageDecision, CommitMessageRefusal } from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { commitMessage, CommitMessageCommand } from './commit-message.workflow.ts'
import type { CommitAllowed, CommitRefusal, CommitWaived } from './commit-message.workflow.ts'

export const CommitMessageInput = Wire.wire({
  raw: Wire.mint(S.String),
  staged: Wire.mint(S.Array(S.String)),
})

export class CommitRejected extends S.TaggedClass<CommitRejected>()(
  'CommitRejected',
  {
    refusal: CommitMessageRefusal,
    problem: S.String,
  },
) {}

const TYPE_NAMES = [
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
].sort().join(' / ')

const SCOPE_NAMES = [
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
].sort().join(' / ')

const punctuationProblem = (header: string): string => {
  if (header.endsWith('.')) return 'the header must not end with a full stop'
  return 'the subject must not end with a full stop'
}

const commitProblemText = (refusal: CommitMessageRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('CommitEmpty', () => 'the commit message is empty'),
    Match.tag('CommitHeaderMalformed', (malformed) => `"${malformed.header}" is not "<type>(<scope>): <subject>"`),
    Match.tag('CommitTypeUnknown', (unknown) => `type "${unknown.type}" is not one of ${TYPE_NAMES}`),
    Match.tag('CommitScopeUnknown', (unknown) => `scope "${unknown.scope}" is not one of ${SCOPE_NAMES}`),
    Match.tag('CommitSubjectEmpty', () => 'the subject is empty'),
    Match.tag('CommitHeaderPunctuation', (punctuated) => punctuationProblem(punctuated.header)),
    Match.tag(
      'CommitAiAttribution',
      () => 'AI co-authors and AI model references are not allowed in commit messages',
    ),
    Match.tag('CommitShapeMismatched', (mismatched) =>
      `"${mismatched.type}" with 100% ${mismatched.shape} paths — allowed types: ${
        [...mismatched.allowed].sort().join(' / ')
      }`),
    Match.tag('CommitProductionUntouched', (untouched) =>
      `"${untouched.type}" must touch at least one production source file`),
    Match.exhaustive,
  )

class RawMessage {
  constructor(readonly input: S.Schema.Type<typeof CommitMessageInput>) {}
}

const read = (
  input: S.Schema.Type<typeof CommitMessageInput>,
): Effect.Effect<RawMessage> => Effect.succeed(new RawMessage(input))

const decode = (
  raw: RawMessage,
): Result.Result<CommitMessageCommand, S.SchemaError> =>
  S.decodeUnknownResult(CommitMessageCommand)({
    _tag: 'CommitMessageCommand',
    raw: raw.input.raw,
    staged: raw.input.staged,
  })

type DecisionWire =
  | {
    readonly _tag: 'CommitAccepted'
    readonly type: string
    readonly scope?: string | undefined
    readonly subject: string
  }
  | { readonly _tag: 'CommitIgnored'; readonly kind: string }

const decisionWire = (decision: CommitAllowed | CommitWaived): DecisionWire => {
  if (decision._tag === 'CommitWaived') {
    return { _tag: 'CommitIgnored', kind: decision.kind }
  }
  if (decision.scope === undefined) {
    return { _tag: 'CommitAccepted', type: decision.type, subject: decision.subject }
  }
  return { _tag: 'CommitAccepted', type: decision.type, scope: decision.scope, subject: decision.subject }
}

const encode = (
  outcome: Result.Result<CommitAllowed | CommitWaived, CommitRefusal>,
): Result.Result<DecisionWire, CommitRefusal> => Result.map(outcome, decisionWire)

const write = (
  output: Result.Result<DecisionWire, CommitRefusal>,
  _raw: RawMessage,
): Effect.Effect<CommitMessageDecision, S.SchemaError | CommitRejected> => {
  if (Result.isFailure(output)) {
    return Effect.flatMap(
      S.decodeUnknownEffect(CommitMessageRefusal)(output.failure),
      (refusal) => Effect.fail(CommitRejected.make({ refusal, problem: commitProblemText(refusal) })),
    )
  }
  return S.decodeUnknownEffect(CommitMessageDecision)(output.success)
}

export const commitMessageCell: Cell.Cell<
  S.Schema.Type<typeof CommitMessageInput>,
  CommitMessageDecision,
  S.SchemaError | CommitRejected,
  never
> = Cell.layer({
  read,
  decode,
  decide: commitMessage,
  encode,
  write,
})
