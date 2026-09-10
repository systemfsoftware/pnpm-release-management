import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as fc from 'fast-check'
import { PinRootManifestCommand } from './pin-root-manifest.schema.ts'
import { pinRootManifest } from './pin-root-manifest.workflow.ts'

const nameArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/)
const suffixArb = fc.stringMatching(/^[a-z0-9]{1,6}(-[a-z0-9]{1,6}){0,2}$/)

const coreArb = fc.tuple(
  fc.integer({ min: 0, max: 20 }),
  fc.integer({ min: 0, max: 20 }),
  fc.integer({ min: 0, max: 20 }),
).map(([major, minor, patch]) => `${major}.${minor}.${patch}`)

const toCommand = (input: {
  readonly manifestText: string
  readonly manifest: Record<string, unknown>
  readonly packageName: string
  readonly indent: string | number
  readonly trailingNewline: boolean
  readonly requestedVersion?: string
  readonly requestedUsable?: string
  readonly declaredVersion?: string
  readonly declaredUsable?: string
  readonly suffixes?: ReadonlyArray<string>
  readonly pinNames: ReadonlyArray<string>
  readonly repoRoot: string
}): PinRootManifestCommand =>
  S.decodeUnknownSync(PinRootManifestCommand)({
    _tag: 'PinRootManifestCommand',
    manifestText: input.manifestText,
    manifest: input.manifest,
    packageName: input.packageName,
    indent: input.indent,
    trailingNewline: input.trailingNewline,
    requestedVersion: input.requestedVersion,
    requestedUsable: input.requestedUsable,
    declaredVersion: input.declaredVersion,
    declaredUsable: input.declaredUsable,
    suffixes: input.suffixes === undefined ? undefined : [...input.suffixes],
    pinNames: input.pinNames,
    repoRoot: input.repoRoot,
  })

const recordOf = (value: unknown): Record<string, unknown> => S.decodeUnknownSync(S.Record(S.String, S.Unknown))(value)

const RUNS = { numRuns: 100 }

Deno.test('pin: unusable version is refused with the given raw', () => {
  fc.assert(
    fc.property(
      nameArb,
      fc.stringMatching(/^[a-z ]{1,12}$/),
      suffixArb,
      (packageName, given, suffix) => {
        const manifestText = JSON.stringify({ name: packageName, version: '0.0.0' })
        const command = toCommand({
          manifestText,
          manifest: { name: packageName, version: '0.0.0' },
          packageName,
          indent: 2,
          trailingNewline: false,
          requestedVersion: given,
          requestedUsable: undefined,
          declaredVersion: undefined,
          declaredUsable: undefined,
          suffixes: [suffix],
          pinNames: [`${packageName}-${suffix}`],
          repoRoot: '/test',
        })
        const outcome = pinRootManifest(command)
        if (Result.isSuccess(outcome)) return false
        return outcome.failure._tag === 'PinVersionUnusable' && outcome.failure.given === given
      },
    ),
    RUNS,
  )
})

Deno.test('pin: typoed requested version refuses even when declared is usable', () => {
  fc.assert(
    fc.property(
      nameArb,
      fc.stringMatching(/^[a-z ]{1,12}$/),
      coreArb,
      suffixArb,
      (packageName, given, declared, suffix) => {
        const command = toCommand({
          manifestText: JSON.stringify({ name: packageName, version: '0.0.0' }),
          manifest: { name: packageName, version: '0.0.0' },
          packageName,
          indent: 2,
          trailingNewline: false,
          requestedVersion: given,
          requestedUsable: undefined,
          declaredVersion: declared,
          declaredUsable: declared,
          suffixes: [suffix],
          pinNames: [`${packageName}-${suffix}`],
          repoRoot: '/test',
        })
        const outcome = pinRootManifest(command)
        if (Result.isSuccess(outcome)) return false
        return outcome.failure._tag === 'PinVersionUnusable' && outcome.failure.given === given
      },
    ),
    RUNS,
  )
})

Deno.test('pin: missing distribution is refused with the root', () => {
  fc.assert(
    fc.property(nameArb, coreArb, (packageName, version) => {
      const manifestText = JSON.stringify({ name: packageName, version })
      const command = toCommand({
        manifestText,
        manifest: { name: packageName, version },
        packageName,
        indent: 2,
        trailingNewline: false,
        requestedVersion: version,
        requestedUsable: version,
        declaredVersion: version,
        declaredUsable: version,
        suffixes: undefined,
        pinNames: [],
        repoRoot: '/test',
      })
      const outcome = pinRootManifest(command)
      if (Result.isSuccess(outcome)) return false
      return outcome.failure._tag === 'PinDistributionMissing' && outcome.failure.root === '/test'
    }),
    RUNS,
  )
})

