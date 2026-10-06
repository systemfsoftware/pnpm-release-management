import { AdoptionExcluded, LedgerEntry, RelativePath } from '@systemfsoftware/release-language'
import * as S from 'effect/Schema'
import { AdoptionRecorded, AdoptionVacant } from './adopt-release.workflow.js'

export const AdoptionLedgered = S.TaggedStruct('Ledgered', { entry: LedgerEntry })
export const AdoptionExcludedTag = S.TaggedStruct('Excluded', { excluded: AdoptionExcluded })
export const AdoptionProduct = S.Union([AdoptionLedgered, AdoptionExcludedTag])
export type AdoptionProduct = S.Schema.Type<typeof AdoptionProduct>

export const AdoptionDecision = S.Union([AdoptionRecorded, AdoptionVacant])
export type AdoptionDecision = S.Schema.Type<typeof AdoptionDecision>

export const AdoptionReport = S.Struct({
  decision: AdoptionDecision,
  excluded: S.Array(AdoptionExcluded),
  output: RelativePath,
})
export type AdoptionReport = S.Schema.Type<typeof AdoptionReport>
