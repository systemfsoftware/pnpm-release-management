import { Workflow } from '@systemfsoftware/effect-cell-types'
import { DecisionTypeId, FsPath, PackageVersion, RepoRoot } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { PinName, PinRootManifestCommand } from './pin-root-manifest.schema.js'

export class PinVersionUnusable extends S.TaggedError<PinVersionUnusable>()(
  'PinVersionUnusable',
  {
    given: S.optional(S.String),
  },
) {}

export class PinDistributionMissing extends S.TaggedError<PinDistributionMissing>()(
  'PinDistributionMissing',
  {
    root: RepoRoot,
  },
) {}

export class PinManifestInvalid extends S.TaggedError<PinManifestInvalid>()(
  'PinManifestInvalid',
  {
    path: FsPath,
    reason: S.String,
  },
) {}

export const PinRefusal = S.Union([
  PinVersionUnusable,
  PinDistributionMissing,
  PinManifestInvalid,
])
export type PinRefusal = S.Schema.Type<typeof PinRefusal>

export class WorkspaceVersionRepinned extends S.TaggedClass<WorkspaceVersionRepinned>()(
  'WorkspaceVersionRepinned',
  {
    version: PackageVersion,
    pins: S.Array(PinName),
    text: S.String,
  },
) {
  readonly [DecisionTypeId] = DecisionTypeId
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
  readonly [DecisionTypeId] = DecisionTypeId
}

export type PinDecision = WorkspaceVersionRepinned | WorkspaceVersionAlreadyCurrent

const VersionUnusableCase = S.TaggedStruct('VersionUnusable', { given: S.optional(S.String) })
const NoDistributionCase = S.TaggedStruct('NoDistribution', { root: RepoRoot })
const RevisionUnchangedCase = S.TaggedStruct('RevisionUnchanged', {
  version: PackageVersion,
  pins: S.Array(PinName),
  text: S.String,
})
const RevisionChangedCase = S.TaggedStruct('RevisionChanged', {
  version: PackageVersion,
  pins: S.Array(PinName),
  text: S.String,
})

type VersionUnusableCase = S.Schema.Type<typeof VersionUnusableCase>
type NoDistributionCase = S.Schema.Type<typeof NoDistributionCase>
type RevisionUnchangedCase = S.Schema.Type<typeof RevisionUnchangedCase>
type RevisionChangedCase = S.Schema.Type<typeof RevisionChangedCase>

type PinCase =
  | VersionUnusableCase
  | NoDistributionCase
  | RevisionUnchangedCase
  | RevisionChangedCase

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

const pinCaseOf = (command: PinRootManifestCommand): PinCase => {
  if (command.suffixes === undefined) return NoDistributionCase.make({ root: command.repoRoot })
  if (command.requestedVersion !== undefined && command.requestedUsable === undefined) {
    return VersionUnusableCase.make({ given: command.requestedVersion })
  }
  const version = command.requestedUsable ?? command.declaredUsable
  if (version === undefined) return VersionUnusableCase.make({ given: command.requestedVersion })
  const text = renderedManifest(command, version)
  if (text === command.manifestText) {
    return RevisionUnchangedCase.make({
      version,
      pins: [...command.pinNames],
      text: command.manifestText,
    })
  }
  return RevisionChangedCase.make({ version, pins: [...command.pinNames], text })
}

export const pinRootManifest = Workflow.make(
  PinRootManifestCommand,
  (
    command,
  ): Result.Result<
    PinDecision,
    PinVersionUnusable | PinDistributionMissing
  > =>
    Match.value(pinCaseOf(command)).pipe(
      Match.tag(
        'VersionUnusable',
        (unusable) => Result.fail(PinVersionUnusable.make({ given: unusable.given })),
      ),
      Match.tag(
        'NoDistribution',
        (missing) => Result.fail(PinDistributionMissing.make({ root: missing.root })),
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
