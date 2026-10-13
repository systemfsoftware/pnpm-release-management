import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import {
  ChangeEvidencePort,
  type ChangeEvidenceRefusal,
  ChangesetsPort,
  type ChangesetsRefusal,
  FsPath,
  GitPort,
  GitRef,
  type IntegrityFilesEmpty,
  type IntegrityNothingToVerify,
  LEDGER_PATH,
  LedgerPort,
  type LedgerRefusal,
  type MemberRefusal,
  ReleaseLedger,
  RemoteName,
  RepoRoot,
  type TagIntegrityMismatch,
  TarballPort,
  type TarballRefusal,
  TaskName,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect, Option } from 'effect'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import {
  compareUnreleasedTarballs,
  TarballsCompared,
  UnreleasedListed,
  UnreleasedMatched,
  UnreleasedTarballsCommand,
  UnreleasedVacant,
} from './compare-unreleased-tarballs.workflow.js'
import { exemptNames, identityCandidates, verifyIntegrity } from './integrity.js'
import { releasedTarballChecks, type ReleasedTarballRefusal } from './released-tarballs.js'

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
    const evidence = yield* Effect.flatMap(ChangeEvidencePort, (port) => {
      if (request.strategy === 'turbo') {
        return port.turboEvidence(request.root, request.ref, request.task ?? TaskName.make('build'))
      }
      return port.pathsEvidence(request.root, request.ref)
    })
    const workspace = yield* WorkspaceStore
    const git = yield* GitPort
    const members = yield* workspace.listMembers()
    const tags = yield* git.remoteTags(remote)
    const planned = yield* Effect.flatMap(ChangesetsPort, (port) => port.plan())
    const tagged = identityCandidates(
      members.map((member) => ({
        name: member.name,
        version: member.manifest.version,
        publishable: member.publishable,
      })),
      tags,
    )
    const releasing = exemptNames(tagged, planned.releases)
    const atRisk = tagged.filter((member) =>
      evidence.touched.includes(member.name) && releasing.includes(member.name) === false
    )
    const packages = atRisk.map((member) => member.name)
    const dir = request.tarballs
    if (dir === undefined || atRisk.length === 0) {
      return UnreleasedTarballsCommand.make({ packages })
    }
    const digests = yield* Effect.flatMap(TarballPort, (port) => port.read(dir))
    const ledger = yield* Effect.flatMap(LedgerPort, (port) => port.read(LEDGER_PATH))
    const ledgerEntries = Option.getOrElse(ledger, () => ReleaseLedger.make({ entries: [] })).entries
    const checks = yield* releasedTarballChecks(atRisk, digests, ledgerEntries, remote)
    const comparison = Result.match(verifyIntegrity(checks), {
      onFailure: (refusal) => refusal,
      onSuccess: (count) => TarballsCompared.make({ count }),
    })
    return UnreleasedTarballsCommand.make({ packages, comparison })
  })

type ComparisonRefusal = IntegrityNothingToVerify | IntegrityFilesEmpty | TagIntegrityMismatch

export const unreleasedTarballsCell = Cell.layer({
  read,
  decide: compareUnreleasedTarballs,
  write: (outcome: Result.Result<UnreleasedTarballsDecision, ComparisonRefusal>) => Effect.fromResult(outcome),
})
