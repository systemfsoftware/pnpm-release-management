import { CycleEntry, PackageName } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export const CapturedText = S.fromJsonString(S.Array(CycleEntry))
export type CapturedText = S.Schema.Type<typeof CapturedText>

export const DeferredNames = S.Array(PackageName)
export type DeferredNames = S.Schema.Type<typeof DeferredNames>
