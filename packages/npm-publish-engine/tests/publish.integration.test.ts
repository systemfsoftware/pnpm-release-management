import { Cell } from '@systemfsoftware/effect-cell-types'
import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import {
  makeFakeCycleStore,
  makeFakeProcess,
  makeFakeRegistry,
  makeFakeWorkspace,
  publishPackagesCell,
  PublishRequest,
  publishStatusCell,
  stageNpmTrustCell,
  StatusRequest,
  TrustRequest,
} from '@systemfsoftware/npm-publish-engine'
import {
  PlanRefusal,
  PublishRefusal,
  PublishStatusRefusal,
  TrustRefusal,
  type WorkspaceCommand,
} from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import * as Match from 'effect/Match'
import * as S from 'effect/Schema'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

const registryUrl = 'https://registry.npmjs.org/'

const publishRequestOf = (
  overrides: Partial<S.Codec.Encoded<typeof PublishRequest>> = {},
): PublishRequest =>
  S.decodeUnknownSync(PublishRequest)({
    unpublishedOnly: false,
    registry: registryUrl,
    provenance: true,
    publishArgs: [],
    dryRun: false,
    ...overrides,
  })

const statusRequestOf = (mode: StatusRequest['mode']): StatusRequest => S.decodeUnknownSync(StatusRequest)({ mode })

const trustRequestOf = (
  overrides: Partial<S.Codec.Encoded<typeof TrustRequest>> = {},
): TrustRequest =>
  S.decodeUnknownSync(TrustRequest)({
    only: [],
    dryRun: false,
    registry: registryUrl,
    workflowFile: 'release.yml',
    slug: 'acme/repo',
    ...overrides,
  })

const renderedCalls = (calls: ReadonlyArray<WorkspaceCommand>): Array<string> =>
  calls.map((call) => `${call.program} ${call.args.join(' ')}`).sort()

const failUnexpected = (message: string): never => {
  throw new Error(message)
}

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

