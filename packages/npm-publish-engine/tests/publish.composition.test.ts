import { assert, assertEquals, assertExists } from '@std/assert'
import { Cell } from '@systemfsoftware/effect-cell-types'
import type * as Lang from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as S from 'effect/Schema'
import { bootstrapNpmTrustCell, TrustRequest } from '../src/bootstrap-npm-trust.ts'
import { publishPackagesCell, PublishRequest } from '../src/publish-packages.ts'
import { publishStatusCell, StatusRequest } from '../src/publish-status.ts'
import { type FakeCycle, makeFakeCycleStore } from '../src/testing/FakeCycle.ts'
import { type FakeProcess, makeFakeProcess } from '../src/testing/FakeProcess.ts'
import { type FakeRegistry, makeFakeRegistry } from '../src/testing/FakeRegistry.ts'
import { type FakeWorkspace, makeFakeWorkspace } from '../src/testing/FakeWorkspace.ts'

const registryUrl = 'https://registry.npmjs.org/'

const publishRequest = (
  overrides: Partial<S.Codec.Encoded<typeof PublishRequest>> = {},
): PublishRequest =>
  S.decodeSync(PublishRequest)({
    unpublishedOnly: false,
    registry: registryUrl,
    provenance: true,
    publishArgs: [],
    dryRun: false,
    ...overrides,
  })

const statusRequest = (mode: StatusRequest['mode']): StatusRequest => S.decodeSync(StatusRequest)({ mode })

const trustRequest = (
  overrides: Partial<S.Codec.Encoded<typeof TrustRequest>> = {},
): TrustRequest =>
  S.decodeSync(TrustRequest)({
    only: [],
    dryRun: false,
    registry: registryUrl,
    workflowFile: 'release.yml',
    slug: 'acme/repo',
    ...overrides,
  })

const runPublish = (
  request: PublishRequest,
  layers: {
    readonly cycle?: FakeCycle
    readonly registry?: FakeRegistry
    readonly process?: FakeProcess
  } = {},
) => {
  const cycle = layers.cycle ?? makeFakeCycleStore()
  const registry = layers.registry ?? makeFakeRegistry()
  const process = layers.process ?? makeFakeProcess()
  const workspace = makeFakeWorkspace()
  const live = Layer.mergeAll(cycle.layer, registry.layer, process.layer, workspace.layer)
  const runnable = Cell.provide(publishPackagesCell, live)
  return Effect.runPromise(
    Cell.run(runnable, request).pipe(
      Effect.match({
        onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
        onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
      }),
    ),
  ).then((outcome) => ({ outcome, cycle, registry, process }))
}

const runStatus = (
  request: StatusRequest,
  layers: {
    readonly workspace?: FakeWorkspace
    readonly registry?: FakeRegistry
  } = {},
) => {
  const workspace = layers.workspace ?? makeFakeWorkspace()
  const registry = layers.registry ?? makeFakeRegistry()
  const live = Layer.mergeAll(workspace.layer, registry.layer)
  const runnable = Cell.provide(publishStatusCell, live)
  return Effect.runPromise(
    Cell.run(runnable, request).pipe(
      Effect.match({
        onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
        onSuccess: (report) => ({ _tag: 'decided' as const, report }),
      }),
    ),
  ).then((outcome) => ({ outcome, workspace, registry }))
}

const runTrust = (
  request: TrustRequest,
  layers: {
    readonly workspace?: FakeWorkspace
    readonly registry?: FakeRegistry
    readonly process?: FakeProcess
  } = {},
) => {
  const workspace = layers.workspace ?? makeFakeWorkspace()
  const registry = layers.registry ?? makeFakeRegistry()
  const process = layers.process ?? makeFakeProcess()
  const live = Layer.mergeAll(workspace.layer, registry.layer, process.layer)
  const runnable = Cell.provide(bootstrapNpmTrustCell, live)
  return Effect.runPromise(
    Cell.run(runnable, request).pipe(
      Effect.match({
        onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
        onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
      }),
    ),
  ).then((outcome) => ({ outcome, workspace, registry, process }))
}

