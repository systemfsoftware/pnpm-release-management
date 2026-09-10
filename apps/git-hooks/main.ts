#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run=git,deno,dprint,./bin/dprint --allow-env
import { DenoRuntime } from '@effect/platform-deno'
import { program, Reporter } from '@systemfsoftware/cli-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { commitMessageCell, CommitRejected, stagedChecksCell } from '@systemfsoftware/git-hooks-engine'
import { Effect, Option } from 'effect'
import * as Match from 'effect/Match'
import { Argument, Command } from 'effect/unstable/cli'
import { MainLive } from './MainLive.ts'

const TYPE_NAMES =
  'ai / api / build / chore / ci / deps / docs / e2e / feat / fix / improvement / perf / refactor / revert / security / style / test'
const SCOPE_NAMES =
  'ci / deps / docs / e2e / gate / global / nix / plan / publish / release / repo / solutions / tag / version'
const TYPES_TRAILER =
  'ai, api, build, chore, ci, deps, docs, e2e, feat, fix, improvement, perf, refactor, revert, security, style, test'
const SCOPES_TRAILER = 'ci, deps, docs, e2e, gate, global, nix, plan, publish, release, repo, solutions, tag, version'

const gitLines = (args: ReadonlyArray<string>): Effect.Effect<Array<string>> =>
  Effect.promise(async () => {
    try {
      const output = await new Deno.Command('git', {
        args: [...args],
        stdout: 'piped',
        stderr: 'piped',
      }).output()
      if (!output.success) return []
      return new TextDecoder().decode(output.stdout).split('\n').map((line) => line.trim()).filter((line) =>
        line.length > 0
      )
    } catch {
      return []
    }
  })

const preCommit = Command.make('pre-commit', {}, () =>
  Effect.gen(function*() {
    const reporter = yield* Reporter
    const allScripts = yield* gitLines(['ls-files', 'scripts'])
    const scripts = allScripts.filter((file) => file.endsWith('.ts'))
    yield* Cell.run(stagedChecksCell, { scripts }).pipe(
      Effect.tap((decision) =>
        decision._tag === 'StagedChecksPassed' && decision.checks.includes('format')
          ? reporter.note(`pre-commit: formatting ${decision.staged} staged file(s)`)
          : Effect.void
      ),
      Effect.catch((error) =>
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
        )
      ),
    )
  }))

const commitMsg = Command.make(
  'commit-msg',
  { messageFile: Argument.string('path-to-commit-message').pipe(Argument.optional) },
  ({ messageFile }) =>
    Effect.gen(function*() {
      const reporter = yield* Reporter
      const messagePath = Option.getOrUndefined(messageFile)
      if (messagePath === undefined) {
        yield* reporter.note('usage: commit-msg.ts <path-to-commit-message>')
        yield* reporter.exitCode(2)
        return
      }
      const raw = yield* Effect.tryPromise({
        try: () => Deno.readTextFile(messagePath),
        catch: (cause) =>
          new Error(
            `commit-msg: cannot read ${messagePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
          ),
      })
      const staged = yield* gitLines(['diff', '--cached', '--name-only'])
      yield* Cell.run(commitMessageCell, { raw, staged }).pipe(
        Effect.catch((error) =>
          error instanceof CommitRejected
            ? Effect.gen(function*() {
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
                Match.tag('CommitHeaderPunctuation', (punctuated) =>
                  punctuated.header.endsWith('.')
                    ? 'the header must not end with a full stop'
                    : 'the subject must not end with a full stop'),
                Match.tag(
                  'CommitAiAttribution',
                  () => 'AI co-authors and AI model references are not allowed in commit messages',
                ),
                Match.tag('CommitShapeMismatched', (mismatched) =>
                  `"${mismatched.type}" with 100% ${mismatched.shape} paths — allowed types: ${
                    [...mismatched.allowed].sort().join(' / ')
                  }`),
                Match.tag(
                  'CommitProductionUntouched',
                  (untouched) => `"${untouched.type}" must touch at least one production source file`,
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
            : Effect.fail(error)
        ),
      )
    }),
)

const hooks = Command.make('hooks').pipe(
  Command.withDescription('Run the repo git hooks (format, lint, commit-message gate)'),
  Command.withSubcommands([preCommit, commitMsg]),
)

DenoRuntime.runMain(Effect.provide(program(hooks, '0.0.0'), MainLive))
