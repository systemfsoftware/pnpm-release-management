import * as S from 'effect/Schema'

export const WorkflowStep = S.Struct({
  name: S.optional(S.String),
  id: S.optional(S.String),
  run: S.optional(S.String),
  env: S.optional(S.Record(S.String, S.String)),
})

export const Workflow = S.Struct({
  jobs: S.Record(S.String, S.Struct({ steps: S.optional(S.Array(WorkflowStep)) })),
})
