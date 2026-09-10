import * as Result from 'effect/Result'
import * as fc from 'fast-check'
import { commitMessage, CommitMessageCommand } from './commit-message.workflow.ts'
import type { CommitAllowed, CommitRefusal, CommitWaived } from './commit-message.workflow.ts'

const run = (
  raw: string,
  staged: ReadonlyArray<string>,
): Result.Result<CommitAllowed | CommitWaived, CommitRefusal> =>
  commitMessage(CommitMessageCommand.make({ raw, staged: [...staged] }))

const IGNORE_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['Merge pull request #42 from alice/topic', 'merge'],
  ["Merge branch 'feature-x'", 'merge'],
  ['Automatic merge', 'merge'],
  ['Merged remote-tracking branch', 'merge'],
  ['Revert "feat: add search"', 'revert'],
  ['fixup! amend the earlier commit', 'fixup'],
  ['squash! amend the earlier commit', 'fixup'],
  ['amend! reword the earlier commit', 'amend'],
  ['chore(release): 1.2.3', 'release'],
]

Deno.test('commit-message: ignored prefixes are accepted as ignored', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...IGNORE_PREFIXES),
      fc.string({ maxLength: 120 }),
      (pair, suffix) => {
        const outcome = run(pair[0] + suffix, [])
        return Result.isSuccess(outcome) &&
          outcome.success._tag === 'CommitWaived' &&
          outcome.success.kind === pair[1]
      },
    ),
    { numRuns: 200 },
  )
})

const VALID_TYPES = [
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

const VALID_SCOPES = [
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

const subjectArb = fc.stringMatching(/^[A-Za-z0-9]([A-Za-z0-9 _-]{0,39}[A-Za-z0-9_-])?$/)

const HEADER_EXPRESSIBLE_TYPES = VALID_TYPES.filter((type) => /^[a-z]+$/.test(type))

Deno.test('commit-message: well-formed headers are accepted with echoed parts', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...HEADER_EXPRESSIBLE_TYPES).chain((type) =>
        fc.tuple(
          type === 'chore'
            ? fc.option(fc.constantFrom(...VALID_SCOPES.filter((scope) => scope !== 'release')))
            : fc.option(fc.constantFrom(...VALID_SCOPES)),
          subjectArb,
        ).map(([scopeOption, subject]) => ({ type, scope: scopeOption ?? undefined, subject }))
      ),
      ({ type, scope, subject }) => {
        const raw = scope === undefined ? `${type}: ${subject}` : `${type}(${scope}): ${subject}`
        const outcome = run(raw, [])
        return Result.isSuccess(outcome) &&
          outcome.success._tag === 'CommitAllowed' &&
          outcome.success.type === type &&
          outcome.success.scope === scope &&
          outcome.success.subject === subject
      },
    ),
    { numRuns: 200 },
  )
})

Deno.test('commit-message: unknown lowercase types are refused with the type echoed', () => {
  fc.assert(
    fc.property(
      fc.stringMatching(/^[a-z]{2,10}$/),
      (type) => {
        fc.pre(!VALID_TYPES.includes(type))
        const outcome = run(`${type}(repo): steady subject`, [])
        return Result.isFailure(outcome) &&
          outcome.failure._tag === 'CommitTypeUnknown' &&
          outcome.failure.type === type
      },
    ),
    { numRuns: 200 },
  )
})

Deno.test('commit-message: unknown scopes are refused with the scope echoed', () => {
  fc.assert(
    fc.property(
      fc.stringMatching(/^[A-Za-z0-9-]{1,12}$/),
      (scope) => {
        fc.pre(!VALID_SCOPES.includes(scope))
        const outcome = run(`feat(${scope}): steady subject`, [])
        return Result.isFailure(outcome) &&
          outcome.failure._tag === 'CommitScopeUnknown' &&
          outcome.failure.scope === scope
      },
    ),
    { numRuns: 200 },
  )
})

