import {
  RegistryDownloadFailed,
  RegistryFetchFailed,
  RegistryMetadata,
  RegistryMetadataMalformed,
  RegistryPort,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as S from 'effect/Schema'
import * as HttpClient from 'effect/unstable/http/HttpClient'
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse'

const reasonOf = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message
  }
  return 'registry request failed'
}

const makeRegistry = (client: HttpClient.HttpClient): RegistryPort => ({
  metadata: (registry, name, version) =>
    Effect.gen(function*() {
      const url = `${registry}/${encodeURIComponent(name)}/${version}`
      const response = yield* client.get(url).pipe(
        Effect.mapError((error) => RegistryFetchFailed.make({ package: name, version, reason: reasonOf(error) })),
      )
      if (response.status === 404) {
        return yield* Effect.fail(
          RegistryFetchFailed.make({ package: name, version, reason: `registry has no ${name}@${version}` }),
        )
      }
      const ok = yield* HttpClientResponse.filterStatusOk(response).pipe(
        Effect.mapError((error) => RegistryFetchFailed.make({ package: name, version, reason: reasonOf(error) })),
      )
      return yield* HttpClientResponse.schemaBodyJson(S.Struct({ dist: RegistryMetadata }))(ok).pipe(
        Effect.map((envelope) => envelope.dist),
        Effect.mapError((error) => RegistryMetadataMalformed.make({ package: name, version, reason: reasonOf(error) })),
      )
    }),
  download: (url) =>
    Effect.gen(function*() {
      const response = yield* client.get(url).pipe(
        Effect.mapError((error) => RegistryDownloadFailed.make({ url, reason: reasonOf(error) })),
      )
      if (response.status === 404) {
        return yield* Effect.fail(
          RegistryDownloadFailed.make({ url, reason: `registry has no tarball at ${url}` }),
        )
      }
      const ok = yield* HttpClientResponse.filterStatusOk(response).pipe(
        Effect.mapError((error) => RegistryDownloadFailed.make({ url, reason: reasonOf(error) })),
      )
      const buffer = yield* ok.arrayBuffer.pipe(
        Effect.mapError((error) => RegistryDownloadFailed.make({ url, reason: reasonOf(error) })),
      )
      return new Uint8Array(buffer)
    }),
})

export const RegistryLive: Layer.Layer<RegistryPort, never, HttpClient.HttpClient> = Layer.effect(
  RegistryPort,
  Effect.map(HttpClient.HttpClient, makeRegistry),
)
