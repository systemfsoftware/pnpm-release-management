import { RelativePath, type ReleaseConfig, type VersionSurface } from '@systemfsoftware/release-language'
import type { BumpInput } from './bump.schema.js'

interface VersionTarget {
  readonly file: RelativePath
  readonly surface: VersionSurface
}

interface VersionTargets {
  readonly manifest: VersionTarget
  readonly surfaces: ReadonlyArray<VersionTarget>
}

export const ROOT_MANIFEST: RelativePath = RelativePath.make('package.json')

const ROOT_TARGET: VersionTarget = {
  file: ROOT_MANIFEST,
  surface: { kind: 'json', path: ROOT_MANIFEST },
}

const surfaceTargetsOf = (
  surfaces: ReadonlyArray<VersionSurface>,
): ReadonlyArray<VersionTarget> =>
  surfaces.flatMap((surface): ReadonlyArray<VersionTarget> => {
    if (surface.kind !== 'toml') return [{ file: surface.path, surface }]
    const path = surface.path
    if (path === undefined) return []
    return [{ file: path, surface }]
  })

export const versionTargetsOf = (release: ReleaseConfig): VersionTargets => {
  const { versioning } = release
  if (versioning.strategy === 'changesets') {
    return { manifest: ROOT_TARGET, surfaces: surfaceTargetsOf(versioning.surfaces) }
  }
  return {
    manifest: { file: versioning.manifest, surface: { kind: 'json', path: versioning.manifest } },
    surfaces: surfaceTargetsOf(versioning.surfaces),
  }
}

export const bumpInputOf = (release: ReleaseConfig): BumpInput => {
  const { versioning } = release
  if (versioning.strategy === 'changesets') {
    return {
      strategy: 'changesets',
      changelogDir: release.changelogDir,
      surfaces: surfaceTargetsOf(versioning.surfaces),
    }
  }
  const targets = versionTargetsOf(release)
  return {
    strategy: 'surfaces',
    changelogDir: release.changelogDir,
    rootChangelog: versioning.changelog,
    manifest: targets.manifest,
    surfaces: targets.surfaces,
  }
}
