import { resolveWorkspaceRoot, type WorkspaceRootNotAbsolute } from '@systemfsoftware/cli-adapter'
import {
  AdoptionRequest,
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
} from '@systemfsoftware/release-language'
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
  readonly tarballs: string
}

export const planRequestOf = (workspace: Workspace, flags: PlanFlags) =>
  decodeFlags(
    S.decodeUnknownEffect(PlanRequest)({
      deferred: flags.deferred,
      remote: flags.remote,
      tarballs: flags.tarballs,
      changelogDir: workspace.config.changelogDir,
      legacyTags: workspace.config.legacyTags,
    }),
  )

export interface AdoptFlags {
  readonly registry: string
  readonly output: string
  readonly remote: string | undefined
}

export const adoptRequestOf = (flags: AdoptFlags) =>
  decodeFlags(
    S.decodeUnknownEffect(AdoptionRequest)({
      registry: flags.registry,
      output: flags.output,
      remote: flags.remote,
    }),
  )

export interface TagFlags {
  readonly captured: string | undefined
  readonly capturedFile: string | undefined
  readonly exclude: string | undefined
  readonly output: string | undefined
  readonly remote: string | undefined
  readonly tarballs: string
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
      tarballs: flags.tarballs,
      dryRun: flags.dryRun,
      json: flags.json,
      changelogDir: workspace.config.changelogDir,
      legacyTags: workspace.config.legacyTags,
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
      legacyTags: workspace.config.legacyTags,
    }),
  )

export interface PullRequestFlags {
  readonly title: string | undefined
  readonly body: string | undefined
  readonly bodyFile: string | undefined
  readonly base: string | undefined
  readonly branch: string | undefined
}

const rootChangelogOf = (versioning: ReleaseConfig['versioning']): RelativePath | undefined => {
  if (versioning.strategy === 'surfaces') return versioning.changelog
  return undefined
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
        changelogDir: workspace.config.changelogDir,
        rootChangelog: rootChangelogOf(workspace.config.versioning),
      }),
    )
  })
