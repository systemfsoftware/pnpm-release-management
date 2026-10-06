import * as S from 'effect/Schema'
import { AdoptionRecorded, AdoptionVacant } from './adopt-release.workflow.js'

export const AdoptionReport = S.Union([AdoptionRecorded, AdoptionVacant])
export type AdoptionReport = S.Schema.Type<typeof AdoptionReport>
