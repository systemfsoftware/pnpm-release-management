import { it } from '@effect/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as fc from 'effect/testing/FastCheck'
import { stagedChecks, StagedChecksCommand } from '../staged-checks.workflow.js'
import type { StagedChecksIdle, StagedChecksRan, StagedChecksSkipped } from '../staged-checks.workflow.js'

const commandOf = (staged: ReadonlyArray<string>, merge: boolean): StagedChecksCommand =>
  S.decodeUnknownSync(StagedChecksCommand)({
    _tag: 'StagedChecksCommand',
    staged: [...staged],
    merge,
    scripts: [],
  })

const pathArb = fc.stringMatching(/^[a-z0-9_.-][a-z0-9_./-]{0,39}$/)

const formattableArb = fc.constantFrom(
  'src/app.ts',
  'lib/util.mjs',
  'pkg/main.cjs',
  'src/app.js',
  'data/config.json',
  'data/settings.jsonc',
  'README.md',
  'docs/guide.md',
  'ci/workflow.yml',
  'ci/workflow.yaml',
  'crate/Cargo.toml',
)

const unformattableArb = fc.constantFrom(
  'Makefile',
  'run.exe',
  'deno.lock',
  'notes.txt',
  'image.png',
  'bin/tool.sh',
)

it.prop(
  '∀staged_StagedChecks_=SkippedOnMerge',
  [fc.array(pathArb, { maxLength: 5 })],
  ([staged]) => {
    const outcome = stagedChecks(commandOf(staged, true))
    if (Result.isFailure(outcome)) return false
    return Match.value(outcome.success).pipe(
      Match.tag('StagedChecksSkipped', (skipped) => skipped.staged === staged.length),
      Match.orElse(() => false),
    )
  },
)

const expectedTag = (staged: ReadonlyArray<string>, merge: boolean): string => {
  if (merge) return 'StagedChecksSkipped'
  if (staged.length === 0) return 'StagedChecksIdle'
  return 'StagedChecksRan'
}

const tagOf = (
  decision: StagedChecksRan | StagedChecksIdle | StagedChecksSkipped,
): string =>
  Match.value(decision).pipe(
    Match.tag('StagedChecksSkipped', () => 'StagedChecksSkipped'),
    Match.tag('StagedChecksIdle', () => 'StagedChecksIdle'),
    Match.tag('StagedChecksRan', () => 'StagedChecksRan'),
    Match.exhaustive,
  )

it.prop(
  '∀input_StagedOutcome_=PrecedenceLaw',
  [fc.array(pathArb, { maxLength: 5 }), fc.boolean()],
  ([staged, merge]) => {
    const outcome = stagedChecks(commandOf(staged, merge))
    if (Result.isFailure(outcome)) return false
    return tagOf(outcome.success) === expectedTag(staged, merge) && outcome.success.staged === staged.length
  },
)

it.prop(
  '∀staged_StagedChecks_=FullSuite',
  [fc.array(formattableArb, { minLength: 1, maxLength: 6 })],
  ([staged]) => {
    const outcome = stagedChecks(commandOf(staged, false))
    if (Result.isFailure(outcome)) return false
    return Match.value(outcome.success).pipe(
      Match.tag(
        'StagedChecksRan',
        (ran) => ran.staged === staged.length && [...ran.checks].join(',') === 'format,typecheck,lint',
      ),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀staged_StagedChecks_=NoFormatLaw',
  [fc.array(unformattableArb, { minLength: 1, maxLength: 6 })],
  ([staged]) => {
    const outcome = stagedChecks(commandOf(staged, false))
    if (Result.isFailure(outcome)) return false
    return Match.value(outcome.success).pipe(
      Match.tag(
        'StagedChecksRan',
        (ran) => ran.staged === staged.length && [...ran.checks].join(',') === 'typecheck,lint',
      ),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀pair_StagedChecks_∈FormatKept',
  [formattableArb, unformattableArb],
  ([formattable, unformattable]) => {
    const outcome = stagedChecks(commandOf([formattable, unformattable], false))
    if (Result.isFailure(outcome)) return false
    return Match.value(outcome.success).pipe(
      Match.tag('StagedChecksRan', (ran) => [...ran.checks].includes('format')),
      Match.orElse(() => false),
    )
  },
)
