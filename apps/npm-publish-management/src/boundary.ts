import { resolveWorkspaceRoot, type WorkspaceRootNotAbsolute } from '@systemfsoftware/cli-adapter'
import { PublishRequest, type StatusMode, TrustRequest } from '@systemfsoftware/npm-publish-engine'
import {
  type ConfigRefusal,
  FsPath,
  GitPort,
  OwnerName,
  type ReleaseConfig,
  ReleaseConfigStore,
  RepoName,
  type RepoRoot,
  type RepoSlug,
} from '@systemfsoftware/release-language'
import { Effect, FileSystem, Option, Path } from 'effect'
import * as S from 'effect/Schema'
import { type BoundaryRefusal, EmitUnwritable, RequestInvalid } from './boundary.schema.js'

const DEFAULT_JOBS = 4

const UNKNOWN_SLUG: RepoSlug = {
  owner: OwnerName.make('unknown'),
  repo: RepoName.make('unknown'),
}

export const slugText = (slug: RepoSlug): string => `${slug.owner}/${slug.repo}`

export const originSlug = (): Effect.Effect<RepoSlug, never, GitPort> =>
  Effect.flatMap(GitPort, (git) => git.repoSlug().pipe(Effect.orElseSucceed(() => UNKNOWN_SLUG)))

export interface Workspace {
  readonly root: RepoRoot
  readonly release: ReleaseConfig
  readonly registry: string
}

export const workspaceOf = (
  config: Option.Option<string>,
  registry: Option.Option<string>,
): Effect.Effect<
  Workspace,
  ConfigRefusal | WorkspaceRootNotAbsolute,
  ReleaseConfigStore | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const root = yield* resolveWorkspaceRoot(config)
    const store = yield* ReleaseConfigStore
    const release = yield* store.loadConfig(root)
    return { root, release, registry: Option.getOrUndefined(registry) ?? release.registry }
  })

export type StatusOutputMode = 'emit-files' | 'json' | 'preflight' | 'report'

export interface StatusTargets {
  readonly filters: Option.Option<FsPath>
  readonly deferred: Option.Option<FsPath>
}

interface PublishFlags {
  readonly dryRun: boolean
  readonly unpublished: boolean
  readonly noProvenance: boolean
  readonly captured: Option.Option<string>
  readonly capturedFile: Option.Option<string>
  readonly filters: Option.Option<string>
}

interface TrustFlags {
  readonly dryRun: boolean
  readonly only: Option.Option<string>
  readonly jobs: Option.Option<string>
  readonly file: Option.Option<string>
}

export const statusModeOf = (preflight: boolean, check: boolean): StatusMode => {
  if (preflight) return 'preflight'
  if (check) return 'check'
  return 'report'
}

export const statusOutputModeOf = (options: {
  readonly json: boolean
  readonly preflight: boolean
  readonly emit: boolean
}): StatusOutputMode => {
  if (options.emit) return 'emit-files'
  if (options.json) return 'json'
  if (options.preflight) return 'preflight'
  return 'report'
}

export const jobsOf = (flag: Option.Option<string>): number =>
  Option.match(flag, { onNone: () => DEFAULT_JOBS, onSome: (value) => Number(value) })

const readTextFile = (file: string): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(file).pipe(Effect.orElseSucceed(() => undefined)))

const readFiltersText = (
  flag: Option.Option<string>,
): Effect.Effect<string | undefined, never, FileSystem.FileSystem> =>
  Option.match(flag, {
    onNone: () => Effect.succeed<string | undefined>(undefined),
    onSome: (file) => readTextFile(file),
  })

const decodeTarget = (flag: Option.Option<string>): Effect.Effect<Option.Option<FsPath>, BoundaryRefusal> =>
  Option.match(flag, {
    onNone: () => Effect.succeed(Option.none<FsPath>()),
    onSome: (value) =>
      S.decodeUnknownEffect(FsPath)(value).pipe(
        Effect.map(Option.some),
        Effect.mapError((issue) => RequestInvalid.make({ reason: issue.message })),
      ),
  })

export const statusTargetsOf = (
  filters: Option.Option<string>,
  deferred: Option.Option<string>,
): Effect.Effect<StatusTargets, BoundaryRefusal> =>
  Effect.gen(function*() {
    const filtersTarget = yield* decodeTarget(filters)
    const deferredTarget = yield* decodeTarget(deferred)
    return { filters: filtersTarget, deferred: deferredTarget }
  })

export const writeEmitFile = (
  target: FsPath,
  text: string,
): Effect.Effect<void, BoundaryRefusal, FileSystem.FileSystem> =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.writeFileString(target, text).pipe(
      Effect.mapError((error) => EmitUnwritable.make({ path: target, reason: error.message })),
    ))

export const publishRequestOf = (
  workspace: Workspace,
  flags: PublishFlags,
): Effect.Effect<PublishRequest, BoundaryRefusal, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const filtersText = yield* readFiltersText(flags.filters)
    return yield* S.decodeUnknownEffect(PublishRequest)({
      capturedPath: Option.getOrUndefined(flags.captured) ?? Option.getOrUndefined(flags.capturedFile),
      unpublishedOnly: flags.unpublished,
      filtersPath: Option.getOrUndefined(flags.filters),
      filtersText,
      registry: workspace.registry,
      provenance: !flags.noProvenance && workspace.release.provenance,
      publishArgs: [...workspace.release.publishArgs],
      dryRun: flags.dryRun,
    }).pipe(Effect.mapError((issue) => RequestInvalid.make({ reason: issue.message })))
  })

export const trustRequestOf = (
  workspace: Workspace,
  slug: RepoSlug,
  flags: TrustFlags,
): Effect.Effect<TrustRequest, BoundaryRefusal> =>
  S.decodeUnknownEffect(TrustRequest)({
    only: (Option.getOrUndefined(flags.only) ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
    jobs: jobsOf(flags.jobs),
    dryRun: flags.dryRun,
    registry: workspace.registry,
    workflowFile: Option.getOrUndefined(flags.file),
    slug: slugText(slug),
    launcherManifest: workspace.release.distribution?.launcherManifest,
  }).pipe(Effect.mapError((issue) => RequestInvalid.make({ reason: issue.message })))
