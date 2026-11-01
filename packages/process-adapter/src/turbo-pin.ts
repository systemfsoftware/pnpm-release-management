import { type EvidenceFileUnreadable, type RepoRoot, TurboPinUnusable } from '@systemfsoftware/release-language'
import { Effect, type FileSystem, Result } from 'effect'
import * as S from 'effect/Schema'
import { Yaml } from 'effect/unstable/encoding'
import { readText } from './evidence-io.js'
import { type PackageResolution, PnpmLockfile } from './turbo-pin.schema.js'

export const LOCKFILE = 'pnpm-lock.yaml'
const CONTEXT = 'change-evidence'

export const pinUnusable = (reason: string): TurboPinUnusable =>
  new TurboPinUnusable({ detail: `${CONTEXT}: ${reason}` })

export interface TurboPin {
  readonly version: string
  readonly resolutionOf: (key: string) => PackageResolution | undefined
}

const lockfileDocuments = (lockfileText: string): ReadonlyArray<string> =>
  lockfileText.split(/^---[ \t]*$/m).filter((document) => document.trim() !== '')

const turboPins = (document: string): ReadonlyArray<TurboPin> => {
  const decoded = S.decodeUnknownResult(PnpmLockfile)(Yaml.parse(document))
  if (Result.isFailure(decoded)) {
    return []
  }
  const entry = decoded.success.importers['.']?.devDependencies?.['turbo']
  if (entry === undefined) {
    return []
  }
  const packages = decoded.success.packages ?? {}
  return [{ version: entry.version, resolutionOf: (key) => packages[key]?.resolution }]
}

const pinFromLockfile = (
  lockfileText: string,
): Result.Result<TurboPin, TurboPinUnusable> => {
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
): Effect.Effect<TurboPin, EvidenceFileUnreadable | TurboPinUnusable, FileSystem.FileSystem> =>
  Effect.flatMap(readText(`${root}/${LOCKFILE}`), (text) => Effect.fromResult(pinFromLockfile(text)))
