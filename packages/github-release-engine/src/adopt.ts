import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import type { AdoptionFailure, LedgerEntry, MemberRefusal, TagRefusal } from '@systemfsoftware/release-language'
import {
  FsPath,
  GitPort,
  HttpUrl,
  LedgerPort,
  LedgerUnwritable,
  RegistryFetchFailed,
  RegistryIntegrityMismatch,
  RegistryMetadataMalformed,
  RegistryPort,
  RelativePath,
  RemoteName,
  TarballPort,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect, Option } from 'effect'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { AdoptionCommand, type AdoptionDecision, AdoptionRefused, adoptRelease } from './adopt-release.workflow.js'
import { AdoptionReport } from './adopt.schema.js'
import { tagOf } from './cycle.js'
import { identityCandidates } from './integrity.js'

export const AdoptionRequest = Wire.wire({
  registry: Wire.mint(HttpUrl),
  remote: Wire.mint(S.optional(RemoteName)),
  output: Wire.mint(RelativePath),
})

export type AdoptionReadRefusal = MemberRefusal | TagRefusal

type AdoptionRequestInput = S.Schema.Type<typeof AdoptionRequest>

const compareTags = (left: LedgerEntry, right: LedgerEntry): number => {
  if (left.tag < right.tag) return -1
  if (left.tag > right.tag) return 1
  return 0
}

const gather = (
  request: AdoptionRequestInput,
): Effect.Effect<
  AdoptionCommand,
  AdoptionReadRefusal,
  WorkspaceStore | GitPort | RegistryPort | TarballPort
> =>
  Effect.gen(function*() {
    const remote = request.remote ?? RemoteName.make('origin')
    const workspace = yield* WorkspaceStore
    const git = yield* GitPort
    const registry = yield* RegistryPort
    const tarballs = yield* TarballPort
    const members = yield* workspace.listMembers()
    const tags = yield* git.remoteTags(remote)
    const candidates = identityCandidates(
      members.map((member) => ({
        name: member.name,
        version: member.manifest.version,
        publishable: member.publishable,
      })),
      tags,
    )
    const entries: Array<LedgerEntry> = []
    const failures: Array<AdoptionFailure> = []
    for (const candidate of candidates) {
      const name = candidate.name
      const version = candidate.version
      const tag = tagOf(name, version)
      const fetched = yield* registry.metadata(request.registry, name, version).pipe(
        Effect.match({ onSuccess: Result.succeed, onFailure: Result.fail }),
      )
      if (Result.isFailure(fetched)) {
        failures.push(fetched.failure)
        continue
      }
      const downloaded = yield* registry.download(fetched.success.tarball).pipe(
        Effect.mapError((failure) =>
          RegistryFetchFailed.make({ package: name, version, reason: `${failure.url}: ${failure.reason}` })
        ),
        Effect.match({ onSuccess: Result.succeed, onFailure: Result.fail }),
      )
      if (Result.isFailure(downloaded)) {
        failures.push(downloaded.failure)
        continue
      }
      const bytes = downloaded.success
      const bytesSource = FsPath.make(fetched.success.tarball)
      const digested = yield* tarballs.digest(bytesSource, bytes).pipe(
        Effect.match({ onSuccess: Result.succeed, onFailure: Result.fail }),
      )
      if (Result.isFailure(digested)) {
        failures.push(digested.failure)
        continue
      }
      const digest = digested.success
      if (digest.name !== name || digest.version !== version) {
        failures.push(
          RegistryMetadataMalformed.make({
            package: name,
            version,
            reason: `dist.tarball holds ${digest.name}@${digest.version}`,
          }),
        )
        continue
      }
      if (digest.integrity !== fetched.success.integrity) {
        failures.push(
          RegistryIntegrityMismatch.make({
            package: name,
            version,
            expected: fetched.success.integrity,
            actual: digest.integrity,
          }),
        )
        continue
      }
      const commit = yield* git.tagCommit(remote, tag)
      if (Option.isNone(commit)) {
        failures.push(
          RegistryFetchFailed.make({ package: name, version, reason: `tag ${tag} is not on ${remote}` }),
        )
        continue
      }
      entries.push({
        tag,
        commit: commit.value,
        package: name,
        version,
        integrity: fetched.success.integrity,
        sha256: tarballs.sha256(bytes),
        files: digest.files,
      })
    }
    entries.sort(compareTags)
    return AdoptionCommand.make({ entries, failures, output: request.output })
  })

const write = (
  outcome: Result.Result<AdoptionDecision, AdoptionRefused>,
  raw: AdoptionCommand,
): Effect.Effect<AdoptionReport, AdoptionRefused | LedgerUnwritable, LedgerPort> =>
  Effect.gen(function*() {
    if (Result.isFailure(outcome)) {
      return yield* Effect.fail(outcome.failure)
    }
    const ledger = yield* LedgerPort
    yield* ledger.write(raw.output, { entries: [...raw.entries] })
    return outcome.success
  })

export const adoptCell: Cell.Cell<
  AdoptionRequestInput,
  AdoptionReport,
  AdoptionReadRefusal | AdoptionRefused | LedgerUnwritable,
  WorkspaceStore | GitPort | RegistryPort | TarballPort | LedgerPort
> = Cell.layer({
  read: gather,
  decide: adoptRelease,
  write,
})
