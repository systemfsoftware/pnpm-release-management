import {
  CommandName,
  type PackageName,
  PackageVersion,
  ProcessPort,
  PublishArg,
  type PublishRefusal,
  RegistryPort,
  type RepoRoot,
  TrustRegistryUnreadable,
  TrustSnapshot,
  WorkspaceCommand,
} from '@systemfsoftware/release-language'
import { Context, Effect, Layer, Option, Semaphore } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
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
const NOT_FOUND = 'Not found'

const drainBody = (response: Response): Effect.Effect<void> => {
  const body = response.body
  if (body === null) {
    return Effect.void
  }
  return Effect.promise(() => body.cancel())
}

const readBody = (
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
    const body: unknown = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => refusal,
    })
    return Option.some(body)
  })

const latestOf = (doc: PackumentDoc): Option.Option<PackageVersion> =>
  Option.flatMap(
    Option.fromNullishOr(doc['dist-tags']?.['latest']),
    S.decodeUnknownOption(PackageVersion),
  )

const carriesAttestation = (entry: unknown): boolean =>
  Option.isSome(
    Option.flatMap(
      S.decodeUnknownOption(VersionDoc)(entry),
      (version) =>
        Option.flatMap(
          Option.fromNullishOr(version.dist),
          (dist) => Option.fromNullishOr(dist.attestations),
        ),
    ),
  )

const publishedDocOf = (doc: PackumentDoc): Option.Option<RegistryDoc> =>
  Option.map(latestOf(doc), (latest): RegistryDoc =>
    PublishedBase.make({
      latest,
      attested: carriesAttestation(doc.versions?.[latest]),
      versions: doc.versions,
    }))

const docOf = (
  payload: Option.Option<unknown>,
  refusal: TrustRegistryUnreadable,
): Effect.Effect<RegistryDoc, TrustRegistryUnreadable> =>
  Effect.gen(function*() {
    if (Option.isNone(payload)) {
      return UnpublishedBase.make({})
    }
    const doc = yield* Effect.fromResult(
      Result.mapError(
        S.decodeUnknownResult(PackumentDoc)(payload.value),
        () => refusal,
      ),
    )
    if (doc.error === NOT_FOUND) {
      return UnpublishedBase.make({})
    }
    const published = publishedDocOf(doc)
    if (Option.isNone(published)) {
      return yield* Effect.fail(refusal)
    }
    return published.value
  })

const registryDocOf = (
  gate: Semaphore.Semaphore,
  url: string,
  name: PackageName,
): Effect.Effect<RegistryDoc, TrustRegistryUnreadable> =>
  Semaphore.withPermit(gate)(
    Effect.gen(function*() {
      const refusal = TrustRegistryUnreadable.make({ packages: [name] })
      return yield* Effect.flatMap(readBody(url, refusal), (payload) => docOf(payload, refusal))
    }),
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
      (published) =>
        published.versions !== undefined &&
        Object.hasOwn(published.versions, version),
    ),
    Match.tag('Unpublished', () => false),
    Match.exhaustive,
  )

const publishArgs = (
  name: PackageName,
  provenance: boolean,
): ReadonlyArray<PublishArg> => {
  const args: Array<PublishArg> = [
    PublishArg.make('--filter'),
    PublishArg.make(name),
    PublishArg.make('publish'),
    PublishArg.make('--access'),
    PublishArg.make('public'),
    PublishArg.make('--no-git-checks'),
  ]
  if (provenance) {
    args.push(PublishArg.make('--provenance'))
  }
  return args
}

const publishCommandOf = (
  name: PackageName,
  provenance: boolean,
  root: RepoRoot,
): WorkspaceCommand =>
  WorkspaceCommand.make({
    program: CommandName.make('pnpm'),
    args: publishArgs(name, provenance),
    cwd: root,
  })

export const RegistryLive: Layer.Layer<
  RegistryPort,
  never,
  RegistryConfig | ProcessPort
> = Layer.effect(
  RegistryPort,
  Effect.gen(function*() {
    const config = yield* RegistryConfig
    const process = yield* ProcessPort
    const gate = yield* Semaphore.make(READ_CONCURRENCY)
    const base = config.baseUrl.replace(/\/+$/, '')
    const root = config.root

    const readOf = (
      name: PackageName,
    ): Effect.Effect<RegistryDoc, TrustRegistryUnreadable> =>
      registryDocOf(gate, `${base}/${encodeURIComponent(name)}`, name)

    return {
      queryPackage: (name: PackageName): Effect.Effect<TrustSnapshot, never, never> =>
        Effect.orElseSucceed(
          Effect.map(readOf(name), (doc) => snapshotOf(name, doc)),
          () => TrustSnapshot.make({ name, attested: false, reachable: false }),
        ),
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
        Effect.as(process.runCommand(publishCommandOf(name, provenance, root)), undefined),
    }
  }),
)
