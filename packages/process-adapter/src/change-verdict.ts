import { type Member, type PackageName, type RelativePath } from '@systemfsoftware/release-language'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import { MANIFEST_SUFFIX } from './evidence-io.js'

const ownerOf = (
  file: RelativePath,
  members: ReadonlyArray<Member>,
): Option.Option<Member> =>
  Option.fromNullishOr(
    members.find(({ dir }) => file === `${dir}${MANIFEST_SUFFIX}` || file.startsWith(`${dir}/`)),
  )

export const pathsTouched = (
  members: ReadonlyArray<Member>,
  changedFiles: ReadonlyArray<RelativePath>,
): ReadonlyArray<PackageName> => {
  const touched: Array<PackageName> = []
  for (const file of changedFiles) {
    const owner = ownerOf(file, members)
    if (Option.isNone(owner)) continue
    if (!owner.value.publishable) continue
    touched.push(owner.value.name)
  }
  return [...HashSet.fromIterable(touched)].sort()
}

const hashMoved = (
  base: HashMap.HashMap<string, string>,
  head: HashMap.HashMap<string, string>,
  name: PackageName,
): boolean => {
  const atHead = HashMap.get(head, name)
  if (Option.isNone(atHead)) return false
  const atBase = HashMap.get(base, name)
  if (Option.isNone(atBase)) return true
  return atBase.value !== atHead.value
}

export const verdictTouched = (
  base: HashMap.HashMap<string, string>,
  head: HashMap.HashMap<string, string>,
  members: ReadonlyArray<Member>,
  changedFiles: ReadonlyArray<RelativePath>,
): ReadonlyArray<PackageName> => {
  const moved: Array<PackageName> = []
  for (const member of members) {
    if (!member.publishable) continue
    if (hashMoved(base, head, member.name)) {
      moved.push(member.name)
      continue
    }
    if (HashMap.has(base, member.name) || HashMap.has(head, member.name)) {
      continue
    }
    if (!changedFiles.some((file) => Option.isSome(ownerOf(file, [member])))) {
      continue
    }
    moved.push(member.name)
  }
  return [...HashSet.fromIterable(moved)].sort()
}