const renderedCalls = (calls: ReadonlyArray<Lang.WorkspaceCommand>): Array<string> =>
  calls.map((call) => `${call.program} ${call.args.join(' ')}`).sort()

Deno.test('publish dispatches pnpm publish for the unpublished remainder', async () => {
  const cycle = makeFakeCycleStore({
    captured: {
      'cycle.json': [
        { name: 'pkg-a', version: '1.0.0' },
        { name: 'pkg-b', version: '2.0.0' },
      ],
    },
  })
  const registry = makeFakeRegistry({ published: ['pkg-a@1.0.0'] })
  const process = makeFakeProcess()
  const { outcome } = await runPublish(
    publishRequest({ unpublishedOnly: true, capturedPath: 'cycle.json' }),
    { cycle, registry, process },
  )
  assert(outcome._tag === 'decided')
  assert(outcome.decision._tag === 'PublishDispatched')
  assertEquals(
    `${outcome.decision.command.program} ${outcome.decision.command.args.join(' ')}`,
    'pnpm publish -r --provenance --access public --no-git-checks',
  )
  assertEquals(process.calls.length, 1)
})

Deno.test('plain publish dispatches the whole workspace unconditionally', async () => {
  const process = makeFakeProcess()
  const { outcome } = await runPublish(publishRequest({ provenance: false }), { process })
  assert(outcome._tag === 'decided')
  assert(outcome.decision._tag === 'PublishDispatched')
  assertEquals(
    `${outcome.decision.command.program} ${outcome.decision.command.args.join(' ')}`,
    'pnpm publish -r --access public --no-git-checks',
  )
  assertEquals(process.calls.length, 1)
})

Deno.test('publish settles when every captured version is published', async () => {
  const cycle = makeFakeCycleStore({
    captured: { 'cycle.json': [{ name: 'pkg-a', version: '1.0.0' }] },
  })
  const registry = makeFakeRegistry({ published: ['pkg-a@1.0.0'] })
  const process = makeFakeProcess()
  const { outcome } = await runPublish(
    publishRequest({ unpublishedOnly: true, capturedPath: 'cycle.json' }),
    { cycle, registry, process },
  )
  assert(outcome._tag === 'decided')
  assert(outcome.decision._tag === 'PublishNothingOwed')
  assertEquals(outcome.decision.packages, 1)
  assertEquals(process.calls.length, 0)
})

Deno.test('publish dry run previews without executing', async () => {
  const cycle = makeFakeCycleStore({
    captured: { 'cycle.json': [{ name: 'pkg-a', version: '1.0.0' }] },
  })
  const process = makeFakeProcess()
  const { outcome } = await runPublish(
    publishRequest({ unpublishedOnly: true, capturedPath: 'cycle.json', dryRun: true }),
    { cycle, process },
  )
  assert(outcome._tag === 'decided')
  assert(outcome.decision._tag === 'PublishDryRun')
  assertEquals(
    `${outcome.decision.command.program} ${outcome.decision.command.args.join(' ')}`,
    'pnpm publish -r --provenance --access public --no-git-checks',
  )
  assertEquals(process.calls.length, 0)
})

Deno.test('publish refuses unpublished without captured', async () => {
  const { outcome } = await runPublish(publishRequest({ unpublishedOnly: true }))
  assert(outcome._tag === 'refused')
  assertEquals(outcome.refusal._tag, 'PublishCapturedRequired')
})

Deno.test('publish threads filter lines into the command', async () => {
  const process = makeFakeProcess()
  const { outcome } = await runPublish(
    publishRequest({
      filtersPath: 'filters.txt',
      filtersText: '--filter=!pkg-x\n--filter=!pkg-y\n',
      publishArgs: ['--tag', 'next'],
    }),
    { process },
  )
  assert(outcome._tag === 'decided')
  assert(outcome.decision._tag === 'PublishDispatched')
  assertEquals(
    `${outcome.decision.command.program} ${outcome.decision.command.args.join(' ')}`,
    'pnpm publish -r --provenance --access public --no-git-checks --filter=!pkg-x --filter=!pkg-y --tag next',
  )
})

