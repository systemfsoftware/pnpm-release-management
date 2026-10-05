import { Context, type Effect } from 'effect'

export class Reporter extends Context.Service<Reporter, {
  readonly emit: (text: string) => Effect.Effect<void>
  readonly note: (text: string) => Effect.Effect<void>
  readonly annotateError: (text: string) => Effect.Effect<void>
  readonly exitCode: (code: number) => Effect.Effect<void>
}>()('Reporter') {}
