import { it } from '@effect/vitest'
import * as Match from 'effect/Match'
import * as Result from 'effect/Result'
import * as S from 'effect/Schema'
import * as fc from 'effect/testing/FastCheck'
import { PinRootManifestCommand } from '../pin-root-manifest.schema.js'
import { pinRootManifest } from '../pin-root-manifest.workflow.js'

const nameArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/)
const suffixArb = fc.stringMatching(/^[a-z0-9]{1,6}(-[a-z0-9]{1,6}){0,2}$/)

const coreArb = fc.tuple(
  fc.integer({ min: 0, max: 20 }),
  fc.integer({ min: 0, max: 20 }),
  fc.integer({ min: 0, max: 20 }),
).map(([major, minor, patch]) => `${major}.${minor}.${patch}`)

const copiedSuffixes = (
  suffixes: ReadonlyArray<string> | undefined,
): Array<string> | undefined => {
  if (suffixes === undefined) {
    return undefined
  }
  return [...suffixes]
}

const toCommand = (input: {
  readonly manifestText: string
  readonly manifest: Record<string, unknown>
  readonly packageName: string
  readonly indent: string | number
  readonly trailingNewline: boolean
  readonly requestedVersion?: string | undefined
  readonly requestedUsable?: string | undefined
  readonly declaredVersion?: string | undefined
  readonly declaredUsable?: string | undefined
  readonly suffixes?: ReadonlyArray<string> | undefined
  readonly pinNames: ReadonlyArray<string>
  readonly repoRoot: string
}): PinRootManifestCommand =>
  S.decodeUnknownSync(PinRootManifestCommand)({
    _tag: 'PinRootManifestCommand',
    manifestText: input.manifestText,
    manifest: input.manifest,
    path: 'package.json',
    packageName: input.packageName,
    indent: input.indent,
    trailingNewline: input.trailingNewline,
    requestedVersion: input.requestedVersion,
    requestedUsable: input.requestedUsable,
    declaredVersion: input.declaredVersion,
    declaredUsable: input.declaredUsable,
    suffixes: copiedSuffixes(input.suffixes),
    pinNames: input.pinNames,
    repoRoot: input.repoRoot,
  })

const recordOf = (value: unknown): Record<string, unknown> => S.decodeUnknownSync(S.Record(S.String, S.Unknown))(value)

const manifestTextOf = (packageName: string, trailingNewline: boolean): string => {
  const text = JSON.stringify({ name: packageName, version: '0.0.0' })
  if (trailingNewline) {
    return `${text}\n`
  }
  return text
}

it.prop(
  '∀cmd_PinRootManifest_⊥UnusableSucceeds',
  [nameArb, fc.stringMatching(/^[a-z ]{1,12}$/), suffixArb],
  ([packageName, given, suffix]) => {
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
    if (Result.isSuccess(outcome)) {
      return false
    }
    return Match.value(outcome.failure).pipe(
      Match.tag('PinVersionUnusable', (unusable) => unusable.given === given),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀cmd_PinRootManifest_⊥TypoSucceeds',
  [nameArb, fc.stringMatching(/^[a-z ]{1,12}$/), coreArb, suffixArb],
  ([packageName, given, declared, suffix]) => {
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
    if (Result.isSuccess(outcome)) {
      return false
    }
    return Match.value(outcome.failure).pipe(
      Match.tag('PinVersionUnusable', (unusable) => unusable.given === given),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀cmd_PinRootManifest_⊥MissingSucceeds',
  [nameArb, coreArb],
  ([packageName, version]) => {
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
    if (Result.isSuccess(outcome)) {
      return false
    }
    return Match.value(outcome.failure).pipe(
      Match.tag('PinDistributionMissing', (missing) => missing.root === '/test'),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀cmd_PinRootManifest_≡RepinsAll',
  [nameArb, coreArb, fc.array(suffixArb, { minLength: 1, maxLength: 3 }), fc.boolean()],
  ([packageName, version, suffixes, trailingNewline]) => {
    const manifestText = manifestTextOf(packageName, trailingNewline)
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
    if (Result.isFailure(outcome)) {
      return false
    }
    return Match.value(outcome.success).pipe(
      Match.tag('WorkspaceVersionRepinned', (decision) => {
        const record = recordOf(JSON.parse(decision.text))
        const pins = recordOf(record['optionalDependencies'])
        const entries = Object.entries(pins)
        return decision.version === version &&
          decision.pins.length === suffixes.length &&
          entries.length === suffixes.length &&
          entries.every(([name, pinned]) => pinned === version && decision.pins.some((pin) => pin === name)) &&
          record['version'] === version
      }),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀cmd_PinRootManifest_≡RepinIdempotent',
  [nameArb, coreArb, fc.array(suffixArb, { minLength: 1, maxLength: 3 })],
  ([packageName, version, suffixes]) => {
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
    if (Result.isFailure(repinned)) {
      return false
    }
    return Match.value(repinned.success).pipe(
      Match.tag('WorkspaceVersionRepinned', (firstDecision) => {
        const second = toCommand({
          manifestText: firstDecision.text,
          manifest: recordOf(JSON.parse(firstDecision.text)),
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
        if (Result.isFailure(again)) {
          return false
        }
        return Match.value(again.success).pipe(
          Match.tag(
            'WorkspaceVersionAlreadyCurrent',
            (current) => current.text === firstDecision.text,
          ),
          Match.orElse(() => false),
        )
      }),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀cmd_PinRootManifest_≡RequestedWins',
  [nameArb, coreArb, coreArb, suffixArb],
  ([packageName, requested, declared, suffix]) => {
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
    if (Result.isFailure(outcome)) {
      return false
    }
    return Match.value(outcome.success).pipe(
      Match.tag('WorkspaceVersionRepinned', (repinned) => repinned.version === requested),
      Match.orElse(() => false),
    )
  },
)

it.prop(
  '∀cmd_PinRootManifest_≡DeclaredCarries',
  [nameArb, coreArb, suffixArb],
  ([packageName, declared, suffix]) => {
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
    if (Result.isFailure(outcome)) {
      return false
    }
    return Match.value(outcome.success).pipe(
      Match.tag('WorkspaceVersionRepinned', (repinned) => repinned.version === declared),
      Match.orElse(() => false),
    )
  },
)
