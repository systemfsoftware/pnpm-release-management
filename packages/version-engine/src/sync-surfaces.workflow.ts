import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Count, DecisionTypeId, PackageVersion, RelativePath } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { SyncCommand } from './sync.schema.js'

export const SyncDrift = S.Struct({
  path: RelativePath,
  found: PackageVersion,
})
export type SyncDrift = S.Schema.Type<typeof SyncDrift>

export class SyncStrategyMismatch extends S.TaggedError<SyncStrategyMismatch>()(
  'SyncStrategyMismatch',
  {
    strategy: S.String,
  },
) {}

export class SyncSurfacesDrifted extends S.TaggedError<SyncSurfacesDrifted>()(
  'SyncSurfacesDrifted',
  {
    expected: PackageVersion,
    diffs: S.NonEmptyArray(SyncDrift),
  },
) {}

export class SyncVersionMissing extends S.TaggedError<SyncVersionMissing>()(
  'SyncVersionMissing',
  {
    action: S.Literal('bump'),
  },
) {}

export class SyncActionUnknown extends S.TaggedError<SyncActionUnknown>()(
  'SyncActionUnknown',
  {
    given: S.String,
  },
) {}

export const SyncRefusal = S.Union([
  SyncStrategyMismatch,
  SyncSurfacesDrifted,
  SyncVersionMissing,
  SyncActionUnknown,
])
export type SyncRefusal = S.Schema.Type<typeof SyncRefusal>

export class SyncAligned extends S.TaggedClass<SyncAligned>()(
  'SyncAligned',
  {
    version: PackageVersion,
    surfaces: Count,
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class SyncRealigned extends S.TaggedClass<SyncRealigned>()(
  'SyncRealigned',
  {
    version: PackageVersion,
    rewritten: S.Array(RelativePath),
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export type SyncDecision = SyncAligned | SyncRealigned

const StrategyMismatchCase = S.TaggedStruct('StrategyMismatch', { strategy: S.String })
const ActionUnknownCase = S.TaggedStruct('ActionUnknown', { given: S.String })
const VersionMissingCase = S.TaggedStruct('VersionMissing', { action: S.Literal('bump') })
const DriftedCase = S.TaggedStruct('Drifted', {
  expected: PackageVersion,
  diffs: S.NonEmptyArray(SyncDrift),
})
const AlignedCase = S.TaggedStruct('Aligned', { version: PackageVersion, count: Count })
const RealignCase = S.TaggedStruct('Realign', {
  version: PackageVersion,
  files: S.Array(RelativePath),
})

type StrategyMismatchCase = S.Schema.Type<typeof StrategyMismatchCase>
type ActionUnknownCase = S.Schema.Type<typeof ActionUnknownCase>
type VersionMissingCase = S.Schema.Type<typeof VersionMissingCase>
type DriftedCase = S.Schema.Type<typeof DriftedCase>
type AlignedCase = S.Schema.Type<typeof AlignedCase>
type RealignCase = S.Schema.Type<typeof RealignCase>

type SyncCase =
  | StrategyMismatchCase
  | ActionUnknownCase
  | VersionMissingCase
  | DriftedCase
  | AlignedCase
  | RealignCase

const syncCaseOf = (command: SyncCommand): SyncCase => {
  if (command.strategy !== 'surfaces') {
    return StrategyMismatchCase.make({ strategy: command.strategy })
  }
  if (command.action === 'check') {
    const diffs = command.entries
      .filter((entry) => entry.found !== command.expected)
      .map((entry) => ({ path: entry.file, found: entry.found }))
    const [first, ...rest] = diffs
    if (first === undefined) {
      return AlignedCase.make({ version: command.expected, count: command.count })
    }
    return DriftedCase.make({ expected: command.expected, diffs: [first, ...rest] })
  }
  if (command.action === 'bump') {
    if (command.pinned === undefined) return VersionMissingCase.make({ action: 'bump' })
    return RealignCase.make({
      version: command.pinned,
      files: [command.manifest.file, ...command.entries.map((entry) => entry.file)],
    })
  }
  return ActionUnknownCase.make({ given: command.action })
}

export const syncSurfaces = Workflow.make(
  SyncCommand,
  (
    command,
  ): Result.Result<
    SyncDecision,
    SyncStrategyMismatch | SyncSurfacesDrifted | SyncVersionMissing | SyncActionUnknown
  > =>
    Match.value(syncCaseOf(command)).pipe(
      Match.tag(
        'StrategyMismatch',
        (mismatch) => Result.fail(SyncStrategyMismatch.make({ strategy: mismatch.strategy })),
      ),
      Match.tag(
        'ActionUnknown',
        (unknown) => Result.fail(SyncActionUnknown.make({ given: unknown.given })),
      ),
      Match.tag(
        'VersionMissing',
        (missing) => Result.fail(SyncVersionMissing.make({ action: missing.action })),
      ),
      Match.tag(
        'Drifted',
        (drifted) =>
          Result.fail(
            SyncSurfacesDrifted.make({
              expected: drifted.expected,
              diffs: drifted.diffs,
            }),
          ),
      ),
      Match.tag(
        'Aligned',
        (aligned) => Result.succeed(SyncAligned.make({ version: aligned.version, surfaces: aligned.count })),
      ),
      Match.tag(
        'Realign',
        (realign) =>
          Result.succeed(
            SyncRealigned.make({ version: realign.version, rewritten: [...realign.files] }),
          ),
      ),
      Match.exhaustive,
    ),
)
