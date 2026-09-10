import {
  type PackageVersion,
  type RelativePath,
  type RootFile,
  SurfaceStore,
  type VersionSurface,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'

export type FakeSurfaceState = {
  readonly versions: Map<RelativePath, PackageVersion>
  readonly rootManifests: Map<RelativePath, string>
}

export const makeFakeSurfaceStore = (
  initial: ReadonlyMap<RelativePath, PackageVersion> = new Map(),
): { readonly layer: Layer.Layer<SurfaceStore>; readonly state: FakeSurfaceState } => {
  const versions = new Map(initial)
  const rootManifests = new Map<RelativePath, string>()
  const layer = Layer.succeed(SurfaceStore, {
    readSurface: (file: RelativePath, _surface: VersionSurface) =>
      Effect.suspend(() => {
        const found = versions.get(file)
        return found === undefined
          ? Effect.fail(
            {
              _tag: 'VersionSurfaceMissing',
              path: file,
            } as const,
          )
          : Effect.succeed(found)
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
  return { layer, state: { versions, rootManifests } }
}
