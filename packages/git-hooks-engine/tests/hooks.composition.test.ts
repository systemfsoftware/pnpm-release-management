import { assert, assertEquals } from '@std/assert'
import { Cell } from '@systemfsoftware/effect-cell-types'
import type { CommitMessageDecision } from '@systemfsoftware/release-language'
import type { ProcessCompleted, PublishRefusal, WorkspaceCommand } from '@systemfsoftware/release-language'
import type { StagedChecksDecision } from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import { commitMessageCell, makeFakeGitPort, makeFakeProcessPort, stagedChecksCell } from '../mod.ts'

const decide = (
  raw: string,
  staged: ReadonlyArray<string>,
): Promise<CommitMessageDecision> => Effect.runPromise(Cell.run(commitMessageCell, { raw, staged }))

const refuse = async (
  raw: string,
  staged: ReadonlyArray<string>,
): Promise<{ readonly refusalTag: string; readonly problem: string }> => {
  const outcome = await Effect.runPromise(
    Effect.flip(Cell.run(commitMessageCell, { raw, staged })),
  )
  if (outcome._tag !== 'CommitRejected') {
    throw new Error(`expected CommitRejected, got ${outcome._tag}`)
  }
  return { refusalTag: outcome.refusal._tag, problem: outcome.problem }
}

Deno.test('hooks: conventional feat with production sources is accepted', async () => {
  const decision = await decide('feat(repo): add search', ['packages/search/src/index.ts'])
  assert(decision._tag === 'CommitAccepted')
  assertEquals(decision.type, 'feat')
  assertEquals(decision.scope, 'repo')
  assertEquals(decision.subject, 'add search')
})

Deno.test('hooks: empty staged sets skip shape checks', async () => {
  const decision = await decide('feat: add search', [])
  assert(decision._tag === 'CommitAccepted')
  assertEquals(decision.scope, undefined)
})

Deno.test('hooks: breaking-change markers are tolerated', async () => {
  const decision = await decide('feat!: drop the old api', ['packages/api/src/index.ts'])
  assert(decision._tag === 'CommitAccepted')
  assertEquals(decision.type, 'feat')
})

Deno.test('hooks: merge commits are ignored', async () => {
  const decision = await decide('Merge pull request #42 from alice/topic', [])
  assert(decision._tag === 'CommitIgnored')
  assertEquals(decision.kind, 'merge')
})

Deno.test('hooks: release chores are ignored', async () => {
  const decision = await decide('chore(release): 1.2.3', [])
  assert(decision._tag === 'CommitIgnored')
  assertEquals(decision.kind, 'release')
})

Deno.test('hooks: fixup markers are ignored', async () => {
  const decision = await decide('fixup! amend the earlier commit', [])
  assert(decision._tag === 'CommitIgnored')
  assertEquals(decision.kind, 'fixup')
})

Deno.test('hooks: malformed headers report the expected shape', async () => {
  const { refusalTag, problem } = await refuse('just some words', [])
  assertEquals(refusalTag, 'CommitHeaderMalformed')
  assertEquals(problem, `"just some words" is not "<type>(<scope>): <subject>"`)
})

Deno.test('hooks: digit types never parse as headers', async () => {
  const { refusalTag, problem } = await refuse('e2e: add tests', [])
  assertEquals(refusalTag, 'CommitHeaderMalformed')
  assertEquals(problem, `"e2e: add tests" is not "<type>(<scope>): <subject>"`)
})
Deno.test('hooks: unknown types name the allowed types', async () => {
  const { refusalTag, problem } = await refuse('hotfix(repo): patch it', [])
  assertEquals(refusalTag, 'CommitTypeUnknown')
  assertEquals(
    problem,
    `type "hotfix" is not one of ai / api / build / chore / ci / deps / docs / e2e / feat / fix / improvement / perf / refactor / revert / security / style / test`,
  )
})

