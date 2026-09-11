import {
  ChangesetStore,
  Count,
  type Intent,
  type IntentPackages,
  type IntentSummary,
  type NewIntentRequest,
  RelativePath,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'

export type FakeChangesetState = {
  readonly intents: Map<RelativePath, Intent>
  readonly readme: string
}

export const makeFakeChangesetStore = (
  initial: ReadonlyMap<RelativePath, Intent> = new Map(),
  readme: string = '# Changesets\n',
): { readonly layer: Layer.Layer<ChangesetStore>; readonly state: FakeChangesetState } => {
  const intents = new Map(initial)
  const layer = Layer.succeed(ChangesetStore, {
    listIntents: () => Effect.succeed([...intents.keys()]),
    readIntent: (path: RelativePath) =>
      Effect.suspend(() => {
        const found = intents.get(path)
        if (found === undefined) {
          return Effect.fail({ _tag: 'IntentFrontmatterMalformed', path } as const)
        }
        return Effect.succeed(found)
      }),
    writeIntent: (request: NewIntentRequest) =>
      Effect.sync(() => {
        const path = RelativePath.make(`.changeset/${request.slug ?? 'derived'}.md`)
        const packages: IntentPackages = request.packages.map((name) => ({
          name,
          bump: request.bump,
        }))
        const summary: IntentSummary = request.summary
        const intent: Intent = { path, packages, summary }
        intents.set(path, intent)
        return intent
      }),
    deleteIntents: (paths: ReadonlyArray<RelativePath>) =>
      Effect.suspend(() => {
        let removed = 0
        for (const path of paths) {
          if (intents.delete(path)) removed += 1
        }
        return Effect.succeed(Count.make(removed))
      }),
    readReadme: () => Effect.succeed({ path: RelativePath.make('README.md'), text: readme }),
  })
  return { layer, state: { intents, readme } }
}
