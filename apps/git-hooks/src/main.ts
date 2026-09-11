import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { program, Reporter, ReporterLive } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { GitLive } from '@systemfsoftware/git-adapter'
import { commitMessageCell, CommitRejected, stagedChecksCell } from '@systemfsoftware/git-hooks-engine'
import { ProcessLive } from '@systemfsoftware/process-adapter'
import {
  type CommitMessageDecision,
  GitPort,
  type ProcessPort,
  type StagedChecksDecision,
  type StagedChecksRefusal,
  type StagedPath,
} from '@systemfsoftware/release-language'
import { Effect, FileSystem, Layer, Option } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import { Argument, Command } from 'effect/unstable/cli'
import { MessageFile, type MessageUnreadable } from './Invocation.schema.js'

const VERSION = '0.0.0'

const COMMIT_TYPES: ReadonlyArray<string> = [
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

const COMMIT_SCOPES: ReadonlyArray<string> = [
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

const COMMIT_TYPE_TRAILER = COMMIT_TYPES.join(', ')
const COMMIT_SCOPE_TRAILER = COMMIT_SCOPES.join(', ')

interface Rendered {
  readonly lines: ReadonlyArray<string>
  readonly annotation: Option.Option<string>
  readonly exitCode: number
}

const silent: Rendered = { lines: [], annotation: Option.none(), exitCode: 0 }

const report = (rendered: Rendered): Effect.Effect<void, never, Reporter> =>
  Effect.flatMap(Reporter, (reporter) =>
    Effect.andThen(
      Effect.forEach(rendered.lines, (line) => reporter.note(line), { discard: true }),
      () =>
        Effect.andThen(
          Option.match(rendered.annotation, {
            onNone: () => Effect.void,
            onSome: (text) => reporter.annotateError(text),
          }),
          () => reporter.exitCode(rendered.exitCode),
        ),
    ))

const preCommitDecision = (decision: StagedChecksDecision): Rendered =>
  Match.value(decision).pipe(
    Match.tag('StagedChecksPassed', (passed) =>
      Match.value(passed.checks.includes('format')).pipe(
        Match.when(true, (): Rendered => ({
          lines: [`pre-commit: formatting ${passed.staged} staged file(s)`],
          annotation: Option.none(),
          exitCode: 0,
        })),
        Match.when(false, () => silent),
        Match.exhaustive,
      )),
    Match.tag('StagedVacant', () => silent),
    Match.tag('MergeChecksSkipped', () => silent),
    Match.exhaustive,
  )

const preCommitFailure = (failure: S.SchemaError | StagedChecksRefusal): Rendered =>
  Match.value(failure).pipe(
    Match.tag('SchemaError', (schema): Rendered => ({
      lines: [],
      annotation: Option.some(schema.message),
      exitCode: 1,
    })),
    Match.tag('FormatRefused', (refused): Rendered => ({
      lines: [`pre-commit: format failed: ${refused.reason}`],
      annotation: Option.none(),
      exitCode: 1,
    })),
    Match.tag('TypecheckRefused', (refused): Rendered => ({
      lines: [`pre-commit: typecheck failed: ${refused.reason}`],
      annotation: Option.none(),
      exitCode: 1,
    })),
    Match.tag('LintRefused', (refused): Rendered => ({
      lines: [`pre-commit: lint failed: ${refused.reason}`],
      annotation: Option.none(),
      exitCode: 1,
    })),
    Match.tag('StagedStateUnreadable', (refused): Rendered => ({
      lines: [`pre-commit: ${refused.reason}`],
      annotation: Option.none(),
      exitCode: 1,
    })),
    Match.exhaustive,
  )

const commitMessageDecision = (decision: CommitMessageDecision): Rendered =>
  Match.value(decision).pipe(
    Match.tag('CommitAccepted', () => silent),
    Match.tag('CommitIgnored', () => silent),
    Match.exhaustive,
  )

const commitMessageFailure = (
  failure: S.SchemaError | MessageUnreadable | StagedChecksRefusal | CommitRejected,
): Rendered =>
  Match.value(failure).pipe(
    Match.tag('SchemaError', (schema): Rendered => ({
      lines: [],
      annotation: Option.some(schema.message),
      exitCode: 1,
    })),
    Match.tag('MessageUnreadable', (unreadable): Rendered => ({
      lines: [],
      annotation: Option.some(`commit-msg: cannot read ${unreadable.path}: ${unreadable.detail}`),
      exitCode: 1,
    })),
    Match.tag(
      'FormatRefused',
      'TypecheckRefused',
      'LintRefused',
      'StagedStateUnreadable',
      (refused): Rendered => ({
        lines: [`commit-msg: ${refused.reason}`],
        annotation: Option.none(),
        exitCode: 1,
      }),
    ),
    Match.tag('CommitRejected', (rejected): Rendered => ({
      lines: [
        `commit-msg: ${rejected.problem}`,
        '',
        '  <type>(<scope>): <subject>',
        '',
        `  types:  ${COMMIT_TYPE_TRAILER}`,
        `  scopes: ${COMMIT_SCOPE_TRAILER}`,
      ],
      annotation: Option.none(),
      exitCode: 1,
    })),
    Match.exhaustive,
  )

const stagedPathsOf: Effect.Effect<ReadonlyArray<StagedPath>, StagedChecksRefusal, GitPort> = Effect.flatMap(
  GitPort,
  (git) => git.stagedPaths(),
)

const preCommit = Command.make('pre-commit', {}, () =>
  stagedPathsOf.pipe(
    Effect.map((paths) => paths.filter((path) => path.startsWith('scripts/') && path.endsWith('.ts'))),
    Effect.flatMap((scripts) => Cell.run(stagedChecksCell, { scripts })),
    Effect.match({ onFailure: preCommitFailure, onSuccess: preCommitDecision }),
    Effect.flatMap(report),
  ))

const commitMsg = Command.make(
  'commit-msg',
  { messageFile: Argument.string('path-to-commit-message').pipe(Argument.optional) },
  ({ messageFile }) =>
    Option.match(messageFile, {
      onNone: () =>
        report({
          lines: ['usage: commit-msg.ts <path-to-commit-message>'],
          annotation: Option.none(),
          exitCode: 2,
        }),
      onSome: (given) =>
        S.decodeUnknownEffect(MessageFile)(given).pipe(
          Effect.flatMap((file) =>
            Effect.flatMap(FileSystem.FileSystem, (fs) =>
              Effect.mapError(
                fs.readFileString(file),
                (cause): MessageUnreadable => ({
                  _tag: 'MessageUnreadable',
                  path: file,
                  detail: cause.message,
                }),
              ))
          ),
          Effect.flatMap((raw) => Effect.map(stagedPathsOf, (staged) => ({ raw, staged }))),
          Effect.flatMap((request) => Cell.run(commitMessageCell, request)),
          Effect.match({ onFailure: commitMessageFailure, onSuccess: commitMessageDecision }),
          Effect.flatMap(report),
        ),
    }),
)

const hooks = Command.make('hooks').pipe(
  Command.withDescription('Run the repo git hooks (format, lint, commit-message gate)'),
  Command.withSubcommands([preCommit, commitMsg]),
)

const MainLive: Layer.Layer<GitPort | ProcessPort> = Layer.mergeAll(GitLive, ProcessLive)

NodeRuntime.runMain(
  Effect.provide(program(hooks, VERSION), Layer.mergeAll(MainLive, ReporterLive, NodeServices.layer)),
)
