import { resolveWorkspaceRoot } from '@systemfsoftware/cli-adapter'
import {
  RelativePath,
  type ReleaseConfig,
  ReleaseConfigStore,
  type RepoRoot,
  type VersionSurface,
} from '@systemfsoftware/release-language'
import type { BumpInput, PinRootManifestInput, SyncInput } from '@systemfsoftware/version-engine'
import {
  ChangelogStoreLive,
  ChangesetStoreLive,
  SurfaceStoreLive,
  WorkspaceStoreLive,
} from '@systemfsoftware/workspace-adapter'
import { Effect, Layer, Option } from 'effect'
import * as S from 'effect/Schema'
import type { ManifestPathRefused, SyncActionMissing } from './refusal.schema.js'

export interface Workspace {
  readonly root: RepoRoot
  readonly release: ReleaseConfig
}

interface VersionTarget {
  readonly file: RelativePath
  readonly surface: VersionSurface
}

interface VersionTargets {
  readonly manifest: VersionTarget
  readonly surfaces: ReadonlyArray<VersionTarget>
}

const ROOT_MANIFEST: RelativePath = RelativePath.make('package.json')

const ROOT_TARGET: VersionTarget = {
  file: ROOT_MANIFEST,
  surface: { kind: 'json', path: ROOT_MANIFEST },
}

export const syncActionOf = (
  subcommand: Option.Option<string>,
): Effect.Effect<string, SyncActionMissing> =>
  Effect.gen(function*() {
    const action = Option.getOrUndefined(subcommand)
    if (action === undefined) {
      return yield* Effect.fail<SyncActionMissing>({ _tag: 'SyncActionMissing' })
    }
    return action
  })

const releaseOf = (root: RepoRoot) =>
  Effect.gen(function*() {
    const configs = yield* ReleaseConfigStore
    return yield* configs.loadConfig(root)
  })

export const workspaceOf = (flag: Option.Option<string>) =>
  Effect.gen(function*() {
    const root = yield* resolveWorkspaceRoot(flag)
    const release = yield* releaseOf(root)
    return { root, release }
  })

export const syncWorkspaceOf = (
  flag: Option.Option<string>,
  subcommand: Option.Option<string>,
) =>
  Effect.gen(function*() {
    const root = yield* resolveWorkspaceRoot(flag)
    const action = yield* syncActionOf(subcommand)
    const release = yield* releaseOf(root)
    return { root, release, action }
  })

export const storesOf = (workspace: Workspace) =>
  Layer.mergeAll(
    WorkspaceStoreLive(workspace.root),
    SurfaceStoreLive(workspace.root),
    ChangelogStoreLive(workspace.root),
    ChangesetStoreLive({ root: workspace.root, changesetDir: workspace.release.changesetDir }),
  )

const surfaceTargetsOf = (
  surfaces: ReadonlyArray<VersionSurface>,
): ReadonlyArray<VersionTarget> =>
  surfaces.flatMap((surface): ReadonlyArray<VersionTarget> => {
    if (surface.kind !== 'toml') return [{ file: surface.path, surface }]
    const path = surface.path
    if (path === undefined) return []
    return [{ file: path, surface }]
  })

const targetsOf = (release: ReleaseConfig): VersionTargets => {
  const { versioning } = release
  if (versioning.strategy === 'pnpm') return { manifest: ROOT_TARGET, surfaces: [] }
  return {
    manifest: { file: versioning.manifest, surface: { kind: 'json', path: versioning.manifest } },
    surfaces: surfaceTargetsOf(versioning.surfaces),
  }
}

export const bumpRequestOf = (release: ReleaseConfig): BumpInput => {
  const { versioning } = release
  if (versioning.strategy === 'pnpm') {
    return {
      strategy: 'pnpm',
      changelogDir: release.changelogDir,
    }
  }
  const targets = targetsOf(release)
  return {
    strategy: 'surfaces',
    changelogDir: release.changelogDir,
    rootChangelog: versioning.changelog,
    manifest: targets.manifest,
    surfaces: targets.surfaces,
  }
}

export const syncRequestOf = (
  release: ReleaseConfig,
  action: string,
  version: string | undefined,
): SyncInput => {
  const targets = targetsOf(release)
  return {
    strategy: release.versioning.strategy,
    action,
    version,
    manifest: targets.manifest,
    surfaces: targets.surfaces,
  }
}

export const pinRequestOf = (
  release: ReleaseConfig,
  flags: {
    readonly manifest: Option.Option<string>
    readonly version: Option.Option<string>
    readonly dryRun: boolean
  },
): Effect.Effect<PinRootManifestInput, ManifestPathRefused> =>
  Effect.gen(function*() {
    const named = Option.getOrUndefined(flags.manifest)
    let manifest: RelativePath = release.distribution?.launcherManifest ?? ROOT_MANIFEST
    if (named !== undefined) {
      manifest = yield* S.decodeUnknownEffect(RelativePath)(named).pipe(
        Effect.mapError((): ManifestPathRefused => ({ _tag: 'ManifestPathRefused', given: named })),
      )
    }
    const fromEnvironment = yield* Effect.sync(() => process.env['VERSION'])
    return {
      manifest,
      requestedVersion: Option.getOrUndefined(flags.version) ?? fromEnvironment,
      suffixes: release.distribution?.targets.map((target) => target.suffix),
      dryRun: flags.dryRun,
    }
  })
