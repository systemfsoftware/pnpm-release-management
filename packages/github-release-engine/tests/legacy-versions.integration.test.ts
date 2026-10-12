import { Gherkin, Given, it, layer, makeFeature, Then, When } from '@systemfsoftware/effect-gherkin-spec'
import { compareVersions } from '@systemfsoftware/github-release-engine'
import { PackageVersion } from '@systemfsoftware/release-language'
import { Effect, Layer } from 'effect'
import { expect } from 'vitest'

const Feature = makeFeature({ it, layer })

type Pair = readonly [string, string]

const ordered = (pairs: ReadonlyArray<Pair>) =>
  Effect.succeed(
    pairs.map(([left, right]) =>
      [left, right, compareVersions(PackageVersion.make(left), PackageVersion.make(right))] as const
    ),
  )

const ascendingPairs = (ascending: ReadonlyArray<string>): ReadonlyArray<Pair> =>
  ascending.flatMap((lower, index) => ascending.slice(index + 1).map((higher): Pair => [lower, higher]))

const PRECEDENCE = [
  '1.0.0-alpha',
  '1.0.0-alpha.1',
  '1.0.0-alpha.beta',
  '1.0.0-beta',
  '1.0.0-beta.2',
  '1.0.0-beta.11',
  '1.0.0-rc.1',
  '1.0.0',
  '1.0.1-0',
]

Feature('Versions are ordered against the last release cut under a legacy tag scheme').body(({ scenario }) => {
  scenario(
    'A component with more digits is the larger number, not the earlier string',
    { scenarioLayer: Layer.empty },
    Gherkin.Do.pipe(
      Given('pairs whose larger version has a longer component')('pairs', () =>
        Effect.succeed<ReadonlyArray<Pair>>([
          ['0.10.0', '0.9.0'],
          ['1.0.10', '1.0.9'],
          ['10.0.0', '9.99.99'],
        ])),
      When('each pair is compared both ways')('run', (s) =>
        Effect.all({
          forward: ordered(s.pairs),
          backward: ordered(s.pairs.map(([left, right]): Pair => [right, left])),
        })),
      Then('the longer component wins in both directions')((s) =>
        Effect.sync(() => {
          expect(s.run.forward).toEqual([
            ['0.10.0', '0.9.0', 1],
            ['1.0.10', '1.0.9', 1],
            ['10.0.0', '9.99.99', 1],
          ])
          expect(s.run.backward).toEqual([
            ['0.9.0', '0.10.0', -1],
            ['1.0.9', '1.0.10', -1],
            ['9.99.99', '10.0.0', -1],
          ])
        })
      ),
    ),
  )

  scenario(
    'The same version compares equal, whatever build metadata it carries',
    { scenarioLayer: Layer.empty },
    Gherkin.Do.pipe(
      Given('pairs naming one version')('pairs', () =>
        Effect.succeed<ReadonlyArray<Pair>>([
          ['0.3.6', '0.3.6'],
          ['1.0.0-rc.1', '1.0.0-rc.1'],
          ['1.0.0+build.5', '1.0.0'],
          ['1.0.0-rc.1+a', '1.0.0-rc.1+b'],
        ])),
      When('each pair is compared')('run', (s) => ordered(s.pairs)),
      Then('every pair is equal')((s) =>
        Effect.sync(() => {
          expect(s.run).toEqual([
            ['0.3.6', '0.3.6', 0],
            ['1.0.0-rc.1', '1.0.0-rc.1', 0],
            ['1.0.0+build.5', '1.0.0', 0],
            ['1.0.0-rc.1+a', '1.0.0-rc.1+b', 0],
          ])
        })
      ),
    ),
  )

  scenario(
    'Pre-releases follow semver precedence and sort below their release',
    { scenarioLayer: Layer.empty },
    Gherkin.Do.pipe(
      Given('every ordered pair from the semver precedence example, plus the next patch pre-release')(
        'pairs',
        () => Effect.succeed(ascendingPairs(PRECEDENCE)),
      ),
      When('each pair is compared both ways')('run', (s) =>
        Effect.all({
          forward: ordered(s.pairs),
          backward: ordered(s.pairs.map(([left, right]): Pair => [right, left])),
        })),
      Then('the earlier version is lower every time')((s) =>
        Effect.sync(() => {
          expect(s.run.forward).toEqual(s.pairs.map(([left, right]) => [left, right, -1]))
          expect(s.run.backward).toEqual(s.pairs.map(([left, right]) => [right, left, 1]))
          expect(s.run.forward).toHaveLength(36)
        })
      ),
    ),
  )
})
