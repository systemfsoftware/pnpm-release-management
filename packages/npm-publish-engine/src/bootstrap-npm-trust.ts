import { Cell, Wire } from '@systemfsoftware/effect-cell-types'
import * as Lang from '@systemfsoftware/release-language'
import { Effect } from 'effect'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import {
  bootstrapNpmTrust,
  TrustCommand,
  type TrustWorkflowDecision,
  type TrustWorkflowRefusal,
  type TrustWorkItem,
} from './bootstrap-npm-trust.workflow.ts'

const PositiveInt = S.Int.pipe(S.check(S.isGreaterThan(0)))

export const TrustRequest = Wire.wire({
  only: Wire.mint(S.Array(Lang.PackageName)),
  dryRun: Wire.mint(S.Boolean),
  registry: Wire.mint(Lang.HttpUrl),
  workflowFile: Wire.mint(S.optional(S.NonEmptyString)),
  slug: Wire.mint(S.NonEmptyString),
  jobs: Wire.mint(S.optional(PositiveInt)),
  launcherManifest: Wire.mint(S.optional(Lang.RelativePath)),
})
export type TrustRequest = S.Schema.Type<typeof TrustRequest>

interface TrustCandidate {
  readonly name: Lang.PackageName
  readonly version: Lang.PackageVersion
  readonly hasBuild: boolean
  readonly snapshot: Lang.TrustSnapshot
}

class TrustRaw {
  constructor(
    readonly request: TrustRequest,
    readonly candidates: ReadonlyArray<TrustCandidate>,
    readonly launcherReady: boolean,
  ) {}
}

type TrustPlan =
  | {
    readonly _tag: 'Execute'
    readonly debuts: number
    readonly owed: ReadonlyArray<TrustWorkItem>
    readonly dryRun: boolean
    readonly workflowFile: string
    readonly slug: string
  }
  | { readonly _tag: 'Quiet'; readonly packages: number }
  | {
    readonly _tag: 'Refused'
    readonly kind: 'only' | 'empty' | 'unreadable' | 'launcher'
    readonly names: ReadonlyArray<Lang.PackageName>
  }

const read = (
  request: TrustRequest,
): Effect.Effect<TrustRaw, Lang.MemberRefusal | Lang.TrustRefusal, Lang.WorkspaceStore | Lang.RegistryPort> =>
  Effect.gen(function*() {
    const workspace = yield* Lang.WorkspaceStore
    const registry = yield* Lang.RegistryPort
    const members = yield* workspace.listMembers()
    const candidates = yield* Effect.forEach(members, (member) =>
      Effect.gen(function*() {
        const manifest = yield* workspace.readManifest(member.dir)
        const snapshot = yield* registry.queryPackage(member.name)
        return {
          name: member.name,
          version: manifest.version,
          hasBuild: typeof manifest.scripts?.build === 'string',
          snapshot,
        }
      }))
    let launcherReady = true
    if (request.launcherManifest !== undefined) {
      launcherReady = yield* workspace.readFileFromRoot(request.launcherManifest).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      )
    }
    return new TrustRaw(request, candidates, launcherReady)
  })

const decode = (raw: TrustRaw): Result.Result<TrustCommand, never> =>
  Result.succeed(
    new TrustCommand({
      only: [...raw.request.only],
      dryRun: raw.request.dryRun,
      registry: raw.request.registry,
      workflowFile: raw.request.workflowFile ?? 'release.yml',
      slug: raw.request.slug,
      launcherReady: raw.launcherReady,
      candidates: raw.candidates.map((candidate) => ({
        name: candidate.name,
        version: candidate.version,
        hasBuild: candidate.hasBuild,
        snapshot: candidate.snapshot,
      })),
    }),
  )

const encode = (
  outcome: Result.Result<TrustWorkflowDecision, TrustWorkflowRefusal>,
): TrustPlan => {
  if (Result.isFailure(outcome)) {
    const refusal = outcome.failure
    if (refusal._tag === 'TrustOnlyUnmatched') {
      return { _tag: 'Refused', kind: 'only', names: [...refusal.only] }
    }
    if (refusal._tag === 'TrustWorkspaceEmpty') {
      return { _tag: 'Refused', kind: 'empty', names: [] }
    }
    if (refusal._tag === 'TrustRegistryUnreadable') {
      return { _tag: 'Refused', kind: 'unreadable', names: [...refusal.packages] }
    }
    return { _tag: 'Refused', kind: 'launcher', names: [...refusal.packages] }
  }
  const decision = outcome.success
  if (decision._tag === 'TrustIdle') {
    return { _tag: 'Quiet', packages: decision.packages }
  }
  return {
    _tag: 'Execute',
    debuts: decision.debuts,
    owed: [...decision.owed],
    dryRun: decision.dryRun,
    workflowFile: decision.workflowFile,
    slug: decision.slug,
  }
}

