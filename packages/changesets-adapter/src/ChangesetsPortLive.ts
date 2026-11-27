import { applyReleasePlan } from '@changesets/apply-release-plan'
import { assembleReleasePlan } from '@changesets/assemble-release-plan'
import { validateConfig } from '@changesets/config'
import { readPreState } from '@changesets/pre'
import { readChangesets } from '@changesets/read'
import { getPackages } from '@manypkg/get-packages'
import {
  ChangesetsPort,
  type ChangesetsRefusal,
  FsPath,
  type GitRef,
  isIntentFileName,
  ManifestInvalid,
  ManifestUnreadable,
  manifestVersionErrorOf,
  PackageManifestWire,
  PackageName,
  type PlannedBump,
  type RelativePath,
  RelativePath as RelativePathSchema,
  type RepoRoot,
  VersionIntentMalformed,
  VersionPrivatePackage,
  VersionUnknownPackage,
} from '@systemfsoftware/release-language'
import { Effect, HashMap, HashSet, Layer, Option } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import { projectPlan } from './plan.js'

const CHANGESET_DIR = '.changeset'
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---/

const configJsonOf = (base: GitRef, ignored: ReadonlyArray<string>) => ({
  changelog: false,
  commit: false,
  access: 'public',
  baseBranch: base,
  updateInternalDependencies: 'patch',
  // A plain range on a sibling's name resolves from the registry (pnpm's linkWorkspacePackages is false), so it names a
  // published release; rewriting it to the version this release PR is about to publish breaks the frozen install.
  bumpVersionsWithWorkspaceProtocolOnly: true,
  // A private member is never published, but the bump an intent gives it is the version a surface bound to it follows (a
  // cargo crate, say), so changesets versions a private member an intent names and ignores every other private member.
  privatePackages: { version: true, tag: false },
  ignore: [...ignored],
  format: false,
  ___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH: { updateInternalDependents: 'always' },
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
    const candidates = [...names].filter(isIntentFileName).sort()
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
      catch: () => ManifestUnreadable.make({ path: FsPath.make(root) }),
    })
    const manifests = yield* Effect.forEach(packages.packages, (pkg) =>
      Effect.gen(function*() {
        const file = FsPath.make(path.join(pkg.dir, 'package.json'))
        const manifest = yield* S.decodeUnknownEffect(PackageManifestWire)(pkg.packageJson).pipe(
          Effect.mapError((error) => ManifestInvalid.make({ path: file, reason: error.message })),
        )
        const error = manifestVersionErrorOf(manifest, file)
        if (error !== undefined) return yield* Effect.fail(error)
        return { name: pkg.packageJson.name, version: manifest.version }
      }), { concurrency: 1 })
    const unversioned = HashSet.fromIterable(
      manifests.filter((manifest) => manifest.version === undefined).map((manifest) => manifest.name),
    )
    const dir = path.join(root, CHANGESET_DIR)
    const present = yield* fs.exists(dir).pipe(Effect.orElseSucceed(() => false))
    const changesets: Awaited<ReturnType<typeof readChangesets>> = []
    if (present) {
      const outcome = yield* Effect.tryPromise({
        try: () => readChangesets(root),
        catch: (cause) => cause,
      }).pipe(Effect.result)
      if (Result.isFailure(outcome)) {
        const malformed = yield* malformedPathOf(fs, path, root)
        return yield* Effect.fail(VersionIntentMalformed.make({ path: malformed }))
      }
      changesets.push(...outcome.success)
    }
    const namedByIntent = HashSet.fromIterable(
      changesets.flatMap((changeset) => changeset.releases.map((release) => release.name)),
    )
    const ignoredPrivateMembers = packages.packages
      .filter((pkg) => pkg.packageJson.private === true && !HashSet.has(namedByIntent, pkg.packageJson.name))
      .map((pkg) => pkg.packageJson.name)
    const parsed = validateConfig(configJsonOf(base, ignoredPrivateMembers), packages)
    if (parsed.errors !== undefined) {
      return yield* Effect.die(new Error(`invalid changesets config: ${parsed.errors.join('; ')}`))
    }
    const config = parsed.config
    if (!present) return { packages, config, plan: EMPTY_PLAN }
    const byName = HashMap.fromIterable(packages.packages.map((pkg) => [pkg.packageJson.name, pkg] as const))
    for (const changeset of changesets) {
      for (const release of changeset.releases) {
        const pkg = HashMap.get(byName, release.name)
        if (Option.isNone(pkg)) {
          return yield* Effect.fail(VersionUnknownPackage.make({ package: PackageName.make(release.name) }))
        }
        if (pkg.value.packageJson.private === true && HashSet.has(unversioned, release.name)) {
          return yield* Effect.fail(VersionPrivatePackage.make({
            package: PackageName.make(release.name),
            path: RelativePathSchema.make(path.relative(root, pkg.value.dir)),
          }))
        }
      }
    }
    const preState = yield* Effect.tryPromise({
      try: () => readPreState(root),
      catch: () => ManifestUnreadable.make({ path: FsPath.make(path.join(root, CHANGESET_DIR, 'pre.json')) }),
    })
    const plan = yield* Effect.try({
      try: () => assembleReleasePlan([...changesets], packages, config, preState),
      catch: () => VersionIntentMalformed.make({ path: RelativePathSchema.make(CHANGESET_DIR) }),
    })
    return { packages, config, plan }
  })

const planOf = (
  fs: FileSystem,
  path: Path,
  root: RepoRoot,
  base: GitRef,
): Effect.Effect<PlannedBump, ChangesetsRefusal> =>
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
): Effect.Effect<void, ChangesetsRefusal> =>
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
