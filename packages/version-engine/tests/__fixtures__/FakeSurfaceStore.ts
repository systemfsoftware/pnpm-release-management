import {
  type PackageVersion,
  type RelativePath,
  type RootFile,
  SurfaceStore,
  type VersionRefusal,
  type VersionSurface,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'

export type FakeSurfaceState = {
  readonly versions: Map<RelativePath, PackageVersion>
  readonly rootManifests: Map<RelativePath, string>
  readonly reads: Array<RelativePath>
}

export const makeFakeSurfaceStore = (
  initial: ReadonlyMap<RelativePath, PackageVersion> = new Map(),
  malformed: ReadonlySet<RelativePath> = new Set(),
): { readonly layer: Layer.Layer<SurfaceStore>; readonly state: FakeSurfaceState } => {
  const versions = new Map(initial)
  const rootManifests = new Map<RelativePath, string>()
  const reads: Array<RelativePath> = []
  const layer = Layer.succeed(SurfaceStore, {
    readSurface: (file: RelativePath, _surface: VersionSurface): Effect.Effect<PackageVersion, VersionRefusal> =>
      Effect.suspend((): Effect.Effect<PackageVersion, VersionRefusal> => {
        reads.push(file)
        if (malformed.has(file)) {
          return Effect.fail(
            {
              _tag: 'VersionIntentMalformed',
              path: file,
            } as const,
          )
        }
        const found = versions.get(file)
        if (found === undefined) {
          return Effect.fail(
            {
              _tag: 'VersionSurfaceMissing',
              path: file,
            } as const,
          )
        }
        return Effect.succeed(found)
      }),
    writeSurface: (file: RelativePath, _surface: VersionSurface, version: PackageVersion) =>
      Effect.sync(() => {
        const previous = versions.get(file)
        versions.set(file, version)
        return { path: file, moved: previous !== version }
      }),
    writeRootManifest: (path: RelativePath, text: string) =>
      Effect.sync(() => {
        rootManifests.set(path, text)
        const file: RootFile = { path, text }
        return file
      }),
  })
  return { layer, state: { versions, rootManifests, reads } }
}