Deno.test('hooks: unknown scopes name the allowed scopes', async () => {
  const { refusalTag, problem } = await refuse('feat(bogus): patch it', [])
  assertEquals(refusalTag, 'CommitScopeUnknown')
  assertEquals(
    problem,
    `scope "bogus" is not one of ci / deps / docs / e2e / gate / global / nix / plan / publish / release / repo / solutions / tag / version`,
  )
})

Deno.test('hooks: empty messages report emptiness with the staged count', async () => {
  const { refusalTag, problem } = await refuse('', ['a.ts', 'b.ts'])
  assertEquals(refusalTag, 'CommitEmpty')
  assertEquals(problem, 'the commit message is empty')
})

Deno.test('hooks: trailing full stops are refused', async () => {
  const { refusalTag, problem } = await refuse('fix: correct a typo.', [])
  assertEquals(refusalTag, 'CommitHeaderPunctuation')
  assertEquals(problem, 'the header must not end with a full stop')
})

Deno.test('hooks: AI co-author trailers are refused', async () => {
  const { refusalTag, problem } = await refuse(
    'feat: add search\n\nCo-authored-by: Helper <bot@noreply@anthropic.com>',
    [],
  )
  assertEquals(refusalTag, 'CommitAiAttribution')
  assertEquals(problem, 'AI co-authors and AI model references are not allowed in commit messages')
})

Deno.test('hooks: all-docs feats report the docs shape allowance', async () => {
  const { refusalTag, problem } = await refuse('feat: rewrite guide', ['docs/guide.md', 'README.md'])
  assertEquals(refusalTag, 'CommitShapeMismatched')
  assertEquals(problem, `"feat" with 100% docs paths — allowed types: ai / chore / docs`)
})

Deno.test('hooks: feats without production sources report the production rule', async () => {
  const { refusalTag, problem } = await refuse('fix: correct docs', ['README.md', 'tests/docs.spec.ts'])
  assertEquals(refusalTag, 'CommitProductionUntouched')
  assertEquals(problem, `"fix" must touch at least one production source file`)
})

const succeedAll = (
  command: WorkspaceCommand,
): Effect.Effect<ProcessCompleted, PublishRefusal> => Effect.succeed({ _tag: 'ProcessCompleted', command } as const)

const runStaged = (
  staged: ReadonlyArray<string>,
  merge: boolean,
  scripts: ReadonlyArray<string>,
  behavior: (command: WorkspaceCommand) => Effect.Effect<ProcessCompleted, PublishRefusal>,
): {
  readonly commands: ReadonlyArray<WorkspaceCommand>
  readonly result: Promise<StagedChecksDecision>
} => {
  const git = makeFakeGitPort({ staged, merge })
  const process = makeFakeProcessPort(behavior)
  const runnable = Cell.provide(Cell.provide(stagedChecksCell, git), process.layer)
  return {
    commands: process.commands,
    result: Effect.runPromise(Cell.run(runnable, { scripts: [...scripts] })),
  }
}

Deno.test('hooks: merges skip checks without running commands', async () => {
  const { commands, result } = runStaged(['src/app.ts'], true, ['scripts/a.ts'], succeedAll)
  const decision = await result
  assert(decision._tag === 'MergeChecksSkipped')
  assertEquals(decision.staged, 1)
  assertEquals(commands.length, 0)
})

Deno.test('hooks: vacant staged sets run no commands', async () => {
  const { commands, result } = runStaged([], false, ['scripts/a.ts'], succeedAll)
  const decision = await result
  assert(decision._tag === 'StagedVacant')
  assertEquals(decision.staged, 0)
  assertEquals(commands.length, 0)
})

