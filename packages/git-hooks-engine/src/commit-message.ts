import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import { CommitAccepted, CommitIgnored, type CommitMessageDecision } from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { CommitRejected } from './commit-message.schema.js'
import { commitMessage, CommitMessageCommand } from './commit-message.workflow.js'
import type { CommitAllowed, CommitRefusal, CommitWaived } from './commit-message.workflow.js'

export { CommitRejected }

export const CommitMessageInput = Wire.wire({
  raw: Wire.mint(S.String),
  staged: Wire.mint(S.Array(S.String)),
})

type CommitMessageRequest = S.Schema.Type<typeof CommitMessageInput>

const TYPE_NAMES: ReadonlyArray<string> = [
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
]

const SCOPE_NAMES: ReadonlyArray<string> = [
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
]

const typeNames = [...TYPE_NAMES].sort().join(' / ')
const scopeNames = [...SCOPE_NAMES].sort().join(' / ')

const punctuatedProblem = (header: string): string =>
  Match.value(header.endsWith('.')).pipe(
    Match.when(true, () => 'the header must not end with a full stop'),
    Match.when(false, () => 'the subject must not end with a full stop'),
    Match.exhaustive,
  )

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

const decisionOf = (decision: CommitAllowed | CommitWaived): CommitMessageDecision =>
  Match.value(decision).pipe(
    Match.tag('CommitWaived', (waived) => CommitIgnored.make({ kind: waived.kind })),
    Match.tag('CommitAllowed', (allowed) =>
      CommitAccepted.make({
        type: allowed.type,
        scope: allowed.scope,
        subject: allowed.subject,
      })),
    Match.exhaustive,
  )

const read = (request: CommitMessageRequest): Effect.Effect<CommitMessageRequest> => Effect.succeed(request)

const decode = (
  raw: CommitMessageRequest,
): Result.Result<CommitMessageCommand, S.SchemaError> =>
  S.decodeUnknownResult(CommitMessageCommand)({
    _tag: 'CommitMessageCommand',
    raw: raw.raw,
    staged: [...raw.staged],
  })

const encode = (
  outcome: Result.Result<CommitAllowed | CommitWaived, CommitRefusal>,
): Result.Result<CommitMessageDecision, CommitRejected> =>
  Match.value(outcome).pipe(
    Match.tag('Success', (success) => Result.succeed(decisionOf(success.success))),
    Match.tag('Failure', (failure) =>
      Result.fail(
        CommitRejected.make({
          refusal: failure.failure,
          problem: problemOf(failure.failure),
        }),
      )),
    Match.exhaustive,
  )

const write = (
  output: Result.Result<CommitMessageDecision, CommitRejected>,
  _raw: CommitMessageRequest,
): Effect.Effect<CommitMessageDecision, S.SchemaError | CommitRejected> => Effect.fromResult(output)

export const commitMessageCell: Cell.Cell<
  CommitMessageRequest,
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
