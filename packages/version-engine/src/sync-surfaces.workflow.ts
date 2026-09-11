import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Count, PackageVersion, RelativePath, SyncDrift } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
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
    first: SyncDrift,
    rest: S.Array(SyncDrift),
  }),
  S.TaggedStruct('Aligned', { version: PackageVersion, count: Count }),
  S.TaggedStruct('Realign', { version: PackageVersion, files: S.Array(RelativePath) }),
])
type SyncCase = S.Schema.Type<typeof SyncCase>

const classify = (command: SyncCommand): SyncCase => {
  if (command.strategy !== 'surfaces') {
    return { _tag: 'StrategyMismatch', strategy: command.strategy }
  }
  if (command.action !== 'check' && command.action !== 'bump') {
    return { _tag: 'ActionUnknown', given: command.action }
  }
  if (command.action === 'bump' && command.pinned === undefined) return { _tag: 'VersionMissing' }
  if (command.action === 'check') {
    const diffs = command.entries.filter((entry) => entry.found !== command.expected).map((entry) => ({
      path: entry.file,
      found: entry.found,
    }))
    const [first, ...rest] = diffs
    if (first === undefined) {
      return { _tag: 'Aligned', version: command.expected, count: command.count }
    }
    return { _tag: 'Drifted', expected: command.expected, first, rest }
  }
  return {
    _tag: 'Realign',
    version: command.pinned ?? command.expected,
    files: [command.manifestFile, ...command.entries.map((entry) => entry.file)],
  }
}

export const syncSurfaces = Workflow.make(
  SyncCommand,
  (command) =>
    Match.value(classify(command)).pipe(
      Match.tag(
        'StrategyMismatch',
        (mismatch) => Result.fail({ _tag: 'SyncStrategyMismatch' as const, strategy: mismatch.strategy }),
      ),
      Match.tag(
        'ActionUnknown',
        (unknown) => Result.fail({ _tag: 'SyncActionUnknown' as const, given: unknown.given }),
      ),
      Match.tag('VersionMissing', () => Result.fail({ _tag: 'SyncVersionMissing' as const, action: 'bump' as const })),
      Match.tag(
        'Drifted',
        (drifted) =>
          Result.fail({
            _tag: 'SyncSurfacesDrifted' as const,
            expected: drifted.expected,
            diffs: [drifted.first, ...drifted.rest] as const,
          }),
      ),
      Match.tag(
        'Aligned',
        (aligned) => Result.succeed(SyncAligned.make({ version: aligned.version, surfaces: aligned.count })),
      ),
      Match.tag(
        'Realign',
        (realign) => Result.succeed(SyncRealigned.make({ version: realign.version, rewritten: [...realign.files] })),
      ),
      Match.exhaustive,
    ),
)
