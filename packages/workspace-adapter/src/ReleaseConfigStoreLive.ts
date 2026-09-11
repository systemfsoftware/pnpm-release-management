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

const REQUIRED_FIELDS = [
  'base',
  'branch',
  'versioning',
  'gate',
] as const
const CONFIG_FILE = 'release.jsonc'

export const ReleaseConfigStoreLive: Layer.Layer<ReleaseConfigStore, never, FileSystem | Path> = Layer.effect(
  ReleaseConfigStore,
  Effect.gen(function*() {
    const fs = yield* FileSystem
    const path = yield* Path

    const loadConfig = (root: RepoRoot): Effect.Effect<ReleaseConfig, ConfigRefusal> =>
      Effect.gen(function*() {
        const full = path.join(root, CONFIG_FILE)
        const configFs = yield* S.decodeUnknownEffect(FsPath)(full).pipe(Effect.orDie)
        const text = yield* fs.readFileString(full).pipe(
          Effect.catchTag(
            'PlatformError',
            (): Effect.Effect<never, ConfigRefusal> =>
              Effect.fail({ _tag: 'ConfigUnreadable', path: configFs } as const),
          ),
        )
        let parsed: unknown
        try {
          parsed = parseJsonc(text)
        } catch (error) {
          if (error instanceof Error) {
            return yield* Effect.fail({ _tag: 'ConfigMalformed', path: configFs, reason: error.message } as const)
          }
          return yield* Effect.fail({ _tag: 'ConfigMalformed', path: configFs, reason: 'unknown error' } as const)
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return yield* Effect.fail(
            { _tag: 'ConfigMalformed', path: configFs, reason: 'expected a JSON object' } as const,
          )
        }
        for (const key of REQUIRED_FIELDS) {
          if (!(key in parsed)) {
            const field = yield* S.decodeUnknownEffect(ConfigField)(key).pipe(Effect.orDie)
            return yield* Effect.fail({ _tag: 'ConfigFieldMissing', path: configFs, field } as const)
          }
        }
        return yield* S.decodeUnknownEffect(ReleaseConfig)(parsed).pipe(
          Effect.mapError((error): ConfigRefusal => ({
            _tag: 'ConfigMalformed',
            path: configFs,
            reason: error.message,
          })),
        )
      })

    return { loadConfig }
  }),
)
