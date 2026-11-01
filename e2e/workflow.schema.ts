import * as S from 'effect/Schema'

export const WorkflowStep = S.Struct({
  name: S.optional(S.String),
  id: S.optional(S.String),
  if: S.optional(S.String),
  run: S.optional(S.String),
  env: S.optional(S.Record(S.String, S.String)),
})

export const Workflow = S.Struct({
  on: S.Struct({
    workflow_call: S.optional(S.Struct({
      outputs: S.optional(S.Record(S.String, S.Struct({ value: S.String }))),
    })),
  }),
  jobs: S.Record(
    S.String,
    S.Struct({
      outputs: S.optional(S.Record(S.String, S.String)),
      steps: S.optional(S.Array(WorkflowStep)),
    }),
  ),
})
export type Workflow = S.Schema.Type<typeof Workflow>
