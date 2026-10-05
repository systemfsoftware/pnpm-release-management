import { Cell } from '@systemfsoftware/effect-cell-types'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import {
  commitMessageCell,
  CommitRejected,
  stagedChecksCell,
  type StagedChecksDecision,
} from '@systemfsoftware/git-hooks-engine'
import type { CommandRefusal, ProcessCompleted, WorkspaceCommand } from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import { expect } from 'vitest'
import { makeFakeGitPort } from './__fixtures__/FakeGitPort.js'
import { makeFakeProcessPort } from './__fixtures__/FakeProcessPort.js'

const Feature = makeFeature({ it, layer })

const failUnexpected = (message: string): never => {
  throw new Error(message)
}
const mustReject = (rejection: S.SchemaError | CommitRejected): CommitRejected => {
  if (rejection instanceof CommitRejected) return rejection
  return failUnexpected('expected commit rejection')
}

const succeedAll = (
  command: WorkspaceCommand,
): Effect.Effect<ProcessCompleted, CommandRefusal> => Effect.succeed({ _tag: 'ProcessCompleted', command } as const)

Feature('Commit policy').body(({ scenario }) => {
  scenario(
    'A conventional feat touching production sources is accepted',
    Gherkin.Do.pipe(
      Given('a feat commit touching production sources was prepared')(
        'input',
        () => Effect.succeed({ raw: 'feat(repo): add search', staged: ['packages/search/src/index.ts'] }),
      ),
      When('the commit message is checked')('outcome', (s) =>
        Cell.run(commitMessageCell, s.input).pipe(
          Effect.match({
            onFailure: (rejection) => ({ _tag: 'rejected', rejection: mustReject(rejection) }) as const,
            onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
          }),
        )),
      Then('the commit is accepted with its type, scope and subject')((s) => {
        Match.value(s.outcome).pipe(
          Match.tag('decided', (decided) =>
            Match.value(decided.decision).pipe(
              Match.tag('CommitAccepted', (accepted) => {
                expect(accepted.type).toEqual('feat')
                expect(accepted.scope).toEqual('repo')
                expect(accepted.subject).toEqual('add search')
              }),
              Match.orElse(() => failUnexpected('expected accepted')),
            )),
          Match.orElse(() => failUnexpected('expected decided')),
        )
      }),
    ),
  )

  scenario(
    'An empty staged set skips the shape checks',
    Gherkin.Do.pipe(
      Given('a scoped feat with no staged paths was prepared')(
        'input',
        () => Effect.succeed({ raw: 'feat: add search', staged: [] }),
      ),
      When('the commit message is checked')('outcome', (s) =>
        Cell.run(commitMessageCell, s.input).pipe(
          Effect.match({
            onFailure: (rejection) => ({ _tag: 'rejected', rejection: mustReject(rejection) }) as const,
            onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
          }),
        )),
      Then('the commit is accepted without a scope')((s) => {
        Match.value(s.outcome).pipe(
          Match.tag('decided', (decided) =>
            Match.value(decided.decision).pipe(
              Match.tag('CommitAccepted', (accepted) => {
                expect(accepted.scope).toBeUndefined()
              }),
              Match.orElse(() => failUnexpected('expected accepted')),
            )),
          Match.orElse(() => failUnexpected('expected decided')),
        )
      }),
    ),
  )

  scenario(
    'A breaking-change marker is tolerated',
    Gherkin.Do.pipe(
      Given('a breaking feat touching production sources was prepared')(
        'input',
        () => Effect.succeed({ raw: 'feat!: drop the old api', staged: ['packages/api/src/index.ts'] }),
      ),
      When('the commit message is checked')('outcome', (s) =>
        Cell.run(commitMessageCell, s.input).pipe(
          Effect.match({
            onFailure: (rejection) => ({ _tag: 'rejected', rejection: mustReject(rejection) }) as const,
            onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
          }),
        )),
      Then('the commit is accepted as a feat')((s) => {
        Match.value(s.outcome).pipe(
          Match.tag('decided', (decided) =>
            Match.value(decided.decision).pipe(
              Match.tag('CommitAccepted', (accepted) => {
                expect(accepted.type).toEqual('feat')
              }),
              Match.orElse(() => failUnexpected('expected accepted')),
            )),
          Match.orElse(() => failUnexpected('expected decided')),
        )
      }),
    ),
  )

  scenario(
    'A merge commit is ignored',
    Gherkin.Do.pipe(
      Given('a merge pull request message was prepared')(
        'input',
        () => Effect.succeed({ raw: 'Merge pull request #42 from alice/topic', staged: [] }),
      ),
      When('the commit message is checked')('outcome', (s) =>
        Cell.run(commitMessageCell, s.input).pipe(
          Effect.match({
            onFailure: (rejection) => ({ _tag: 'rejected', rejection: mustReject(rejection) }) as const,
            onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
          }),
        )),
      Then('the commit is ignored as a merge')((s) => {
        Match.value(s.outcome).pipe(
          Match.tag('decided', (decided) =>
            Match.value(decided.decision).pipe(
              Match.tag('CommitIgnored', (ignored) => {
                expect(ignored.kind).toEqual('merge')
              }),
              Match.orElse(() => failUnexpected('expected ignored')),
            )),
          Match.orElse(() => failUnexpected('expected decided')),
        )
      }),
    ),
  )

  scenario(
    'A release chore is ignored',
    Gherkin.Do.pipe(
      Given('a release chore message was prepared')(
        'input',
        () => Effect.succeed({ raw: 'chore(release): 1.2.3', staged: [] }),
      ),
      When('the commit message is checked')('outcome', (s) =>
        Cell.run(commitMessageCell, s.input).pipe(
          Effect.match({
            onFailure: (rejection) => ({ _tag: 'rejected', rejection: mustReject(rejection) }) as const,
            onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
          }),
        )),
      Then('the commit is ignored as a release')((s) => {
        Match.value(s.outcome).pipe(
          Match.tag('decided', (decided) =>
            Match.value(decided.decision).pipe(
              Match.tag('CommitIgnored', (ignored) => {
                expect(ignored.kind).toEqual('release')
              }),
              Match.orElse(() => failUnexpected('expected ignored')),
            )),
          Match.orElse(() => failUnexpected('expected decided')),
        )
      }),
    ),
  )

  scenario(
    'A fixup marker is ignored',
    Gherkin.Do.pipe(
      Given('a fixup message was prepared')(
        'input',
        () => Effect.succeed({ raw: 'fixup! amend the earlier commit', staged: [] }),
      ),
      When('the commit message is checked')('outcome', (s) =>
        Cell.run(commitMessageCell, s.input).pipe(
          Effect.match({
            onFailure: (rejection) => ({ _tag: 'rejected', rejection: mustReject(rejection) }) as const,
            onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
          }),
        )),
      Then('the commit is ignored as a fixup')((s) => {
        Match.value(s.outcome).pipe(
          Match.tag('decided', (decided) =>
            Match.value(decided.decision).pipe(
              Match.tag('CommitIgnored', (ignored) => {
                expect(ignored.kind).toEqual('fixup')
              }),
              Match.orElse(() => failUnexpected('expected ignored')),
            )),
          Match.orElse(() => failUnexpected('expected decided')),
        )
      }),
    ),
  )

  scenario(
    'A malformed header reports the expected shape',
    Gherkin.Do.pipe(
      Given('a message without a conventional shape was prepared')(
        'input',
        () => Effect.succeed({ raw: 'just some words', staged: [] }),
      ),
      When('the commit message is checked')('outcome', (s) =>
        Cell.run(commitMessageCell, s.input).pipe(
          Effect.match({
            onFailure: (rejection) => ({ _tag: 'rejected', rejection: mustReject(rejection) }) as const,
            onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
          }),
        )),
      Then('the header is refused with the shape guidance')((s) => {
        Match.value(s.outcome).pipe(
          Match.tag('rejected', (rejected) => {
            expect(rejected.rejection.problem).toEqual('"just some words" is not "<type>(<scope>): <subject>"')
            Match.value(rejected.rejection.refusal).pipe(
              Match.tag('CommitHeaderMalformed', () => undefined),
              Match.orElse(() => failUnexpected('expected malformed header')),
            )
          }),
          Match.orElse(() => failUnexpected('expected rejected')),
        )
      }),
    ),
  )

  scenario(
    'A digit-led type never parses as a header',
    Gherkin.Do.pipe(
      Given('a message with a digit-led type was prepared')(
        'input',
        () => Effect.succeed({ raw: 'e2e: add tests', staged: [] }),
      ),
      When('the commit message is checked')('outcome', (s) =>
        Cell.run(commitMessageCell, s.input).pipe(
          Effect.match({
            onFailure: (rejection) => ({ _tag: 'rejected', rejection: mustReject(rejection) }) as const,
            onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
          }),
        )),
      Then('the header is refused with the shape guidance')((s) => {
        Match.value(s.outcome).pipe(
          Match.tag('rejected', (rejected) => {
            expect(rejected.rejection.problem).toEqual('"e2e: add tests" is not "<type>(<scope>): <subject>"')
            Match.value(rejected.rejection.refusal).pipe(
              Match.tag('CommitHeaderMalformed', () => undefined),
              Match.orElse(() => failUnexpected('expected malformed header')),
            )
          }),
          Match.orElse(() => failUnexpected('expected rejected')),
        )
      }),
    ),
  )

  scenario(
    'An unknown type names the allowed types',
    Gherkin.Do.pipe(
      Given('a message with an unknown type was prepared')(
        'input',
        () => Effect.succeed({ raw: 'hotfix(repo): patch it', staged: [] }),
      ),
      When('the commit message is checked')('outcome', (s) =>
        Cell.run(commitMessageCell, s.input).pipe(
          Effect.match({
            onFailure: (rejection) => ({ _tag: 'rejected', rejection: mustReject(rejection) }) as const,
            onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
          }),
        )),
      Then('the type is refused with the full type list')((s) => {
        Match.value(s.outcome).pipe(
          Match.tag('rejected', (rejected) => {
            expect(rejected.rejection.problem).toEqual(
              'type "hotfix" is not one of ai / api / build / chore / ci / deps / docs / e2e / feat / fix / improvement / perf / refactor / revert / security / style / test',
            )
            Match.value(rejected.rejection.refusal).pipe(
              Match.tag('CommitTypeUnknown', () => undefined),
              Match.orElse(() => failUnexpected('expected unknown type')),
            )
          }),
          Match.orElse(() => failUnexpected('expected rejected')),
        )
      }),
    ),
  )

  scenario(
    'An unknown scope names the allowed scopes',
    Gherkin.Do.pipe(
      Given('a message with an unknown scope was prepared')(
        'input',
        () => Effect.succeed({ raw: 'feat(bogus): patch it', staged: [] }),
      ),
      When('the commit message is checked')('outcome', (s) =>
        Cell.run(commitMessageCell, s.input).pipe(
          Effect.match({
            onFailure: (rejection) => ({ _tag: 'rejected', rejection: mustReject(rejection) }) as const,
            onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
          }),
        )),
      Then('the scope is refused with the full scope list')((s) => {
        Match.value(s.outcome).pipe(
          Match.tag('rejected', (rejected) => {
            expect(rejected.rejection.problem).toEqual(
              'scope "bogus" is not one of ci / deps / docs / e2e / gate / global / nix / plan / publish / release / repo / solutions / tag / version',
            )
            Match.value(rejected.rejection.refusal).pipe(
              Match.tag('CommitScopeUnknown', () => undefined),
              Match.orElse(() => failUnexpected('expected unknown scope')),
            )
          }),
          Match.orElse(() => failUnexpected('expected rejected')),
        )
      }),
    ),
  )

  scenario(
    'An empty message reports emptiness',
    Gherkin.Do.pipe(
      Given('an empty message with staged paths was prepared')(
        'input',
        () => Effect.succeed({ raw: '', staged: ['a.ts', 'b.ts'] }),
      ),
      When('the commit message is checked')('outcome', (s) =>
        Cell.run(commitMessageCell, s.input).pipe(
          Effect.match({
            onFailure: (rejection) => ({ _tag: 'rejected', rejection: mustReject(rejection) }) as const,
            onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
          }),
        )),
      Then('the message is refused as empty')((s) => {
        Match.value(s.outcome).pipe(
          Match.tag('rejected', (rejected) => {
            Match.value(rejected.rejection.refusal).pipe(
              Match.tag('CommitEmpty', () => undefined),
              Match.orElse(() => failUnexpected('expected empty')),
            )
          }),
          Match.orElse(() => failUnexpected('expected rejected')),
        )
      }),
    ),
  )

  scenario(
    'A trailing full stop is refused',
    Gherkin.Do.pipe(
      Given('a header ending with a full stop was prepared')(
        'input',
        () => Effect.succeed({ raw: 'fix: correct a typo.', staged: [] }),
      ),
      When('the commit message is checked')('outcome', (s) =>
        Cell.run(commitMessageCell, s.input).pipe(
          Effect.match({
            onFailure: (rejection) => ({ _tag: 'rejected', rejection: mustReject(rejection) }) as const,
            onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
          }),
        )),
      Then('the header is refused for punctuation')((s) => {
        Match.value(s.outcome).pipe(
          Match.tag('rejected', (rejected) => {
            expect(rejected.rejection.problem).toEqual('the header must not end with a full stop')
            Match.value(rejected.rejection.refusal).pipe(
              Match.tag('CommitHeaderPunctuation', () => undefined),
              Match.orElse(() => failUnexpected('expected punctuation')),
            )
          }),
          Match.orElse(() => failUnexpected('expected rejected')),
        )
      }),
    ),
  )

  scenario(
    'An AI co-author trailer is refused',
    Gherkin.Do.pipe(
      Given('a message with an AI co-author trailer was prepared')('input', () =>
        Effect.succeed({
          raw: 'feat: add search\n\nCo-authored-by: Helper <bot@noreply@anthropic.com>',
          staged: [],
        })),
      When('the commit message is checked')('outcome', (s) =>
        Cell.run(commitMessageCell, s.input).pipe(
          Effect.match({
            onFailure: (rejection) => ({ _tag: 'rejected', rejection: mustReject(rejection) }) as const,
            onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
          }),
        )),
      Then('the message is refused for AI attribution')((s) => {
        Match.value(s.outcome).pipe(
          Match.tag('rejected', (rejected) => {
            expect(rejected.rejection.problem).toEqual(
              'AI co-authors and AI model references are not allowed in commit messages',
            )
            Match.value(rejected.rejection.refusal).pipe(
              Match.tag('CommitAiAttribution', () => undefined),
              Match.orElse(() => failUnexpected('expected attribution')),
            )
          }),
          Match.orElse(() => failUnexpected('expected rejected')),
        )
      }),
    ),
  )

  scenario(
    'An all-docs feat reports the docs shape allowance',
    Gherkin.Do.pipe(
      Given('a feat touching only docs paths was prepared')(
        'input',
        () => Effect.succeed({ raw: 'feat: rewrite guide', staged: ['docs/guide.md', 'README.md'] }),
      ),
      When('the commit message is checked')('outcome', (s) =>
        Cell.run(commitMessageCell, s.input).pipe(
          Effect.match({
            onFailure: (rejection) => ({ _tag: 'rejected', rejection: mustReject(rejection) }) as const,
            onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
          }),
        )),
      Then('the feat is refused with the docs allowance')((s) => {
        Match.value(s.outcome).pipe(
          Match.tag('rejected', (rejected) => {
            expect(rejected.rejection.problem).toEqual('"feat" with 100% docs paths — allowed types: ai / chore / docs')
            Match.value(rejected.rejection.refusal).pipe(
              Match.tag('CommitShapeMismatched', () => undefined),
              Match.orElse(() => failUnexpected('expected shape mismatch')),
            )
          }),
          Match.orElse(() => failUnexpected('expected rejected')),
        )
      }),
    ),
  )

  scenario(
    'A feat without production sources reports the production rule',
    Gherkin.Do.pipe(
      Given('a fix touching only docs and tests was prepared')(
        'input',
        () => Effect.succeed({ raw: 'fix: correct docs', staged: ['README.md', 'tests/docs.spec.ts'] }),
      ),
      When('the commit message is checked')('outcome', (s) =>
        Cell.run(commitMessageCell, s.input).pipe(
          Effect.match({
            onFailure: (rejection) => ({ _tag: 'rejected', rejection: mustReject(rejection) }) as const,
            onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
          }),
        )),
      Then('the fix is refused for untouched production sources')((s) => {
        Match.value(s.outcome).pipe(
          Match.tag('rejected', (rejected) => {
            expect(rejected.rejection.problem).toEqual('"fix" must touch at least one production source file')
            Match.value(rejected.rejection.refusal).pipe(
              Match.tag('CommitProductionUntouched', () => undefined),
              Match.orElse(() => failUnexpected('expected untouched production')),
            )
          }),
          Match.orElse(() => failUnexpected('expected rejected')),
        )
      }),
    ),
  )

  {
    const git = makeFakeGitPort({ staged: ['src/app.ts'], merge: true })
    const process = makeFakeProcessPort(succeedAll)
    const live = Layer.mergeAll(git, process.layer)
    const runnable = Cell.provide(stagedChecksCell, live)
    const decide = (scripts: ReadonlyArray<string>): Effect.Effect<StagedChecksDecision, never> =>
      Cell.run(runnable, { scripts: [...scripts] }).pipe(
        Effect.match({
          onFailure: () => failUnexpected('expected decided'),
          onSuccess: (decision) => decision,
        }),
      )
    scenario(
      'Merges skip every check without running commands',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a merge in progress with staged paths was recorded')('setup', () => Effect.succeed({ process })),
        When('the staged checks run')('decision', () => decide(['scripts/a.ts'])),
        Then('the run is skipped and no command ran')((s) => {
          Match.value(s.decision).pipe(
            Match.tag('MergeChecksSkipped', (skipped) => {
              expect(skipped.staged).toEqual(1)
            }),
            Match.orElse(() => failUnexpected('expected skipped')),
          )
          expect(s.setup.process.commands.length).toEqual(0)
        }),
      ),
    )
  }

  {
    const git = makeFakeGitPort({ staged: [], merge: false })
    const process = makeFakeProcessPort(succeedAll)
    const live = Layer.mergeAll(git, process.layer)
    const runnable = Cell.provide(stagedChecksCell, live)
    const decide = (scripts: ReadonlyArray<string>): Effect.Effect<StagedChecksDecision, never> =>
      Cell.run(runnable, { scripts: [...scripts] }).pipe(
        Effect.match({
          onFailure: () => failUnexpected('expected decided'),
          onSuccess: (decision) => decision,
        }),
      )
    scenario(
      'A vacant staged set runs no commands',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('an empty staged set was recorded')('setup', () => Effect.succeed({ process })),
        When('the staged checks run')('decision', () => decide(['scripts/a.ts'])),
        Then('the run is vacant and no command ran')((s) => {
          Match.value(s.decision).pipe(
            Match.tag('StagedVacant', (vacant) => {
              expect(vacant.staged).toEqual(0)
            }),
            Match.orElse(() => failUnexpected('expected vacant')),
          )
          expect(s.setup.process.commands.length).toEqual(0)
        }),
      ),
    )
  }

  {
    const git = makeFakeGitPort({ staged: ['src/app.ts', 'README.md', 'run.exe', 'deno.lock'], merge: false })
    const process = makeFakeProcessPort(succeedAll)
    const live = Layer.mergeAll(git, process.layer)
    const runnable = Cell.provide(stagedChecksCell, live)
    const decide = (scripts: ReadonlyArray<string>): Effect.Effect<StagedChecksDecision, never> =>
      Cell.run(runnable, { scripts: [...scripts] }).pipe(
        Effect.match({
          onFailure: () => failUnexpected('expected decided'),
          onSuccess: (decision) => decision,
        }),
      )
    scenario(
      'A staged set runs format, typecheck and lint in order',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a mixed staged set was recorded')('setup', () => Effect.succeed({ process })),
        When('the staged checks run')('decision', () => decide(['scripts/a.ts'])),
        Then('every check runs with the expected commands')((s) => {
          Match.value(s.decision).pipe(
            Match.tag('StagedChecksPassed', (passed) => {
              expect([...passed.checks]).toEqual(['format', 'typecheck', 'lint'])
            }),
            Match.orElse(() => failUnexpected('expected passed')),
          )
          expect(
            s.setup.process.commands.map((command) => ({ program: command.program, args: [...command.args] })),
          ).toEqual([
            {
              program: './bin/dprint',
              args: ['fmt', '--allow-no-files', '--', 'src/app.ts', 'README.md'],
            },
            { program: 'deno', args: ['check', 'scripts/a.ts'] },
            { program: 'deno', args: ['lint', '--quiet'] },
          ])
        }),
      ),
    )
  }

  {
    const git = makeFakeGitPort({ staged: ['src/app.ts'], merge: false })
    const process = makeFakeProcessPort((command) => {
      if (command.program === './bin/dprint') {
        return Effect.fail({ _tag: 'CommandRefused', command, reason: 'dprint boom' } as const)
      }
      return succeedAll(command)
    })
    const live = Layer.mergeAll(git, process.layer)
    const runnable = Cell.provide(stagedChecksCell, live)
    scenario(
      'A format failure refuses with the format command',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a formatter that always fails was installed')('setup', () => Effect.succeed({ process })),
        When('the staged checks run')('outcome', () =>
          Cell.run(runnable, { scripts: ['scripts/a.ts'] }).pipe(
            Effect.match({
              onFailure: (refusal) => ({ _tag: 'refused', refusal }) as const,
              onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
            }),
          )),
        Then('the run refuses at format after one command')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) =>
              Match.value(refused.refusal).pipe(
                Match.tag('FormatRefused', (format) => {
                  expect(format.command.kind).toEqual('format')
                  expect(format.command.command.program).toEqual('./bin/dprint')
                  expect(format.reason).toEqual('dprint boom')
                }),
                Match.orElse(() => failUnexpected('expected format refusal')),
              )),
            Match.orElse(() => failUnexpected('expected refused')),
          )
          expect(s.setup.process.commands.length).toEqual(1)
        }),
      ),
    )
  }

  {
    const git = makeFakeGitPort({ staged: ['src/app.ts'], merge: false })
    const process = makeFakeProcessPort((command) => {
      if (command.program === 'deno' && command.args[0] === 'check') {
        return Effect.fail({ _tag: 'CommandRefused', command, reason: 'type boom' } as const)
      }
      return succeedAll(command)
    })
    const live = Layer.mergeAll(git, process.layer)
    const runnable = Cell.provide(stagedChecksCell, live)
    scenario(
      'A typecheck failure refuses after format',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a typechecker that always fails was installed')('setup', () => Effect.succeed({ process })),
        When('the staged checks run')('outcome', () =>
          Cell.run(runnable, { scripts: ['scripts/a.ts'] }).pipe(
            Effect.match({
              onFailure: (refusal) => ({ _tag: 'refused', refusal }) as const,
              onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
            }),
          )),
        Then('the run refuses at typecheck after two commands')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) =>
              Match.value(refused.refusal).pipe(
                Match.tag('TypecheckRefused', (typecheck) => {
                  expect(typecheck.command.kind).toEqual('typecheck')
                  expect(typecheck.reason).toEqual('type boom')
                }),
                Match.orElse(() => failUnexpected('expected typecheck refusal')),
              )),
            Match.orElse(() => failUnexpected('expected refused')),
          )
          expect(s.setup.process.commands.length).toEqual(2)
        }),
      ),
    )
  }

  {
    const git = makeFakeGitPort({ staged: ['src/app.ts'], merge: false })
    const process = makeFakeProcessPort((command) => {
      if (command.program === 'deno' && command.args[0] === 'lint') {
        return Effect.fail({ _tag: 'CommandRefused', command, reason: 'lint boom' } as const)
      }
      return succeedAll(command)
    })
    const live = Layer.mergeAll(git, process.layer)
    const runnable = Cell.provide(stagedChecksCell, live)
    scenario(
      'A lint failure refuses last',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a linter that always fails was installed')('setup', () => Effect.succeed({ process })),
        When('the staged checks run')('outcome', () =>
          Cell.run(runnable, { scripts: ['scripts/a.ts'] }).pipe(
            Effect.match({
              onFailure: (refusal) => ({ _tag: 'refused', refusal }) as const,
              onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
            }),
          )),
        Then('the run refuses at lint after three commands')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) =>
              Match.value(refused.refusal).pipe(
                Match.tag('LintRefused', (lint) => {
                  expect(lint.command.kind).toEqual('lint')
                  expect(lint.reason).toEqual('lint boom')
                }),
                Match.orElse(() => failUnexpected('expected lint refusal')),
              )),
            Match.orElse(() => failUnexpected('expected refused')),
          )
          expect(s.setup.process.commands.length).toEqual(3)
        }),
      ),
    )
  }

  {
    const git = makeFakeGitPort({
      staged: [],
      merge: false,
      stagedError: { _tag: 'StagedStateUnreadable', reason: 'git exploded' } as const,
    })
    const process = makeFakeProcessPort(succeedAll)
    const live = Layer.mergeAll(git, process.layer)
    const runnable = Cell.provide(stagedChecksCell, live)
    scenario(
      'An unreadable staged state refuses without running commands',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a git port that cannot read the staged state was installed')('setup', () => Effect.succeed({ process })),
        When('the staged checks run')('outcome', () =>
          Cell.run(runnable, { scripts: ['scripts/a.ts'] }).pipe(
            Effect.match({
              onFailure: (refusal) => ({ _tag: 'refused', refusal }) as const,
              onSuccess: (decision) => ({ _tag: 'decided', decision }) as const,
            }),
          )),
        Then('the run refuses with the git reason and no command ran')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) =>
              Match.value(refused.refusal).pipe(
                Match.tag('StagedStateUnreadable', (unreadable) => {
                  expect(unreadable.reason).toEqual('git exploded')
                }),
                Match.orElse(() => failUnexpected('expected unreadable state')),
              )),
            Match.orElse(() => failUnexpected('expected refused')),
          )
          expect(s.setup.process.commands.length).toEqual(0)
        }),
      ),
    )
  }
})
