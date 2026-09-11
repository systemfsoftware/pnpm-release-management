import * as S from 'effect/Schema'

export const StreamedBase = S.TaggedStruct('Streamed', {
  code: S.Number,
})
export type StreamedOutcome = S.Schema.Type<typeof StreamedBase>

export const CapturedBase = S.TaggedStruct('Captured', {
  code: S.Number,
  stdout: S.String,
  stderr: S.String,
})
export type CapturedOutcome = S.Schema.Type<typeof CapturedBase>

export const ProcessOutcome = S.Union([StreamedBase, CapturedBase])
export type ProcessOutcome = S.Schema.Type<typeof ProcessOutcome>

export class ProcessUnstartable extends S.TaggedError<ProcessUnstartable>()('ProcessUnstartable', {
  program: S.String,
  reason: S.String,
}) {}

export class ProcessUnobservable extends S.TaggedError<ProcessUnobservable>()('ProcessUnobservable', {
  program: S.String,
  reason: S.String,
}) {}

export type ProcessFault = ProcessUnstartable | ProcessUnobservable
