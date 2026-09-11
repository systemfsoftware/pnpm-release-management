import {
  ChangesetStore,
  Count,
  type Intent,
  type IntentPackages,
  type IntentRefusal,
  IntentStagedNamed,
  type IntentSummary,
  type NewIntentDecision,
  type NewIntentRefusal,
  type NewIntentRequest,
  RelativePath,
  type RootFile,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as S from 'effect/Schema'

export type FakeChangesetState = {
  readonly intents: Map<RelativePath, Intent>
  readonly readme: string
}

const mustBrand = <C extends S.Constraint>(schema: C, input: unknown) =>
  S.decodeUnknownEffect(schema)(input).pipe(Effect.orDie)

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
      Effect.flatMap(
        mustBrand(RelativePath, `.changeset/${request.slug ?? 'derived'}.md`),
        (path): Effect.Effect<NewIntentDecision, NewIntentRefusal> => {
          const packages: IntentPackages = request.packages.map((name) => ({
            name,
            bump: request.bump,
          }))
          const summary: IntentSummary = request.summary
          intents.set(path, { path, packages, summary })
          return Effect.succeed(IntentStagedNamed.make({
            path,
            packages: [...packages],
            bump: request.bump,
            summary,
          }))
        },
      ),
    deleteIntents: (paths: ReadonlyArray<RelativePath>) =>
      Effect.suspend(() => {
        let removed = 0
        for (const path of paths) {
          if (intents.delete(path)) removed += 1
        }
        return Effect.flatMap(
          mustBrand(Count, removed),
          (consumed): Effect.Effect<Count, IntentRefusal> => Effect.succeed(consumed),
        )
      }),
    readReadme: () =>
      Effect.flatMap(
        mustBrand(RelativePath, 'README.md'),
        (path): Effect.Effect<RootFile, IntentRefusal> => Effect.succeed({ path, text: readme }),
      ),
  })
  return { layer, state: { intents, readme } }
}
