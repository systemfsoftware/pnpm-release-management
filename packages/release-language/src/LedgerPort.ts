import { Context, type Effect, type Option } from 'effect'
import type { LedgerMalformed, LedgerUnreadable, LedgerUnwritable, ReleaseLedger } from './Ledger.schema.js'
import type { GitRef, RelativePath } from './Workspace.schema.js'
import { RelativePath as RelativePathSchema } from './Workspace.schema.js'

export const LEDGER_PATH: RelativePath = RelativePathSchema.make('release-ledger.json')

export interface LedgerPort {
  readonly read: (
    path: RelativePath,
  ) => Effect.Effect<Option.Option<ReleaseLedger>, LedgerUnreadable | LedgerMalformed, never>
  readonly readAt: (
    ref: GitRef,
    path: RelativePath,
  ) => Effect.Effect<Option.Option<ReleaseLedger>, LedgerUnreadable | LedgerMalformed, never>
  readonly write: (
    path: RelativePath,
    ledger: ReleaseLedger,
  ) => Effect.Effect<void, LedgerUnwritable, never>
}

export const LedgerPort: Context.Service<LedgerPort, LedgerPort> = Context.Service<
  LedgerPort,
  LedgerPort
>('LedgerPort')
