import type { RelativePath } from '@systemfsoftware/release-language'
import {
  ChangesetStore,
  Count,
  IntentFrontmatterMalformed,
  NewIntentInvalidBump,
  RelativePath as RelativePathSchema,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'

export const makeFakeChangesetStore = (initial: Array<RelativePath>) => {
  const intents = [...initial]
  return Layer.succeed(ChangesetStore, {
    listIntents: () => Effect.succeed([...intents]),
    readIntent: (path: RelativePath) => Effect.fail(IntentFrontmatterMalformed.make({ path })),
    writeIntent: () => Effect.fail(NewIntentInvalidBump.make({ given: 'unsupported' })),
    deleteIntents: (paths: ReadonlyArray<RelativePath>) => {
      for (const path of paths) {
        const index = intents.indexOf(path)
        if (index !== -1) {
          intents.splice(index, 1)
        }
      }
      return Effect.succeed(Count.make(intents.length))
    },
    readReadme: () =>
      Effect.fail(
        IntentFrontmatterMalformed.make({ path: RelativePathSchema.make('README.md') }),
      ),
  })
}
