import { Workflow } from '@systemfsoftware/effect-cell-types'
import {
  BaseIntent,
  type Bump,
  DecisionTypeId,
  type DroppedRelease,
  type GateBaseIntentMalformed,
  type GateIntentMissing,
  type GateReleaseDiverged,
  type GateReleaseDropped,
  type GateReleaseStale,
  type GateReleaseUnreplayable,
  type GateUnknownPackage,
  Intent,
  Member,
  PackageName,
  RelativePath,
  ReleaseCheck,
  TurboComparison,
  type TurboRun,
  type TurboTask,
} from '@systemfsoftware/release-language'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'

export const ChangedPath = S.Struct({
  path: RelativePath,
  owner: S.optional(PackageName),
  released: S.Boolean,
})
export type ChangedPath = S.Schema.Type<typeof ChangedPath>

export class GateCommand extends S.TaggedClass<GateCommand>()('GateCommand', {
  members: S.Array(Member),
  deleted: S.Array(PackageName),
  intents: S.Array(Intent),
  baseIntents: S.Array(BaseIntent),
  checks: S.Array(ReleaseCheck),
  changed: S.Array(ChangedPath),
  turbo: S.optional(TurboComparison),
  skipLiveness: S.optional(S.Boolean),
}) {}

export class ChangesVacant extends S.TaggedClass<ChangesVacant>()('ChangesVacant', {
  members: S.Array(PackageName),
  released: S.Array(PackageName),
  deleted: S.Array(PackageName),
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

export class ChangesGated extends S.TaggedClass<ChangesGated>()('ChangesGated', {
  touched: S.Array(PackageName),
  released: S.Array(PackageName),
  deleted: S.Array(PackageName),
}) {
  readonly [DecisionTypeId] = DecisionTypeId
}

type GateDecisionRefusal =
  | GateReleaseUnreplayable
  | GateReleaseDiverged
  | GateReleaseStale
  | GateBaseIntentMalformed
  | GateReleaseDropped
  | GateUnknownPackage
  | GateIntentMissing

type Verdict = Result.Result<ChangesVacant | ChangesGated, GateDecisionRefusal>

type Refused = Result.Result<never, GateDecisionRefusal> | undefined

const BUMP_RANK: Record<Bump, number> = { none: 0, patch: 1, minor: 2, major: 3 }

const verified = (check: ReleaseCheck): boolean =>
  Match.value(check.outcome).pipe(
    Match.tag('ReleaseReplayed', (replayed) => replayed.divergent.length === 0),
    Match.tag('ReleaseUnreplayed', () => false),
    Match.exhaustive,
  )

const replayRefusalOf = (check: ReleaseCheck): Refused =>
  Match.value(check.outcome).pipe(
    Match.tag('ReleaseUnreplayed', (outcome): Refused =>
      Result.fail({ _tag: 'GateReleaseUnreplayable', commit: check.candidate.commit, reason: outcome.reason })),
    Match.tag('ReleaseReplayed', (outcome): Refused => {
      const [first, ...rest] = outcome.divergent
      if (first === undefined) {
        return undefined
      }
      return Result.fail({ _tag: 'GateReleaseDiverged', commit: check.candidate.commit, paths: [first, ...rest] })
    }),
    Match.exhaustive,
  )

const firstRefused = <A>(items: ReadonlyArray<A>, refusalOf: (item: A) => Refused): Refused =>
  items.reduce<Refused>((found, item) => found ?? refusalOf(item), undefined)

const unreplayed = (check: ReleaseCheck): boolean =>
  Match.value(check.outcome).pipe(
    Match.tag('ReleaseUnreplayed', () => true),
    Match.tag('ReleaseReplayed', () => false),
    Match.exhaustive,
  )

const unreplayableOf = (command: GateCommand): Refused =>
  firstRefused(command.checks.filter((check) => !check.candidate.intentOnly && unreplayed(check)), replayRefusalOf)

const divergedOf = (command: GateCommand): Refused =>
  firstRefused(command.checks.filter((check) => !check.candidate.intentOnly), replayRefusalOf)

const staleOf = (command: GateCommand): Refused =>
  firstRefused(command.checks.filter(verified), (check): Refused => {
    const [first, ...rest] = check.staleSurfaces
    if (first === undefined) return undefined
    return Result.fail({ _tag: 'GateReleaseStale', commit: check.candidate.commit, paths: [first, ...rest] })
  })

const malformedOf = (command: GateCommand): Refused => {
  const malformed = command.baseIntents.find((intent) => intent.packages === undefined)
  if (malformed === undefined) return undefined
  return Result.fail({ _tag: 'GateBaseIntentMalformed', path: malformed.path })
}

const higher = (top: Bump | undefined, bump: Bump): Bump => {
  if (top === undefined || BUMP_RANK[bump] > BUMP_RANK[top]) return bump
  return top
}

const highest = (bumps: ReadonlyArray<Bump>): Bump | undefined => bumps.reduce<Bump | undefined>(higher, undefined)

const unique = <A>(items: ReadonlyArray<A>): ReadonlyArray<A> =>
  items.filter((item, index) => items.indexOf(item) === index)

const bumpsFor = (
  name: PackageName,
  intents: ReadonlyArray<
    { readonly packages?: ReadonlyArray<{ readonly name: PackageName; readonly bump: Bump }> | undefined }
  >,
): ReadonlyArray<Bump> =>
  intents.flatMap((intent) => (intent.packages ?? []).filter((entry) => entry.name === name).map((entry) => entry.bump))

const droppedOf = (command: GateCommand): Refused => {
  const consumed = command.checks.filter(verified).flatMap((check) => check.candidate.consumed)
  const pending = command.baseIntents.filter((intent) => !consumed.includes(intent.path))
  const names = [...unique(pending.flatMap((intent) => (intent.packages ?? []).map((entry) => entry.name)))].sort()
  const dropped = names.flatMap((name): ReadonlyArray<DroppedRelease> => {
    const owed = highest(bumpsFor(name, pending)) ?? 'none'
    const remaining = highest(bumpsFor(name, command.intents))
    if (BUMP_RANK[remaining ?? 'none'] >= BUMP_RANK[owed]) return []
    const intents = pending.filter((intent) => bumpsFor(name, [intent]).length > 0).map((intent) => intent.path)
    return [{ package: name, pending: owed, remaining, intents }]
  })
  const [first, ...rest] = dropped
  if (first === undefined) return undefined
  return Result.fail({ _tag: 'GateReleaseDropped', dropped: [first, ...rest] })
}

const unknownOf = (command: GateCommand): Refused => {
  if (command.skipLiveness === true) return undefined
  const memberNames = command.members.map((member) => member.name)
  return firstRefused(command.intents, (intent): Refused => {
    const entry = intent.packages.find((named) => !memberNames.includes(named.name))
    if (entry === undefined) return undefined
    return Result.fail({ _tag: 'GateUnknownPackage', path: intent.path, package: entry.name })
  })
}

interface PackageFacts {
  readonly named: (name: string) => boolean
  readonly released: (name: string) => boolean
  readonly ownsChange: (name: string) => boolean
  readonly ownsFeature: (name: string) => boolean
  readonly featureOwned: (path: string) => boolean
}

const factsOf = (command: GateCommand): PackageFacts => {
  const owned = (name: string) => command.changed.filter((change) => change.owner === name)
  const featurePaths: ReadonlyArray<string> = command.changed.filter((change) => !change.released).map((change) =>
    change.path
  )
  return {
    named: (name) => command.intents.some((intent) => intent.packages.some((entry) => entry.name === name)),
    released: (name) => owned(name).length > 0 && owned(name).every((change) => change.released),
    ownsChange: (name) => owned(name).length > 0,
    ownsFeature: (name) => owned(name).some((change) => !change.released),
    featureOwned: (path) => featurePaths.includes(path),
  }
}

const taskIn = (run: TurboRun, id: string): TurboTask | undefined => run.tasks.find((task) => task.taskId === id)

const changedKeys = (base: Record<string, string>, head: Record<string, string>): ReadonlyArray<string> =>
  unique([...Object.keys(base), ...Object.keys(head)]).filter((key) => base[key] !== head[key])

interface TurboAccounting {
  readonly moved: (name: string) => boolean
  readonly accounted: (name: string) => boolean
}

const turboAccountingOf = (comparison: TurboComparison, facts: PackageFacts): TurboAccounting => {
  const idOf = (name: string): string => `${name}#${comparison.task}`
  const taskMoved = (id: string): boolean => {
    const atHead = taskIn(comparison.head, id)
    return atHead !== undefined && taskIn(comparison.base, id)?.hash !== atHead.hash
  }
  const globalsSettled = comparison.base.globalOther === comparison.head.globalOther &&
    !changedKeys(comparison.base.globalFiles, comparison.head.globalFiles).some(facts.featureOwned)
  const settledOutsideDependencies = (task: TurboTask): boolean => {
    const before = taskIn(comparison.base, task.taskId)
    return before !== undefined &&
      globalsSettled &&
      before.externalHash === task.externalHash &&
      !changedKeys(before.inputs, task.inputs).some(facts.featureOwned)
  }
  const movedTasks = comparison.head.tasks.filter((task) => taskMoved(task.taskId))
  const settles = (accounted: ReadonlyArray<string>) => (task: TurboTask): boolean =>
    facts.named(task.package) ||
    facts.released(task.package) ||
    (!facts.ownsChange(task.package) &&
      settledOutsideDependencies(task) &&
      task.dependencies.filter(taskMoved).every((id) => accounted.includes(id)))
  const grow = (accounted: ReadonlyArray<string>): ReadonlyArray<string> => {
    const next = movedTasks.filter(settles(accounted)).map((task) => task.taskId)
    if (next.length === accounted.length) return accounted
    return grow(next)
  }
  const accounted = grow([])
  return {
    moved: (name) =>
      taskMoved(idOf(name)) ||
      (taskIn(comparison.head, idOf(name)) === undefined && taskIn(comparison.base, idOf(name)) === undefined &&
        facts.ownsChange(name)),
    accounted: (name) => !taskMoved(idOf(name)) || accounted.includes(idOf(name)),
  }
}

interface PackageView {
  readonly touched: ReadonlyArray<PackageName>
  readonly released: ReadonlyArray<PackageName>
  readonly missing: ReadonlyArray<PackageName>
}

const pathsViewOf = (publishable: ReadonlyArray<PackageName>, facts: PackageFacts): PackageView => {
  const direct = publishable.filter(facts.ownsFeature)
  return {
    touched: direct,
    released: publishable.filter(facts.released),
    missing: direct.filter((name) => !facts.named(name)),
  }
}

const turboViewOf = (
  publishable: ReadonlyArray<PackageName>,
  facts: PackageFacts,
  comparison: TurboComparison,
): PackageView => {
  const accounting = turboAccountingOf(comparison, facts)
  const direct = publishable.filter((name) => facts.ownsFeature(name) && accounting.moved(name))
  const transitive = publishable.filter((name) => !facts.ownsChange(name) && accounting.moved(name))
  return {
    touched: [...direct, ...transitive].sort(),
    released: publishable.filter(facts.released),
    missing: [
      ...direct.filter((name) => !facts.named(name)),
      ...transitive.filter((name) => !accounting.accounted(name)),
    ]
      .sort(),
  }
}

const packageViewOf = (command: GateCommand): PackageView => {
  const facts = factsOf(command)
  const publishable = command.members.filter((member) => member.publishable).map((member) => member.name).sort()
  if (command.turbo === undefined) return pathsViewOf(publishable, facts)
  return turboViewOf(publishable, facts, command.turbo)
}

const verdictOf = (command: GateCommand, view: PackageView): Verdict => {
  const [first, ...rest] = view.missing
  if (first !== undefined) return Result.fail({ _tag: 'GateIntentMissing', packages: [first, ...rest] })
  if (view.touched.length === 0) {
    return Result.succeed(
      ChangesVacant.make({
        members: command.members.map((member) => member.name),
        released: view.released,
        deleted: command.deleted,
      }),
    )
  }
  return Result.succeed(ChangesGated.make({ touched: view.touched, released: view.released, deleted: command.deleted }))
}

const refusalOf = (command: GateCommand): Refused =>
  unreplayableOf(command) ??
    divergedOf(command) ??
    staleOf(command) ??
    malformedOf(command) ??
    droppedOf(command) ??
    unknownOf(command)

export const gateChanges = Workflow.make(
  GateCommand,
  (command): Verdict => refusalOf(command) ?? verdictOf(command, packageViewOf(command)),
)