Deno.test('commit-message: headers without a conventional shape are refused with the header echoed', () => {
  fc.assert(
    fc.property(
      fc.stringMatching(/^[a-z]{3,8} [a-z]{3,8}$/),
      (raw) => {
        const outcome = run(raw, [])
        return Result.isFailure(outcome) &&
          outcome.failure._tag === 'CommitHeaderMalformed' &&
          outcome.failure.header === raw
      },
    ),
    { numRuns: 200 },
  )
})

Deno.test('commit-message: headers ending with a full stop are refused', () => {
  fc.assert(
    fc.property(
      subjectArb,
      (subject) => {
        const raw = `feat(repo): ${subject}.`
        const outcome = run(raw, [])
        return Result.isFailure(outcome) &&
          outcome.failure._tag === 'CommitHeaderPunctuation' &&
          outcome.failure.header === raw
      },
    ),
    { numRuns: 200 },
  )
})

Deno.test('commit-message: AI co-author trailers are refused', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(
        '\n\nCo-authored-by: Helper <bot@noreply@anthropic.com>',
        '\nCo-authored-by: Reviewer <r@example.com> (assisted by Claude Sonnet)',
        '\n\nCo-authored-by: Agent <cursoragent@cursor.com>',
      ),
      (trailer) => {
        const outcome = run(`docs(repo): tidy wording${trailer}`, [])
        return Result.isFailure(outcome) &&
          outcome.failure._tag === 'CommitAiAttribution' &&
          outcome.failure.lines >= 1
      },
    ),
    { numRuns: 200 },
  )
})

Deno.test('commit-message: all-docs staged sets refuse feat with the docs shape', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.constantFrom('README.md', 'docs/guide.md', 'AGENTS.md', 'CHANGELOG.md', 'notes/todo.md'),
        { minLength: 1, maxLength: 6 },
      ),
      (staged) => {
        const outcome = run('feat(repo): add search', staged)
        return Result.isFailure(outcome) &&
          outcome.failure._tag === 'CommitShapeMismatched' &&
          outcome.failure.shape === 'docs' &&
          outcome.failure.type === 'feat' &&
          [...outcome.failure.allowed].sort().join('/') === 'ai/chore/docs'
      },
    ),
    { numRuns: 200 },
  )
})

Deno.test('commit-message: mixed non-production staged sets refuse feat without production sources', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('README.md', 'docs/guide.md'),
      fc.constantFrom('src/app.test.ts', 'tests/app.spec.ts', 'e2e/flow.test.ts'),
      fc.array(
        fc.constantFrom('README.md', 'tests/app.spec.ts', '.github/workflows/ci.yml', 'pnpm-lock.yaml', 'bin/tool.sh'),
        { maxLength: 3 },
      ),
      (doc, test, extras) => {
        const outcome = run('feat: add search', [doc, test, ...extras])
        return Result.isFailure(outcome) &&
          outcome.failure._tag === 'CommitProductionUntouched' &&
          outcome.failure.type === 'feat'
      },
    ),
    { numRuns: 200 },
  )
})

Deno.test('commit-message: lockfile-only staged sets refuse feat with the lockfile shape first', () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom('pnpm-lock.yaml', 'deno.lock', 'flake.lock'), {
        minLength: 1,
        maxLength: 4,
      }),
      (staged) => {
        const outcome = run('feat: bump dependencies', staged)
        return Result.isFailure(outcome) &&
          outcome.failure._tag === 'CommitShapeMismatched' &&
          outcome.failure.shape === 'lockfile'
      },
    ),
    { numRuns: 200 },
  )
})

Deno.test('commit-message: empty messages are refused with the staged count', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('', '   ', '\n  \n', '# only a comment\n# another'),
      fc.array(fc.stringMatching(/^[a-z0-9_./-]{1,30}$/), { maxLength: 5 }),
      (raw, staged) => {
        const outcome = run(raw, staged)
        return Result.isFailure(outcome) &&
          outcome.failure._tag === 'CommitEmpty' &&
          outcome.failure.staged === staged.length
      },
    ),
    { numRuns: 200 },
  )
})
