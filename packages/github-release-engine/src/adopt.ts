import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import type { AdoptionFailure, TagRefusal } from '@systemfsoftware/release-language'
import {
  AdoptionExcluded,
  AdoptionTagUnresolved,
  FsPath,
  GitPort,
  HttpUrl,
  LedgerPort,
  LedgerUnwritable,
  MismatchedLedgerEntry,
  PackageName,
  PackageVersion,
  PublishedLedgerEntry,
  PublishedState,
  RegistryFetchFailed,
  RegistryIntegrityMismatch,
  RegistryMetadataMalformed,
  RegistryPort,
  type RegistryRefusal,
  RelativePath,
  type ReleaseLedgerEntry,
  type ReleaseTag,
  RemoteName,
  TarballPort,
  UnpublishedLedgerEntry,
  UnpublishedState,
  type VersionState,
} from '@systemfsoftware/release-language'
import { Effect, Option, Schedule } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { AdoptionCommand, type AdoptionDecision, AdoptionRefused, adoptRelease } from './adopt-release.workflow.js'
import { AdoptionExcludedTag, AdoptionLedgered, type AdoptionProduct, AdoptionReport } from './adopt.schema.js'

export const AdoptionRequest = Wire.wire({
  registry: Wire.mint(HttpUrl),
  remote: Wire.mint(S.optional(RemoteName)),
  output: Wire.mint(RelativePath),
})

export type AdoptionReadRefusal = TagRefusal

type AdoptionRequestInput = S.Schema.Type<typeof AdoptionRequest>

interface Candidate {
  readonly tag: ReleaseTag
  readonly name: PackageName
  readonly version: PackageVersion
}

