import { Workflow } from '@systemfsoftware/effect-cell-types'
import type { PinDistributionMissing, PinVersionUnusable } from '@systemfsoftware/release-language'
import { PackageVersion, PinName, RepoRoot } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { PinRootManifestCommand } from './pin-root-manifest.schema.js'

const PinDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/pnpm-release-management/PinDecision',
)
type PinDecisionTypeId = typeof PinDecisionTypeId

export class WorkspaceVersionRepinned extends S.TaggedClass<WorkspaceVersionRepinned>()(
  'WorkspaceVersionRepinned',
  {
    version: PackageVersion,
    pins: S.Array(PinName),
    text: S.String,
  },
) {
  readonly [PinDecisionTypeId] = PinDecisionTypeId
}

export class WorkspaceVersionAlreadyCurrent extends S.TaggedClass<
  WorkspaceVersionAlreadyCurrent
>()(
  'WorkspaceVersionAlreadyCurrent',
  {
    version: PackageVersion,
    pins: S.Array(PinName),
    text: S.String,
  },
) {
  readonly [PinDecisionTypeId] = PinDecisionTypeId
}

const PinCase = S.Union([
  S.TaggedStruct('VersionUnusable', { given: S.optional(S.String) }),
  S.TaggedStruct('NoDistribution', { root: RepoRoot }),
  S.TaggedStruct('RevisionUnchanged', {
    version: PackageVersion,
    pins: S.Array(PinName),
    text: S.String,
  }),
  S.TaggedStruct('RevisionChanged', {
    version: PackageVersion,
    pins: S.Array(PinName),
    text: S.String,
  }),
])
type PinCase = S.Schema.Type<typeof PinCase>

const renderedManifest = (command: PinRootManifestCommand, version: PackageVersion): string =>
  `${
    JSON.stringify(
      {
        ...command.manifest,
        version,
        optionalDependencies: Object.fromEntries(command.pinNames.map((name) => [name, version])),
      },
      null,
      command.indent,
    )
  }${'\n'.repeat(Number(command.trailingNewline))}`

const revisionCaseOf = (command: PinRootManifestCommand, version: PackageVersion): PinCase => {
  const text = renderedManifest(command, version)
  return Option.match(
    Option.filter(Option.some(text), (candidate) => candidate === command.manifestText),
    {
      onNone: (): PinCase => ({ _tag: 'RevisionChanged', version, pins: [...command.pinNames], text }),
      onSome: (): PinCase => ({
        _tag: 'RevisionUnchanged',
        version,
        pins: [...command.pinNames],
        text: command.manifestText,
      }),
    },
  )
}

const versionOf = (command: PinRootManifestCommand): Option.Option<PackageVersion> =>
  Option.orElse(
    Option.fromNullishOr(command.requestedUsable),
    () => Option.fromNullishOr(command.declaredUsable),
  )

const versionCaseOf = (command: PinRootManifestCommand): PinCase =>
  Option.match(versionOf(command), {
    onNone: (): PinCase => ({ _tag: 'VersionUnusable', given: command.requestedVersion }),
    onSome: (version): PinCase => revisionCaseOf(command, version),
  })

const requestedUnusableOf = (command: PinRootManifestCommand): Option.Option<PinCase> =>
  Option.map(
    Option.filter(
      Option.fromNullishOr(command.requestedVersion),
      () => command.requestedUsable === undefined,
    ),
    (given): PinCase => ({ _tag: 'VersionUnusable', given }),
  )

const unusableCaseOf = (command: PinRootManifestCommand): PinCase =>
  Option.match(requestedUnusableOf(command), {
    onNone: (): PinCase => versionCaseOf(command),
    onSome: (unusable): PinCase => unusable,
  })

const caseOf = (command: PinRootManifestCommand): PinCase =>
  Option.match(Option.fromNullishOr(command.suffixes), {
    onNone: (): PinCase => ({ _tag: 'NoDistribution', root: command.repoRoot }),
    onSome: (): PinCase => unusableCaseOf(command),
  })

export const pinRootManifest = Workflow.make(
  PinRootManifestCommand,
  (
    command,
  ): Result.Result<
    WorkspaceVersionRepinned | WorkspaceVersionAlreadyCurrent,
    PinVersionUnusable | PinDistributionMissing
  > =>
    Match.value(caseOf(command)).pipe(
      Match.tag(
        'VersionUnusable',
        (unusable) => Result.fail({ _tag: 'PinVersionUnusable' as const, given: unusable.given }),
      ),
      Match.tag(
        'NoDistribution',
        (missing) => Result.fail({ _tag: 'PinDistributionMissing' as const, root: missing.root }),
      ),
      Match.tag(
        'RevisionUnchanged',
        (unchanged) =>
          Result.succeed(WorkspaceVersionAlreadyCurrent.make({
            version: unchanged.version,
            pins: [...unchanged.pins],
            text: unchanged.text,
          })),
      ),
      Match.tag(
        'RevisionChanged',
        (changed) =>
          Result.succeed(WorkspaceVersionRepinned.make({
            version: changed.version,
            pins: [...changed.pins],
            text: changed.text,
          })),
      ),
      Match.exhaustive,
    ),
)
