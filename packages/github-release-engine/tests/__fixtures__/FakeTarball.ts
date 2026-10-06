import { PackageName, PackageVersion, type TarballDigest, TarballPort } from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'

export const FAKE_INTEGRITY = 'sha512-fake'
export const FAKE_FILES: Record<string, string> = {}

export const fakeDigest = (name: string, version: string): TarballDigest => ({
  name: PackageName.make(name),
  version: PackageVersion.make(version),
  integrity: FAKE_INTEGRITY,
  files: FAKE_FILES,
})

const DEFAULT_DIGESTS: ReadonlyArray<TarballDigest> = [
  fakeDigest('alpha', '1.0.0'),
  fakeDigest('beta', '2.0.0'),
  fakeDigest('alpha', '9.9.9'),
]

export const makeFakeTarball = (
  digests: ReadonlyArray<TarballDigest> = DEFAULT_DIGESTS,
) =>
  Layer.succeed(TarballPort, {
    read: () => Effect.succeed([...digests]),
  })
