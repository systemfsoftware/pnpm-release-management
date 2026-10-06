import { LedgerPort, type ReleaseLedger, type ReleaseLedgerEntry } from '@systemfsoftware/release-language'
import { Effect, Layer, Option } from 'effect'

export const fakeLedgerPort = (
  head: ReadonlyArray<ReleaseLedgerEntry> = [],
  base: ReadonlyArray<ReleaseLedgerEntry> = [],
) =>
  Layer.succeed(LedgerPort, {
    read: () => {
      if (head.length === 0) return Effect.succeed(Option.none<ReleaseLedger>())
      return Effect.succeed(Option.some({ entries: [...head] }))
    },
    readAt: () => {
      if (base.length === 0) return Effect.succeed(Option.none<ReleaseLedger>())
      return Effect.succeed(Option.some({ entries: [...base] }))
    },
    write: () => Effect.void,
  })
