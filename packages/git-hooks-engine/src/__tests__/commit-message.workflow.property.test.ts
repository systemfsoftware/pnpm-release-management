import { it } from '@effect/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as fc from 'effect/testing/FastCheck'
import { commitMessage, CommitMessageCommand } from '../commit-message.workflow.js'
import type { CommitAllowed, CommitRefusal, CommitWaived } from '../commit-message.workflow.js'

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

it.prop(
  '∀trailer_CommitIgnore_∈IgnoreKind',
  [fc.constantFrom(...IGNORE_PREFIXES), fc.string({ maxLength: 120 })],
  ([pair, suffix]) => {
    const outcome = run(pair[0] + suffix, [])
    if (Result.isFailure(outcome)) return false
    return Match.value(outcome.success).pipe(
      Match.tag('CommitWaived', (waived) => waived.kind === pair[1]),
      Match.orElse(() => false),
    )
  },
)

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

it.prop(
  '∀header_CommitAccept_=EchoedParts',
  [
    fc.constantFrom(...HEADER_EXPRESSIBLE_TYPES).chain((type) => {
      const scopes = VALID_SCOPES.filter((scope) => type !== 'chore' || scope !== 'release')
      return fc.tuple(
        fc.option(fc.constantFrom(...scopes)),
        subjectArb,
      ).map(([scopeOption, subject]) => ({ type, scope: scopeOption ?? undefined, subject }))
    }),
  ],
  ([expressible]) => {
    const scope = expressible.scope
    let raw = `${expressible.type}: ${expressible.subject}`
    if (scope !== undefined) {
      raw = `${expressible.type}(${scope}): ${expressible.subject}`
    }
    const outcome = run(raw, [])
    if (Result.isFailure(outcome)) return false
    return Match.value(outcome.success).pipe(
      Match.tag(
        'CommitAllowed',
        (allowed) =>
          allowed.type === expressible.type && allowed.scope === expressible.scope &&
          allowed.subject === expressible.subject,
      ),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀type_CommitRefusal_=TypeEcho',
  [fc.stringMatching(/^[a-z]{2,10}$/)],
  ([type]) => {
    fc.pre(!VALID_TYPES.includes(type))
    const outcome = run(`${type}(repo): steady subject`, [])
    if (Result.isSuccess(outcome)) return false
    return Match.value(outcome.failure).pipe(
      Match.tag('CommitTypeUnknown', (refusal) => refusal.type === type),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀scope_CommitRefusal_=ScopeEcho',
  [fc.stringMatching(/^[A-Za-z0-9-]{1,12}$/)],
  ([scope]) => {
    fc.pre(!VALID_SCOPES.includes(scope))
    const outcome = run(`feat(${scope}): steady subject`, [])
    if (Result.isSuccess(outcome)) return false
    return Match.value(outcome.failure).pipe(
      Match.tag('CommitScopeUnknown', (refusal) => refusal.scope === scope),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀raw_CommitRefusal_=HeaderEcho',
  [fc.stringMatching(/^[a-z]{3,8} [a-z]{3,8}$/)],
  ([raw]) => {
    const outcome = run(raw, [])
    if (Result.isSuccess(outcome)) return false
    return Match.value(outcome.failure).pipe(
      Match.tag('CommitHeaderMalformed', (refusal) => refusal.header === raw),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀header_CommitRefusal_=PunctuationLaw',
  [subjectArb],
  ([subject]) => {
    const raw = `feat(repo): ${subject}.`
    const outcome = run(raw, [])
    if (Result.isSuccess(outcome)) return false
    return Match.value(outcome.failure).pipe(
      Match.tag('CommitHeaderPunctuation', (refusal) => refusal.header === raw),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀trailer_CommitRefusal_=AttributionLaw',
  [
    fc.constantFrom(
      '\n\nCo-authored-by: Helper <bot@noreply@anthropic.com>',
      '\nCo-authored-by: Reviewer <r@example.com> (assisted by Claude Sonnet)',
      '\n\nCo-authored-by: Agent <cursoragent@cursor.com>',
    ),
  ],
  ([trailer]) => {
    const outcome = run(`docs(repo): tidy wording${trailer}`, [])
    if (Result.isSuccess(outcome)) return false
    return Match.value(outcome.failure).pipe(
      Match.tag('CommitAiAttribution', (refusal) => refusal.lines >= 1),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀staged_CommitRefusal_=DocsShape',
  [
    fc.array(
      fc.constantFrom('README.md', 'docs/guide.md', 'AGENTS.md', 'CHANGELOG.md', 'notes/todo.md'),
      { minLength: 1, maxLength: 6 },
    ),
  ],
  ([staged]) => {
    const outcome = run('feat(repo): add search', staged)
    if (Result.isSuccess(outcome)) return false
    return Match.value(outcome.failure).pipe(
      Match.tag(
        'CommitShapeMismatched',
        (refusal) =>
          refusal.shape === 'docs' && refusal.type === 'feat' &&
          [...refusal.allowed].sort().join('/') === 'ai/chore/docs',
      ),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀staged_CommitRefusal_=ProductionRule',
  [
    fc.constantFrom('README.md', 'docs/guide.md'),
    fc.constantFrom('src/app.test.ts', 'tests/app.spec.ts', 'e2e/flow.test.ts'),
    fc.array(
      fc.constantFrom('README.md', 'tests/app.spec.ts', '.github/workflows/ci.yml', 'pnpm-lock.yaml', 'bin/tool.sh'),
      { maxLength: 3 },
    ),
  ],
  ([doc, test, extras]) => {
    const outcome = run('feat: add search', [doc, test, ...extras])
    if (Result.isSuccess(outcome)) return false
    return Match.value(outcome.failure).pipe(
      Match.tag('CommitProductionUntouched', (refusal) => refusal.type === 'feat'),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀staged_CommitRefusal_=LockfileShape',
  [
    fc.array(fc.constantFrom('pnpm-lock.yaml', 'deno.lock', 'flake.lock'), {
      minLength: 1,
      maxLength: 4,
    }),
  ],
  ([staged]) => {
    const outcome = run('feat: bump dependencies', staged)
    if (Result.isSuccess(outcome)) return false
    return Match.value(outcome.failure).pipe(
      Match.tag('CommitShapeMismatched', (refusal) => refusal.shape === 'lockfile'),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀raw_CommitRefusal_=EmptyCount',
  [
    fc.constantFrom('', '   ', '\n  \n', '# only a comment\n# another'),
    fc.array(fc.stringMatching(/^[a-z0-9_./-]{1,30}$/), { maxLength: 5 }),
  ],
  ([raw, staged]) => {
    const outcome = run(raw, staged)
    if (Result.isSuccess(outcome)) return false
    return Match.value(outcome.failure).pipe(
      Match.tag('CommitEmpty', (refusal) => refusal.staged === staged.length),
      Match.orElse(() => false),
    )
  },
)
