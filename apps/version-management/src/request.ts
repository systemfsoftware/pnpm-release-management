import { type ReleaseConfig, type VersionSurface } from '@systemfsoftware/release-language'

const ROOT_MANIFEST = 'package.json'

type SurfaceEntry = { readonly file: string; readonly surface: VersionSurface }

const surfaceEntriesOf = (surfaces: ReadonlyArray<VersionSurface>): ReadonlyArray<SurfaceEntry> =>
  surfaces.flatMap((surface): ReadonlyArray<SurfaceEntry> => {
    if (surface.kind !== 'toml') return [{ file: surface.path, surface }]
    if (surface.path === undefined) return []
    return [{ file: surface.path, surface }]
  })

const versioningOf = (config: ReleaseConfig): {
  readonly manifest: string
  readonly surfaces: ReadonlyArray<SurfaceEntry>
} => {
  const { versioning } = config
  if (versioning.strategy === 'pnpm') return { manifest: ROOT_MANIFEST, surfaces: [] }
  return { manifest: versioning.manifest, surfaces: surfaceEntriesOf(versioning.surfaces) }
}

export const bumpRequestOf = (config: ReleaseConfig) => {
  const { versioning } = config
  const { manifest, surfaces } = versioningOf(config)
  let rootChangelog: string | undefined
  if (versioning.strategy === 'surfaces') rootChangelog = versioning.changelog
  return {
    strategy: versioning.strategy,
    changelogDir: config.changelogDir,
    manifest: { file: manifest, surface: { kind: 'json', path: manifest } },
    surfaces,
    rootChangelog,
  }
}

export const syncRequestOf = (
  config: ReleaseConfig,
  action: string,
  version: string | undefined,
) => {
  const { manifest, surfaces } = versioningOf(config)
  return {
    strategy: config.versioning.strategy,
    action,
    manifest: { file: manifest, surface: { kind: 'json', path: manifest } },
    surfaces,
    version,
  }
}

export const pinRequestOf = (
  config: ReleaseConfig,
  flags: {
    readonly manifest: string | undefined
    readonly version: string | undefined
    readonly dryRun: boolean
  },
) => {
  const { distribution } = config
  let suffixes: ReadonlyArray<string> | undefined
  if (distribution !== undefined) suffixes = distribution.targets.map((target) => target.suffix)
  return {
    manifest: flags.manifest ?? distribution?.launcherManifest ?? ROOT_MANIFEST,
    requestedVersion: flags.version,
    suffixes,
    dryRun: flags.dryRun,
  }
}
