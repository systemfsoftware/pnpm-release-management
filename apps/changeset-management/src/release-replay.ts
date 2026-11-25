import { ChangesetsPortLive } from '@systemfsoftware/changesets-adapter'
import { Cell } from '@systemfsoftware/effect-cell-types'
import { inWorktreeAt, stagedDivergence } from '@systemfsoftware/process-adapter'
import {
  ChangesetStore,
  type RelativePath,
  type ReleaseCandidate,
  type ReleaseConfig,
  ReleaseConfigStore,
  releaseCreatedPaths,
  ReleaseReplayPort,
  type ReplayOutcome,
  type RepoRoot,
  WorkspaceStore,
} from '@systemfsoftware/release-language'
import { bumpCell, bumpInputOf } from '@systemfsoftware/version-engine'
import {
  ChangelogStoreLive,
  ChangesetStoreLive,
  SurfaceStoreLive,
  WorkspaceStoreLive,
} from '@systemfsoftware/workspace-adapter'
import { Cause, Effect, Exit, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import type { ChildProcessSpawner } from 'effect/unstable/process/ChildProcessSpawner'

const unreplayed = (reason: string): ReplayOutcome => ({ _tag: 'ReleaseUnreplayed', reason })

const rootChangelogOf = (versioning: ReleaseConfig['versioning']): RelativePath | undefined => {
  if (versioning.strategy === 'surfaces') return versioning.changelog
  return undefined
}

const storesAt = (root: RepoRoot, release: ReleaseConfig) =>
  Layer.mergeAll(
    WorkspaceStoreLive(root),
    SurfaceStoreLive(root),
    ChangelogStoreLive(root),
    ChangesetsPortLive({ root, base: release.base }),
    ChangesetStoreLive({ root, changesetDir: release.changesetDir }),
  )

const setAside = (root: RepoRoot, consumed: ReadonlyArray<RelativePath>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path
    const store = yield* ChangesetStore
    const others = (yield* store.listIntents()).filter((intent) => !consumed.includes(intent))
    return yield* Effect.forEach(others, (intent) =>
      Effect.gen(function*() {
        const file = path.join(root, intent)
        const text = yield* fs.readFileString(file)
        yield* fs.remove(file)
        return { file, text }
      }))
  })

const restore = (aside: ReadonlyArray<{ readonly file: string; readonly text: string }>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem
    yield* Effect.forEach(aside, (entry) => fs.writeFileString(entry.file, entry.text), { discard: true })
  })

const bumpedAt = (root: RepoRoot, release: ReleaseConfig, consumed: ReadonlyArray<RelativePath>) =>
  Effect.gen(function*() {
    const aside = yield* setAside(root, consumed)
    yield* Cell.run(Cell.provide(bumpCell, storesAt(root, release)), bumpInputOf(release))
    yield* restore(aside)
    const workspace = yield* WorkspaceStore
    return releaseCreatedPaths(
      yield* workspace.changelogStorage(),
      release.changelogDir,
      yield* workspace.listMembers(),
      rootChangelogOf(release.versioning),
    )
  }).pipe(Effect.provide(storesAt(root, release)))

const replayIn = (dir: RepoRoot, candidate: ReleaseCandidate) =>
  Effect.gen(function*() {
    const configs = yield* ReleaseConfigStore
    const bumped = yield* Effect.exit(
      Effect.flatMap(configs.loadConfig(dir), (release) => bumpedAt(dir, release, candidate.consumed)),
    )
    return yield* Exit.match(bumped, {
      onFailure: (cause) => Effect.succeed(unreplayed(Cause.pretty(cause))),
      onSuccess: (created) =>
        Effect.map(
          stagedDivergence(dir, created, candidate.commit),
          (divergent): ReplayOutcome => ({ _tag: 'ReleaseReplayed', divergent }),
        ),
    })
  })

export const ReleaseReplayLive: Layer.Layer<
  ReleaseReplayPort,
  never,
  ReleaseConfigStore | FileSystem | Path | ChildProcessSpawner
> = Layer.effect(
  ReleaseReplayPort,
  Effect.gen(function*() {
    const services = yield* Effect.context<ReleaseConfigStore | FileSystem | Path | ChildProcessSpawner>()
    return {
      replay: (root, candidate) =>
        inWorktreeAt(root, candidate.parent, (dir) => replayIn(dir, candidate)).pipe(Effect.provide(services)),
    }
  }),
)
