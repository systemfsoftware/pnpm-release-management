import { ChangesetsPortLive } from '@systemfsoftware/changesets-adapter'
import { resolveWorkspaceRoot } from '@systemfsoftware/cli-adapter'
import { RelativePath, type ReleaseConfig, ReleaseConfigStore, type RepoRoot } from '@systemfsoftware/release-language'
import {
  type PinRootManifestInput,
  ROOT_MANIFEST,
  type SyncInput,
  versionTargetsOf,
} from '@systemfsoftware/version-engine'
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
    ChangesetsPortLive({ root: workspace.root, base: workspace.release.base }),
    ChangesetStoreLive({ root: workspace.root, changesetDir: workspace.release.changesetDir }),
  )

export const syncRequestOf = (
  release: ReleaseConfig,
  action: string,
  version: string | undefined,
): SyncInput => {
  const targets = versionTargetsOf(release)
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
