import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as fc from 'fast-check'
import { syncSurfaces } from './sync-surfaces.workflow.ts'
import { SyncCommand } from './sync.schema.ts'

const coreArb = fc.tuple(
  fc.integer({ min: 0, max: 20 }),
  fc.integer({ min: 0, max: 20 }),
  fc.integer({ min: 0, max: 20 }),
).map(([major, minor, patch]) => `${major}.${minor}.${patch}`)

const segmentArb = fc.stringMatching(/^[a-z0-9._~-]{1,12}$/)
const relativePathArb = fc.tuple(segmentArb, fc.array(segmentArb, { maxLength: 3 }))
  .map(([head, tail]) => [head, ...tail].join('/'))

const toCommand = (input: {
  readonly strategy: string
  readonly action: string
  readonly pinned?: string
  readonly expected: string
  readonly manifestFile: string
  readonly entries: ReadonlyArray<{ readonly file: string; readonly found: string }>
  readonly count: number
}): SyncCommand =>
  S.decodeUnknownSync(SyncCommand)({
    _tag: 'SyncCommand',
    strategy: input.strategy,
    action: input.action,
    pinned: input.pinned,
    expected: input.expected,
    manifestFile: input.manifestFile,
    entries: input.entries,
    count: input.count,
  })

const RUNS = { numRuns: 100 }

Deno.test('sync: non-surfaces strategy is refused with its name', () => {
  fc.assert(
    fc.property(
      fc.stringMatching(/^[a-z]{1,10}$/).map((strategy) => strategy === 'surfaces' ? 'pnpm' : strategy),
      fc.constantFrom('check', 'bump'),
      coreArb,
      relativePathArb,
      (strategy, action, expected, manifestFile) => {
        const command = toCommand({ strategy, action, expected, manifestFile, entries: [], count: 0 })
        const outcome = syncSurfaces(command)
        if (Result.isSuccess(outcome)) return false
        return outcome.failure._tag === 'SyncStrategyMismatch' && outcome.failure.strategy === strategy
      },
    ),
    RUNS,
  )
})

Deno.test('sync: unknown action is refused with the given word', () => {
  fc.assert(
    fc.property(
      fc.stringMatching(/^[a-z]{1,10}$/).map((action) =>
        action === 'check' || action === 'bump' ? 'frobnicate' : action
      ),
      coreArb,
      relativePathArb,
      (action, expected, manifestFile) => {
        const command = toCommand({
          strategy: 'surfaces',
          action,
          expected,
          manifestFile,
          entries: [],
          count: 0,
        })
        const outcome = syncSurfaces(command)
        if (Result.isSuccess(outcome)) return false
        return outcome.failure._tag === 'SyncActionUnknown' && outcome.failure.given === action
      },
    ),
    RUNS,
  )
})

Deno.test('sync: bump without a version is refused', () => {
  fc.assert(
    fc.property(coreArb, relativePathArb, (expected, manifestFile) => {
      const command = toCommand({ strategy: 'surfaces', action: 'bump', expected, manifestFile, entries: [], count: 0 })
      const outcome = syncSurfaces(command)
      if (Result.isSuccess(outcome)) return false
      return outcome.failure._tag === 'SyncVersionMissing'
    }),
    RUNS,
  )
})

Deno.test('sync: check passes exactly when every surface matches', () => {
  fc.assert(
    fc.property(
      coreArb,
      relativePathArb,
      fc.array(relativePathArb, { maxLength: 3 }),
      fc.boolean(),
      (expected, manifestFile, files, driftFirst) => {
        const entries = files.map((file, index) => ({
          file,
          found: driftFirst && index === 0 ? '0.0.0-drift' : expected,
        }))
        const command = toCommand({
          strategy: 'surfaces',
          action: 'check',
          expected,
          manifestFile,
          entries,
          count: entries.length,
        })
        const outcome = syncSurfaces(command)
        if (entries.length > 0 && driftFirst) {
          if (Result.isSuccess(outcome)) return false
          if (outcome.failure._tag !== 'SyncSurfacesDrifted') return false
          return outcome.failure.expected === expected &&
            outcome.failure.diffs.length === 1 &&
            outcome.failure.diffs[0]?.path === entries[0]?.file &&
            outcome.failure.diffs[0]?.found === entries[0]?.found
        }
        if (Result.isFailure(outcome)) return false
        if (outcome.success._tag !== 'SyncAligned') return false
        return outcome.success.version === expected && outcome.success.surfaces === entries.length
      },
    ),
    RUNS,
  )
})

Deno.test('sync: drift diffs name every mismatched surface in order', () => {
  fc.assert(
    fc.property(
      coreArb,
      coreArb,
      relativePathArb,
      fc.array(relativePathArb, { minLength: 1, maxLength: 4 }),
      (expected, other, manifestFile, files) => {
        const entries = files.map((file, index) => ({
          file,
          found: index % 2 === 0 ? expected : other,
        }))
        const command = toCommand({
          strategy: 'surfaces',
          action: 'check',
          expected,
          manifestFile,
          entries,
          count: entries.length,
        })
        const outcome = syncSurfaces(command)
        const mismatched = entries.filter((entry) => entry.found !== expected)
        if (mismatched.length === 0) {
          if (Result.isFailure(outcome)) return false
          return outcome.success._tag === 'SyncAligned'
        }
        if (Result.isSuccess(outcome)) return false
        if (outcome.failure._tag !== 'SyncSurfacesDrifted') return false
        return outcome.failure.expected === expected &&
          outcome.failure.diffs.length === mismatched.length &&
          outcome.failure.diffs.every((drift, index) =>
            drift.path === mismatched[index]?.file && drift.found === mismatched[index]?.found
          )
      },
    ),
    RUNS,
  )
})

Deno.test('sync: bump realigns the manifest and every surface', () => {
  fc.assert(
    fc.property(
      coreArb,
      coreArb,
      relativePathArb,
      fc.array(relativePathArb, { maxLength: 3 }),
      (expected, pinned, manifestFile, files) => {
        const entries = files.map((file) => ({ file, found: expected }))
        const command = toCommand({
          strategy: 'surfaces',
          action: 'bump',
          pinned,
          expected,
          manifestFile,
          entries,
          count: entries.length,
        })
        const outcome = syncSurfaces(command)
        if (Result.isFailure(outcome)) return false
        if (outcome.success._tag !== 'SyncRealigned') return false
        const decision = outcome.success
        const rewritten = [manifestFile, ...entries.map((entry) => entry.file)]
        return decision.version === pinned &&
          decision.rewritten.length === rewritten.length &&
          decision.rewritten.every((path, index) => path === rewritten[index])
      },
    ),
    RUNS,
  )
})
