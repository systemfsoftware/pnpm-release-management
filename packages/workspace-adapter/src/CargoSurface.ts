import { parse as parseToml } from '@std/toml'
import {
  PackageVersion,
  RelativePath,
  VersionIntentMalformed,
  VersionLockStale,
  type VersionRefusal,
} from '@systemfsoftware/release-language'
import { Effect, HashSet } from 'effect'
import * as Option from 'effect/Option'
import * as S from 'effect/Schema'
import { spliceToml } from './TomlEdit.js'

const WORKSPACE_SECTION = 'workspace.package'
const PACKAGE_SECTION = 'package'
const LOCK_SEPARATOR = '\n[[package]]\n'
const LOCK_NAME = /^name = "([^"]*)"$/m
const LOCK_SOURCE = /^source = /m
const LOCK_VERSION = /^version = "([^"]*)"$/m

export interface CargoArtifact {
  readonly file: RelativePath
  readonly text: string
}

export interface CargoInput {
  readonly manifest: CargoArtifact
  readonly members: ReadonlyArray<CargoArtifact>
  readonly lock: CargoArtifact | undefined
}

export interface CargoWrite {
  readonly file: RelativePath
  readonly text: string
}

const malformed = (file: RelativePath): VersionRefusal => VersionIntentMalformed.make({ path: file })

const parseOr = (text: string, file: RelativePath): Effect.Effect<Record<string, unknown>, VersionRefusal> =>
  Effect.try({
    try: () => parseToml(text),
    catch: () => malformed(file),
  })

const isTable = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const tableAt = (parsed: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined => {
  if (parsed === undefined) return undefined
  const value = parsed[key]
  if (!isTable(value)) return undefined
  return value
}

const stringAt = (table: Record<string, unknown> | undefined, key: string): Option.Option<string> => {
  if (table === undefined) return Option.none()
  const value = table[key]
  if (typeof value !== 'string') return Option.none()
  return Option.some(value)
}

export const workspaceVersionOf = (
  text: string,
  file: RelativePath,
): Effect.Effect<PackageVersion, VersionRefusal> =>
  Effect.gen(function*() {
    const parsed = yield* parseOr(text, file)
    const raw = stringAt(tableAt(tableAt(parsed, 'workspace'), 'package'), 'version')
    if (Option.isNone(raw)) return yield* Effect.fail(malformed(file))
    return yield* S.decodeUnknownEffect(PackageVersion)(raw.value).pipe(Effect.mapError(() => malformed(file)))
  })

export const memberGlobsOf = (text: string): ReadonlyArray<string> => {
  try {
    const workspace = tableAt(parseToml(text), 'workspace')
    if (workspace === undefined) return []
    const members = workspace['members']
    if (!Array.isArray(members)) return []
    return members.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return []
  }
}

export const memberNameOf = (text: string): Option.Option<string> => {
  try {
    return stringAt(tableAt(parseToml(text), 'package'), 'name')
  } catch {
    return Option.none()
  }
}

const pinnedVersionOf = (text: string): Option.Option<string> => {
  try {
    return stringAt(tableAt(parseToml(text), 'package'), 'version')
  } catch {
    return Option.none()
  }
}

const memberNames = (members: ReadonlyArray<CargoArtifact>): HashSet.HashSet<string> =>
  members.reduce<HashSet.HashSet<string>>((names, member) => {
    const name = memberNameOf(member.text)
    if (Option.isSome(name)) return HashSet.add(names, name.value)
    return names
  }, HashSet.empty())

const lockBlocks = (text: string): ReadonlyArray<string> => text.split(LOCK_SEPARATOR).slice(1)

const lockVersionOf = (block: string): Option.Option<string> => {
  const match = LOCK_VERSION.exec(block)
  if (match === null) return Option.none()
  const found = match.at(1)
  if (found === undefined) return Option.none()
  return Option.some(found)
}

export const rewriteLock = (
  text: string,
  names: HashSet.HashSet<string>,
  version: PackageVersion,
  file: RelativePath,
): Effect.Effect<string, VersionRefusal> =>
  Effect.gen(function*() {
    const blocks = text.split(LOCK_SEPARATOR)
    const next = blocks.map((block, index) => {
      if (index === 0) return block
      const name = LOCK_NAME.exec(block)?.at(1)
      if (name === undefined || !HashSet.has(names, name) || LOCK_SOURCE.test(block)) return block
      return block.replace(LOCK_VERSION, `version = "${version}"`)
    })
    const stale = next.slice(1).some((block) => {
      const name = LOCK_NAME.exec(block)?.at(1)
      if (name === undefined || !HashSet.has(names, name) || LOCK_SOURCE.test(block)) return false
      const found = lockVersionOf(block)
      return Option.isNone(found) || found.value !== version
    })
    if (stale) return yield* Effect.fail(VersionLockStale.make({ path: file }))
    return next.join(LOCK_SEPARATOR)
  })

export const currentCargoVersion = (input: CargoInput): Effect.Effect<PackageVersion, VersionRefusal> =>
  Effect.gen(function*() {
    const workspace = yield* workspaceVersionOf(input.manifest.text, input.manifest.file)
    for (const member of input.members) {
      const pinned = pinnedVersionOf(member.text)
      if (Option.isSome(pinned) && pinned.value !== workspace) return PackageVersion.make(pinned.value)
    }
    if (input.lock !== undefined) {
      const names = memberNames(input.members)
      for (const block of lockBlocks(input.lock.text)) {
        const name = LOCK_NAME.exec(block)?.at(1)
        if (name === undefined || !HashSet.has(names, name) || LOCK_SOURCE.test(block)) continue
        const found = lockVersionOf(block)
        if (Option.isSome(found) && found.value !== workspace) return PackageVersion.make(found.value)
      }
    }
    return workspace
  })

const manifestWriteOf = (input: CargoInput, next: string): ReadonlyArray<CargoWrite> => {
  if (next === input.manifest.text) return []
  return [{ file: input.manifest.file, text: next }]
}

const lockWriteOf = (
  input: CargoInput,
  version: PackageVersion,
): Effect.Effect<ReadonlyArray<CargoWrite>, VersionRefusal> =>
  Effect.gen(function*() {
    if (input.lock === undefined) return []
    const nextLock = yield* rewriteLock(input.lock.text, memberNames(input.members), version, input.lock.file)
    if (nextLock === input.lock.text) return []
    return [{ file: input.lock.file, text: nextLock }]
  })

export const planCargoBump = (
  input: CargoInput,
  version: PackageVersion,
): Effect.Effect<ReadonlyArray<CargoWrite>, VersionRefusal> =>
  Effect.gen(function*() {
    yield* workspaceVersionOf(input.manifest.text, input.manifest.file)
    const manifestNext = spliceToml(input.manifest.text, [WORKSPACE_SECTION], version)
    if (Option.isNone(manifestNext)) return yield* Effect.fail(malformed(input.manifest.file))
    const manifestWrites = manifestWriteOf(input, manifestNext.value)
    const memberWrites = input.members.flatMap((member): ReadonlyArray<CargoWrite> => {
      const next = spliceToml(member.text, [PACKAGE_SECTION], version)
      if (Option.isSome(next) && next.value !== member.text) return [{ file: member.file, text: next.value }]
      return []
    })
    const lockWrites = yield* lockWriteOf(input, version)
    return [...manifestWrites, ...memberWrites, ...lockWrites]
  })
