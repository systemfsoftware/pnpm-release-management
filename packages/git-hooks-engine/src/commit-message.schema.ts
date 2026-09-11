import { CommitMessageRefusal } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export const CommitAcceptedWire = S.TaggedStruct('CommitAccepted', {
  type: S.String,
  scope: S.optional(S.String),
  subject: S.String,
})
export type CommitAcceptedWire = S.Schema.Type<typeof CommitAcceptedWire>

export const CommitIgnoredWire = S.TaggedStruct('CommitIgnored', {
  kind: S.String,
})
export type CommitIgnoredWire = S.Schema.Type<typeof CommitIgnoredWire>

export const DecisionWire = S.Union([CommitAcceptedWire, CommitIgnoredWire])
export type DecisionWire = S.Schema.Type<typeof DecisionWire>

export class CommitRejected extends S.TaggedClass<CommitRejected>()(
  'CommitRejected',
  {
    refusal: CommitMessageRefusal,
    problem: S.String,
  },
) {}
