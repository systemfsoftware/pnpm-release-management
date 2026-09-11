import { FsPath } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export const RequestInvalid = S.TaggedStruct('RequestInvalid', {
  reason: S.String,
})
export type RequestInvalid = S.Schema.Type<typeof RequestInvalid>

export const EmitUnwritable = S.TaggedStruct('EmitUnwritable', {
  path: FsPath,
  reason: S.String,
})
export type EmitUnwritable = S.Schema.Type<typeof EmitUnwritable>

export const BoundaryRefusal = S.Union([RequestInvalid, EmitUnwritable])
export type BoundaryRefusal = S.Schema.Type<typeof BoundaryRefusal>