Deno.test('pin: repin sets every pin and the version in one text', () => {
  fc.assert(
    fc.property(
      nameArb,
      coreArb,
      fc.array(suffixArb, { minLength: 1, maxLength: 3 }),
      fc.boolean(),
      (packageName, version, suffixes, trailingNewline) => {
        const manifestText = JSON.stringify({ name: packageName, version: '0.0.0' }) +
          (trailingNewline ? '\n' : '')
        const command = toCommand({
          manifestText,
          manifest: { name: packageName, version: '0.0.0' },
          packageName,
          indent: 2,
          trailingNewline,
          requestedVersion: version,
          requestedUsable: version,
          declaredVersion: '0.0.0',
          declaredUsable: '0.0.0',
          suffixes: [...suffixes],
          pinNames: suffixes.map((suffix) => `${packageName}-${suffix}`),
          repoRoot: '/test',
        })
        const outcome = pinRootManifest(command)
        if (Result.isFailure(outcome)) return false
        if (outcome.success._tag !== 'WorkspaceVersionRepinned') return false
        const decision = outcome.success
        const record = recordOf(JSON.parse(decision.text))
        const pins = recordOf(record['optionalDependencies'])
        const entries = Object.entries(pins)
        return decision.version === version &&
          decision.pins.length === suffixes.length &&
          entries.length === suffixes.length &&
          entries.every(([name, pinned]) => pinned === version && decision.pins.some((pin) => pin === name)) &&
          record['version'] === version
      },
    ),
    RUNS,
  )
})

Deno.test('pin: repinned text redecides as already current', () => {
  fc.assert(
    fc.property(
      nameArb,
      coreArb,
      fc.array(suffixArb, { minLength: 1, maxLength: 3 }),
      (packageName, version, suffixes) => {
        const first = toCommand({
          manifestText: JSON.stringify({ name: packageName, version: '0.0.0' }),
          manifest: { name: packageName, version: '0.0.0' },
          packageName,
          indent: 2,
          trailingNewline: true,
          requestedVersion: version,
          requestedUsable: version,
          declaredVersion: '0.0.0',
          declaredUsable: '0.0.0',
          suffixes: [...suffixes],
          pinNames: suffixes.map((suffix) => `${packageName}-${suffix}`),
          repoRoot: '/test',
        })
        const repinned = pinRootManifest(first)
        if (Result.isFailure(repinned)) return false
        if (repinned.success._tag !== 'WorkspaceVersionRepinned') return false
        const second = toCommand({
          manifestText: repinned.success.text,
          manifest: recordOf(JSON.parse(repinned.success.text)),
          packageName,
          indent: 2,
          trailingNewline: true,
          requestedVersion: version,
          requestedUsable: version,
          declaredVersion: version,
          declaredUsable: version,
          suffixes: [...suffixes],
          pinNames: suffixes.map((suffix) => `${packageName}-${suffix}`),
          repoRoot: '/test',
        })
        const again = pinRootManifest(second)
        if (Result.isFailure(again)) return false
        return again.success._tag === 'WorkspaceVersionAlreadyCurrent' &&
          again.success.text === repinned.success.text
      },
    ),
    RUNS,
  )
})

Deno.test('pin: requested version wins over declared version', () => {
  fc.assert(
    fc.property(
      nameArb,
      coreArb,
      coreArb,
      suffixArb,
      (packageName, requested, declared, suffix) => {
        const command = toCommand({
          manifestText: JSON.stringify({ name: packageName, version: declared }),
          manifest: { name: packageName, version: declared },
          packageName,
          indent: 2,
          trailingNewline: false,
          requestedVersion: requested,
          requestedUsable: requested,
          declaredVersion: declared,
          declaredUsable: declared,
          suffixes: [suffix],
          pinNames: [`${packageName}-${suffix}`],
          repoRoot: '/test',
        })
        const outcome = pinRootManifest(command)
        if (Result.isFailure(outcome)) return false
        if (outcome.success._tag !== 'WorkspaceVersionRepinned') return false
        return outcome.success.version === requested
      },
    ),
    RUNS,
  )
})

Deno.test('pin: declared version carries the pin when nothing is requested', () => {
  fc.assert(
    fc.property(nameArb, coreArb, suffixArb, (packageName, declared, suffix) => {
      const manifest = { name: packageName, version: '9.9.9' }
      const command = toCommand({
        manifestText: JSON.stringify(manifest),
        manifest,
        packageName,
        indent: 2,
        trailingNewline: false,
        requestedVersion: undefined,
        requestedUsable: undefined,
        declaredVersion: declared,
        declaredUsable: declared,
        suffixes: [suffix],
        pinNames: [`${packageName}-${suffix}`],
        repoRoot: '/test',
      })
      const outcome = pinRootManifest(command)
      if (Result.isFailure(outcome)) return false
      if (outcome.success._tag !== 'WorkspaceVersionRepinned') return false
      return outcome.success.version === declared
    }),
    RUNS,
  )
})
