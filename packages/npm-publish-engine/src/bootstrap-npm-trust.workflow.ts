import { Workflow } from '@systemfsoftware/effect-cell-types'
import { HttpUrl, PackageName, PackageVersion, TrustSnapshot } from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

const TrustDecisionTypeId: unique symbol = Symbol.for(
  '@systemfsoftware/npm-publish-engine/TrustDecision',
)
type TrustDecisionTypeId = typeof TrustDecisionTypeId

export const TrustCandidateState = S.Struct({
  name: PackageName,
  version: PackageVersion,
  hasBuild: S.Boolean,
  snapshot: TrustSnapshot,
})
export type TrustCandidateState = S.Schema.Type<typeof TrustCandidateState>

export class TrustCommand extends S.TaggedClass<TrustCommand>()('TrustCommand', {
  only: S.Array(PackageName),
  dryRun: S.Boolean,
  registry: HttpUrl,
  workflowFile: S.NonEmptyString,
  slug: S.String,
  launcherReady: S.Boolean,
  candidates: S.Array(TrustCandidateState),
}) {}

export const TrustWorkItem = S.Struct({
  name: PackageName,
  version: PackageVersion,
  mode: S.Literals(['debut', 'untrusted']),
  hasBuild: S.Boolean,
})
export type TrustWorkItem = S.Schema.Type<typeof TrustWorkItem>

export class TrustComplete extends S.TaggedClass<TrustComplete>()('TrustComplete', {
  processed: S.Int,
  debuts: S.Int,
  owed: S.Array(TrustWorkItem),
  dryRun: S.Boolean,
  workflowFile: S.NonEmptyString,
  slug: S.String,
}) {
  readonly [TrustDecisionTypeId] = TrustDecisionTypeId
}

export class TrustIdle extends S.TaggedClass<TrustIdle>()('TrustIdle', {
  packages: S.Int,
}) {
  readonly [TrustDecisionTypeId] = TrustDecisionTypeId
}

export type TrustWorkflowDecision = TrustComplete | TrustIdle

export class TrustOnlyUnmatched extends S.TaggedError<TrustOnlyUnmatched>()(
  'TrustOnlyUnmatched',
  { only: S.Array(PackageName) },
) {}

export class TrustWorkspaceEmpty extends S.TaggedError<TrustWorkspaceEmpty>()(
  'TrustWorkspaceEmpty',
  { members: S.Int },
) {}

export class TrustRegistryUnreadable extends S.TaggedError<TrustRegistryUnreadable>()(
  'TrustRegistryUnreadable',
  { packages: S.Array(PackageName) },
) {}

export class TrustLauncherMissing extends S.TaggedError<TrustLauncherMissing>()(
  'TrustLauncherMissing',
  { packages: S.Array(PackageName) },
) {}

export type TrustWorkflowRefusal =
  | TrustOnlyUnmatched
  | TrustWorkspaceEmpty
  | TrustRegistryUnreadable
  | TrustLauncherMissing

const EmptyCase = S.TaggedStruct('Empty', {
  members: S.Int,
})
const OnlyUnmatchedCase = S.TaggedStruct('OnlyUnmatched', {
  only: S.Array(PackageName),
})
const UnreadableCase = S.TaggedStruct('Unreadable', {
  packages: S.Array(PackageName),
})
const LauncherMissingCase = S.TaggedStruct('LauncherMissing', {
  packages: S.Array(PackageName),
})
const IdleCase = S.TaggedStruct('Idle', {
  packages: S.Int,
})
const ProceedCase = S.TaggedStruct('Proceed', {
  processed: S.Int,
  debuts: S.Int,
  owed: S.Array(TrustWorkItem),
  dryRun: S.Boolean,
  workflowFile: S.NonEmptyString,
  slug: S.String,
})
const TrustCase = S.Union([
  EmptyCase,
  OnlyUnmatchedCase,
  UnreadableCase,
  LauncherMissingCase,
  IdleCase,
  ProceedCase,
])
type TrustCase = S.Schema.Type<typeof TrustCase>

