import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import {
  type ChangeEvidencePort,
  type ChangeEvidenceRefusal,
  ChangesetsPort,
  type ChangesetsRefusal,
  evidenceOf,
  FsPath,
  GitPort,
  GitRef,
  type LedgerPort,
  type LedgerRefusal,
  type MemberRefusal,
  type PackageName,
  RemoteName,
  RepoRoot,
  TarballPort,
  type TarballRefusal,
  TaskName,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import {
  compareUnreleasedTarballs,
  type ComparisonRefusal,
  UnreleasedListed,
  UnreleasedMatched,
  UnreleasedTarballsCommand,
  type UnreleasedTargets,
  UnreleasedVacant,
} from './compare-unreleased-tarballs.workflow.js'
import { verifyIntegrity } from './integrity.js'
import { ledgerEntries, releasedTarballChecks, type ReleasedTarballRefusal, unreleasedOf } from './released-tarballs.js'

export const UnreleasedTarballsRequest = Wire.wire({
  root: Wire.mint(RepoRoot),
  ref: Wire.mint(GitRef),
  strategy: Wire.mint(S.Literals(['paths', 'turbo'])),
  task: Wire.mint(S.optional(TaskName)),
  remote: Wire.mint(S.optional(RemoteName)),
  tarballs: Wire.mint(S.optional(FsPath)),
})

export type UnreleasedTarballsDecision = UnreleasedVacant | UnreleasedListed | UnreleasedMatched

type ReadRefusal =
  | ChangeEvidenceRefusal
  | MemberRefusal
  | ChangesetsRefusal
  | TarballRefusal
  | LedgerRefusal
  | ReleasedTarballRefusal

const read = (
  request: S.Schema.Type<typeof UnreleasedTarballsRequest>,
): Effect.Effect<
  UnreleasedTarballsCommand,
  ReadRefusal,
  ChangeEvidencePort | WorkspaceStore | GitPort | ChangesetsPort | TarballPort | LedgerPort
> =>
  Effect.gen(function*() {
    const remote = request.remote ?? RemoteName.make('origin')
    const evidence = yield* evidenceOf(request.root, request.ref, request.strategy, request.task)
    const workspace = yield* WorkspaceStore
    const git = yield* GitPort
    const members = yield* workspace.listMembers()
    const tags = yield* git.remoteTags(remote)
    const planned = yield* Effect.flatMap(ChangesetsPort, (port) => port.plan())
    const atRisk = unreleasedOf(members, tags, planned.releases).filter((member) =>
      evidence.touched.includes(member.name)
    )
    const [first, ...rest] = atRisk.map((member) => member.name)
    if (first === undefined) {
      return UnreleasedTarballsCommand.make({ targets: { _tag: 'NoTargets' } })
    }
    const packages: readonly [PackageName, ...Array<PackageName>] = [first, ...rest]
    const dir = request.tarballs
    if (dir === undefined) {
      return UnreleasedTarballsCommand.make({ targets: { _tag: 'AwaitingTarballs', packages } })
    }
    const digests = yield* Effect.flatMap(TarballPort, (port) => port.read(dir))
    const entries = yield* ledgerEntries
    const checks = yield* releasedTarballChecks(atRisk, digests, entries, remote)
    const targets = Result.match(verifyIntegrity(checks), {
      onFailure: (refusal): UnreleasedTargets => ({ _tag: 'TarballsRefused', packages, refusal }),
      onSuccess: (count): UnreleasedTargets => ({ _tag: 'TarballsCompared', packages, count }),
    })
    return UnreleasedTarballsCommand.make({ targets })
  })

export const unreleasedTarballsCell = Cell.layer({
  read,
  decide: compareUnreleasedTarballs,
  write: (outcome: Result.Result<UnreleasedTarballsDecision, ComparisonRefusal>) => Effect.fromResult(outcome),
})
