import { AdoptionExcluded, RelativePath } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'
import { AdoptionRecorded, AdoptionVacant } from './adopt-release.workflow.js'

export const AdoptionDecision = S.Union([AdoptionRecorded, AdoptionVacant])
export type AdoptionDecision = S.Schema.Type<typeof AdoptionDecision>

export const AdoptionReport = S.Struct({
  decision: AdoptionDecision,
  excluded: S.Array(AdoptionExcluded),
  output: RelativePath,
})
export type AdoptionReport = S.Schema.Type<typeof AdoptionReport>