Deno.test('publish refuses a filters path without its content', async () => {
  const { outcome } = await runPublish(publishRequest({ filtersPath: 'filters.txt' }))
  assert(outcome._tag === 'refused')
  assertEquals(outcome.refusal._tag, 'PublishFiltersUnreadable')
})

Deno.test('publish surfaces a malformed captured file', async () => {
  const cycle = makeFakeCycleStore({ malformed: ['cycle.json'] })
  const { outcome } = await runPublish(
    publishRequest({ unpublishedOnly: true, capturedPath: 'cycle.json' }),
    { cycle },
  )
  assert(outcome._tag === 'refused')
  assertEquals(outcome.refusal._tag, 'PlanCapturedMalformed')
})

Deno.test('status reports owed members with JSON rows', async () => {
  const workspace = makeFakeWorkspace({
    members: [
      { name: 'pkg-a', dir: 'packages/pkg-a', version: '1.0.0', provenance: true },
      { name: 'pkg-b', dir: 'packages/pkg-b', version: '2.0.0' },
      { name: 'pkg-c', dir: 'packages/pkg-c', version: '1.0.0' },
    ],
  })
  const registry = makeFakeRegistry({
    snapshots: {
      'pkg-a': { latest: '1.0.0', attested: true },
      'pkg-b': { latest: '1.0.0', attested: true },
      'pkg-c': {},
    },
  })
  const { outcome } = await runStatus(statusRequest('report'), { workspace, registry })
  assert(outcome._tag === 'decided')
  assert(outcome.report.decision._tag === 'PublishStatusOwed')
  assertEquals(outcome.report.decision.unpublished, 1)
  assertEquals(outcome.report.decision.untrusted, 0)
  assertEquals(outcome.report.decision.stuck, 1)
  assertEquals(outcome.report.rows.length, 3)
  for (const row of outcome.report.rows) {
    assertEquals(Object.keys(row).sort(), [
      'attested',
      'class',
      'local_version',
      'name',
      'npm_latest',
      'publishConfig_provenance',
    ])
  }
  const byName = Object.fromEntries(outcome.report.rows.map((row) => [row.name, row]))
  const rowA = byName['pkg-a']
  const rowB = byName['pkg-b']
  const rowC = byName['pkg-c']
  assertExists(rowA)
  assertExists(rowB)
  assertExists(rowC)
  assertEquals(rowA.class, 'ok')
  assertEquals(rowA.npm_latest, '1.0.0')
  assertEquals(rowA.publishConfig_provenance, 'yes')
  assertEquals(rowB.class, 'stuck')
  assertEquals(rowC.class, 'unpublished')
  assertEquals(rowC.npm_latest, '—')
  assertEquals(rowC.attested, 'no')
  assertEquals(outcome.report.deferred.join(','), 'pkg-c')
})

Deno.test('status reports healthy when every member is current', async () => {
  const workspace = makeFakeWorkspace({
    members: [{ name: 'pkg-a', dir: 'packages/pkg-a', version: '1.0.0' }],
  })
  const registry = makeFakeRegistry({
    snapshots: { 'pkg-a': { latest: '1.0.0', attested: true } },
  })
  const { outcome } = await runStatus(statusRequest('report'), { workspace, registry })
  assert(outcome._tag === 'decided')
  assert(outcome.report.decision._tag === 'PublishStatusHealthy')
  assertEquals(outcome.report.decision.packages, 1)
  assertEquals(outcome.report.deferred, [])
})

Deno.test('status refuses an empty workspace', async () => {
  const { outcome } = await runStatus(statusRequest('report'))
  assert(outcome._tag === 'refused')
  assertEquals(outcome.refusal._tag, 'PublishStatusEmpty')
})

