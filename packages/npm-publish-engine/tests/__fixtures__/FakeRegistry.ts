import * as Lang from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as S from 'effect/Schema'

export interface FakeRegistrySnapshot {
  readonly latest?: string
  readonly attested?: boolean
  readonly reachable?: boolean
}

export interface FakeRegistrySeed {
  readonly snapshots?: Record<string, FakeRegistrySnapshot>
  readonly published?: ReadonlyArray<string>
  readonly queryFailures?: ReadonlyArray<string>
  readonly publishFailures?: ReadonlyArray<string>
}

export interface FakePublishCall {
  readonly name: Lang.PackageName
  readonly version: Lang.PackageVersion
  readonly provenance: boolean
}

export interface FakeRegistry {
  readonly layer: Layer.Layer<Lang.RegistryPort>
  readonly publishCalls: Array<FakePublishCall>
  readonly isPublished: (name: string, version: string) => boolean
}

export const makeFakeRegistry = (seed: FakeRegistrySeed = {}): FakeRegistry => {
  const published = new Set(seed.published ?? [])
  const queryFailed: Record<string, true> = Object.fromEntries(
    (seed.queryFailures ?? []).map((name): [string, true] => [name, true]),
  )
  const publishFailed: Record<string, true> = Object.fromEntries(
    (seed.publishFailures ?? []).map((name): [string, true] => [name, true]),
  )
  const publishCalls: Array<FakePublishCall> = []
  const snapshots = seed.snapshots ?? {}

  const versionOf = (text: string): Lang.PackageVersion => S.decodeSync(Lang.PackageVersion)(text)
  const unreadableOf = (name: Lang.PackageName): Lang.TrustRegistryUnreadable =>
    S.decodeSync(Lang.TrustRegistryUnreadable)({
      _tag: 'TrustRegistryUnreadable',
      packages: [name],
    })

  const layer = Layer.succeed(Lang.RegistryPort, {
    queryPackage: (name) => {
      if (name in queryFailed) {
        return Effect.fail(unreadableOf(name))
      }
      const snapshot = snapshots[name] ?? {}
      if (snapshot.latest === undefined) {
        return Effect.succeed({
          name,
          attested: snapshot.attested ?? false,
          reachable: snapshot.reachable ?? true,
        })
      }
      return Effect.succeed({
        name,
        latest: versionOf(snapshot.latest),
        attested: snapshot.attested ?? false,
        reachable: snapshot.reachable ?? true,
      })
    },
    isVersionPublished: (name, version) => {
      if (name in queryFailed) {
        return Effect.fail(unreadableOf(name))
      }
      return Effect.succeed(published.has(`${name}@${version}`))
    },
    publishMember: (name, version, provenance) => {
      if (name in publishFailed) {
        return Effect.fail(
          S.decodeSync(Lang.PublishCommandRefused)({
            _tag: 'PublishCommandRefused',
            command: S.decodeSync(Lang.WorkspaceCommand)({ program: 'pnpm', args: ['publish'] }),
            reason: `${name} failed to publish`,
          }),
        )
      }
      publishCalls.push({ name, version, provenance })
      published.add(`${name}@${version}`)
      return Effect.succeed(undefined)
    },
  })
  return {
    layer,
    publishCalls,
    isPublished: (name, version) => published.has(`${name}@${version}`),
  }
}
