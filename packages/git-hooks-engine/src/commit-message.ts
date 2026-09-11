import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import { CommitMessageDecision, CommitMessageRefusal } from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { CommitAcceptedWire, CommitIgnoredWire, CommitRejected } from './commit-message.schema.js'
import type { DecisionWire } from './commit-message.schema.js'
import { commitMessage, CommitMessageCommand } from './commit-message.workflow.js'
import type { CommitAllowed, CommitRefusal, CommitWaived } from './commit-message.workflow.js'

export { CommitRejected }

export const CommitMessageInput = Wire.wire({
  raw: Wire.mint(S.String),
  staged: Wire.mint(S.Array(S.String)),
})

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

const decisionWire = (decision: CommitAllowed | CommitWaived): DecisionWire =>
  Match.value(decision).pipe(
    Match.tag('CommitWaived', (waived) => CommitIgnoredWire.make({ kind: waived.kind })),
    Match.tag('CommitAllowed', (allowed) => {
      if (allowed.scope === undefined) {
        return CommitAcceptedWire.make({ type: allowed.type, subject: allowed.subject })
      }
      return CommitAcceptedWire.make({ type: allowed.type, scope: allowed.scope, subject: allowed.subject })
    }),
    Match.exhaustive,
  )
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
