import * as S from 'effect/Schema'

export const MessageFile = S.String.pipe(S.brand('MessageFile'))
export type MessageFile = S.Schema.Type<typeof MessageFile>

export const MessageFileMissing = S.TaggedStruct('MessageFileMissing', {})
export type MessageFileMissing = S.Schema.Type<typeof MessageFileMissing>

export const MessageUnreadable = S.TaggedStruct('MessageUnreadable', {
  path: S.String,
  detail: S.String,
})
export type MessageUnreadable = S.Schema.Type<typeof MessageUnreadable>
