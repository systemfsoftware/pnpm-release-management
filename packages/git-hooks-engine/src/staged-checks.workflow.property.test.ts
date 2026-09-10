import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as fc from 'fast-check'
import { stagedChecks, StagedChecksCommand } from './staged-checks.workflow.ts'

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

Deno.test('staged-checks: merges skip every check', () => {
  fc.assert(
    fc.property(
      fc.array(pathArb, { maxLength: 5 }),
      (staged) => {
        const outcome = stagedChecks(commandOf(staged, true))
        return Result.isSuccess(outcome) &&
          outcome.success._tag === 'StagedChecksSkipped' &&
          outcome.success.staged === staged.length
      },
    ),
    { numRuns: 200 },
  )
})

Deno.test('staged-checks: outcome follows merge first, then staged emptiness', () => {
  fc.assert(
    fc.property(
      fc.array(pathArb, { maxLength: 5 }),
      fc.boolean(),
      (staged, merge) => {
        const outcome = stagedChecks(commandOf(staged, merge))
        const expected = merge
          ? 'StagedChecksSkipped'
          : staged.length === 0
          ? 'StagedChecksIdle'
          : 'StagedChecksRan'
        return Result.isSuccess(outcome) &&
          outcome.success._tag === expected &&
          outcome.success.staged === staged.length
      },
    ),
    { numRuns: 200 },
  )
})

Deno.test('staged-checks: formattable staged sets run format, typecheck and lint', () => {
  fc.assert(
    fc.property(
      fc.array(formattableArb, { minLength: 1, maxLength: 6 }),
      (staged) => {
        const outcome = stagedChecks(commandOf(staged, false))
        return Result.isSuccess(outcome) &&
          outcome.success._tag === 'StagedChecksRan' &&
          outcome.success.staged === staged.length &&
          [...outcome.success.checks].join(',') === 'format,typecheck,lint'
      },
    ),
    { numRuns: 200 },
  )
})

Deno.test('staged-checks: unformattable staged sets skip format but keep typecheck and lint', () => {
  fc.assert(
    fc.property(
      fc.array(unformattableArb, { minLength: 1, maxLength: 6 }),
      (staged) => {
        const outcome = stagedChecks(commandOf(staged, false))
        return Result.isSuccess(outcome) &&
          outcome.success._tag === 'StagedChecksRan' &&
          outcome.success.staged === staged.length &&
          [...outcome.success.checks].join(',') === 'typecheck,lint'
      },
    ),
    { numRuns: 200 },
  )
})

Deno.test('staged-checks: mixed staged sets keep format', () => {
  fc.assert(
    fc.property(
      formattableArb,
      unformattableArb,
      (formattable, unformattable) => {
        const outcome = stagedChecks(commandOf([formattable, unformattable], false))
        return Result.isSuccess(outcome) &&
          outcome.success._tag === 'StagedChecksRan' &&
          [...outcome.success.checks].includes('format')
      },
    ),
    { numRuns: 200 },
  )
})
