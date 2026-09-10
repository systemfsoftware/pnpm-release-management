import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import * as Lang from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import {
  PublishCommand,
  type PublishDispatched,
  type PublishDryRun,
  type PublishNothingOwed,
  publishPackages,
  type PublishWorkflowDecision,
} from './publish-packages.workflow.ts'

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

class PublishRaw {
  constructor(
    readonly request: PublishRequest,
    readonly captured: ReadonlyArray<Lang.CycleEntry>,
    readonly published: ReadonlyArray<boolean>,
    readonly filterLines: ReadonlyArray<string>,
    readonly command: Lang.WorkspaceCommand,
    readonly packages: Lang.Count,
  ) {}
}

type PublishPlan =
  | { readonly _tag: 'Dispatch'; readonly decision: PublishDispatched }
  | { readonly _tag: 'Preview'; readonly decision: PublishDryRun }
  | { readonly _tag: 'Settled'; readonly decision: PublishNothingOwed }
  | { readonly _tag: 'Refused'; readonly refusal: Lang.PublishRefusal }

const read = (
  request: PublishRequest,
): Effect.Effect<
  PublishRaw,
  Lang.PlanRefusal | Lang.TrustRefusal,
  Lang.CycleStore | Lang.RegistryPort
> =>
  Effect.gen(function*() {
    const cycle = yield* Lang.CycleStore
    const registry = yield* Lang.RegistryPort
    let captured: ReadonlyArray<Lang.CycleEntry> = []
    if (request.unpublishedOnly === true && request.capturedPath !== undefined) {
      captured = yield* cycle.readCaptured(request.capturedPath)
    }
    const published = yield* Effect.forEach(captured, (entry) => registry.isVersionPublished(entry.name, entry.version))
    const filterLines = [...splitFilterLines(request.filtersText)]
    const command = yield* S.decodeEffect(Lang.WorkspaceCommand)({
      program: 'pnpm',
      args: argsOf({
        provenance: request.provenance,
        filterLines,
        publishArgs: request.publishArgs,
      }),
    }).pipe(Effect.orDie)
    const packages = yield* S.decodeEffect(Lang.Count)(captured.length).pipe(Effect.orDie)
    return new PublishRaw(request, captured, published, filterLines, command, packages)
  })

const provenanceArgsOf = (provenance: boolean): ReadonlyArray<string> => provenance ? ['--provenance'] : []

const argsOf = (parts: {
  readonly provenance: boolean
  readonly filterLines: ReadonlyArray<string>
  readonly publishArgs: ReadonlyArray<Lang.PublishArg>
}): ReadonlyArray<string> => [
  'publish',
  '-r',
  ...provenanceArgsOf(parts.provenance),
  '--access',
  'public',
  '--no-git-checks',
  ...parts.filterLines,
  ...parts.publishArgs,
]

const splitFilterLines = (text: string | undefined): ReadonlyArray<string> =>
  (text ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0)

const decode = (
  raw: PublishRaw,
): Result.Result<PublishCommand, Lang.PublishFiltersUnreadable> => {
  if (raw.request.filtersPath !== undefined && raw.request.filtersText === undefined) {
    return Result.fail({
      _tag: 'PublishFiltersUnreadable',
      path: raw.request.filtersPath,
    })
  }
  return Result.succeed(
    new PublishCommand({
      capturedPath: raw.request.capturedPath,
      unpublishedOnly: raw.request.unpublishedOnly,
      filterLines: [...raw.filterLines],
      registry: raw.request.registry,
      provenance: raw.request.provenance,
      publishArgs: [...raw.request.publishArgs],
      dryRun: raw.request.dryRun,
      entries: raw.captured.map((entry, index) => ({
        name: entry.name,
        version: entry.version,
        published: raw.published[index] ?? false,
      })),
      command: raw.command,
      packages: raw.packages,
    }),
  )
}

const encode = (
  outcome: Result.Result<PublishWorkflowDecision, Lang.PublishRefusal>,
): PublishPlan => {
  if (Result.isFailure(outcome)) {
    return { _tag: 'Refused', refusal: outcome.failure }
  }
  const decision = outcome.success
  if (decision._tag === 'PublishNothingOwed') {
    return { _tag: 'Settled', decision }
  }
  if (decision._tag === 'PublishDryRun') {
    return { _tag: 'Preview', decision }
  }
  return { _tag: 'Dispatch', decision }
}

const write = (
  plan: PublishPlan,
  _raw: PublishRaw,
): Effect.Effect<Lang.PublishDecision, Lang.PublishRefusal, Lang.ProcessPort> =>
  Match.value(plan).pipe(
    Match.tag('Refused', (refused) => Effect.fail(refused.refusal)),
    Match.tag('Settled', (settled) =>
      S.decodeEffect(Lang.PublishNothingOwed)({
        _tag: 'PublishNothingOwed',
        packages: settled.decision.packages,
      }).pipe(Effect.orDie)),
    Match.tag('Preview', (preview) =>
      S.decodeEffect(Lang.PublishDryRun)({
        _tag: 'PublishDryRun',
        command: preview.decision.command,
      }).pipe(Effect.orDie)),
    Match.tag('Dispatch', (job) =>
      Effect.gen(function*() {
        const process = yield* Lang.ProcessPort
        const decision = yield* S.decodeEffect(Lang.PublishDispatched)({
          _tag: 'PublishDispatched',
          command: job.decision.command,
        }).pipe(Effect.orDie)
        yield* process.runCommand(decision.command)
        return decision
      })),
    Match.exhaustive,
  )

export const publishPackagesCell: Cell.Cell<
  PublishRequest,
  Lang.PublishDecision,
  Lang.PlanRefusal | Lang.TrustRefusal | Lang.PublishRefusal,
  Lang.CycleStore | Lang.RegistryPort | Lang.ProcessPort
> = Cell.layer({ read, decode, decide: publishPackages, encode, write })