const compareTags = (left: ReleaseLedgerEntry, right: ReleaseLedgerEntry): number => {
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

const isNotFound = (failure: RegistryRefusal): boolean =>
  Match.value(failure).pipe(
    Match.tag('RegistryFetchFailed', (fetched) => fetched.status === 404),
    Match.tag('RegistryMetadataMalformed', () => false),
    Match.tag('RegistryDownloadFailed', () => false),
    Match.exhaustive,
  )

const isTransient = (failure: AdoptionFailure): boolean =>
  Match.value(failure).pipe(
    Match.tag('RegistryFetchFailed', (fetched) => fetched.status === undefined || fetched.status >= 500),
    Match.tag('RegistryMetadataMalformed', () => false),
    Match.tag('RegistryIntegrityMismatch', () => false),
    Match.tag('AdoptionTagUnresolved', () => false),
    Match.exhaustive,
  )

const metadataUrl = (registry: HttpUrl, name: PackageName, version: PackageVersion): HttpUrl =>
  HttpUrl.make(`${registry}/${encodeURIComponent(name)}/${version}`)

const fetchState = (
  request: AdoptionRequestInput,
  registry: RegistryPort,
  tarballs: TarballPort,
  name: PackageName,
  version: PackageVersion,
): Effect.Effect<VersionState, AdoptionFailure> =>
  Effect.gen(function*() {
    const requested = metadataUrl(request.registry, name, version)
    const attempted = yield* registry.metadata(request.registry, name, version).pipe(
      Effect.match({ onSuccess: Result.succeed, onFailure: Result.fail }),
    )
    if (Result.isFailure(attempted)) {
      if (isNotFound(attempted.failure)) {
        return UnpublishedState.make({
          url: requested,
          status: 404,
          fetchedAt: new Date().toISOString(),
        })
      }
      return yield* Effect.fail(registryFailureOf(attempted.failure, name, version))
    }
    const metadata = attempted.success
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
    return PublishedState.make({
      integrity: metadata.integrity,
      sha256: tarballs.sha256(downloaded),
      files: digested.files,
    })
  })

const stateEntry = (
  tag: ReleaseTag,
  commit: PublishedLedgerEntry['commit'],
  name: PackageName,
  version: PackageVersion,
  state: VersionState,
): ReleaseLedgerEntry =>
  Match.value(state).pipe(
    Match.tag('published', (published) =>
      PublishedLedgerEntry.make({
        tag,
        commit,
        package: name,
        version,
        integrity: published.integrity,
        sha256: published.sha256,
        files: published.files,
      })),
    Match.tag('unpublished', (unpublished) =>
      UnpublishedLedgerEntry.make({
        tag,
        commit,
        package: name,
        version,
        url: unpublished.url,
        status: unpublished.status,
        fetchedAt: unpublished.fetchedAt,
      })),
    Match.exhaustive,
  )

const fetchEntry = (
  request: AdoptionRequestInput,
  git: GitPort,
  registry: RegistryPort,
  tarballs: TarballPort,
  remote: RemoteName,
  candidate: Candidate,
): Effect.Effect<AdoptionProduct, AdoptionFailure> =>
  Effect.gen(function*() {
    const tag = candidate.tag
    const claimed = candidate.version
    const treeOption = yield* git.tagTree(remote, tag).pipe(
      Effect.mapError(() => AdoptionTagUnresolved.make({ tag, reason: `tag ${tag} is not readable on ${remote}` })),
    )
    if (Option.isNone(treeOption)) {
      return yield* Effect.fail(
        AdoptionTagUnresolved.make({ tag, reason: `tag ${tag} does not resolve to a commit on ${remote}` }),
      )
    }
    const tree = treeOption.value
    const named = tree.manifests.filter((candidateManifest) => {
      const name = candidateManifest.manifest.name
      return name === candidate.name || name.endsWith(`/${candidate.name}`)
    })
    if (named.length === 0) {
      const available = tree.manifests.map(
        (candidateManifest) => `${candidateManifest.manifest.name}@${candidateManifest.manifest.version}`,
      )
      let candidates = ''
      if (available.length > 0) {
        candidates = `; candidates: ${available.join(', ')}`
      }
      return yield* Effect.fail(
        AdoptionTagUnresolved.make({
          tag,
          reason: `no package.json at ${tree.commit} matches ${candidate.name}${candidates}`,
        }),
      )
    }
    if (named.length > 1) {
      return yield* Effect.fail(
        AdoptionTagUnresolved.make({
          tag,
          reason: `several package.json match ${candidate.name}: ${
            named.map((manifest) => manifest.manifest.name).join(', ')
          }`,
        }),
      )
    }
    const [matched] = named
    if (matched === undefined) {
      return yield* Effect.fail(AdoptionTagUnresolved.make({ tag, reason: `cannot resolve ${tag}` }))
    }
    const published = matched.manifest.name
    if (matched.manifest.private === true) {
      return AdoptionExcludedTag.make({
        excluded: AdoptionExcluded.make({
          tag,
          package: published,
          version: claimed,
          reason: 'private, never published',
        }),
      })
    }
    const manifestVersion = matched.manifest.version
    if (manifestVersion === claimed) {
      const state = yield* fetchState(request, registry, tarballs, published, claimed)
      return AdoptionLedgered.make({ entry: stateEntry(tag, tree.commit, published, claimed, state) })
    }
    const claimedState = yield* fetchState(request, registry, tarballs, published, claimed)
    const manifestState = yield* fetchState(request, registry, tarballs, published, manifestVersion)
    return AdoptionLedgered.make({
      entry: MismatchedLedgerEntry.make({
        tag,
        commit: tree.commit,
        package: published,
        claimedVersion: claimed,
        manifestVersion,
        claimed: claimedState,
        manifest: manifestState,
      }),
    })
  }).pipe(Effect.retry({ schedule: Schedule.exponential('200 millis'), times: 2, while: isTransient }))

const gather = (
  request: AdoptionRequestInput,
): Effect.Effect<AdoptionCommand, AdoptionReadRefusal, GitPort | RegistryPort | TarballPort> =>
  Effect.gen(function*() {
    const remote = request.remote ?? RemoteName.make('origin')
    const git = yield* GitPort
    const registry = yield* RegistryPort
    const tarballs = yield* TarballPort
    const tags = yield* git.remoteTags(remote)
    const candidates: Array<Candidate> = []
    for (const tag of tags) {
      const parsed = parseTag(tag)
      if (Option.isSome(parsed)) {
        candidates.push({ tag, name: parsed.value.name, version: parsed.value.version })
      }
    }
    const outcomes = yield* Effect.forEach(
      candidates,
      (candidate) => Effect.result(fetchEntry(request, git, registry, tarballs, remote, candidate)),
      { concurrency: 4 },
    )
    const entries: Array<ReleaseLedgerEntry> = []
    const excluded: Array<AdoptionExcluded> = []
    const failures: Array<AdoptionFailure> = []
    for (const outcome of outcomes) {
      if (Result.isFailure(outcome)) {
        failures.push(outcome.failure)
        continue
      }
      Match.value(outcome.success).pipe(
        Match.tag('Ledgered', (ledgered) => entries.push(ledgered.entry)),
        Match.tag('Excluded', (skipped) => excluded.push(skipped.excluded)),
        Match.exhaustive,
      )
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
    return AdoptionReport.make({
      decision: outcome.success,
      entries: [...raw.entries],
      excluded: [...raw.excluded],
      output: raw.output,
    })
  })

export const adoptCell: Cell.Cell<
  AdoptionRequestInput,
  AdoptionReport,
  AdoptionReadRefusal | AdoptionRefused | LedgerUnwritable,
  GitPort | RegistryPort | TarballPort | LedgerPort
> = Cell.layer({
  read: gather,
  decide: adoptRelease,
  write,
})
