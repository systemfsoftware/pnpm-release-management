import { applyReleasePlan } from '@changesets/apply-release-plan'
import { assembleReleasePlan } from '@changesets/assemble-release-plan'
import { validateConfig } from '@changesets/config'
import { readChangesets } from '@changesets/read'
import { getPackages } from '@manypkg/get-packages'
import {
  ChangesetsPort,
  type GitRef,
  PackageName,
  type PlannedBump,
  type RelativePath,
  RelativePath as RelativePathSchema,
  type RepoRoot,
  VersionIntentMalformed,
  VersionUnknownPackage,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import * as Result from 'effect/Result'
import { projectPlan } from './plan.js'

const CHANGESET_DIR = '.changeset'
const README_FILE = 'readme.md'
const IGNORED_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---/

const isIntentFile = (name: string): boolean =>
  name.endsWith('.md') &&
  !name.startsWith('.') &&
  name.toLowerCase() !== README_FILE &&
  !IGNORED_FILES.includes(name)

const configJsonOf = (base: GitRef) => ({
  changelog: false,
  commit: false,
  access: 'public',
  baseBranch: base,
  updateInternalDependencies: 'patch',
  privatePackages: { version: true, tag: false },
  format: false,
})

const malformedPathOf = (
  fs: FileSystem,
  path: Path,
  root: RepoRoot,
): Effect.Effect<RelativePath> =>
  Effect.gen(function*() {
    const dir = path.join(root, CHANGESET_DIR)
    const present = yield* fs.exists(dir).pipe(Effect.orElseSucceed(() => false))
    if (!present) return RelativePathSchema.make(CHANGESET_DIR)
    const none: ReadonlyArray<string> = []
    const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => none))
    const candidates = [...names].filter(isIntentFile).sort()
    for (const name of candidates) {
      const text = yield* fs.readFileString(path.join(dir, name)).pipe(Effect.orElseSucceed(() => ''))
      if (!FRONTMATTER.test(text)) return RelativePathSchema.make(`${CHANGESET_DIR}/${name}`)
    }
    const first = candidates.at(0)
    if (first === undefined) return RelativePathSchema.make(CHANGESET_DIR)
    return RelativePathSchema.make(`${CHANGESET_DIR}/${first}`)
  })

const EMPTY_PLAN = { changesets: [], releases: [], preState: undefined }

const assemble = (fs: FileSystem, path: Path, root: RepoRoot, base: GitRef) =>
  Effect.gen(function*() {
    const packages = yield* Effect.tryPromise({
      try: () => getPackages(root),
      catch: (cause) => cause,
    }).pipe(Effect.orDie)
    const parsed = validateConfig(configJsonOf(base), packages)
    if (parsed.errors !== undefined) {
      return yield* Effect.die(new Error(`invalid changesets config: ${parsed.errors.join('; ')}`))
    }
    const config = parsed.config
    const dir = path.join(root, CHANGESET_DIR)
    const present = yield* fs.exists(dir).pipe(Effect.orElseSucceed(() => false))
    if (!present) return { packages, config, plan: EMPTY_PLAN }
    const outcome = yield* Effect.tryPromise({
      try: () => readChangesets(root),
      catch: (cause) => cause,
    }).pipe(Effect.result)
    if (Result.isFailure(outcome)) {
      const malformed = yield* malformedPathOf(fs, path, root)
      return yield* Effect.fail(VersionIntentMalformed.make({ path: malformed }))
    }
    const known = packages.packages.map((pkg) => pkg.packageJson.name)
    for (const changeset of outcome.success) {
      for (const release of changeset.releases) {
        if (!known.includes(release.name)) {
          return yield* Effect.fail(VersionUnknownPackage.make({ package: PackageName.make(release.name) }))
        }
      }
    }
    const plan = assembleReleasePlan([...outcome.success], packages, config, undefined)
    return { packages, config, plan }
  })

const planOf = (
  fs: FileSystem,
  path: Path,
  root: RepoRoot,
  base: GitRef,
): Effect.Effect<PlannedBump, VersionIntentMalformed | VersionUnknownPackage> =>
  Effect.gen(function*() {
    const assembled = yield* assemble(fs, path, root, base)
    return projectPlan({
      packages: assembled.packages.packages,
      changesets: assembled.plan.changesets,
      releases: assembled.plan.releases,
      count: assembled.plan.changesets.length,
    })
  })

const applyOf = (
  fs: FileSystem,
  path: Path,
  root: RepoRoot,
  base: GitRef,
): Effect.Effect<void, VersionIntentMalformed | VersionUnknownPackage> =>
  Effect.gen(function*() {
    const assembled = yield* assemble(fs, path, root, base)
    yield* Effect.promise(async () => {
      await applyReleasePlan(assembled.plan, assembled.packages, assembled.config)
    })
  })

export const ChangesetsPortLive = (options: {
  readonly root: RepoRoot
  readonly base: GitRef
}): Layer.Layer<ChangesetsPort, never, FileSystem | Path> =>
  Layer.effect(
    ChangesetsPort,
    Effect.gen(function*() {
      const fs = yield* FileSystem
      const path = yield* Path
      return {
        plan: () => planOf(fs, path, options.root, options.base),
        apply: () => applyOf(fs, path, options.root, options.base),
      }
    }),
  )
