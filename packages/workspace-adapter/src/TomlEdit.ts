import type { PackageVersion } from '@systemfsoftware/release-language'
import * as Option from 'effect/Option'

export const TOML_SECTION = /^\s*\[(.+?)\]\s*$/
export const TOML_VERSION = /^(\s*version\s*=\s*")([^"]*)(".*)$/

export const spliceToml = (
  text: string,
  sections: ReadonlyArray<string>,
  version: PackageVersion,
): Option.Option<string> => {
  const lines: Array<string> = []
  let current: string | undefined
  let spliced = 0
  for (const line of text.split('\n')) {
    const section = TOML_SECTION.exec(line)?.at(1)?.trim()
    if (section !== undefined) {
      current = section
      lines.push(line)
      continue
    }
    if (current === undefined || !sections.includes(current)) {
      lines.push(line)
      continue
    }
    const match = TOML_VERSION.exec(line)
    if (match === null) {
      lines.push(line)
      continue
    }
    spliced += 1
    lines.push(`${match.at(1) ?? ''}${version}${match.at(3) ?? ''}`)
  }
  if (spliced === sections.length) return Option.some(lines.join('\n'))
  return Option.none()
}
