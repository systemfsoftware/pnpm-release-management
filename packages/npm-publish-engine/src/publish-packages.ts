import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import * as Lang from '@systemfsoftware/release-language'
import { Effect, Option } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import {
  PublishCommand,
  type PublishEntryState,
  publishPackages,
  type PublishWorkflowDecision,
} from './publish-packages.workflow.js'

export const PublishRequest = Wire.wire({
  capturedPath: Wire.mint(S.optional(Lang.FsPath)),
  unpublishedOnly: Wire.mint(S.Boolean),
  filtersPath: Wire.mint(S.optional(Lang.FsPath)),
  filtersText: Wire.mint(S.optional(S.String)),
  registry: Wire.mint(Lang.HttpUrl),
  provenance: Wire.mint(S.Boolean),
  publishArgs: Wire.mint(S.Array(Lang.PublishArg)),
  dryRun: Wire.mint(S.Boolean),
})
export type PublishRequest = S.Schema.Type<typeof PublishRequest>

const provenanceArgsOf = (provenance: boolean): ReadonlyArray<Lang.PublishArg> => {
  if (provenance) return [Lang.PublishArg.make('--provenance')]
  return []
}

const filterLinesOf = (text: string | undefined): ReadonlyArray<string> =>
  (text ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0)

const argsOf = (
  request: PublishRequest,
  filterLines: ReadonlyArray<string>,
): ReadonlyArray<Lang.PublishArg> => [
  Lang.PublishArg.make('publish'),
  Lang.PublishArg.make('-r'),
  ...provenanceArgsOf(request.provenance),
  Lang.PublishArg.make('--access'),
  Lang.PublishArg.make('public'),
  Lang.PublishArg.make('--no-git-checks'),
  ...filterLines.map((line) => Lang.PublishArg.make(line)),
  ...request.publishArgs,
]

const entriesOf = (
  captured: ReadonlyArray<Lang.CycleEntry>,
  published: ReadonlyArray<boolean>,
): ReadonlyArray<PublishEntryState> =>
  captured.map((entry, index) => ({
    name: entry.name,
    version: entry.version,
    published: published[index] ?? false,
  }))

const capturedPathOf = (request: PublishRequest): Option.Option<Lang.FsPath> => {
  if (request.unpublishedOnly) return Option.fromNullishOr(request.capturedPath)
  return Option.none()
}

const read = (
  request: PublishRequest,
): Effect.Effect<
  PublishCommand,
  Lang.PlanRefusal | Lang.TrustRefusal | Lang.PublishRefusal,
  Lang.CycleStore | Lang.RegistryPort
> =>
  Effect.gen(function*() {
    const cycle = yield* Lang.CycleStore
    const registry = yield* Lang.RegistryPort
    const captured = yield* Option.match(capturedPathOf(request), {
      onNone: () => Effect.succeed<ReadonlyArray<Lang.CycleEntry>>([]),
      onSome: (path) => cycle.readCaptured(path),
    })
    const published = yield* Effect.forEach(
      captured,
      (entry) => registry.isVersionPublished(entry.name, entry.version),
    )
    const filtersPath = request.filtersPath
    if (filtersPath !== undefined && request.filtersText === undefined) {
      return yield* Effect.fail<Lang.PublishFiltersUnreadable>({
        _tag: 'PublishFiltersUnreadable',
        path: filtersPath,
      })
    }
    const filterLines = filterLinesOf(request.filtersText)
    return new PublishCommand({
      capturedPath: request.capturedPath,
      unpublishedOnly: request.unpublishedOnly,
      filterLines,
      registry: request.registry,
      provenance: request.provenance,
      publishArgs: request.publishArgs,
      dryRun: request.dryRun,
      entries: entriesOf(captured, published),
      command: Lang.WorkspaceCommand.make({
        program: Lang.CommandName.make('pnpm'),
        args: argsOf(request, filterLines),
      }),
      packages: Lang.Count.make(captured.length),
    })
  })

const write = (
  outcome: Result.Result<PublishWorkflowDecision, Lang.PublishRefusal>,
): Effect.Effect<PublishWorkflowDecision, Lang.PublishRefusal, Lang.ProcessPort> =>
  Effect.flatMap(Effect.fromResult(outcome), (decision) =>
    Match.value(decision).pipe(
      Match.tag(
        'PublishDispatched',
        (
          dispatched,
        ): Effect.Effect<PublishWorkflowDecision, Lang.PublishRefusal, Lang.ProcessPort> =>
          Effect.as(
            Effect.flatMap(Lang.ProcessPort, (process) => process.runCommand(dispatched.command)),
            dispatched,
          ),
      ),
      Match.tag(
        'PublishDryRun',
        (preview): Effect.Effect<PublishWorkflowDecision, Lang.PublishRefusal, never> => Effect.succeed(preview),
      ),
      Match.tag(
        'PublishNothingOwed',
        (settled): Effect.Effect<PublishWorkflowDecision, Lang.PublishRefusal, never> => Effect.succeed(settled),
      ),
      Match.exhaustive,
    ))

export const publishPackagesCell: Cell.Cell<
  PublishRequest,
  PublishWorkflowDecision,
  Lang.PlanRefusal | Lang.TrustRefusal | Lang.PublishRefusal,
  Lang.CycleStore | Lang.RegistryPort | Lang.ProcessPort
> = Cell.layer({
  read,
  decide: publishPackages,
  write,
})
