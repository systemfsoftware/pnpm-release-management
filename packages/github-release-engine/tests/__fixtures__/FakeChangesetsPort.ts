import { ChangesetsPort, Count, type PlannedRelease } from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'

export const makeFakeChangesetsPort = (releases: ReadonlyArray<PlannedRelease> = []) =>
  Layer.succeed(ChangesetsPort, {
    plan: () => Effect.succeed({ changesets: Count.make(0), releases: [...releases] }),
    apply: () => Effect.void,
  })
