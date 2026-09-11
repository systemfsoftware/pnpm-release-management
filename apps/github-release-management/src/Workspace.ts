import {
  type ConfigRefusal,
  RelativePath,
  type ReleaseConfig,
  ReleaseConfigStore,
  RepoRoot,
  type VersionSurface,
} from '@systemfsoftware/release-language'
import type { BumpInput } from '@systemfsoftware/version-engine'
import { Effect, FileSystem, Option, Path } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'

export const CHANGESET_FALLBACK: RelativePath = RelativePath.make('.changeset')

export interface Workspace {
  readonly root: RepoRoot
  readonly config: ReleaseConfig
}

const decodeRoot = (value: string): Effect.Effect<RepoRoot> => S.decodeUnknownEffect(RepoRoot)(value).pipe(Effect.orDie)

const rootUnder = (
  path: Path.Path,
  fs: FileSystem.FileSystem,
  cwd: string,
  flag: string,
): Effect.Effect<RepoRoot> =>
  Effect.gen(function*() {
    const resolved = path.resolve(cwd, flag)
    const directory = yield* fs.stat(resolved).pipe(
      Effect.map((info) => info.type === 'Directory'),
      Effect.orElseSucceed(() => false),
    )
    if (directory) {
      return yield* decodeRoot(resolved)
    }
    return yield* decodeRoot(path.dirname(resolved))
  })

export const workspaceOf = (
  flag: string | undefined,
): Effect.Effect<
  Workspace,
  ConfigRefusal,
  FileSystem.FileSystem | Path.Path | ReleaseConfigStore
> =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const configs = yield* ReleaseConfigStore
    const cwd = yield* Effect.sync(() => process.cwd())
    const root = yield* Option.match(Option.fromNullishOr(flag), {
      onNone: () => decodeRoot(cwd),
      onSome: (config) => rootUnder(path, fs, cwd, config),
    })
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
