import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { CommitMessageCommand } from './commit-message.schema.js'
import {
  commitMessage,
  CommitMessageDecision,
  CommitRejected,
  CommitScope,
  CommitType,
} from './commit-message.workflow.js'
import type { CommitRefusal } from './commit-message.workflow.js'

export const CommitMessageInput = Wire.wire({
  raw: Wire.mint(S.String),
  staged: Wire.mint(S.Array(S.String)),
})

type CommitMessageRequest = S.Schema.Type<typeof CommitMessageInput>

const typeNames = [...CommitType.literals].sort().join(' / ')
const scopeNames = [...CommitScope.literals].sort().join(' / ')

const punctuatedProblem = (header: string): string => {
  if (header.endsWith('.')) return 'the header must not end with a full stop'
  return 'the subject must not end with a full stop'
}

const problemOf = (refusal: CommitRefusal): string =>
  Match.value(refusal).pipe(
    Match.tag('CommitEmpty', () => 'the commit message is empty'),
    Match.tag(
      'CommitHeaderMalformed',
      (malformed) => `"${malformed.header}" is not "<type>(<scope>): <subject>"`,
    ),
    Match.tag('CommitTypeUnknown', (unknown) => `type "${unknown.type}" is not one of ${typeNames}`),
    Match.tag('CommitScopeUnknown', (unknown) => `scope "${unknown.scope}" is not one of ${scopeNames}`),
    Match.tag('CommitSubjectEmpty', () => 'the subject is empty'),
    Match.tag('CommitHeaderPunctuation', (punctuated) => punctuatedProblem(punctuated.header)),
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

const read = (request: CommitMessageRequest): Effect.Effect<CommitMessageCommand> =>
  Effect.succeed(CommitMessageCommand.make({ raw: request.raw, staged: [...request.staged] }))

const rejected = (refusal: CommitRefusal): CommitRejected =>
  CommitRejected.make({ refusal, problem: problemOf(refusal) })

const write = (
  outcome: Result.Result<CommitMessageDecision, CommitRefusal>,
  _raw: CommitMessageCommand,
): Effect.Effect<CommitMessageDecision, CommitRejected> => Effect.fromResult(Result.mapError(outcome, rejected))

export const commitMessageCell: Cell.Cell<
  CommitMessageRequest,
  CommitMessageDecision,
  CommitRejected,
  never
> = Cell.layer({
  read,
  decide: commitMessage,
  write,
})
