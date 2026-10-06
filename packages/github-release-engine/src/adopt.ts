import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import type { AdoptionFailure, LedgerEntry, MemberRefusal, TagRefusal } from '@systemfsoftware/release-language'
import {
  AdoptionExcluded,
  FsPath,
  GitPort,
  HttpUrl,
  LedgerPort,
  LedgerUnwritable,
  PackageName,
  PackageVersion,
  RegistryFetchFailed,
  RegistryIntegrityMismatch,
  RegistryMetadataMalformed,
  RegistryPort,
  type RegistryRefusal,
  RelativePath,
  type ReleaseTag,
  RemoteName,
  TarballPort,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { Effect, Option, Schedule } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { AdoptionCommand, type AdoptionDecision, AdoptionRefused, adoptRelease } from './adopt-release.workflow.js'
import { AdoptionReport } from './adopt.schema.js'

export const AdoptionRequest = Wire.wire({
  registry: Wire.mint(HttpUrl),
  remote: Wire.mint(S.optional(RemoteName)),
  output: Wire.mint(RelativePath),
})

export type AdoptionReadRefusal = MemberRefusal | TagRefusal

type AdoptionRequestInput = S.Schema.Type<typeof AdoptionRequest>

interface Candidate {
  readonly tag: ReleaseTag
  readonly name: PackageName
  readonly version: PackageVersion
}

const compareTags = (left: LedgerEntry, right: LedgerEntry): number => {
  if (left.tag < right.tag) return -1
  if (left.tag > right.tag) return 1
  return 0
}

const parseTag = (tag: ReleaseTag): Option.Option<{ name: PackageName; version: PackageVersion }> => {
  const index = tag.lastIndexOf('@v')
  if (index <= 0) {
    return Option.none()
  }
  const name = S.decodeUnknownOption(PackageName)(tag.slice(0, index))
  const version = S.decodeUnknownOption(PackageVersion)(tag.slice(index + 2))
  if (Option.isNone(name) || Option.isNone(version)) {
    return Option.none()
  }
  return Option.some({ name: name.value, version: version.value })
}

const registryFailureOf = (
  failure: RegistryRefusal,
  name: PackageName,
  version: PackageVersion,
): AdoptionFailure =>
  Match.value(failure).pipe(
    Match.tag('RegistryFetchFailed', (fetched) => fetched),
    Match.tag('RegistryMetadataMalformed', (malformed) => malformed),
    Match.tag('RegistryDownloadFailed', (download) =>
      RegistryFetchFailed.make({ package: name, version, reason: download.reason, status: download.status })),
    Match.exhaustive,
  )

const isTransient = (failure: AdoptionFailure): boolean =>
  Match.value(failure).pipe(
    Match.tag('RegistryFetchFailed', (fetched) => fetched.status === undefined || fetched.status >= 500),
    Match.tag('RegistryMetadataMalformed', () => false),
    Match.tag('RegistryIntegrityMismatch', () => false),
    Match.exhaustive,
  )

const fetchEntry = (
  request: AdoptionRequestInput,
  git: GitPort,
  registry: RegistryPort,
  tarballs: TarballPort,
  remote: RemoteName,
  candidate: Candidate,
): Effect.Effect<LedgerEntry, AdoptionFailure> =>
  Effect.gen(function*() {
    const name = candidate.name
    const version = candidate.version
    const tag = candidate.tag
    const metadata = yield* registry.metadata(request.registry, name, version).pipe(
      Effect.mapError((failure) => registryFailureOf(failure, name, version)),
    )
    const downloaded = yield* registry.download(metadata.tarball).pipe(
      Effect.mapError((failure) =>
        RegistryFetchFailed.make({
          package: name,
          version,
          reason: `${failure.url}: ${failure.reason}`,
          status: failure.status,
        })
      ),
    )
    const digested = yield* tarballs.digest(FsPath.make(metadata.tarball), downloaded).pipe(
      Effect.mapError((failure) =>
        RegistryMetadataMalformed.make({ package: name, version, reason: `tarball unreadable: ${failure.reason}` })
      ),
    )
    if (digested.name !== name || digested.version !== version) {
      return yield* Effect.fail(
        RegistryMetadataMalformed.make({
          package: name,
          version,
          reason: `dist.tarball holds ${digested.name}@${digested.version}`,
        }),
      )
    }
    if (digested.integrity !== metadata.integrity) {
      return yield* Effect.fail(
        RegistryIntegrityMismatch.make({
          package: name,
          version,
          expected: metadata.integrity,
          actual: digested.integrity,
        }),
      )
    }
    const commit = yield* git.tagCommit(remote, tag).pipe(
      Effect.mapError(() => RegistryFetchFailed.make({ package: name, version, reason: `tag ${tag} unreadable` })),
    )
    if (Option.isNone(commit)) {
      return yield* Effect.fail(
        RegistryFetchFailed.make({ package: name, version, reason: `tag ${tag} is not on ${remote}` }),
      )
    }
    return {
      tag,
      commit: commit.value,
      package: name,
      version,
      integrity: metadata.integrity,
      sha256: tarballs.sha256(downloaded),
      files: digested.files,
    }
  }).pipe(Effect.retry({ schedule: Schedule.exponential('200 millis'), times: 2, while: isTransient }))

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
    const candidates: Array<Candidate> = []
    for (const tag of tags) {
      const parsed = parseTag(tag)
      if (Option.isSome(parsed)) {
        candidates.push({ tag, name: parsed.value.name, version: parsed.value.version })
      }
    }
    const toAdopt: Array<Candidate> = []
    const excluded: Array<AdoptionExcluded> = []
    for (const candidate of candidates) {
      const member = members.find((known) => known.name === candidate.name)
      if (member !== undefined && !member.publishable) {
        excluded.push(
          AdoptionExcluded.make({
            tag: candidate.tag,
            package: candidate.name,
            version: candidate.version,
            reason: 'private, never published',
          }),
        )
        continue
      }
      toAdopt.push(candidate)
    }
    const outcomes = yield* Effect.forEach(
      toAdopt,
      (candidate) => Effect.result(fetchEntry(request, git, registry, tarballs, remote, candidate)),
      { concurrency: 4 },
    )
    const entries: Array<LedgerEntry> = []
    const failures: Array<AdoptionFailure> = []
    for (const outcome of outcomes) {
      if (Result.isFailure(outcome)) {
        failures.push(outcome.failure)
      } else {
        entries.push(outcome.success)
      }
    }
    entries.sort(compareTags)
    return AdoptionCommand.make({ entries, failures, excluded, output: request.output })
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
    return AdoptionReport.make({ decision: outcome.success, excluded: [...raw.excluded], output: raw.output })
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
