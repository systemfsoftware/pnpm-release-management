import { type ChangeEvidence, ChangeEvidencePort } from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Layer from 'effect/Layer'

export const fakeChangeEvidencePort = (evidence: ChangeEvidence) =>
  Layer.succeed(ChangeEvidencePort, {
    pathsEvidence: () => Effect.succeed(evidence),
    turboEvidence: () => Effect.succeed(evidence),
  })
