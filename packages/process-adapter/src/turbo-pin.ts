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

const lockfileDocuments = (lockfileText: string): ReadonlyArray<string> =>
  lockfileText.split(/^---[ \t]*$/m).filter((document) => document.trim() !== '')

const turboPins = (document: string): ReadonlyArray<string> => {
  const decoded = S.decodeUnknownResult(PnpmLockfile)(Yaml.parse(document))
  if (Result.isFailure(decoded)) {
    return []
  }
  const entry = decoded.success.importers['.']?.devDependencies?.['turbo']
  if (entry === undefined) {
    return []
  }
  return [entry.version]
}

const pinFromLockfile = (
  lockfileText: string,
): Result.Result<string, TurboPinUnusable> => {
  const [pin, ...others] = lockfileDocuments(lockfileText).flatMap(turboPins)
  if (pin === undefined) {
    return Result.fail(
      pinUnusable(`no lockfileVersion 9.0 document in ${LOCKFILE} pins 'turbo' as a root devDependency`),
    )
  }
  if (others.length > 0) {
    return Result.fail(
      pinUnusable(`${others.length + 1} documents in ${LOCKFILE} pin 'turbo' as a root devDependency`),
    )
  }
  return Result.succeed(pin)
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
