import {
  type LedgerEntry,
  LedgerPort,
  type ReleaseLedger,
  ReleaseLedger as ReleaseLedgerSchema,
} from '@systemfsoftware/release-language'
import { Effect, Layer, Option } from 'effect'

export const makeFakeLedger = (entries: ReadonlyArray<LedgerEntry> = []) => {
  const ledger: ReleaseLedger = ReleaseLedgerSchema.make({ entries: [...entries] })
  return Layer.succeed(LedgerPort, {
    read: () => {
      if (entries.length === 0) return Effect.succeed(Option.none())
      return Effect.succeed(Option.some(ledger))
    },
    readAt: () => Effect.succeed(Option.none()),
    write: () => Effect.void,
  })
}
