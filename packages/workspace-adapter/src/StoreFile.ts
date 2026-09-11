import { Effect } from 'effect'
import type { FileSystem } from 'effect/FileSystem'
import * as Match from 'effect/Match'
import type { PlatformError } from 'effect/PlatformError'
import type { StoreFault } from './StoreFile.schema.js'

export const faultOf = (error: PlatformError): StoreFault =>
  Match.value(error.reason).pipe(
    Match.tag('NotFound', (): StoreFault => ({ _tag: 'Missing', reason: error.message })),
    Match.tag('AlreadyExists', (): StoreFault => ({ _tag: 'AlreadyExists', reason: error.message })),
    Match.orElse((): StoreFault => ({ _tag: 'Unavailable', reason: error.message })),
  )

export const readTextFile = (
  fs: FileSystem,
  full: string,
): Effect.Effect<string, StoreFault> => fs.readFileString(full).pipe(Effect.mapError(faultOf))

export const readDirectoryEntries = (
  fs: FileSystem,
  full: string,
): Effect.Effect<ReadonlyArray<string>, StoreFault> => fs.readDirectory(full).pipe(Effect.mapError(faultOf))

export const isRegularFile = (
  fs: FileSystem,
  full: string,
): Effect.Effect<boolean, StoreFault> =>
  fs.stat(full).pipe(
    Effect.map((info) => info.type === 'File'),
    Effect.mapError(faultOf),
  )

export const removeFile = (
  fs: FileSystem,
  full: string,
): Effect.Effect<boolean, StoreFault> =>
  fs.remove(full).pipe(
    Effect.as(true),
    Effect.mapError(faultOf),
    Effect.catchTag('Missing', () => Effect.succeed(false)),
  )

export const writeTextFile = (
  fs: FileSystem,
  full: string,
  text: string,
  guard: 'exclusive' | 'overwrite',
): Effect.Effect<void, StoreFault> => {
  if (guard === 'exclusive') {
    return fs.writeFileString(full, text, { flag: 'wx' }).pipe(Effect.mapError(faultOf))
  }
  return fs.writeFileString(full, text).pipe(Effect.mapError(faultOf))
}
