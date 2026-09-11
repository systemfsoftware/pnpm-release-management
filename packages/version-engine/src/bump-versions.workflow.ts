import { Workflow } from '@systemfsoftware/effect-cell-types'
import type { VersionIntentMalformed, VersionUnknownPackage } from '@systemfsoftware/release-language'
import { Count, PackageName, PackageVersion, RelativePath } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { BumpCommand } from './bump.schema.js'

const VersionDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/VersionDecision',
)
type VersionDecisionTypeId = typeof VersionDecisionTypeId

export class VersionBumped extends S.TaggedClass<VersionBumped>()(
  'VersionBumped',
  {
    version: PackageVersion,
    moved: S.Array(PackageName),
    changelogs: S.Array(RelativePath),
  },
) {
  readonly [VersionDecisionTypeId] = VersionDecisionTypeId
}

export class VersionConsumed extends S.TaggedClass<VersionConsumed>()(
  'VersionConsumed',
  {
    consumed: Count,
  },
) {
  readonly [VersionDecisionTypeId] = VersionDecisionTypeId
}

export class VersionIdle extends S.TaggedClass<VersionIdle>()(
  'VersionIdle',
  {
    pending: Count,
  },
) {
  readonly [VersionDecisionTypeId] = VersionDecisionTypeId
}

const BumpCase = S.Union([
  S.TaggedStruct('NoIntents', {}),
  S.TaggedStruct('UnknownPackage', { package: PackageName }),
  S.TaggedStruct('IntentMalformed', { path: RelativePath }),
  S.TaggedStruct('OnlyNone', { count: Count }),
  S.TaggedStruct('Bumped', {
    version: PackageVersion,
    moved: S.Array(PackageName),
    changelogs: S.Array(RelativePath),
  }),
])
type BumpCase = S.Schema.Type<typeof BumpCase>

const CORE_PATTERN = /^(\d+)\.(\d+)\.(\d+)/
const CORE_WIDTH = 12

const coreKeyOf = (version: string): string =>
  Option.match(Option.fromNullishOr(CORE_PATTERN.exec(version)), {
    onNone: () => '0'.repeat(CORE_WIDTH * 3),
    onSome: (hit) => hit.slice(1, 4).map((part) => part.padStart(CORE_WIDTH, '0')).join(''),
  })

const highestCoreOf = (
  versions: ReadonlyArray<PackageVersion>,
): PackageVersion | undefined => [...versions].sort((left, right) => coreKeyOf(right).localeCompare(coreKeyOf(left)))[0]

const surfacesNextOf = (command: BumpCommand): Option.Option<PackageVersion> =>
  Option.map(
    Option.filter(Option.some(command.strategy), (strategy) => strategy === 'surfaces'),
    () => command.consolidatedNext,
  )

const highestNextOf = (command: BumpCommand): PackageVersion =>
  Option.getOrElse(
    Option.fromNullishOr(highestCoreOf(command.nexts.map((entry) => entry.next))),
    () => command.consolidatedNext,
  )

const versionOf = (command: BumpCommand): PackageVersion =>
  Option.getOrElse(surfacesNextOf(command), () => highestNextOf(command))

const bumpedCaseOf = (command: BumpCommand): BumpCase => ({
  _tag: 'Bumped',
  version: versionOf(command),
  moved: [...command.moved],
  changelogs: command.changelogPaths.map((entry) => entry.path),
})

const onlyNoneOf = (command: BumpCommand): Option.Option<Count> =>
  Option.map(
    Option.filter(Option.some(command.consolidated), (consolidated) => consolidated === 'none'),
    () => command.intentCount,
  )

const consolidatedCaseOf = (command: BumpCommand): BumpCase =>
  Option.match(onlyNoneOf(command), {
    onNone: (): BumpCase => bumpedCaseOf(command),
    onSome: (count): BumpCase => ({ _tag: 'OnlyNone', count }),
  })

const malformedPathCaseOf = (command: BumpCommand): BumpCase =>
  Option.match(Option.fromNullishOr(command.malformedPath), {
    onNone: (): BumpCase => consolidatedCaseOf(command),
    onSome: (path): BumpCase => ({ _tag: 'IntentMalformed', path }),
  })

const unknownPackageCaseOf = (command: BumpCommand): BumpCase =>
  Option.match(Option.fromNullishOr(command.unknownPackage), {
    onNone: (): BumpCase => malformedPathCaseOf(command),
    onSome: (unknown): BumpCase => ({ _tag: 'UnknownPackage', package: unknown }),
  })

const caseOf = (command: BumpCommand): BumpCase =>
  Option.match(Option.fromNullishOr(command.intents[0]), {
    onNone: (): BumpCase => ({ _tag: 'NoIntents' }),
    onSome: (): BumpCase => unknownPackageCaseOf(command),
  })

export const bumpVersions = Workflow.make(
  BumpCommand,
  (
    command,
  ): Result.Result<
    VersionBumped | VersionConsumed | VersionIdle,
    VersionUnknownPackage | VersionIntentMalformed
  > =>
    Match.value(caseOf(command)).pipe(
      Match.tag(
        'NoIntents',
        () => Result.succeed(VersionIdle.make({ pending: command.intentCount })),
      ),
      Match.tag(
        'UnknownPackage',
        (unknown) => Result.fail({ _tag: 'VersionUnknownPackage' as const, package: unknown.package }),
      ),
      Match.tag(
        'IntentMalformed',
        (malformed) => Result.fail({ _tag: 'VersionIntentMalformed' as const, path: malformed.path }),
      ),
      Match.tag(
        'OnlyNone',
        (idle) => Result.succeed(VersionConsumed.make({ consumed: idle.count })),
      ),
      Match.tag(
        'Bumped',
        (bumped) =>
          Result.succeed(VersionBumped.make({
            version: bumped.version,
            moved: [...bumped.moved],
            changelogs: [...bumped.changelogs],
          })),
      ),
      Match.exhaustive,
    ),
)