Feature('Publishing packages to the registry').body(({ scenario }) => {
  {
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
    const workspace = makeFakeWorkspace()
    const live = Layer.mergeAll(cycle.layer, registry.layer, process.layer, workspace.layer)
    scenario(
      'Unpublished packages are dispatched while published ones are skipped',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a captured cycle with one published and one unpublished package')(
          'input',
          () => Effect.succeed(publishRequestOf({ unpublishedOnly: true, capturedPath: 'cycle.json' })),
        ),
        When('publishing the unpublished remainder')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(publishPackagesCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('a single publish runs for the remainder')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.decision).pipe(
                Match.tag('PublishDispatched', (dispatched) => {
                  expect(`${dispatched.command.program} ${dispatched.command.args.join(' ')}`).toEqual(
                    'pnpm publish -r --provenance --access public --no-git-checks',
                  )
                }),
                Match.tag('PublishNothingOwed', () => failUnexpected('expected dispatched')),
                Match.tag('PublishDryRun', () => failUnexpected('expected dispatched')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected decided')),
            Match.exhaustive,
          )
          expect(process.calls.length).toEqual(1)
        }),
      ),
    )
  }

  {
    const cycle = makeFakeCycleStore()
    const registry = makeFakeRegistry()
    const process = makeFakeProcess()
    const workspace = makeFakeWorkspace()
    const live = Layer.mergeAll(cycle.layer, registry.layer, process.layer, workspace.layer)
    scenario(
      'A plain publish dispatches the whole workspace',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a workspace with no unpublished filter')(
          'input',
          () => Effect.succeed(publishRequestOf({ provenance: false })),
        ),
        When('publishing unconditionally')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(publishPackagesCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('a single publish runs without provenance')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.decision).pipe(
                Match.tag('PublishDispatched', (dispatched) => {
                  expect(`${dispatched.command.program} ${dispatched.command.args.join(' ')}`).toEqual(
                    'pnpm publish -r --access public --no-git-checks',
                  )
                }),
                Match.tag('PublishNothingOwed', () => failUnexpected('expected dispatched')),
                Match.tag('PublishDryRun', () => failUnexpected('expected dispatched')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected decided')),
            Match.exhaustive,
          )
          expect(process.calls.length).toEqual(1)
        }),
      ),
    )
  }

  {
    const cycle = makeFakeCycleStore({
      captured: { 'cycle.json': [{ name: 'pkg-a', version: '1.0.0' }] },
    })
    const registry = makeFakeRegistry({ published: ['pkg-a@1.0.0'] })
    const process = makeFakeProcess()
    const workspace = makeFakeWorkspace()
    const live = Layer.mergeAll(cycle.layer, registry.layer, process.layer, workspace.layer)
    scenario(
      'A fully published cycle settles without running anything',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a captured cycle where every version is already published')(
          'input',
          () => Effect.succeed(publishRequestOf({ unpublishedOnly: true, capturedPath: 'cycle.json' })),
        ),
        When('publishing the unpublished remainder')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(publishPackagesCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the run settles with nothing to do')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.decision).pipe(
                Match.tag('PublishNothingOwed', (settled) => {
                  expect(settled.packages).toEqual(1)
                }),
                Match.tag('PublishDispatched', () => failUnexpected('expected settled')),
                Match.tag('PublishDryRun', () => failUnexpected('expected settled')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected decided')),
            Match.exhaustive,
          )
          expect(process.calls.length).toEqual(0)
        }),
      ),
    )
  }

  {
    const cycle = makeFakeCycleStore({
      captured: { 'cycle.json': [{ name: 'pkg-a', version: '1.0.0' }] },
    })
    const registry = makeFakeRegistry()
    const process = makeFakeProcess()
    const workspace = makeFakeWorkspace()
    const live = Layer.mergeAll(cycle.layer, registry.layer, process.layer, workspace.layer)
    scenario(
      'A dry run previews the publish without executing it',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a captured cycle with a dry run requested')(
          'input',
          () => Effect.succeed(publishRequestOf({ unpublishedOnly: true, capturedPath: 'cycle.json', dryRun: true })),
        ),
        When('publishing in dry-run mode')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(publishPackagesCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the command is previewed and nothing runs')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.decision).pipe(
                Match.tag('PublishDryRun', (preview) => {
                  expect(`${preview.command.program} ${preview.command.args.join(' ')}`).toEqual(
                    'pnpm publish -r --provenance --access public --no-git-checks',
                  )
                }),
                Match.tag('PublishDispatched', () => failUnexpected('expected dry run')),
                Match.tag('PublishNothingOwed', () => failUnexpected('expected dry run')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected decided')),
            Match.exhaustive,
          )
          expect(process.calls.length).toEqual(0)
        }),
      ),
    )
  }

  {
    const cycle = makeFakeCycleStore()
    const registry = makeFakeRegistry()
    const process = makeFakeProcess()
    const workspace = makeFakeWorkspace()
    const live = Layer.mergeAll(cycle.layer, registry.layer, process.layer, workspace.layer)
    scenario(
      'An unpublished publish without a captured file is refused',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('an unpublished-only request naming no captured file')(
          'input',
          () => Effect.succeed(publishRequestOf({ unpublishedOnly: true })),
        ),
        When('publishing the unpublished remainder')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(publishPackagesCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the missing captured file is refused')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(PublishRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('PublishCapturedRequired', () => undefined),
                Match.tag('PublishFiltersUnreadable', () => failUnexpected('expected captured required')),
                Match.tag('PublishCommandRefused', () => failUnexpected('expected captured required')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected refused')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const cycle = makeFakeCycleStore()
    const registry = makeFakeRegistry()
    const process = makeFakeProcess()
    const workspace = makeFakeWorkspace()
    const live = Layer.mergeAll(cycle.layer, registry.layer, process.layer, workspace.layer)
    scenario(
      'Filter lines are threaded into the publish command',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('filter text with two exclusions and extra publish args')('input', () =>
          Effect.succeed(publishRequestOf({
            filtersPath: 'filters.txt',
            filtersText: '--filter=!pkg-x\n--filter=!pkg-y\n',
            publishArgs: ['--tag', 'next'],
          }))),
        When('publishing with filters')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(publishPackagesCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the filters and extra args appear in the command')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.decision).pipe(
                Match.tag('PublishDispatched', (dispatched) => {
                  expect(`${dispatched.command.program} ${dispatched.command.args.join(' ')}`).toEqual(
                    'pnpm publish -r --provenance --access public --no-git-checks --filter=!pkg-x --filter=!pkg-y --tag next',
                  )
                }),
                Match.tag('PublishNothingOwed', () => failUnexpected('expected dispatched')),
                Match.tag('PublishDryRun', () => failUnexpected('expected dispatched')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected decided')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const cycle = makeFakeCycleStore()
    const registry = makeFakeRegistry()
    const process = makeFakeProcess()
    const workspace = makeFakeWorkspace()
    const live = Layer.mergeAll(cycle.layer, registry.layer, process.layer, workspace.layer)
    scenario(
      'A filters path without its content is refused',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a filters path with no accompanying text')(
          'input',
          () => Effect.succeed(publishRequestOf({ filtersPath: 'filters.txt' })),
        ),
        When('publishing with filters')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(publishPackagesCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the unreadable filters are refused')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(PublishRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('PublishFiltersUnreadable', () => undefined),
                Match.tag('PublishCapturedRequired', () => failUnexpected('expected filters unreadable')),
                Match.tag('PublishCommandRefused', () => failUnexpected('expected filters unreadable')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected refused')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const cycle = makeFakeCycleStore({ malformed: ['cycle.json'] })
    const registry = makeFakeRegistry()
    const process = makeFakeProcess()
    const workspace = makeFakeWorkspace()
    const live = Layer.mergeAll(cycle.layer, registry.layer, process.layer, workspace.layer)
    scenario(
      'A malformed captured file surfaces a read refusal',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a captured file holding malformed text')(
          'input',
          () => Effect.succeed(publishRequestOf({ unpublishedOnly: true, capturedPath: 'cycle.json' })),
        ),
        When('publishing the unpublished remainder')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(publishPackagesCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the malformed file is refused')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(PlanRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('PlanCapturedMalformed', () => undefined),
                Match.tag('PlanDeferredUnknown', () => failUnexpected('expected captured malformed')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected refused')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
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
    const live = Layer.mergeAll(workspace.layer, registry.layer)
    scenario(
      'Owed members are reported with per-package rows',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('three packages with one owed, one stuck and one unpublished')(
          'input',
          () => Effect.succeed(statusRequestOf('report')),
        ),
        When('reporting publish status')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(publishStatusCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (report) => ({ _tag: 'decided' as const, report }),
            }),
        ),
        Then('the owed counts and rows are reported')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) => {
              Match.value(decided.report.decision).pipe(
                Match.tag('PublishStatusOwed', (owed) => {
                  expect(owed.unpublished).toEqual(1)
                  expect(owed.untrusted).toEqual(0)
                  expect(owed.stuck).toEqual(1)
                }),
                Match.tag('PublishStatusHealthy', () => failUnexpected('expected owed')),
                Match.exhaustive,
              )
              expect(decided.report.rows.length).toEqual(3)
              for (const row of decided.report.rows) {
                expect(Object.keys(row).sort()).toEqual([
                  'attested',
                  'class',
                  'local_version',
                  'name',
                  'npm_latest',
                  'publishConfig_provenance',
                ])
              }
              const byName: Record<string, (typeof decided.report.rows)[number] | undefined> = Object.fromEntries(
                decided.report.rows.map((row) => [row.name, row] as const),
              )
              expect(byName['pkg-a']?.class).toEqual('ok')
              expect(byName['pkg-a']?.npm_latest).toEqual('1.0.0')
              expect(byName['pkg-a']?.publishConfig_provenance).toEqual('yes')
              expect(byName['pkg-b']?.class).toEqual('stuck')
              expect(byName['pkg-c']?.class).toEqual('unpublished')
              expect(byName['pkg-c']?.npm_latest).toEqual('—')
              expect(byName['pkg-c']?.attested).toEqual('no')
              expect(decided.report.deferred.join(',')).toEqual('pkg-c')
            }),
            Match.tag('refused', () => failUnexpected('expected decided')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const workspace = makeFakeWorkspace({
      members: [{ name: 'pkg-a', dir: 'packages/pkg-a', version: '1.0.0' }],
    })
    const registry = makeFakeRegistry({
      snapshots: { 'pkg-a': { latest: '1.0.0', attested: true } },
    })
    const live = Layer.mergeAll(workspace.layer, registry.layer)
    scenario(
      'A current workspace reports healthy',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a package already current on the registry')('input', () => Effect.succeed(statusRequestOf('report'))),
        When('reporting publish status')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(publishStatusCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (report) => ({ _tag: 'decided' as const, report }),
            }),
        ),
        Then('the workspace reports healthy with no deferred')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) => {
              Match.value(decided.report.decision).pipe(
                Match.tag('PublishStatusHealthy', (healthy) => {
                  expect(healthy.packages).toEqual(1)
                }),
                Match.tag('PublishStatusOwed', () => failUnexpected('expected healthy')),
                Match.exhaustive,
              )
              expect(decided.report.deferred).toEqual([])
            }),
            Match.tag('refused', () => failUnexpected('expected decided')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const workspace = makeFakeWorkspace()
    const registry = makeFakeRegistry()
    const live = Layer.mergeAll(workspace.layer, registry.layer)
    scenario(
      'An empty workspace refuses the status report',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a workspace with no members')('input', () => Effect.succeed(statusRequestOf('report'))),
        When('reporting publish status')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(publishStatusCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (report) => ({ _tag: 'decided' as const, report }),
            }),
        ),
        Then('the empty workspace is refused')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(PublishStatusRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('PublishStatusEmpty', () => undefined),
                Match.tag('PublishStatusUnpublished', () => failUnexpected('expected empty')),
                Match.tag('PublishStatusUnattested', () => failUnexpected('expected empty')),
                Match.tag('PublishStatusUnreadable', () => failUnexpected('expected empty')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected refused')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const workspace = makeFakeWorkspace({
      members: [{ name: 'pkg-a', dir: 'packages/pkg-a', version: '1.0.0' }],
    })
    const registry = makeFakeRegistry({
      snapshots: { 'pkg-a': { latest: '1.0.0', attested: false } },
    })
    const live = Layer.mergeAll(workspace.layer, registry.layer)
    scenario(
      'Unattested members refuse the status check',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a member published without attestation')('input', () => Effect.succeed(statusRequestOf('check'))),
        When('checking publish status')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(publishStatusCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (report) => ({ _tag: 'decided' as const, report }),
            }),
        ),
        Then('the unattested member is refused')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(PublishStatusRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('PublishStatusUnattested', () => undefined),
                Match.tag('PublishStatusEmpty', () => failUnexpected('expected unattested')),
                Match.tag('PublishStatusUnpublished', () => failUnexpected('expected unattested')),
                Match.tag('PublishStatusUnreadable', () => failUnexpected('expected unattested')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected refused')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const workspace = makeFakeWorkspace({
      members: [{ name: 'pkg-a', dir: 'packages/pkg-a', version: '1.0.0' }],
    })
    const registry = makeFakeRegistry()
    const live = Layer.mergeAll(workspace.layer, registry.layer)
    scenario(
      'Unpublished members refuse the preflight check',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a member never published to the registry')('input', () => Effect.succeed(statusRequestOf('preflight'))),
        When('running the preflight check')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(publishStatusCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (report) => ({ _tag: 'decided' as const, report }),
            }),
        ),
        Then('the unpublished member is refused')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(PublishStatusRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('PublishStatusUnpublished', () => undefined),
                Match.tag('PublishStatusEmpty', () => failUnexpected('expected unpublished')),
                Match.tag('PublishStatusUnattested', () => failUnexpected('expected unpublished')),
                Match.tag('PublishStatusUnreadable', () => failUnexpected('expected unpublished')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected refused')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const workspace = makeFakeWorkspace({ members: [...trustMembers] })
    const registry = makeFakeRegistry({ snapshots: { ...trustSnapshots } })
    const process = makeFakeProcess()
    const live = Layer.mergeAll(workspace.layer, registry.layer, process.layer)
    scenario(
      'Debut and untrusted members are bootstrapped with trust',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a workspace with a debut and an untrusted member')(
          'input',
          () => Effect.succeed(trustRequestOf({ jobs: 2 })),
        ),
        When('bootstrapping registry trust')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(stageNpmTrustCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('both members are processed with one debut publish')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.decision).pipe(
                Match.tag('TrustComplete', (complete) => {
                  expect(complete.processed).toEqual(2)
                  expect(complete.debuts).toEqual(1)
                }),
                Match.tag('TrustIdle', () => failUnexpected('expected complete')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected decided')),
            Match.exhaustive,
          )
          expect(registry.publishCalls.length).toEqual(1)
          expect(registry.publishCalls.map((call) => call.name).join(',')).toEqual('debut-pkg')
          expect(registry.publishCalls.map((call) => call.provenance).join(',')).toEqual('false')
          expect(registry.isPublished('debut-pkg', '0.1.0')).toEqual(true)
          expect(renderedCalls(process.calls)).toEqual([
            'npm trust github debut-pkg --repo acme/repo --file release.yml --allow-publish --yes',
            'npm trust github tired-pkg --repo acme/repo --file release.yml --allow-publish --yes',
            'npm trust list debut-pkg',
            'npm trust list tired-pkg',
            'pnpm --filter debut-pkg build',
          ])
        }),
      ),
    )
  }

  {
    const workspace = makeFakeWorkspace({
      members: [{ name: 'fine-pkg', dir: 'packages/fine-pkg', version: '3.0.0' }],
    })
    const registry = makeFakeRegistry({
      snapshots: { 'fine-pkg': { latest: '3.0.0', attested: true } },
    })
    const process = makeFakeProcess()
    const live = Layer.mergeAll(workspace.layer, registry.layer, process.layer)
    scenario(
      'An attested workspace idles without doing anything',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a workspace where everything is already attested')('input', () => Effect.succeed(trustRequestOf())),
        When('bootstrapping registry trust')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(stageNpmTrustCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the run idles with no process or publish calls')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.decision).pipe(
                Match.tag('TrustIdle', () => undefined),
                Match.tag('TrustComplete', () => failUnexpected('expected idle')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected decided')),
            Match.exhaustive,
          )
          expect(process.calls.length).toEqual(0)
          expect(registry.publishCalls.length).toEqual(0)
        }),
      ),
    )
  }

  {
    const workspace = makeFakeWorkspace({ members: [...trustMembers] })
    const registry = makeFakeRegistry({ snapshots: { ...trustSnapshots } })
    const process = makeFakeProcess()
    const live = Layer.mergeAll(workspace.layer, registry.layer, process.layer)
    scenario(
      'A dry run completes without executing anything',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('owed members with a dry run requested')('input', () => Effect.succeed(trustRequestOf({ dryRun: true }))),
        When('bootstrapping registry trust')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(stageNpmTrustCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the run completes with no side effects')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) =>
              Match.value(decided.decision).pipe(
                Match.tag('TrustComplete', (complete) => {
                  expect(complete.processed).toEqual(2)
                }),
                Match.tag('TrustIdle', () => failUnexpected('expected complete')),
                Match.exhaustive,
              )),
            Match.tag('refused', () => failUnexpected('expected decided')),
            Match.exhaustive,
          )
          expect(process.calls.length).toEqual(0)
          expect(registry.publishCalls.length).toEqual(0)
        }),
      ),
    )
  }

  {
    const workspace = makeFakeWorkspace({ members: [...trustMembers] })
    const registry = makeFakeRegistry()
    const process = makeFakeProcess()
    const live = Layer.mergeAll(workspace.layer, registry.layer, process.layer)
    scenario(
      'An unmatched package filter is refused',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a package filter naming nothing in the workspace')(
          'input',
          () => Effect.succeed(trustRequestOf({ only: ['ghost-pkg'] })),
        ),
        When('bootstrapping registry trust')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(stageNpmTrustCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the unmatched filter is refused')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(TrustRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('TrustOnlyUnmatched', () => undefined),
                Match.tag('TrustWorkspaceEmpty', () => failUnexpected('expected only unmatched')),
                Match.tag('TrustRegistryUnreadable', () => failUnexpected('expected only unmatched')),
                Match.tag('TrustPublishRefused', () => failUnexpected('expected only unmatched')),
                Match.tag('TrustLauncherMissing', () => failUnexpected('expected only unmatched')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected refused')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const workspace = makeFakeWorkspace({ members: [...trustMembers] })
    const registry = makeFakeRegistry({ queryFailures: ['debut-pkg'] })
    const process = makeFakeProcess()
    const live = Layer.mergeAll(workspace.layer, registry.layer, process.layer)
    scenario(
      'An unreadable registry is refused',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a registry that fails package queries')('input', () => Effect.succeed(trustRequestOf())),
        When('bootstrapping registry trust')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(stageNpmTrustCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the unreadable registry is refused')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(TrustRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('TrustRegistryUnreadable', () => undefined),
                Match.tag('TrustWorkspaceEmpty', () => failUnexpected('expected unreadable')),
                Match.tag('TrustOnlyUnmatched', () => failUnexpected('expected unreadable')),
                Match.tag('TrustPublishRefused', () => failUnexpected('expected unreadable')),
                Match.tag('TrustLauncherMissing', () => failUnexpected('expected unreadable')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected refused')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const workspace = makeFakeWorkspace({ members: [...trustMembers] })
    const registry = makeFakeRegistry({
      snapshots: { ...trustSnapshots },
      publishFailures: ['debut-pkg'],
    })
    const process = makeFakeProcess()
    const live = Layer.mergeAll(workspace.layer, registry.layer, process.layer)
    scenario(
      'A failed debut publish is refused',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a debut member whose publish fails')('input', () => Effect.succeed(trustRequestOf())),
        When('bootstrapping registry trust')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(stageNpmTrustCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the failed publish names the package')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(TrustRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('TrustPublishRefused', (denied) => {
                  expect(denied.packages.map((name) => `${name}`).join(',')).toEqual('debut-pkg')
                }),
                Match.tag('TrustWorkspaceEmpty', () => failUnexpected('expected publish refused')),
                Match.tag('TrustOnlyUnmatched', () => failUnexpected('expected publish refused')),
                Match.tag('TrustRegistryUnreadable', () => failUnexpected('expected publish refused')),
                Match.tag('TrustLauncherMissing', () => failUnexpected('expected publish refused')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected refused')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const workspace = makeFakeWorkspace({ members: [...trustMembers] })
    const registry = makeFakeRegistry({ snapshots: { ...trustSnapshots } })
    const process = makeFakeProcess()
    const live = Layer.mergeAll(workspace.layer, registry.layer, process.layer)
    scenario(
      'A missing launcher for debuts is refused',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a debut member with a missing launcher manifest')(
          'input',
          () => Effect.succeed(trustRequestOf({ launcherManifest: 'dist/launcher.json' })),
        ),
        When('bootstrapping registry trust')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(stageNpmTrustCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (decision) => ({ _tag: 'decided' as const, decision }),
            }),
        ),
        Then('the missing launcher is refused')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(TrustRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('TrustLauncherMissing', () => undefined),
                Match.tag('TrustWorkspaceEmpty', () => failUnexpected('expected launcher missing')),
                Match.tag('TrustOnlyUnmatched', () => failUnexpected('expected launcher missing')),
                Match.tag('TrustRegistryUnreadable', () => failUnexpected('expected launcher missing')),
                Match.tag('TrustPublishRefused', () => failUnexpected('expected launcher missing')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected refused')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
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
    const live = Layer.mergeAll(workspace.layer, registry.layer)
    scenario(
      'Unreadable rows render without refusing the report',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a member whose registry entry is unreachable')('input', () => Effect.succeed(statusRequestOf('report'))),
        When('reporting publish status')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(publishStatusCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (report) => ({ _tag: 'decided' as const, report }),
            }),
        ),
        Then('the report carries an error row with no deferred')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('decided', (decided) => {
              Match.value(decided.report.decision).pipe(
                Match.tag('PublishStatusOwed', (owed) => {
                  expect(owed.unpublished).toEqual(0)
                  expect(owed.untrusted).toEqual(0)
                  expect(owed.stuck).toEqual(0)
                }),
                Match.tag('PublishStatusHealthy', () => failUnexpected('expected owed')),
                Match.exhaustive,
              )
              expect(decided.report.rows.length).toEqual(2)
              expect(decided.report.rows.find((row) => row.name === 'pkg-b')?.class).toEqual('error')
              expect(decided.report.rows.find((row) => row.name === 'pkg-b')?.npm_latest).toEqual('?')
              expect(decided.report.deferred).toEqual([])
            }),
            Match.tag('refused', () => failUnexpected('expected decided')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const workspace = makeFakeWorkspace({
      members: [{ name: 'pkg-a', dir: 'packages/pkg-a', version: '1.0.0' }],
    })
    const registry = makeFakeRegistry({
      snapshots: { 'pkg-a': { latest: '1.0.0', attested: true, reachable: false } },
    })
    const live = Layer.mergeAll(workspace.layer, registry.layer)
    scenario(
      'An unreadable registry refuses the status check',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a member whose registry entry is unreachable')('input', () => Effect.succeed(statusRequestOf('check'))),
        When('checking publish status')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(publishStatusCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (report) => ({ _tag: 'decided' as const, report }),
            }),
        ),
        Then('the unreadable registry is refused')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(PublishStatusRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('PublishStatusUnreadable', () => undefined),
                Match.tag('PublishStatusEmpty', () => failUnexpected('expected unreadable')),
                Match.tag('PublishStatusUnpublished', () => failUnexpected('expected unreadable')),
                Match.tag('PublishStatusUnattested', () => failUnexpected('expected unreadable')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected refused')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }

  {
    const workspace = makeFakeWorkspace({
      members: [{ name: 'pkg-a', dir: 'packages/pkg-a', version: '1.0.0' }],
    })
    const registry = makeFakeRegistry({ queryFailures: ['pkg-a'] })
    const live = Layer.mergeAll(workspace.layer, registry.layer)
    scenario(
      'A registry port failure surfaces as a trust refusal',
      { scenarioLayer: live },
      Gherkin.Do.pipe(
        Given('a registry that fails package queries')('input', () => Effect.succeed(statusRequestOf('report'))),
        When('reporting publish status')(
          'outcome',
          (s) =>
            Effect.match(Cell.run(Cell.provide(publishStatusCell, live), s.input), {
              onFailure: (refusal) => ({ _tag: 'refused' as const, refusal }),
              onSuccess: (report) => ({ _tag: 'decided' as const, report }),
            }),
        ),
        Then('the port failure is refused as unreadable')((s) => {
          Match.value(s.outcome).pipe(
            Match.tag('refused', (refused) => {
              const refusal = S.decodeUnknownSync(TrustRefusal)(refused.refusal)
              Match.value(refusal).pipe(
                Match.tag('TrustRegistryUnreadable', () => undefined),
                Match.tag('TrustWorkspaceEmpty', () => failUnexpected('expected unreadable')),
                Match.tag('TrustOnlyUnmatched', () => failUnexpected('expected unreadable')),
                Match.tag('TrustPublishRefused', () => failUnexpected('expected unreadable')),
                Match.tag('TrustLauncherMissing', () => failUnexpected('expected unreadable')),
                Match.exhaustive,
              )
            }),
            Match.tag('decided', () => failUnexpected('expected refused')),
            Match.exhaustive,
          )
        }),
      ),
    )
  }
})
