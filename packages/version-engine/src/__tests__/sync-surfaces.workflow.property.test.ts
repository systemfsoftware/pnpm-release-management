import { it } from '@effect/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as fc from 'effect/testing/FastCheck'
import { syncSurfaces } from '../sync-surfaces.workflow.js'
import { SyncCommand } from '../sync.schema.js'

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

const nonSurfacesArb = fc.stringMatching(/^[a-z]{1,10}$/).map((strategy) => {
  if (strategy === 'surfaces') {
    return 'pnpm'
  }
  return strategy
})

const nonActionArb = fc.stringMatching(/^[a-z]{1,10}$/).map((action) => {
  if (action === 'check' || action === 'bump') {
    return 'frobnicate'
  }
  return action
})

it.prop(
  '∀cmd_SyncSurfaces_⊥StrategySucceeds',
  [nonSurfacesArb, fc.constantFrom('check', 'bump'), coreArb, relativePathArb],
  ([strategy, action, expected, manifestFile]) => {
    const command = toCommand({ strategy, action, expected, manifestFile, entries: [], count: 0 })
    const outcome = syncSurfaces(command)
    if (Result.isSuccess(outcome)) {
      return false
    }
    return Match.value(outcome.failure).pipe(
      Match.tag('SyncStrategyMismatch', (mismatch) => mismatch.strategy === strategy),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀cmd_SyncSurfaces_⊥ActionSucceeds',
  [nonActionArb, coreArb, relativePathArb],
  ([action, expected, manifestFile]) => {
    const command = toCommand({
      strategy: 'surfaces',
      action,
      expected,
      manifestFile,
      entries: [],
      count: 0,
    })
    const outcome = syncSurfaces(command)
    if (Result.isSuccess(outcome)) {
      return false
    }
    return Match.value(outcome.failure).pipe(
      Match.tag('SyncActionUnknown', (unknown) => unknown.given === action),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀cmd_SyncSurfaces_⊥VersionlessSucceeds',
  [coreArb, relativePathArb],
  ([expected, manifestFile]) => {
    const command = toCommand({ strategy: 'surfaces', action: 'bump', expected, manifestFile, entries: [], count: 0 })
    const outcome = syncSurfaces(command)
    if (Result.isSuccess(outcome)) {
      return false
    }
    return Match.value(outcome.failure).pipe(
      Match.tag('SyncVersionMissing', () => true),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀cmd_SyncSurfaces_≡AlignedIffMatch',
  [coreArb, relativePathArb, fc.array(relativePathArb, { maxLength: 3 }), fc.boolean()],
  ([expected, manifestFile, files, driftFirst]) => {
    const entries = files.map((file, index) => {
      if (driftFirst && index === 0) {
        return { file, found: '0.0.0-drift' }
      }
      return { file, found: expected }
    })
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
      if (Result.isSuccess(outcome)) {
        return false
      }
      return Match.value(outcome.failure).pipe(
        Match.tag('SyncSurfacesDrifted', (drifted) => {
          const [firstEntry] = entries
          const [firstDiff] = drifted.diffs
          if (firstEntry === undefined) {
            return false
          }
          return drifted.expected === expected &&
            drifted.diffs.length === 1 &&
            firstDiff.path === firstEntry.file &&
            firstDiff.found === firstEntry.found
        }),
        Match.orElse(() => false),
      )
    }
    if (Result.isFailure(outcome)) {
      return false
    }
    return Match.value(outcome.success).pipe(
      Match.tag(
        'SyncAligned',
        (aligned) => aligned.version === expected && aligned.surfaces === entries.length,
      ),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀cmd_SyncSurfaces_≡DriftOrdered',
  [coreArb, coreArb, relativePathArb, fc.array(relativePathArb, { minLength: 1, maxLength: 4 })],
  ([expected, other, manifestFile, files]) => {
    const entries = files.map((file, index) => {
      if (index % 2 === 0) {
        return { file, found: expected }
      }
      return { file, found: other }
    })
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
      if (Result.isFailure(outcome)) {
        return false
      }
      return Match.value(outcome.success).pipe(
        Match.tag('SyncAligned', () => true),
        Match.orElse(() => false),
      )
    }
    if (Result.isSuccess(outcome)) {
      return false
    }
    return Match.value(outcome.failure).pipe(
      Match.tag('SyncSurfacesDrifted', (drifted) => {
        if (drifted.expected !== expected || drifted.diffs.length !== mismatched.length) {
          return false
        }
        return drifted.diffs.every((drift, index) => {
          const other = mismatched[index]
          if (other === undefined) {
            return false
          }
          return drift.path === other.file && drift.found === other.found
        })
      }),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀cmd_SyncSurfaces_≡RealignsAll',
  [coreArb, coreArb, relativePathArb, fc.array(relativePathArb, { maxLength: 3 })],
  ([expected, pinned, manifestFile, files]) => {
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
    if (Result.isFailure(outcome)) {
      return false
    }
    return Match.value(outcome.success).pipe(
      Match.tag('SyncRealigned', (realigned) => {
        const rewritten = [manifestFile, ...entries.map((entry) => entry.file)]
        return realigned.version === pinned &&
          realigned.rewritten.length === rewritten.length &&
          realigned.rewritten.every((path, index) => path === rewritten[index])
      }),
      Match.orElse(() => false),
    )
  },
)
