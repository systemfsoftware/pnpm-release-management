import { Effect } from 'effect'
import type { FileSystem } from 'effect/FileSystem'
import * as Match from 'effect/Match'
import type { PlatformError } from 'effect/PlatformError'
import { AlreadyExists, Missing, type StoreFault, Unavailable } from './StoreFile.schema.js'

const faultOf = (error: PlatformError): StoreFault =>
  Match.value(error.reason).pipe(
    Match.tag('NotFound', () => Missing.make({ reason: error.message })),
    Match.tag('AlreadyExists', () => AlreadyExists.make({ reason: error.message })),
    Match.orElse(() => Unavailable.make({ reason: error.message })),
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

export const createTextFile = (
  fs: FileSystem,
  full: string,
  text: string,
): Effect.Effect<void, StoreFault> => fs.writeFileString(full, text, { flag: 'wx' }).pipe(Effect.mapError(faultOf))

export const overwriteTextFile = (
  fs: FileSystem,
  full: string,
  text: string,
): Effect.Effect<void, StoreFault> => fs.writeFileString(full, text).pipe(Effect.mapError(faultOf))
