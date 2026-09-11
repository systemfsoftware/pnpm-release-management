import { Workflow } from '@systemfsoftware/effect-cell-types'
import type {
  SyncActionUnknown,
  SyncStrategyMismatch,
  SyncSurfacesDrifted,
  SyncVersionMissing,
} from '@systemfsoftware/release-language'
import { Count, PackageVersion, RelativePath, SyncDrift } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { SyncCommand } from './sync.schema.js'

const SyncDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/SyncDecision',
)
type SyncDecisionTypeId = typeof SyncDecisionTypeId

export class SyncAligned extends S.TaggedClass<SyncAligned>()(
  'SyncAligned',
  {
    version: PackageVersion,
    surfaces: Count,
  },
) {
  readonly [SyncDecisionTypeId] = SyncDecisionTypeId
}

export class SyncRealigned extends S.TaggedClass<SyncRealigned>()(
  'SyncRealigned',
  {
    version: PackageVersion,
    rewritten: S.Array(RelativePath),
  },
) {
  readonly [SyncDecisionTypeId] = SyncDecisionTypeId
}

const SyncCase = S.Union([
  S.TaggedStruct('StrategyMismatch', { strategy: S.String }),
  S.TaggedStruct('ActionUnknown', { given: S.String }),
  S.TaggedStruct('VersionMissing', {}),
  S.TaggedStruct('Drifted', {
    expected: PackageVersion,
    diffs: S.NonEmptyArray(SyncDrift),
  }),
  S.TaggedStruct('Aligned', { version: PackageVersion, count: Count }),
  S.TaggedStruct('Realign', {
    version: PackageVersion,
    files: S.Array(RelativePath),
  }),
])
type SyncCase = S.Schema.Type<typeof SyncCase>

const driftsOf = (command: SyncCommand): ReadonlyArray<SyncDrift> =>
  command.entries
    .filter((entry) => entry.found !== command.expected)
    .map((entry): SyncDrift => ({ path: entry.file, found: entry.found }))

const nonEmptyDriftsOf = (
  command: SyncCommand,
): Option.Option<readonly [SyncDrift, ...ReadonlyArray<SyncDrift>]> => {
  const drifts = driftsOf(command)
  return Option.map(
    Option.fromNullishOr(drifts[0]),
    (first): readonly [SyncDrift, ...ReadonlyArray<SyncDrift>] => [first, ...drifts.slice(1)],
  )
}

const checkCaseOf = (command: SyncCommand): SyncCase =>
  Option.match(nonEmptyDriftsOf(command), {
    onNone: (): SyncCase => ({ _tag: 'Aligned', version: command.expected, count: command.count }),
    onSome: (diffs): SyncCase => ({ _tag: 'Drifted', expected: command.expected, diffs }),
  })

const bumpCaseOf = (command: SyncCommand): SyncCase =>
  Option.match(Option.fromNullishOr(command.pinned), {
    onNone: (): SyncCase => ({ _tag: 'VersionMissing' }),
    onSome: (pinned): SyncCase => ({
      _tag: 'Realign',
      version: pinned,
      files: [command.manifestFile, ...command.entries.map((entry) => entry.file)],
    }),
  })

const checkActionOf = (command: SyncCommand): Option.Option<SyncCase> =>
  Option.map(
    Option.filter(Option.some(command.action), (action) => action === 'check'),
    (): SyncCase => checkCaseOf(command),
  )

const bumpActionOf = (command: SyncCommand): Option.Option<SyncCase> =>
  Option.map(
    Option.filter(Option.some(command.action), (action) => action === 'bump'),
    (): SyncCase => bumpCaseOf(command),
  )

const unknownActionOf = (command: SyncCommand): SyncCase =>
  Option.getOrElse(
    bumpActionOf(command),
    (): SyncCase => ({ _tag: 'ActionUnknown', given: command.action }),
  )

const actionCaseOf = (command: SyncCommand): SyncCase =>
  Option.match(checkActionOf(command), {
    onNone: (): SyncCase => unknownActionOf(command),
    onSome: (decided): SyncCase => decided,
  })

const caseOf = (command: SyncCommand): SyncCase =>
  Option.match(
    Option.filter(Option.some(command.strategy), (strategy) => strategy === 'surfaces'),
    {
      onNone: (): SyncCase => ({ _tag: 'StrategyMismatch', strategy: command.strategy }),
      onSome: (): SyncCase => actionCaseOf(command),
    },
  )

export const syncSurfaces = Workflow.make(
  SyncCommand,
  (
    command,
  ): Result.Result<
    SyncAligned | SyncRealigned,
    SyncStrategyMismatch | SyncSurfacesDrifted | SyncVersionMissing | SyncActionUnknown
  > =>
    Match.value(caseOf(command)).pipe(
      Match.tag(
        'StrategyMismatch',
        (mismatch) => Result.fail({ _tag: 'SyncStrategyMismatch' as const, strategy: mismatch.strategy }),
      ),
      Match.tag(
        'ActionUnknown',
        (unknown) => Result.fail({ _tag: 'SyncActionUnknown' as const, given: unknown.given }),
      ),
      Match.tag(
        'VersionMissing',
        () => Result.fail({ _tag: 'SyncVersionMissing' as const, action: 'bump' as const }),
      ),
      Match.tag(
        'Drifted',
        (drifted) =>
          Result.fail({
            _tag: 'SyncSurfacesDrifted' as const,
            expected: drifted.expected,
            diffs: drifted.diffs,
          }),
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
