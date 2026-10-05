import { type EvidenceFileUnreadable, type RepoRoot, TurboPinUnusable } from '@systemfsoftware/release-language'
import { Effect, FileSystem, Result } from 'effect'
import * as S from 'effect/Schema'
import { Yaml } from 'effect/unstable/encoding'
import { readText } from './evidence-io.js'
import { InstalledTurbo, PnpmLockfile } from './turbo-pin.schema.js'

const LOCKFILE = 'pnpm-lock.yaml'
const TURBO_MANIFEST = 'node_modules/turbo/package.json'
const CONTEXT = 'change-evidence'

const pinUnusable = (reason: string): TurboPinUnusable => new TurboPinUnusable({ detail: `${CONTEXT}: ${reason}` })

const pinFromLockfile = (
  lockfileText: string,
): Result.Result<string, TurboPinUnusable> => {
  const decoded = S.decodeUnknownResult(PnpmLockfile)(Yaml.parse(lockfileText))
  if (Result.isFailure(decoded)) {
    return Result.fail(
      pinUnusable(
        `${LOCKFILE} is not the lockfileVersion 9.0 document the turbo pin is read from`,
      ),
    )
  }
  const rootImporter = decoded.success.importers['.']
  if (rootImporter === undefined) {
    return Result.fail(
      pinUnusable(`${LOCKFILE} declares no root importer`),
    )
  }
  const entry = rootImporter.devDependencies?.['turbo']
  if (entry === undefined) {
    return Result.fail(
      pinUnusable(
        `no 'turbo' devDependency in the root importer of ${LOCKFILE}`,
      ),
    )
  }
  return Result.succeed(entry.version)
}

export const turboPin = (
  root: RepoRoot,
): Effect.Effect<
  string,
  EvidenceFileUnreadable | TurboPinUnusable,
  FileSystem.FileSystem
> =>
  Effect.gen(function*() {
    const pinned = yield* Effect.fromResult(
      pinFromLockfile(yield* readText(`${root}/${LOCKFILE}`)),
    )
    const fs = yield* FileSystem.FileSystem
    const resolved = yield* fs
      .readFileString(`${root}/${TURBO_MANIFEST}`)
      .pipe(Effect.orElseSucceed(() => '{}'))
    const installed = yield* Effect.mapError(
      Effect.fromResult(
        S.decodeUnknownResult(S.fromJsonString(InstalledTurbo))(resolved),
      ),
      () => pinUnusable(`${TURBO_MANIFEST} is not parseable JSON`),
    )
    if (installed.version === pinned) {
      return pinned
    }
    return yield* Effect.fail(
      pinUnusable(
        `installed turbo ${installed.version} does not match the lockfile pin ${pinned} — run 'pnpm install --frozen-lockfile'`,
      ),
    )
  })
