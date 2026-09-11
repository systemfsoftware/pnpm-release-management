import {
  ChangesetStore,
  type Intent,
  IntentStagedDerived,
  IntentStagedNamed,
  type NewIntentRefusal,
  type NewIntentRequest,
  RelativePath,
} from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Layer from 'effect/Layer'

export interface FakeChangesetStoreOptions {
  readonly intents?: ReadonlyArray<Intent>
  readonly writeIntentFailure?: NewIntentRefusal
}

export interface FakeChangesetStore {
  readonly layer: Layer.Layer<ChangesetStore>
  readonly written: Array<NewIntentRequest>
}

export const fakeChangesetStore = (
  options: FakeChangesetStoreOptions = {},
): FakeChangesetStore => {
  const intents = options.intents ?? []
  const written: Array<NewIntentRequest> = []
  const layer = Layer.succeed(ChangesetStore, {
    listIntents: () => Effect.succeed(intents.map((intent) => intent.path)),
    readIntent: (path) => {
      const found = intents.find((intent) => intent.path === path)
      if (found !== undefined) {
        return Effect.succeed(found)
      }
      return Effect.fail({ _tag: 'IntentFrontmatterMalformed' as const, path })
    },
    readReadme: () => Effect.die(new Error('FakeChangesetStore.readReadme is not used by these cells')),
    deleteIntents: () => Effect.die(new Error('FakeChangesetStore.deleteIntents is not used by these cells')),
    writeIntent: (request) => {
      written.push(request)
      if (options.writeIntentFailure !== undefined) {
        return Effect.fail(options.writeIntentFailure)
      }
      const joined = request.packages.map((pkg) => pkg).join(' ')
      const derived = joined.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '').slice(0, 48)
      let fallback = 'changeset'
      if (derived.length > 0) {
        fallback = derived
      }
      const name = request.slug ?? fallback
      if (request.slug !== undefined) {
        return Effect.succeed(IntentStagedNamed.make({
          path: RelativePath.make(`${name}.md`),
          packages: request.packages.map((pkg) => ({ name: pkg, bump: request.bump })),
          bump: request.bump,
          summary: request.summary,
        }))
      }
      return Effect.succeed(IntentStagedDerived.make({
        path: RelativePath.make(`${name}.md`),
        packages: request.packages.map((pkg) => ({ name: pkg, bump: request.bump })),
        bump: request.bump,
        summary: request.summary,
      }))
    },
  })
  return { layer, written }
}
