import { CycleEntry } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'

export const CapturedText = S.fromJsonString(S.Array(CycleEntry))
export type CapturedText = S.Schema.Type<typeof CapturedText>
