import { parse as parseJsonc } from '@std/jsonc'
import {
  ConfigField,
  type ConfigRefusal,
  FsPath,
  ReleaseConfig,
  ReleaseConfigStore,
  type RepoRoot,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import { FileSystem } from 'effect/FileSystem'
import { Path } from 'effect/Path'
import * as S from 'effect/Schema'
import { ConfigDocument } from './ReleaseConfig.schema.js'
import { readTextFile } from './StoreFile.js'

const CONFIG_FILE = 'release.jsonc'
const REQUIRED_FIELDS = ['base', 'branch', 'versioning', 'gate'] as const

const describeCause = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string') return cause
  return 'unknown error'
}

export const ReleaseConfigStoreLive: Layer.Layer<ReleaseConfigStore, never, FileSystem | Path> = Layer.effect(
  ReleaseConfigStore,
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path

    const loadConfig = (root: RepoRoot): Effect.Effect<ReleaseConfig, ConfigRefusal> =>
      Effect.gen(function*() {
        const file = FsPath.make(path.join(root, CONFIG_FILE))
        const text = yield* readTextFile(fs, file).pipe(
          Effect.mapError((): ConfigRefusal => ({ _tag: 'ConfigUnreadable', path: file })),
        )
        const parsed = yield* Effect.try({
          try: () => parseJsonc(text),
          catch: (cause): ConfigRefusal => ({ _tag: 'ConfigMalformed', path: file, reason: describeCause(cause) }),
        })
        const document = yield* S.decodeUnknownEffect(ConfigDocument)(parsed).pipe(
          Effect.mapError((error): ConfigRefusal => ({ _tag: 'ConfigMalformed', path: file, reason: error.message })),
        )
        for (const field of REQUIRED_FIELDS) {
          if (!Object.hasOwn(document, field)) {
            return yield* Effect.fail<ConfigRefusal>({
              _tag: 'ConfigFieldMissing',
              path: file,
              field: ConfigField.make(field),
            })
          }
        }
        return yield* S.decodeUnknownEffect(ReleaseConfig)(document).pipe(
          Effect.mapError((error): ConfigRefusal => ({ _tag: 'ConfigMalformed', path: file, reason: error.message })),
        )
      })

    return { loadConfig }
  }),
)