const runParts = (
  program: string,
  args: ReadonlyArray<string>,
): Effect.Effect<boolean, never, Lang.ProcessPort> =>
  Effect.gen(function*() {
    const process = yield* Lang.ProcessPort
    const command = yield* S.decodeEffect(Lang.WorkspaceCommand)({ program, args }).pipe(Effect.orDie)
    return yield* process.runCommand(command).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )
  })

const executeItem = (
  item: TrustWorkItem,
  frame: { readonly workflowFile: string; readonly slug: string },
): Effect.Effect<boolean, never, Lang.RegistryPort | Lang.ProcessPort> =>
  Effect.gen(function*() {
    const registry = yield* Lang.RegistryPort
    if (item.mode === 'debut') {
      if (item.hasBuild === true) {
        const built = yield* runParts('pnpm', ['--filter', item.name, 'build'])
        if (built === false) {
          return false
        }
      }
      const published = yield* registry.publishMember(item.name, item.version, false).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      )
      if (published === false) {
        return false
      }
    }
    const trusted = yield* runParts('npm', [
      'trust',
      'github',
      item.name,
      '--repo',
      frame.slug,
      '--file',
      frame.workflowFile,
      '--allow-publish',
      '--yes',
    ])
    if (trusted === false) {
      return false
    }
    return yield* runParts('npm', ['trust', 'list', item.name])
  })

const write = (
  plan: TrustPlan,
  raw: TrustRaw,
): Effect.Effect<Lang.TrustDecision, Lang.TrustRefusal, Lang.RegistryPort | Lang.ProcessPort> =>
  Match.value(plan).pipe(
    Match.tag('Quiet', (quiet) =>
      S.decodeEffect(Lang.TrustIdle)({ _tag: 'TrustIdle', packages: quiet.packages }).pipe(Effect.orDie)),
    Match.tag('Refused', (refused) => {
      if (refused.kind === 'only') {
        return S.decodeUnknownEffect(Lang.TrustOnlyUnmatched)({
          _tag: 'TrustOnlyUnmatched',
          only: [...refused.names],
        }).pipe(
          Effect.orDie,
          Effect.flatMap((denied) =>
            Effect.fail(denied)
          ),
        )
      }
      if (refused.kind === 'unreadable') {
        return S.decodeUnknownEffect(Lang.TrustRegistryUnreadable)({
          _tag: 'TrustRegistryUnreadable',
          packages: [...refused.names],
        }).pipe(Effect.orDie, Effect.flatMap((denied) => Effect.fail(denied)))
      }
      if (refused.kind === 'launcher') {
        return Effect.gen(function*() {
          const head = refused.names[0] ??
            (yield* S.decodeEffect(Lang.PackageName)('unclaimed').pipe(Effect.orDie))
          return yield* S.decodeUnknownEffect(Lang.TrustLauncherMissing)({
            _tag: 'TrustLauncherMissing',
            package: head,
          }).pipe(Effect.orDie, Effect.flatMap((denied) => Effect.fail(denied)))
        })
      }
      return S.decodeEffect(Lang.TrustWorkspaceEmpty)({
        _tag: 'TrustWorkspaceEmpty',
        members: 0,
      }).pipe(Effect.orDie, Effect.flatMap((denied) => Effect.fail(denied)))
    }),
    Match.tag('Execute', (job) => {
      if (job.dryRun === true) {
        return S.decodeEffect(Lang.TrustComplete)({
          _tag: 'TrustComplete',
          processed: job.owed.length,
          debuts: job.debuts,
        }).pipe(Effect.orDie)
      }
      return Effect.gen(function*() {
        const outcomes = yield* Effect.forEach(
          job.owed,
          (item) => Effect.map(executeItem(item, job), (ok) => ({ name: item.name, ok })),
          {
            concurrency: raw.request.jobs ?? 4,
          },
        )
        const failed = outcomes.filter((result) => result.ok === false).map((result) => result.name)
        if (failed.length > 0) {
          return yield* S.decodeUnknownEffect(Lang.TrustPublishRefused)({
            _tag: 'TrustPublishRefused',
            packages: [...failed],
          }).pipe(Effect.orDie, Effect.flatMap((denied) => Effect.fail(denied)))
        }
        return yield* S.decodeEffect(Lang.TrustComplete)({
          _tag: 'TrustComplete',
          processed: job.owed.length,
          debuts: job.debuts,
        }).pipe(Effect.orDie)
      })
    }),
    Match.exhaustive,
  )

export const bootstrapNpmTrustCell: Cell.Cell<
  TrustRequest,
  Lang.TrustDecision,
  Lang.MemberRefusal | Lang.TrustRefusal,
  Lang.WorkspaceStore | Lang.RegistryPort | Lang.ProcessPort
> = Cell.layer({ read, decode, decide: bootstrapNpmTrust, encode, write })
