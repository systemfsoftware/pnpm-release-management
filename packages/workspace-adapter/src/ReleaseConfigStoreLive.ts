import { parse as parseJsonc } from '@std/jsonc'
import { join } from '@std/path'
import {
  ConfigField,
  type ConfigRefusal,
  FsPath,
  ReleaseConfig,
  ReleaseConfigStore,
  type RepoRoot,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as S from 'effect/Schema'
const REQUIRED_FIELDS = [
  'base',
  'branch',
  'versioning',
  'gate',
] as const
const CONFIG_FILE = 'release.jsonc'

const loadConfig = (root: RepoRoot): Effect.Effect<ReleaseConfig, ConfigRefusal> =>
  Effect.gen(function*() {
    const configFs = yield* S.decodeUnknownEffect(FsPath)(join(root, CONFIG_FILE)).pipe(Effect.orDie)
    const text = yield* Effect.tryPromise({
      try: () => Deno.readTextFile(join(root, CONFIG_FILE)),
      catch: (): ConfigRefusal => ({ _tag: 'ConfigUnreadable', path: configFs }),
    })
    let parsed: unknown
    try {
      parsed = parseJsonc(text)
    } catch (error) {
      return yield* Effect.fail({ _tag: 'ConfigMalformed', path: configFs, reason: String(error) } as const)
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

export const ReleaseConfigStoreLive: Layer.Layer<ReleaseConfigStore> = Layer.succeed(ReleaseConfigStore)({
  loadConfig,
})