Deno.test('status check refuses unattested members', async () => {
  const workspace = makeFakeWorkspace({
    members: [{ name: 'pkg-a', dir: 'packages/pkg-a', version: '1.0.0' }],
  })
  const registry = makeFakeRegistry({
    snapshots: { 'pkg-a': { latest: '1.0.0', attested: false } },
  })
  const { outcome } = await runStatus(statusRequest('check'), { workspace, registry })
  assert(outcome._tag === 'refused')
  assertEquals(outcome.refusal._tag, 'PublishStatusUnattested')
})

Deno.test('status preflight refuses unpublished members', async () => {
  const workspace = makeFakeWorkspace({
    members: [{ name: 'pkg-a', dir: 'packages/pkg-a', version: '1.0.0' }],
  })
  const { outcome } = await runStatus(statusRequest('preflight'), { workspace })
  assert(outcome._tag === 'refused')
  assertEquals(outcome.refusal._tag, 'PublishStatusUnpublished')
})

const trustMembers = [
  { name: 'debut-pkg', dir: 'packages/debut-pkg', version: '0.1.0', build: true },
  { name: 'tired-pkg', dir: 'packages/tired-pkg', version: '1.2.0' },
  { name: 'fine-pkg', dir: 'packages/fine-pkg', version: '3.0.0' },
] as const

const trustSnapshots = {
  'debut-pkg': {},
  'tired-pkg': { latest: '1.2.0', attested: false },
  'fine-pkg': { latest: '3.0.0', attested: true },
}

Deno.test('trust bootstraps debut and untrusted members', async () => {
  const workspace = makeFakeWorkspace({ members: [...trustMembers] })
  const registry = makeFakeRegistry({ snapshots: { ...trustSnapshots } })
  const process = makeFakeProcess()
  const { outcome } = await runTrust(trustRequest({ jobs: 2 }), { workspace, registry, process })
  assert(outcome._tag === 'decided')
  assert(outcome.decision._tag === 'TrustComplete')
  assertEquals(outcome.decision.processed, 2)
  assertEquals(outcome.decision.debuts, 1)
  assertEquals(registry.publishCalls.length, 1)
  assertEquals(registry.publishCalls.map((call) => call.name).join(','), 'debut-pkg')
  assertEquals(registry.publishCalls.map((call) => call.provenance).join(','), 'false')
  assertEquals(registry.isPublished('debut-pkg', '0.1.0'), true)
  assertEquals(renderedCalls(process.calls), [
    'npm trust github debut-pkg --repo acme/repo --file release.yml --allow-publish --yes',
    'npm trust github tired-pkg --repo acme/repo --file release.yml --allow-publish --yes',
    'npm trust list debut-pkg',
    'npm trust list tired-pkg',
    'pnpm --filter debut-pkg build',
  ])
})

Deno.test('trust idles when everything is attested', async () => {
  const workspace = makeFakeWorkspace({
    members: [{ name: 'fine-pkg', dir: 'packages/fine-pkg', version: '3.0.0' }],
  })
  const registry = makeFakeRegistry({
    snapshots: { 'fine-pkg': { latest: '3.0.0', attested: true } },
  })
  const process = makeFakeProcess()
  const { outcome } = await runTrust(trustRequest(), { workspace, registry, process })
  assert(outcome._tag === 'decided')
  assert(outcome.decision._tag === 'TrustIdle')
  assertEquals(process.calls.length, 0)
  assertEquals(registry.publishCalls.length, 0)
})

Deno.test('trust dry run completes without executing', async () => {
  const workspace = makeFakeWorkspace({ members: [...trustMembers] })
  const registry = makeFakeRegistry({ snapshots: { ...trustSnapshots } })
  const process = makeFakeProcess()
  const { outcome } = await runTrust(trustRequest({ dryRun: true }), {
    workspace,
    registry,
    process,
  })
  assert(outcome._tag === 'decided')
  assert(outcome.decision._tag === 'TrustComplete')
  assertEquals(outcome.decision.processed, 2)
  assertEquals(process.calls.length, 0)
  assertEquals(registry.publishCalls.length, 0)
})

Deno.test('trust refuses an unmatched only filter', async () => {
  const workspace = makeFakeWorkspace({ members: [...trustMembers] })
  const { outcome } = await runTrust(trustRequest({ only: ['ghost-pkg'] }), { workspace })
  assert(outcome._tag === 'refused')
  assertEquals(outcome.refusal._tag, 'TrustOnlyUnmatched')
})

