import { Workflow } from '@systemfsoftware/effect-cell-types'
import { PackageVersion, PinName, RepoRoot } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
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

const terminated = (text: string, trailingNewline: boolean): string => {
  if (trailingNewline) return `${text}\n`
  return text
}
const rewritten = (
  command: PinRootManifestCommand,
  version: string,
): string =>
  terminated(
    JSON.stringify(
      {
        ...command.manifest,
        version,
        optionalDependencies: Object.fromEntries(command.pinNames.map((name) => [name, version])),
      },
      null,
      command.indent,
    ),
    command.trailingNewline,
  )

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

const classify = (command: PinRootManifestCommand): PinCase => {
  if (command.suffixes === undefined) return { _tag: 'NoDistribution', root: command.repoRoot }
  if (command.requestedVersion !== undefined && command.requestedUsable === undefined) {
    return { _tag: 'VersionUnusable', given: command.requestedVersion }
  }
  const version = command.requestedUsable ?? command.declaredUsable
  if (version === undefined) return { _tag: 'VersionUnusable', given: command.requestedVersion }
  const text = rewritten(command, version)
  if (text === command.manifestText) {
    return { _tag: 'RevisionUnchanged', version, pins: [...command.pinNames], text: command.manifestText }
  }
  return { _tag: 'RevisionChanged', version, pins: [...command.pinNames], text }
}

export const pinRootManifest = Workflow.make(
  PinRootManifestCommand,
  (command) =>
    Match.value(classify(command)).pipe(
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
