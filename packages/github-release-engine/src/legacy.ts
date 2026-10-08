import type {
  GitPort,
  LegacyTags,
  Member,
  PackageName,
  PackageVersion,
  RemoteName,
  TagRefusal,
} from '@systemfsoftware/release-language'
import { LegacyTagUnverified, ReleaseTag } from '@systemfsoftware/release-language'
import { Effect, Option } from 'effect'
import { tagOf } from './cycle.js'

const numericIdentifier = /^\d+$/

const compareNumeric = (left: string, right: string): number => {
  if (left.length !== right.length) return Math.sign(left.length - right.length)
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

const compareIdentifier = (left: string, right: string): number => {
  const leftNumeric = numericIdentifier.test(left)
  const rightNumeric = numericIdentifier.test(right)
  if (leftNumeric && rightNumeric) return compareNumeric(left, right)
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

const partsOf = (
  version: PackageVersion,
): { readonly core: ReadonlyArray<string>; readonly pre: ReadonlyArray<string> } => {
  const [precedence = ''] = version.split('+')
  const dash = precedence.indexOf('-')
  if (dash === -1) return { core: precedence.split('.'), pre: [] }
  return { core: precedence.slice(0, dash).split('.'), pre: precedence.slice(dash + 1).split('.') }
}

export const compareVersions = (left: PackageVersion, right: PackageVersion): number => {
  const a = partsOf(left)
  const b = partsOf(right)
  for (let index = 0; index < 3; index++) {
    const order = compareNumeric(a.core[index] ?? '0', b.core[index] ?? '0')
    if (order !== 0) return order
  }
  if (a.pre.length === 0 || b.pre.length === 0) return Math.sign(b.pre.length - a.pre.length)
  const shared = Math.min(a.pre.length, b.pre.length)
  for (let index = 0; index < shared; index++) {
    const order = compareIdentifier(a.pre[index] ?? '', b.pre[index] ?? '')
    if (order !== 0) return order
  }
  return Math.sign(a.pre.length - b.pre.length)
}

export const legacyTagOf = (legacy: LegacyTags, name: PackageName, version: PackageVersion): ReleaseTag =>
  ReleaseTag.make(legacy.tag.replaceAll('{name}', name).replaceAll('{version}', version))

const verify = (
  git: GitPort,
  remote: RemoteName,
  tag: ReleaseTag,
  member: Member,
): Effect.Effect<void, LegacyTagUnverified | TagRefusal> =>
  Effect.gen(function*() {
    const name = member.name
    const version = member.manifest.version
    const unverified = (reason: string) =>
      Effect.fail(LegacyTagUnverified.make({ tag, package: name, version, reason }))
    const tree = yield* git.tagTree(remote, tag)
    if (Option.isNone(tree)) {
      return yield* unverified(`${tag} does not resolve to a commit on ${remote}`)
    }
    const commit = tree.value.commit
    const named = tree.value.manifests.filter((tagged) => tagged.manifest.name === name)
    const [only, ...more] = named
    if (only === undefined) {
      return yield* unverified(`no package.json at ${commit} names ${name}`)
    }
    if (more.length > 0) {
      return yield* unverified(`several package.json at ${commit} name ${name}: ${named.map((t) => t.path).join(', ')}`)
    }
    if (only.manifest.private === true) {
      return yield* unverified(`${only.path} at ${commit} is private`)
    }
    if (only.manifest.version !== version) {
      return yield* unverified(`${only.path} at ${commit} declares ${name}@${only.manifest.version}`)
    }
  })

export const legacyReleased = (input: {
  readonly git: GitPort
  readonly remote: RemoteName
  readonly members: ReadonlyArray<Member>
  readonly remoteTags: ReadonlyArray<ReleaseTag>
  readonly legacy: LegacyTags | undefined
}): Effect.Effect<ReadonlyArray<PackageName>, LegacyTagUnverified | TagRefusal> =>
  Effect.gen(function*() {
    const legacy = input.legacy
    if (legacy === undefined) return []
    const released: Array<PackageName> = []
    for (const member of input.members) {
      const version = member.manifest.version
      if (!member.publishable) continue
      if (input.remoteTags.includes(tagOf(member.name, version))) continue
      if (compareVersions(version, legacy.through) > 0) continue
      const tag = legacyTagOf(legacy, member.name, version)
      if (!input.remoteTags.includes(tag)) continue
      yield* verify(input.git, input.remote, tag, member)
      released.push(member.name)
    }
    return released
  })