Deno.test('trust refuses an unreadable registry', async () => {
  const workspace = makeFakeWorkspace({ members: [...trustMembers] })
  const registry = makeFakeRegistry({ queryFailures: ['debut-pkg'] })
  const { outcome } = await runTrust(trustRequest(), { workspace, registry })
  assert(outcome._tag === 'refused')
  assertEquals(outcome.refusal._tag, 'TrustRegistryUnreadable')
})

Deno.test('trust refuses failed publishes', async () => {
  const workspace = makeFakeWorkspace({ members: [...trustMembers] })
  const registry = makeFakeRegistry({
    snapshots: { ...trustSnapshots },
    publishFailures: ['debut-pkg'],
  })
  const process = makeFakeProcess()
  const { outcome } = await runTrust(trustRequest(), { workspace, registry, process })
  assert(outcome._tag === 'refused')
  assert(outcome.refusal._tag === 'TrustPublishRefused')
  assertEquals(outcome.refusal.packages.map((name) => `${name}`).join(','), 'debut-pkg')
})

Deno.test('trust refuses a missing launcher for debuts', async () => {
  const workspace = makeFakeWorkspace({ members: [...trustMembers] })
  const registry = makeFakeRegistry({ snapshots: { ...trustSnapshots } })
  const { outcome } = await runTrust(
    trustRequest({ launcherManifest: 'dist/launcher.json' }),
    { workspace, registry },
  )
  assert(outcome._tag === 'refused')
  assertEquals(outcome.refusal._tag, 'TrustLauncherMissing')
})

Deno.test('status report renders unreadable rows without refusing', async () => {
  const workspace = makeFakeWorkspace({
    members: [
      { name: 'pkg-a', dir: 'packages/pkg-a', version: '1.0.0' },
      { name: 'pkg-b', dir: 'packages/pkg-b', version: '1.0.0' },
    ],
  })
  const registry = makeFakeRegistry({
    snapshots: {
      'pkg-a': { latest: '1.0.0', attested: true },
      'pkg-b': { latest: '1.0.0', attested: true, reachable: false },
    },
  })
  const { outcome } = await runStatus(statusRequest('report'), { workspace, registry })
  assert(outcome._tag === 'decided')
  assert(outcome.report.decision._tag === 'PublishStatusOwed')
  assertEquals(outcome.report.decision.unpublished, 0)
  assertEquals(outcome.report.decision.untrusted, 0)
  assertEquals(outcome.report.decision.stuck, 0)
  assertEquals(outcome.report.rows.length, 2)
  const errorRow = outcome.report.rows.find((row) => row.name === 'pkg-b')
  assertExists(errorRow)
  assertEquals(errorRow.class, 'error')
  assertEquals(errorRow.npm_latest, '?')
  assertEquals(outcome.report.deferred, [])
})

Deno.test('status check refuses an unreadable registry', async () => {
  const workspace = makeFakeWorkspace({
    members: [{ name: 'pkg-a', dir: 'packages/pkg-a', version: '1.0.0' }],
  })
  const registry = makeFakeRegistry({
    snapshots: { 'pkg-a': { latest: '1.0.0', attested: true, reachable: false } },
  })
  const { outcome } = await runStatus(statusRequest('check'), { workspace, registry })
  assert(outcome._tag === 'refused')
  assertEquals(outcome.refusal._tag, 'PublishStatusUnreadable')
})

Deno.test('status surfaces a registry port failure', async () => {
  const workspace = makeFakeWorkspace({
    members: [{ name: 'pkg-a', dir: 'packages/pkg-a', version: '1.0.0' }],
  })
  const registry = makeFakeRegistry({ queryFailures: ['pkg-a'] })
  const { outcome } = await runStatus(statusRequest('report'), { workspace, registry })
  assert(outcome._tag === 'refused')
  assertEquals(outcome.refusal._tag, 'TrustRegistryUnreadable')
})
