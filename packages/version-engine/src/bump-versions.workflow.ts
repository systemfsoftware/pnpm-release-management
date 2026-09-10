import { Workflow } from '@systemfsoftware/effect-cell-types'
import { Count, PackageName, PackageVersion, RelativePath } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { BumpCommand } from './bump.schema.ts'

const CORE_PATTERN = /^(\d+)\.(\d+)\.(\d+)/

const tupleOf = (version: string): readonly [number, number, number] => {
  const hit = CORE_PATTERN.exec(version)
  return [Number(hit?.[1] ?? '0'), Number(hit?.[2] ?? '0'), Number(hit?.[3] ?? '0')]
}

const compareTuples = (
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number => left[0] - right[0] || left[1] - right[1] || left[2] - right[2]

const maxVersion = (
  versions: ReadonlyArray<PackageVersion>,
): PackageVersion | undefined =>
  versions.reduce<PackageVersion | undefined>((top, version) => {
    if (top === undefined || compareTuples(tupleOf(version), tupleOf(top)) > 0) {
      return version
    }
    return top
  }, undefined)

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

const classify = (command: BumpCommand): BumpCase => {
  if (command.intents.length === 0) return { _tag: 'NoIntents' }
  if (command.unknownPackage !== undefined) {
    return { _tag: 'UnknownPackage', package: command.unknownPackage }
  }
  if (command.malformedPath !== undefined) {
    return { _tag: 'IntentMalformed', path: command.malformedPath }
  }
  if (command.consolidated === 'none') return { _tag: 'OnlyNone', count: command.intentCount }
  const version = maxVersion(command.nexts.map((entry) => entry.next))
  if (command.strategy === 'surfaces') {
    return {
      _tag: 'Bumped',
      version: command.consolidatedNext,
      moved: command.moved,
      changelogs: command.changelogPaths.map((entry) => entry.path),
    }
  }
  return {
    _tag: 'Bumped',
    version: version ?? command.consolidatedNext,
    moved: command.moved,
    changelogs: command.changelogPaths.map((entry) => entry.path),
  }
}

export const bumpVersions = Workflow.make(
  BumpCommand,
  (command) =>
    Match.value(classify(command)).pipe(
      Match.tag('NoIntents', () => Result.succeed(VersionIdle.make({ pending: command.intentCount }))),
      Match.tag(
        'UnknownPackage',
        (unknown) => Result.fail({ _tag: 'VersionUnknownPackage' as const, package: unknown.package }),
      ),
      Match.tag(
        'IntentMalformed',
        (malformed) => Result.fail({ _tag: 'VersionIntentMalformed' as const, path: malformed.path }),
      ),
      Match.tag('OnlyNone', (idle) => Result.succeed(VersionConsumed.make({ consumed: idle.count }))),
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
