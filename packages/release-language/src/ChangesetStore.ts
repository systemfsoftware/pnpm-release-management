import { Context, type Effect } from 'effect'
import type { Intent, IntentRefusal } from './Intent.schema.js'
import type { NewIntentDecision, NewIntentRefusal, NewIntentRequest } from './NewIntent.schema.js'
import type { Count, RelativePath, RootFile } from './Workspace.schema.js'

export interface ChangesetStore {
  readonly listIntents: () => Effect.Effect<
    ReadonlyArray<RelativePath>,
    IntentRefusal,
    never
  >
  readonly readIntent: (
    path: RelativePath,
  ) => Effect.Effect<Intent, IntentRefusal, never>
  readonly writeIntent: (
    request: NewIntentRequest,
  ) => Effect.Effect<NewIntentDecision, NewIntentRefusal, never>
  readonly deleteIntents: (
    paths: ReadonlyArray<RelativePath>,
  ) => Effect.Effect<Count, IntentRefusal, never>
  readonly readReadme: () => Effect.Effect<RootFile, IntentRefusal, never>
}

export const ChangesetStore: Context.Service<ChangesetStore, ChangesetStore> = Context.Service<
  ChangesetStore,
  ChangesetStore
>('ChangesetStore')
