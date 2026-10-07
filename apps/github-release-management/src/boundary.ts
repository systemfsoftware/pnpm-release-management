import { resolveWorkspaceRoot, type WorkspaceRootNotAbsolute } from '@systemfsoftware/cli-adapter'
import {
  GithubReleaseRequest,
  PlanRequest,
  PullRequestRequest,
  TagRequest,
} from '@systemfsoftware/github-release-engine'
import {
  type ConfigRefusal,
  RelativePath,
  type ReleaseConfig,
  ReleaseConfigStore,
  type RepoRoot,
  type VersionSurface,
} from '@systemfsoftware/release-language'
import type { BumpInput } from '@systemfsoftware/version-engine'
import { Effect, type FileSystem, Option, Path } from 'effect'
import * as S from 'effect/Schema'
import { InvalidFlags } from './boundary.schema.js'

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

const decodeFlags = <A, E extends { readonly message: string }>(
  decode: Effect.Effect<A, E>,
): Effect.Effect<A, InvalidFlags> =>
  decode.pipe(Effect.mapError((issue) => InvalidFlags.make({ reason: issue.message })))

export interface PlanFlags {
  readonly deferred: string | undefined
  readonly remote: string | undefined
}

export const planRequestOf = (workspace: Workspace, flags: PlanFlags) =>
  decodeFlags(
    S.decodeUnknownEffect(PlanRequest)({
      deferred: flags.deferred,
      remote: flags.remote,
      changelogDir: workspace.config.changelogDir,
    }),
  )

export interface TagFlags {
  readonly captured: string | undefined
  readonly capturedFile: string | undefined
  readonly exclude: string | undefined
  readonly output: string | undefined
  readonly remote: string | undefined
  readonly dryRun: boolean
  readonly json: boolean
}

export const tagRequestOf = (workspace: Workspace, flags: TagFlags) =>
  decodeFlags(
    S.decodeUnknownEffect(TagRequest)({
      captured: flags.captured,
      capturedFile: flags.capturedFile,
      exclude: flags.exclude,
      output: flags.output,
      remote: flags.remote,
      dryRun: flags.dryRun,
      json: flags.json,
      changelogDir: workspace.config.changelogDir,
    }),
  )

export interface ReleaseFlags {
  readonly captured: string | undefined
  readonly capturedFile: string | undefined
  readonly assert: boolean
  readonly dryRun: boolean
}

export const releaseRequestOf = (workspace: Workspace, flags: ReleaseFlags) =>
  decodeFlags(
    S.decodeUnknownEffect(GithubReleaseRequest)({
      captured: flags.captured,
      capturedFile: flags.capturedFile,
      assert: flags.assert,
      dryRun: flags.dryRun,
      changelogDir: workspace.config.changelogDir,
    }),
  )

export interface PullRequestFlags {
  readonly title: string | undefined
  readonly body: string | undefined
  readonly bodyFile: string | undefined
  readonly base: string | undefined
  readonly branch: string | undefined
}

export const pullRequestRequestOf = (workspace: Workspace, flags: PullRequestFlags) =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const cwd = yield* Effect.sync(() => process.cwd())
    const bodyFile = Option.map(
      Option.fromNullishOr(flags.bodyFile),
      (file) => path.relative(cwd, path.resolve(cwd, file)),
    )
    const body = Option.match(Option.fromNullishOr(flags.body), {
      onNone: (): string | undefined =>
        Option.match(bodyFile, {
          onNone: () => workspace.config.pr.body,
          onSome: (): string | undefined => undefined,
        }),
      onSome: (given) => given,
    })
    return yield* decodeFlags(
      S.decodeUnknownEffect(PullRequestRequest)({
        title: flags.title ?? workspace.config.pr.title,
        body,
        bodyFile: Option.getOrUndefined(bodyFile),
        base: flags.base ?? workspace.config.base,
        branch: flags.branch ?? workspace.config.branch,
        remote: undefined,
        labels: ['release'],
      }),
    )
  })

const surfaceEntryOf = (
  surface: VersionSurface,
): ReadonlyArray<BumpInput['surfaces'][number]> => {
  if (surface.kind !== 'toml') return [{ file: surface.path, surface }]
  if (surface.path === undefined) return []
  return [{ file: surface.path, surface }]
}

export const bumpInput = (
  changelogDir: RelativePath,
  versioning: ReleaseConfig['versioning'],
): BumpInput => {
  if (versioning.strategy === 'changesets') {
    return {
      strategy: 'changesets',
      changelogDir,
      manifest: {
        file: RelativePath.make('package.json'),
        surface: { kind: 'json', path: RelativePath.make('package.json') },
      },
      surfaces: versioning.surfaces.flatMap(surfaceEntryOf),
    }
  }
  return {
    strategy: 'surfaces',
    changelogDir,
    rootChangelog: versioning.changelog,
    manifest: {
      file: versioning.manifest,
      surface: { kind: 'json', path: versioning.manifest },
    },
    surfaces: versioning.surfaces.flatMap(surfaceEntryOf),
  }
}
