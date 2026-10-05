import { Reporter } from '@systemfsoftware/cli-adapter'
import {
  type CommitMessageDecision,
  type CommitRejected,
  CommitScope,
  CommitType,
  type StagedChecksDecision,
} from '@systemfsoftware/git-hooks-engine'
import type { StagedChecksRefusal } from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import type * as S from 'effect/Schema'
import type { MessageFileMissing, MessageUnreadable } from './boundary.schema.js'

const commaList = (names: ReadonlyArray<string>): string => names.join(', ')

const COMMIT_TYPE_TRAILER = commaList(CommitType.literals)
const COMMIT_SCOPE_TRAILER = commaList(CommitScope.literals)

export const renderStagedChecks = (
  decision: StagedChecksDecision,
): Effect.Effect<void, never, Reporter> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    yield* Match.value(decision).pipe(
      Match.tag('StagedChecksPassed', (passed): Effect.Effect<void, never, Reporter> =>
        Effect.gen(function*() {
          if (passed.checks.includes('format')) {
            yield* reporter.note(`pre-commit: formatting ${passed.staged} staged file(s)`)
          }
          yield* reporter.exitCode(0)
        })),
      Match.tag('StagedVacant', 'MergeChecksSkipped', (): Effect.Effect<void, never, Reporter> => reporter.exitCode(0)),
      Match.exhaustive,
    )
  })

export const renderStagedChecksRefusal = (
  refusal: S.SchemaError | StagedChecksRefusal,
): Effect.Effect<void, never, Reporter> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    yield* Match.value(refusal).pipe(
      Match.tag(
        'SchemaError',
        (schema): Effect.Effect<void, never, Reporter> => reporter.annotateError(schema.message),
      ),
      Match.tag(
        'FormatRefused',
        (refused): Effect.Effect<void, never, Reporter> =>
          reporter.note(`pre-commit: format failed: ${refused.reason}`),
      ),
      Match.tag(
        'TypecheckRefused',
        (refused): Effect.Effect<void, never, Reporter> =>
          reporter.note(`pre-commit: typecheck failed: ${refused.reason}`),
      ),
      Match.tag(
        'LintRefused',
        (refused): Effect.Effect<void, never, Reporter> => reporter.note(`pre-commit: lint failed: ${refused.reason}`),
      ),
      Match.tag(
        'StagedStateUnreadable',
        (refused): Effect.Effect<void, never, Reporter> => reporter.note(`pre-commit: ${refused.reason}`),
      ),
      Match.exhaustive,
    )
    yield* reporter.exitCode(1)
  })

export const renderCommitMessage = (
  decision: CommitMessageDecision,
): Effect.Effect<void, never, Reporter> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    yield* Match.value(decision).pipe(
      Match.tag('CommitAccepted', 'CommitIgnored', (): Effect.Effect<void, never, Reporter> => reporter.exitCode(0)),
      Match.exhaustive,
    )
  })

export const renderCommitMessageRefusal = (
  refusal: S.SchemaError | MessageFileMissing | MessageUnreadable | StagedChecksRefusal | CommitRejected,
): Effect.Effect<void, never, Reporter> =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    yield* Match.value(refusal).pipe(
      Match.tag('SchemaError', (schema): Effect.Effect<void, never, Reporter> =>
        Effect.gen(function*() {
          yield* reporter.annotateError(schema.message)
          yield* reporter.exitCode(1)
        })),
      Match.tag('MessageFileMissing', (): Effect.Effect<void, never, Reporter> =>
        Effect.gen(function*() {
          yield* reporter.note('usage: commit-msg.ts <path-to-commit-message>')
          yield* reporter.exitCode(2)
        })),
      Match.tag('MessageUnreadable', (unreadable): Effect.Effect<void, never, Reporter> =>
        Effect.gen(function*() {
          yield* reporter.annotateError(`commit-msg: cannot read ${unreadable.path}: ${unreadable.detail}`)
          yield* reporter.exitCode(1)
        })),
      Match.tag(
        'FormatRefused',
        'TypecheckRefused',
        'LintRefused',
        'StagedStateUnreadable',
        (refused): Effect.Effect<void, never, Reporter> =>
          Effect.gen(function*() {
            yield* reporter.note(`commit-msg: ${refused.reason}`)
            yield* reporter.exitCode(1)
          }),
      ),
      Match.tag('CommitRejected', (rejected): Effect.Effect<void, never, Reporter> =>
        Effect.gen(function*() {
          yield* reporter.note(`commit-msg: ${rejected.problem}`)
          yield* reporter.note('')
          yield* reporter.note('  <type>(<scope>): <subject>')
          yield* reporter.note('')
          yield* reporter.note(`  types:  ${COMMIT_TYPE_TRAILER}`)
          yield* reporter.note(`  scopes: ${COMMIT_SCOPE_TRAILER}`)
          yield* reporter.exitCode(1)
        })),
      Match.exhaustive,
    )
  })
