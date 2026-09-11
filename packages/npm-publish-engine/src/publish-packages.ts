import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import * as Lang from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
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

interface PublishRead {
  readonly request: PublishRequest
  readonly entries: ReadonlyArray<PublishEntryState>
  readonly filterLines: ReadonlyArray<string>
  readonly command: Lang.WorkspaceCommand
  readonly packages: Lang.Count
}

const provenanceArgsOf = (provenance: boolean): ReadonlyArray<string> =>
  Match.value(provenance).pipe(
    Match.when(true, (): ReadonlyArray<string> => ['--provenance']),
    Match.when(false, (): ReadonlyArray<string> => []),
    Match.exhaustive,
  )

const filterLinesOf = (text: string | undefined): ReadonlyArray<string> =>
  (text ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0)

const argsOf = (request: PublishRequest, filterLines: ReadonlyArray<string>): ReadonlyArray<string> => [
  'publish',
  '-r',
  ...provenanceArgsOf(request.provenance),
  '--access',
  'public',
  '--no-git-checks',
  ...filterLines,
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

const capturedPathOf = (request: PublishRequest): Option.Option<Lang.FsPath> =>
  Match.value(request.unpublishedOnly).pipe(
    Match.when(true, () => Option.fromNullishOr(request.capturedPath)),
    Match.when(false, () => Option.none<Lang.FsPath>()),
    Match.exhaustive,
  )

const read = (
  request: PublishRequest,
): Effect.Effect<
  PublishRead,
  Lang.PlanRefusal | Lang.TrustRefusal,
  Lang.CycleStore | Lang.RegistryPort
> =>
  Effect.gen(function*() {
    const cycle = yield* Lang.CycleStore
    const registry = yield* Lang.RegistryPort
    const captured = yield* Option.match(capturedPathOf(request), {
      onNone: () => Effect.succeed<ReadonlyArray<Lang.CycleEntry>>([]),
      onSome: (path) => cycle.readCaptured(path),
    })
    const published = yield* Effect.forEach(captured, (entry) => registry.isVersionPublished(entry.name, entry.version))
    const filterLines = filterLinesOf(request.filtersText)
    const command = yield* S.decodeUnknownEffect(Lang.WorkspaceCommand)({
      program: 'pnpm',
      args: [...argsOf(request, filterLines)],
    }).pipe(Effect.orDie)
    return {
      request,
      entries: entriesOf(captured, published),
      filterLines,
      command,
      packages: Lang.Count.make(captured.length),
    }
  })

const commandOf = (raw: PublishRead): PublishCommand =>
  new PublishCommand({
    capturedPath: raw.request.capturedPath,
    unpublishedOnly: raw.request.unpublishedOnly,
    filterLines: [...raw.filterLines],
    registry: raw.request.registry,
    provenance: raw.request.provenance,
    publishArgs: [...raw.request.publishArgs],
    dryRun: raw.request.dryRun,
    entries: [...raw.entries],
    command: raw.command,
    packages: raw.packages,
  })

const decode = (raw: PublishRead): Result.Result<PublishCommand, Lang.PublishFiltersUnreadable> =>
  Option.match(Option.fromNullishOr(raw.request.filtersPath), {
    onNone: () => Result.succeed(commandOf(raw)),
    onSome: (path) =>
      Option.match(Option.fromNullishOr(raw.request.filtersText), {
        onNone: () => Result.fail(Lang.PublishFiltersUnreadable.make({ path })),
        onSome: () => Result.succeed(commandOf(raw)),
      }),
  })

const encode = (
  outcome: Result.Result<PublishWorkflowDecision, Lang.PublishRefusal>,
): Result.Result<Lang.PublishDecision, Lang.PublishRefusal> =>
  Result.map(outcome, (decision) =>
    Match.value(decision).pipe(
      Match.tag('PublishDispatched', (dispatched) => Lang.PublishDispatched.make({ command: dispatched.command })),
      Match.tag('PublishNothingOwed', (settled) => Lang.PublishNothingOwed.make({ packages: settled.packages })),
      Match.tag('PublishDryRun', (preview) => Lang.PublishDryRun.make({ command: preview.command })),
      Match.exhaustive,
    ))

const write = (
  output: Result.Result<Lang.PublishDecision, Lang.PublishRefusal>,
  _raw: PublishRead,
): Effect.Effect<Lang.PublishDecision, Lang.PublishRefusal, Lang.ProcessPort> =>
  Effect.flatMap(Effect.fromResult(output), (decision) =>
    Match.value(decision).pipe(
      Match.tag(
        'PublishDispatched',
        (dispatched): Effect.Effect<Lang.PublishDecision, Lang.PublishRefusal, Lang.ProcessPort> =>
          Effect.as(
            Effect.flatMap(Lang.ProcessPort, (process) => process.runCommand(dispatched.command)),
            dispatched,
          ),
      ),
      Match.tag(
        'PublishDryRun',
        (preview): Effect.Effect<Lang.PublishDecision, Lang.PublishRefusal, Lang.ProcessPort> =>
          Effect.succeed(preview),
      ),
      Match.tag(
        'PublishNothingOwed',
        (settled): Effect.Effect<Lang.PublishDecision, Lang.PublishRefusal, Lang.ProcessPort> =>
          Effect.succeed(settled),
      ),
      Match.exhaustive,
    ))

export const publishPackagesCell: Cell.Cell<
  PublishRequest,
  Lang.PublishDecision,
  Lang.PlanRefusal | Lang.TrustRefusal | Lang.PublishRefusal,
  Lang.CycleStore | Lang.RegistryPort | Lang.ProcessPort
> = Cell.layer({
  read,
  decode,
  decide: publishPackages,
  encode,
  write,
})
