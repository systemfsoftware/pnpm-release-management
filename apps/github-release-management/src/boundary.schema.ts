import { FsPath } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export const InvalidFlags = S.TaggedStruct('InvalidFlags', { reason: S.String })
export type InvalidFlags = S.Schema.Type<typeof InvalidFlags>

export const OutputUnwritable = S.TaggedStruct('OutputUnwritable', {
  path: FsPath,
  reason: S.String,
})
export type OutputUnwritable = S.Schema.Type<typeof OutputUnwritable>

export const OutputUnreadable = S.TaggedStruct('OutputUnreadable', {
  path: FsPath,
  reason: S.String,
})
export type OutputUnreadable = S.Schema.Type<typeof OutputUnreadable>

export const BoundaryRefusal = S.Union([InvalidFlags, OutputUnwritable, OutputUnreadable])
export type BoundaryRefusal = S.Schema.Type<typeof BoundaryRefusal>
