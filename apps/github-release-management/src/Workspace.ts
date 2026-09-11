import { resolveWorkspaceRoot, type WorkspaceRootNotAbsolute } from '@systemfsoftware/cli-adapter'
import {
  type ConfigRefusal,
  RelativePath,
  type ReleaseConfig,
  ReleaseConfigStore,
  RepoRoot,
  type VersionSurface,
} from '@systemfsoftware/release-language'
import type { BumpInput } from '@systemfsoftware/version-engine'
import { Effect, type FileSystem, Option, type Path } from 'effect'
import * as Match from 'effect/Match'

export const CHANGESET_FALLBACK: RelativePath = RelativePath.make('.changeset')

export interface Workspace {
  readonly root: RepoRoot
  readonly config: ReleaseConfig
}

export const workspaceOf = (
  flag: Option.Option<string>,
): Effect.Effect<
  Workspace,
  ConfigRefusal | WorkspaceRootNotAbsolute,
  FileSystem.FileSystem | Path.Path | ReleaseConfigStore
> =>
  Effect.gen(function*() {
    const root = yield* resolveWorkspaceRoot(flag)
    const configs = yield* ReleaseConfigStore
    const config = yield* configs.loadConfig(root)
    return { root, config }
  })

const surfaceInput = (
  surface: VersionSurface,
): ReadonlyArray<BumpInput['surfaces'][number]> =>
  Match.value(surface).pipe(
    Match.discriminator('kind')('json', (json) => [{ file: json.path, surface: json }]),
    Match.discriminator('kind')('nix', (nix) => [{ file: nix.path, surface: nix }]),
    Match.discriminator('kind')('toml', (toml) =>
      Option.match(Option.fromNullishOr(toml.path), {
        onNone: (): ReadonlyArray<BumpInput['surfaces'][number]> => [],
        onSome: (path) => [{ file: path, surface: toml }],
      })),
    Match.exhaustive,
  )

export const bumpInput = (
  changelogDir: RelativePath,
  versioning: ReleaseConfig['versioning'],
): BumpInput =>
  Match.value(versioning).pipe(
    Match.discriminator('strategy')('pnpm', (): BumpInput => ({
      strategy: 'pnpm',
      changelogDir,
      manifest: {
        file: RelativePath.make('package.json'),
        surface: { kind: 'json', path: RelativePath.make('package.json') },
      },
      surfaces: [],
    })),
    Match.discriminator('strategy')('surfaces', (surfaces): BumpInput => ({
      strategy: 'surfaces',
      changelogDir,
      rootChangelog: surfaces.changelog,
      manifest: {
        file: surfaces.manifest,
        surface: { kind: 'json', path: surfaces.manifest },
      },
      surfaces: surfaces.surfaces.flatMap(surfaceInput),
    })),
    Match.exhaustive,
  )
