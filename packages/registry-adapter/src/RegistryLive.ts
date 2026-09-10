import {
  type PackageName,
  PackageVersion,
  ProcessPort,
  RegistryPort,
  type RepoRoot,
  type TrustRegistryUnreadable,
  type TrustSnapshot,
  WorkspaceCommand,
} from '@systemfsoftware/release-language'
import { Context, Effect, Layer, Semaphore } from 'effect'
import * as S from 'effect/Schema'

export interface RegistryConfig {
  readonly baseUrl: string
  readonly root: RepoRoot
}

export const RegistryConfig: Context.Service<RegistryConfig, RegistryConfig> = Context.Service<
  RegistryConfig,
  RegistryConfig
>('RegistryConfig')

const REGISTRY_CONCURRENCY = 8

const QUERY_TIMEOUT_MS = 30_000

const ABBREVIATED = 'application/vnd.npm.install-v1+json'

const PackumentDoc = S.Struct({
  'dist-tags': S.optional(S.Record(S.String, S.Unknown)),
  versions: S.optional(S.Record(S.String, S.Unknown)),
  error: S.optional(S.Unknown),
})
type PackumentDoc = S.Schema.Type<typeof PackumentDoc>

type RegistryDoc =
  | {
    readonly _tag: 'Published'
    readonly latest: PackageVersion
    readonly attested: boolean
    readonly versions: Readonly<Record<string, unknown>> | undefined
  }
  | { readonly _tag: 'Unpublished' }

const stripTrailingSlashes = (baseUrl: string): string => baseUrl.replace(/\/+$/, '')

const unreadable = (name: PackageName): TrustRegistryUnreadable => {
  const packages: [PackageName, ...Array<PackageName>] = [name]
  return { _tag: 'TrustRegistryUnreadable', packages }
}

const hasAttestations = (entry: unknown): boolean => {
  if (typeof entry !== 'object' || entry === null) return false
  if (!('dist' in entry)) return false
  const dist: unknown = entry.dist
  if (typeof dist !== 'object' || dist === null) return false
  if (!('attestations' in dist)) return false
  return dist.attestations != null
}

const drainBody = (response: Response): Effect.Effect<void> => {
  const body = response.body
  return body === null ? Effect.void : Effect.promise(() => body.cancel())
}

const readRegistryDoc = (
  base: string,
  gate: Semaphore.Semaphore,
  name: PackageName,
): Effect.Effect<RegistryDoc, TrustRegistryUnreadable> =>
  Semaphore.withPermit(gate)(
    Effect.gen(function*() {
      const failure = unreadable(name)
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${base}/${encodeURIComponent(name)}`, {
            headers: { accept: ABBREVIATED },
            signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
          }),
        catch: () => failure,
      })
      if (response.status === 404) {
        yield* drainBody(response)
        return { _tag: 'Unpublished' } as const
      }
      if (!response.ok) {
        yield* drainBody(response)
        return yield* Effect.fail(failure)
      }
      const body: unknown = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () => failure,
      })
      const doc = yield* Effect.mapError(
        Effect.fromResult(S.decodeUnknownResult(PackumentDoc)(body)),
        () => failure,
      )
      if (doc.error === 'Not found') return { _tag: 'Unpublished' } as const
      const latestRaw: unknown = doc['dist-tags']?.['latest']
      if (typeof latestRaw !== 'string') return yield* Effect.fail(failure)
      const latest = yield* Effect.mapError(
        Effect.fromResult(S.decodeResult(PackageVersion)(latestRaw)),
        () => failure,
      )
      const versions = doc.versions
      return {
        _tag: 'Published',
        latest,
        attested: hasAttestations(versions?.[latest]),
        versions,
      } as const
    }),
  )

const publishCommand = (
  name: PackageName,
  provenance: boolean,
  root: RepoRoot,
): Effect.Effect<WorkspaceCommand> =>
  Effect.fromResult(
    S.decodeResult(WorkspaceCommand)({
      program: 'pnpm',
      args: [
        '--filter',
        name,
        'publish',
        '--access',
        'public',
        '--no-git-checks',
        ...(provenance ? ['--provenance'] : []),
      ],
      cwd: root,
    }),
  ).pipe(Effect.orDie)

export const RegistryLive: Layer.Layer<RegistryPort, never, RegistryConfig | ProcessPort> = Layer.effect(
  RegistryPort,
  Effect.gen(function*() {
    const config = yield* RegistryConfig
    const proc = yield* ProcessPort
    const gate = yield* Semaphore.make(REGISTRY_CONCURRENCY)
    const base = stripTrailingSlashes(config.baseUrl)
    const root = config.root
    return {
      queryPackage: (name: PackageName): Effect.Effect<TrustSnapshot, never> =>
        Effect.matchEffect(readRegistryDoc(base, gate, name), {
          onFailure: () =>
            Effect.succeed(
              {
                name,
                latest: undefined,
                attested: false,
                reachable: false,
              } satisfies TrustSnapshot,
            ),
          onSuccess: (doc) =>
            Effect.succeed(
              doc._tag === 'Published'
                ? {
                  name,
                  latest: doc.latest,
                  attested: doc.attested,
                  reachable: true,
                } satisfies TrustSnapshot
                : {
                  name,
                  latest: undefined,
                  attested: false,
                  reachable: true,
                } satisfies TrustSnapshot,
            ),
        }),
      isVersionPublished: (name: PackageName, version: PackageVersion) =>
        Effect.map(readRegistryDoc(base, gate, name), (doc) =>
          doc._tag === 'Published' && doc.versions !== undefined
            ? Object.hasOwn(doc.versions, version)
            : false),
      publishMember: (name: PackageName, _version: PackageVersion, provenance: boolean) =>
        Effect.flatMap(
          publishCommand(name, provenance, root),
          (command) => Effect.as(proc.runCommand(command), undefined),
        ),
    } satisfies RegistryPort
  }),
)