Deno.test('hooks: staged sets run format, typecheck and lint in order', async () => {
  const { commands, result } = runStaged(
    ['src/app.ts', 'README.md', 'run.exe', 'deno.lock'],
    false,
    ['scripts/a.ts'],
    succeedAll,
  )
  const decision = await result
  assert(decision._tag === 'StagedChecksPassed')
  assertEquals([...decision.checks], ['format', 'typecheck', 'lint'])
  assertEquals(
    commands.map((command) => ({ program: String(command.program), args: command.args.map(String) })),
    [
      {
        program: './bin/dprint',
        args: ['fmt', '--allow-no-files', '--', 'src/app.ts', 'README.md'],
      },
      { program: 'deno', args: ['check', 'scripts/a.ts'] },
      { program: 'deno', args: ['lint', '--quiet'] },
    ],
  )
})

Deno.test('hooks: format failures refuse with the format command', async () => {
  const git = makeFakeGitPort({ staged: ['src/app.ts'], merge: false })
  const process = makeFakeProcessPort((command) =>
    command.program === './bin/dprint'
      ? Effect.fail({ _tag: 'PublishCommandRefused', command, reason: 'dprint boom' } as const)
      : succeedAll(command)
  )
  const runnable = Cell.provide(Cell.provide(stagedChecksCell, git), process.layer)
  const refusal = await Effect.runPromise(Effect.flip(Cell.run(runnable, { scripts: ['scripts/a.ts'] })))
  assert(refusal._tag === 'FormatRefused')
  assertEquals(refusal.command.kind, 'format')
  assertEquals(refusal.command.command.program, './bin/dprint')
  assertEquals(refusal.reason, 'dprint boom')
  assertEquals(process.commands.length, 1)
})

Deno.test('hooks: typecheck failures refuse after format', async () => {
  const git = makeFakeGitPort({ staged: ['src/app.ts'], merge: false })
  const process = makeFakeProcessPort((command) =>
    command.program === 'deno' && command.args[0] === 'check'
      ? Effect.fail({ _tag: 'PublishCommandRefused', command, reason: 'type boom' } as const)
      : succeedAll(command)
  )
  const runnable = Cell.provide(Cell.provide(stagedChecksCell, git), process.layer)
  const refusal = await Effect.runPromise(Effect.flip(Cell.run(runnable, { scripts: ['scripts/a.ts'] })))
  assert(refusal._tag === 'TypecheckRefused')
  assertEquals(refusal.command.kind, 'typecheck')
  assertEquals(refusal.reason, 'type boom')
  assertEquals(process.commands.length, 2)
})

Deno.test('hooks: lint failures refuse last', async () => {
  const git = makeFakeGitPort({ staged: ['src/app.ts'], merge: false })
  const process = makeFakeProcessPort((command) =>
    command.program === 'deno' && command.args[0] === 'lint'
      ? Effect.fail({ _tag: 'PublishCommandRefused', command, reason: 'lint boom' } as const)
      : succeedAll(command)
  )
  const runnable = Cell.provide(Cell.provide(stagedChecksCell, git), process.layer)
  const refusal = await Effect.runPromise(Effect.flip(Cell.run(runnable, { scripts: ['scripts/a.ts'] })))
  assert(refusal._tag === 'LintRefused')
  assertEquals(refusal.command.kind, 'lint')
  assertEquals(refusal.reason, 'lint boom')
  assertEquals(process.commands.length, 3)
})

Deno.test('hooks: unreadable staged state refuses without running commands', async () => {
  const git = makeFakeGitPort({
    staged: [],
    merge: false,
    stagedError: { _tag: 'StagedStateUnreadable', reason: 'git exploded' } as const,
  })
  const process = makeFakeProcessPort(succeedAll)
  const runnable = Cell.provide(Cell.provide(stagedChecksCell, git), process.layer)
  const refusal = await Effect.runPromise(Effect.flip(Cell.run(runnable, { scripts: ['scripts/a.ts'] })))
  assert(refusal._tag === 'StagedStateUnreadable')
  assertEquals(refusal.reason, 'git exploded')
  assertEquals(process.commands.length, 0)
})