const matchedOf = (
  command: TrustCommand,
): ReadonlyArray<TrustCandidateState> => {
  if (command.only.length === 0) return command.candidates
  return command.candidates.filter((candidate) => command.only.includes(candidate.name))
}

const owedOf = (
  matched: ReadonlyArray<TrustCandidateState>,
): ReadonlyArray<TrustWorkItem> =>
  matched.flatMap((candidate): ReadonlyArray<TrustWorkItem> => {
    if (candidate.snapshot.latest === undefined) {
      return [{
        name: candidate.name,
        version: candidate.version,
        mode: 'debut',
        hasBuild: candidate.hasBuild,
      }]
    }
    if (candidate.snapshot.attested === false) {
      return [{
        name: candidate.name,
        version: candidate.version,
        mode: 'untrusted',
        hasBuild: candidate.hasBuild,
      }]
    }
    return []
  })

const unreadableOf = (
  matched: ReadonlyArray<TrustCandidateState>,
): ReadonlyArray<PackageName> =>
  matched.filter((candidate) => candidate.snapshot.reachable === false).map((candidate) => candidate.name)

const classify = (command: TrustCommand): TrustCase => {
  const matched = matchedOf(command)
  const owed = owedOf(matched)
  const debuts = owed.filter((item) => item.mode === 'debut')
  return Match.value({ command, matched, owed, debuts }).pipe(
    Match.when(
      ({ command: request }) => request.candidates.length === 0,
      () => ({ _tag: 'Empty', members: 0 } as const),
    ),
    Match.when(
      ({ command: request, matched: targets }) => request.only.length > 0 && targets.length === 0,
      ({ command: request }) => ({
        _tag: 'OnlyUnmatched',
        only: [...request.only],
      } as const),
    ),
    Match.when(
      ({ matched: targets }) => unreadableOf(targets).length > 0,
      ({ matched: targets }) => ({
        _tag: 'Unreadable',
        packages: [...unreadableOf(targets)],
      } as const),
    ),
    Match.when(
      ({ command: request, debuts: debut }) => debut.length > 0 && request.launcherReady === false,
      ({ debuts: debut }) => ({
        _tag: 'LauncherMissing',
        packages: debut.map((item) => item.name),
      } as const),
    ),
    Match.when(
      ({ owed: outstanding }) => outstanding.length === 0,
      ({ matched: targets }) => ({
        _tag: 'Idle',
        packages: targets.length,
      } as const),
    ),
    Match.orElse(({ command: request, owed: outstanding, debuts: debut }) => ({
      _tag: 'Proceed',
      processed: outstanding.length,
      debuts: debut.length,
      owed: [...outstanding],
      dryRun: request.dryRun,
      workflowFile: request.workflowFile,
      slug: request.slug,
    } as const)),
  )
}

export const bootstrapNpmTrust = Workflow.make(
  TrustCommand,
  (
    command,
  ): Result.Result<TrustWorkflowDecision, TrustWorkflowRefusal> =>
    Match.value(classify(command)).pipe(
      Match.tag('Empty', (empty) => Result.fail(TrustWorkspaceEmpty.make({ members: empty.members }))),
      Match.tag('OnlyUnmatched', (unmatched) => Result.fail(TrustOnlyUnmatched.make({ only: [...unmatched.only] }))),
      Match.tag('Unreadable', (unreadable) =>
        Result.fail(TrustRegistryUnreadable.make({ packages: [...unreadable.packages] }))),
      Match.tag('LauncherMissing', (missing) =>
        Result.fail(TrustLauncherMissing.make({ packages: [...missing.packages] }))),
      Match.tag('Idle', (idle) =>
        Result.succeed(TrustIdle.make({ packages: idle.packages }))),
      Match.tag('Proceed', (proceed) =>
        Result.succeed(
          TrustComplete.make({
            processed: proceed.processed,
            debuts: proceed.debuts,
            owed: [...proceed.owed],
            dryRun: proceed.dryRun,
            workflowFile: proceed.workflowFile,
            slug: proceed.slug,
          }),
        )),
      Match.exhaustive,
    ),
)
