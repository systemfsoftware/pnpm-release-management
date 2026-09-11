import { NodeRuntime } from '@effect/platform-node'
import { program, Reporter } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { GitLive } from '@systemfsoftware/git-adapter'
import { commitMessageCell, CommitRejected, stagedChecksCell } from '@systemfsoftware/git-hooks-engine'
import { ProcessLive } from '@systemfsoftware/process-adapter'
import type { GitPort, ProcessPort } from '@systemfsoftware/release-language'
import { Effect, FileSystem, Layer, Option } from 'effect'
import * as Match from 'effect/Match'
import { Argument, Command } from 'effect/unstable/cli'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'

const TYPE_NAMES =
  'ai / api / build / chore / ci / deps / docs / e2e / feat / fix / improvement / perf / refactor / revert / security / style / test'
const SCOPE_NAMES =
  'ci / deps / docs / e2e / gate / global / nix / plan / publish / release / repo / solutions / tag / version'
const TYPES_TRAILER =
  'ai, api, build, chore, ci, deps, docs, e2e, feat, fix, improvement, perf, refactor, revert, security, style, test'
const SCOPES_TRAILER = 'ci, deps, docs, e2e, gate, global, nix, plan, publish, release, repo, solutions, tag, version'

const causeMessage = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message
  }
  if (typeof cause === 'string') {
    return cause
  }
  return 'unknown'
}

const compareStrings = (left: string, right: string): number => {
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }
  return 0
}

const gitLines = (
  args: ReadonlyArray<string>,
): Effect.Effect<Array<string>, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function*() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const lines = yield* spawner.lines(ChildProcess.make('git', [...args])).pipe(
      Effect.orElseSucceed((): Array<string> => []),
    )
    return lines.map((line) => line.trim()).filter((line) => line.length > 0)
  })
const preCommit = Command.make('pre-commit', {}, () =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    const allScripts = yield* gitLines(['ls-files', 'scripts'])
    const scripts = allScripts.filter((file) => file.endsWith('.ts'))
    yield* Cell.run(stagedChecksCell, { scripts }).pipe(
      Effect.tap((decision) =>
        Match.value(decision).pipe(
          Match.tag('StagedChecksPassed', (passed) => {
            if (passed.checks.includes('format')) {
              return reporter.note(`pre-commit: formatting ${passed.staged} staged file(s)`)
            }
            return Effect.void
          }),
          Match.orElse(() => Effect.void),
        )
      ),
      Effect.catchIf((): boolean => true, (error) =>
        Match.value(error).pipe(
          Match.tag('SchemaError', (parseError) => Effect.fail(parseError)),
          Match.tag('FormatRefused', (refused) =>
            Effect.andThen(
              reporter.note(`pre-commit: format failed: ${refused.reason}`),
              () => reporter.exitCode(1),
            )),
          Match.tag('TypecheckRefused', (refused) =>
            Effect.andThen(
              reporter.note(`pre-commit: typecheck failed: ${refused.reason}`),
              () => reporter.exitCode(1),
            )),
          Match.tag('LintRefused', (refused) =>
            Effect.andThen(
              reporter.note(`pre-commit: lint failed: ${refused.reason}`),
              () => reporter.exitCode(1),
            )),
          Match.tag('StagedStateUnreadable', (refused) =>
            Effect.andThen(
              reporter.note(`pre-commit: ${refused.reason}`),
              () => reporter.exitCode(1),
            )),
          Match.exhaustive,
        )),
    )
  }))

const commitMsg = Command.make(
  'commit-msg',
  { messageFile: Argument.string('path-to-commit-message').pipe(Argument.optional) },
  ({ messageFile }) =>
    Effect.gen(function*() {
      const reporter = yield* Reporter
      const fs = yield* FileSystem.FileSystem
      const messagePath = Option.getOrUndefined(messageFile)
      if (messagePath === undefined) {
        yield* reporter.note('usage: commit-msg.ts <path-to-commit-message>')
        yield* reporter.exitCode(2)
        return
      }
      const raw = yield* fs.readFileString(messagePath).pipe(
        Effect.mapError((cause) =>
          new Error(
            `commit-msg: cannot read ${messagePath}: ${causeMessage(cause)}`,
            { cause },
          )
        ),
      )
      const staged = yield* gitLines(['diff', '--cached', '--name-only'])
      yield* Cell.run(commitMessageCell, { raw, staged }).pipe(
        Effect.catchIf((): boolean => true, (error) => {
          if (error instanceof CommitRejected) {
            return Effect.gen(function*() {
              const problem = Match.value(error.refusal).pipe(
                Match.tag('CommitEmpty', () => 'the commit message is empty'),
                Match.tag(
                  'CommitHeaderMalformed',
                  (malformed) => `"${malformed.header}" is not "<type>(<scope>): <subject>"`,
                ),
                Match.tag(
                  'CommitTypeUnknown',
                  (unknown) => `type "${unknown.type}" is not one of ${TYPE_NAMES}`,
                ),
                Match.tag(
                  'CommitScopeUnknown',
                  (unknown) => `scope "${unknown.scope}" is not one of ${SCOPE_NAMES}`,
                ),
                Match.tag('CommitSubjectEmpty', () => 'the subject is empty'),
                Match.tag('CommitHeaderPunctuation', (punctuated) => {
                  if (punctuated.header.endsWith('.')) {
                    return 'the header must not end with a full stop'
                  }
                  return 'the subject must not end with a full stop'
                }),
                Match.tag(
                  'CommitAiAttribution',
                  () => 'AI co-authors and AI model references are not allowed in commit messages',
                ),
                Match.tag('CommitShapeMismatched', (mismatched) =>
                  `"${mismatched.type}" with 100% ${mismatched.shape} paths — allowed types: ${
                    [...mismatched.allowed].sort(compareStrings).join(' / ')
                  }`),
                Match.tag(
                  'CommitProductionUntouched',
                  (untouched) =>
                    `"${untouched.type}" must touch at least one production source file`,
                ),
                Match.exhaustive,
              )
              yield* reporter.note(`commit-msg: ${problem}`)
              yield* reporter.note('')
              yield* reporter.note('  <type>(<scope>): <subject>')
              yield* reporter.note('')
              yield* reporter.note(`  types:  ${TYPES_TRAILER}`)
              yield* reporter.note(`  scopes: ${SCOPES_TRAILER}`)
              yield* reporter.exitCode(1)
            })
          }
          return Effect.fail(error)
        }),
      )
    }),
)

const hooks = Command.make('hooks').pipe(
  Command.withDescription('Run the repo git hooks (format, lint, commit-message gate)'),
  Command.withSubcommands([preCommit, commitMsg]),
)

const MainLive: Layer.Layer<GitPort | ProcessPort> = Layer.mergeAll(GitLive, ProcessLive)

NodeRuntime.runMain(Effect.provide(program(hooks, '0.0.0'), MainLive))
