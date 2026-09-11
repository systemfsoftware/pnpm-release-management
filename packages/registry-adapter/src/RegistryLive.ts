import {
  type PackageName,
  PackageVersion,
  ProcessPort,
  type PublishRefusal,
  RegistryPort,
  type RepoRoot,
  TrustRegistryUnreadable,
  TrustSnapshot,
  WorkspaceCommand,
} from '@systemfsoftware/release-language'
import { Context, Effect, Layer, Option, Semaphore } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import { PackumentDoc, PublishedBase, type RegistryDoc, UnpublishedBase, VersionDoc } from './Registry.schema.js'

export interface RegistryConfig {
  readonly baseUrl: string
  readonly root: RepoRoot
}

export const RegistryConfig: Context.Service<RegistryConfig, RegistryConfig> = Context.Service<
  RegistryConfig,
  RegistryConfig
>('RegistryConfig')

const READ_CONCURRENCY = 8
const ABBREVIATED_PACKUMENT = 'application/vnd.npm.install-v1+json'
const READ_DEADLINE_MS = 30_000

const drainBody = (response: Response): Effect.Effect<void> => {
  const body = response.body
  if (body === null) {
    return Effect.void
  }
  return Effect.promise(() => body.cancel())
}

const readPackument = (
  url: string,
  refusal: TrustRegistryUnreadable,
): Effect.Effect<Option.Option<unknown>, TrustRegistryUnreadable> =>
  Effect.gen(function*() {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          headers: { accept: ABBREVIATED_PACKUMENT },
          signal: AbortSignal.timeout(READ_DEADLINE_MS),
        }),
      catch: () => refusal,
    })
    if (response.status === 404) {
      yield* drainBody(response)
      return Option.none<unknown>()
    }
    if (!response.ok) {
      yield* drainBody(response)
      return yield* Effect.fail(refusal)
    }
    const body: unknown = yield* Effect.tryPromise({ try: () => response.json(), catch: () => refusal })
    return Option.some(body)
  })

const carriesAttestation = (entry: unknown): boolean =>
  Option.getSuccess(S.decodeUnknownResult(VersionDoc)(entry)).pipe(
    Option.flatMap((version) => Option.fromNullishOr(version.dist)),
    Option.flatMap((dist) => Option.fromNullishOr(dist.attestations)),
    Option.isSome,
  )

const latestOf = (doc: PackumentDoc): Option.Option<PackageVersion> =>
  Option.flatMap(
    Option.fromNullishOr(doc['dist-tags']?.['latest']),
    (raw) => Option.getSuccess(S.decodeUnknownResult(PackageVersion)(raw)),
  )

const publishedDocOf = (doc: PackumentDoc): Option.Option<RegistryDoc> =>
  Option.map(latestOf(doc), (latest): RegistryDoc =>
    PublishedBase.make({
      latest,
      attested: carriesAttestation(doc.versions?.[latest]),
      versions: doc.versions,
    }))

const decodeBody = (body: unknown): Option.Option<RegistryDoc> =>
  Option.flatMap(Option.getSuccess(S.decodeUnknownResult(PackumentDoc)(body)), (doc) =>
    Match.value(doc.error).pipe(
      Match.when('Not found', () => Option.some<RegistryDoc>(UnpublishedBase.make({}))),
      Match.orElse(() => publishedDocOf(doc)),
    ))

const decodeAnswer = (payload: Option.Option<unknown>): Option.Option<RegistryDoc> =>
  Option.match(payload, {
    onNone: () => Option.some<RegistryDoc>(UnpublishedBase.make({})),
    onSome: decodeBody,
  })

const registryDocOf = (
  gate: Semaphore.Semaphore,
  url: string,
  refusal: TrustRegistryUnreadable,
): Effect.Effect<RegistryDoc, TrustRegistryUnreadable> =>
  Semaphore.withPermit(gate)(
    Effect.flatMap(readPackument(url, refusal), (payload) =>
      Option.match(decodeAnswer(payload), {
        onNone: () => Effect.fail(refusal),
        onSome: (doc) => Effect.succeed(doc),
      })),
  )

const snapshotOf = (name: PackageName, doc: RegistryDoc): TrustSnapshot =>
  Match.value(doc).pipe(
    Match.tag('Published', (published) =>
      TrustSnapshot.make({
        name,
        latest: published.latest,
        attested: published.attested,
        reachable: true,
      })),
    Match.tag('Unpublished', () => TrustSnapshot.make({ name, attested: false, reachable: true })),
    Match.exhaustive,
  )

const listsVersion = (doc: RegistryDoc, version: PackageVersion): boolean =>
  Match.value(doc).pipe(
    Match.tag(
      'Published',
      (published) => published.versions !== undefined && Object.hasOwn(published.versions, version),
    ),
    Match.tag('Unpublished', () => false),
    Match.exhaustive,
  )

const publishCommandOf = (
  name: PackageName,
  provenance: boolean,
  root: RepoRoot,
): Effect.Effect<WorkspaceCommand, never> => {
  const args: Array<string> = ['--filter', name, 'publish', '--access', 'public', '--no-git-checks']
  if (provenance) {
    args.push('--provenance')
  }
  return Effect.orDie(
    Effect.fromResult(S.decodeResult(WorkspaceCommand)({ program: 'pnpm', args, cwd: root })),
  )
}

export const RegistryLive: Layer.Layer<RegistryPort, never, RegistryConfig | ProcessPort> = Layer.effect(
  RegistryPort,
  Effect.gen(function*() {
    const config = yield* RegistryConfig
    const process = yield* ProcessPort
    const gate = yield* Semaphore.make(READ_CONCURRENCY)
    const base = config.baseUrl.replace(/\/+$/, '')
    const root = config.root

    const readOf = (name: PackageName): Effect.Effect<RegistryDoc, TrustRegistryUnreadable> =>
      registryDocOf(gate, `${base}/${encodeURIComponent(name)}`, TrustRegistryUnreadable.make({ packages: [name] }))

    return {
      queryPackage: (name: PackageName): Effect.Effect<TrustSnapshot, never, never> =>
        Effect.matchEffect(readOf(name), {
          onFailure: () => Effect.succeed(TrustSnapshot.make({ name, attested: false, reachable: false })),
          onSuccess: (doc) => Effect.succeed(snapshotOf(name, doc)),
        }),
      isVersionPublished: (
        name: PackageName,
        version: PackageVersion,
      ): Effect.Effect<boolean, TrustRegistryUnreadable, never> =>
        Effect.map(readOf(name), (doc) => listsVersion(doc, version)),
      publishMember: (
        name: PackageName,
        _version: PackageVersion,
        provenance: boolean,
      ): Effect.Effect<void, PublishRefusal, never> =>
        Effect.flatMap(
          publishCommandOf(name, provenance, root),
          (command) => Effect.as(process.runCommand(command), undefined),
        ),
    }
  }),
)
