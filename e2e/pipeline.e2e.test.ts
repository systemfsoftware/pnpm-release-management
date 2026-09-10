import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { fromFileUrl, join } from '@std/path'
import { headSha, MEMBERS, setupFixture } from './fixture.ts'
import { FIXTURE, type World } from './harness.ts'
import { Session } from './session.ts'

const REPO_ROOT = fromFileUrl(new URL('../', import.meta.url))

const stamp = (): string => new Date().toISOString().replace(/[:.]/g, '-')

const readVersion = async (world: World, name: string): Promise<string> => {
  const raw = await world.read(`${FIXTURE}/packages/${name}/package.json`)
  return JSON.parse(raw).version as string
}

const jsonLines = <T>(stdout: string): T[] =>
  stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line) as T)

const releaseFor = <T>(world: World, tag: string) =>
  world.github<T>(`/repos/admin/fixture/releases/tags/${encodeURIComponent(tag)}`)

Deno.test('pnpm release management, end to end', async () => {
  const artifacts = join(REPO_ROOT, 'e2e', '.artifacts', stamp())
  await Deno.mkdir(artifacts, { recursive: true })

  const session = await Session.open({
    repoRoot: REPO_ROOT,
    artifacts,
    filter: Deno.env.get('E2E_FILTER'),
    keep: Deno.env.get('E2E_KEEP') === '1',
  })

  let base = ''

  try {
    await session.phase('fixture is a two package pnpm workspace with tags for 1.0.0', async (world) => {
      await setupFixture(world)
      base = await headSha(world)
    })

    await session.phase('gate refuses a publishable change with no intent', async (world) => {
      await world.write(`${FIXTURE}/packages/alpha/index.js`, 'export const alpha = 2\n')
      await world.must('git add -A && git commit -q -m "feat: alpha grows"', { cwd: FIXTURE })

      const blocked = await world.tool('changeset-management', 'check', base)
      assertEquals(blocked.code, 1, `expected the gate to fail\n${blocked.stdout}${blocked.stderr}`)
      assertStringIncludes(`${blocked.stdout}${blocked.stderr}`, '@e2e/alpha')
    })

    await session.phase('gate passes once an intent names the package', async (world) => {
      const created = await world.tool(
        'changeset-management',
        'new',
        '@e2e/alpha --bump minor --summary "alpha grows a public export" --slug alpha-grows',
      )
      assertEquals(created.code, 0, `changeset-new failed\n${created.stdout}${created.stderr}`)
      await world.must('git add -A && git commit -q -m "chore: changeset"', { cwd: FIXTURE })

      const passed = await world.tool('changeset-management', 'check', base)
      assertEquals(passed.code, 0, `expected the gate to pass\n${passed.stdout}${passed.stderr}`)
      assertStringIncludes(`${passed.stdout}${passed.stderr}`, '@e2e/alpha')
    })

    await session.phase('plan asks for a version step', async (world) => {
      const planned = await world.tool('github-release-management', 'plan')
      const output = `${planned.stdout}${planned.stderr}`
      assertEquals(planned.code, 0, output)
      assertStringIncludes(output, 'pending_intents=1')
      assertStringIncludes(output, 'this_cycle=0')
      assertStringIncludes(output, 'phase=version')
    })

    await session.phase('version step bumps surfaces, writes changelogs, consumes intents', async (world) => {
      const versioned = await world.tool('version-management', 'bump')
      assertEquals(versioned.code, 0, `release-version failed\n${versioned.stdout}${versioned.stderr}`)

      assertEquals(await readVersion(world, 'alpha'), '1.1.0')
      assertEquals(await readVersion(world, 'beta'), '1.1.0')

      const rootManifest = await world.read(`${FIXTURE}/package.json`)
      assertStringIncludes(rootManifest, '"version": "1.1.0"', rootManifest)

      const alphaChangelog = await world.read(`${FIXTURE}/.changeset/changelogs/@e2e!alpha@1.1.0.md`)
      assertStringIncludes(alphaChangelog, 'alpha grows a public export', alphaChangelog)

      const betaChangelog = await world.read(`${FIXTURE}/.changeset/changelogs/@e2e!beta@1.1.0.md`)
      assert(betaChangelog.trim().length > betaChangelog.split('\n')[0].length, betaChangelog)

      assertStringIncludes(await world.read(`${FIXTURE}/CHANGELOG.md`), '## 1.1.0')

      const leftover = (await world.must('ls .changeset', { cwd: FIXTURE })).stdout
      assertEquals(leftover.trim().split('\n').sort().join(','), 'README.md,changelogs')

      await world.must('git add -A && git commit -q -m "chore(release): version packages"', {
        cwd: FIXTURE,
      })
    })

    await session.phase('plan asks for a publish step', async (world) => {
      const planned = await world.tool('github-release-management', 'plan')
      const output = `${planned.stdout}${planned.stderr}`
      assertEquals(planned.code, 0, output)
      assertStringIncludes(output, 'pending_intents=0')
      assertStringIncludes(output, `this_cycle=${MEMBERS.length}`)
      assertStringIncludes(output, 'phase=publish')
    })

    await session.phase('publish lands both packages on the registry', async (world) => {
      const published = await world.tool('npm-publish-management', 'publish')
      assertEquals(published.code, 0, `pnpm publish failed\n${published.stdout}${published.stderr}`)

      const status = await world.tool('npm-publish-management', 'status', '--json')
      assertEquals(status.code, 0, `publish-status failed\n${status.stdout}${status.stderr}`)

      const rows = jsonLines<{ name: string; local_version: string; npm_latest: string; class: string }>(
        status.stdout,
      )
      assertEquals(rows.length, MEMBERS.length, `status rows:\n${status.stdout}`)
      for (const row of rows) {
        assertEquals(row.local_version, '1.1.0', JSON.stringify(row))
        assertEquals(row.npm_latest, '1.1.0', JSON.stringify(row))
        assertEquals(row.class, 'no-oidc', JSON.stringify(row))
      }
    })

    await session.phase('captured set is written for the later steps', async (world) => {
      const captured = await world.tool(
        'github-release-management',
        'tag',
        '--output /tmp/captured.json',
      )
      const output = `${captured.stdout}${captured.stderr}`
      assertEquals(captured.code, 0, output)
      assertStringIncludes(output, `wrote ${MEMBERS.length} captured package(s)`)

      const tags = (await world.must('git ls-remote --tags origin', { cwd: FIXTURE })).stdout
      assert(!tags.includes('@v1.1.0'), `capturing must not push tags, origin has:\n${tags}`)

      const written = JSON.parse(await world.read('/tmp/captured.json')) as Array<{ tag: string }>
      assertEquals(written.map((entry) => entry.tag), MEMBERS.map((member) => `${member}@v1.1.0`))
    })

    await session.phase('GitHub releases carry the generated changelog', async (world) => {
      const created = await world.tool(
        'github-release-management',
        'release',
        '--captured /tmp/captured.json',
      )
      const output = `${created.stdout}${created.stderr}`
      assertEquals(created.code, 0, `create-github-releases failed\n${output}`)
      assertStringIncludes(output, `created ${MEMBERS.length} release(s)`)

      const release = await releaseFor<{ tag_name: string; body: string; make_latest: unknown }>(
        world,
        '@e2e/alpha@v1.1.0',
      )
      assertEquals(release.status, 200, JSON.stringify(release.body))
      assertStringIncludes(release.body?.body ?? '', 'alpha grows a public export')

      const all = await world.github<unknown[]>('/repos/admin/fixture/releases?per_page=100')
      assertEquals(all.body?.length, MEMBERS.length, JSON.stringify(all.body))

      for (const member of MEMBERS) {
        const found = await releaseFor<{ tag_name: string }>(world, `${member}@v1.1.0`)
        assertEquals(found.status, 200, `${member} has no release: ${JSON.stringify(found.body)}`)
      }
    })

    await session.phase('creating releases twice creates nothing', async (world) => {
      const again = await world.tool(
        'github-release-management',
        'release',
        '--captured /tmp/captured.json',
      )
      const output = `${again.stdout}${again.stderr}`
      assertEquals(again.code, 0, output)
      assertStringIncludes(output, `created 0 release(s), skipped ${MEMBERS.length}`)

      const all = await world.github<unknown[]>('/repos/admin/fixture/releases?per_page=100')
      assertEquals(all.body?.length, MEMBERS.length, JSON.stringify(all.body))
    })

    await session.phase('tagging pushes one tag per captured package', async (world) => {
      const tagged = await world.tool(
        'github-release-management',
        'tag',
        '--captured /tmp/captured.json',
      )
      assertEquals(tagged.code, 0, `tagging failed\n${tagged.stdout}${tagged.stderr}`)

      const tags = (await world.must('git ls-remote --tags origin', { cwd: FIXTURE })).stdout
      for (const member of MEMBERS) assertStringIncludes(tags, `${member}@v1.1.0`, tags)
    })

    await session.phase('plan is empty once tags exist', async (world) => {
      const planned = await world.tool('github-release-management', 'plan')
      const output = `${planned.stdout}${planned.stderr}`
      assertEquals(planned.code, 0, output)
      assertStringIncludes(output, 'this_cycle=0')
      assertStringIncludes(output, 'phase=none')
    })

    await session.phase('release PR opens with the release label', async (world) => {
      const created = await world.tool(
        'changeset-management',
        'new',
        '@e2e/beta --bump patch --summary "beta stops dropping the last frame" --slug beta-fix',
      )
      assertEquals(created.code, 0, `${created.stdout}${created.stderr}`)

      const opened = await world.tool('github-release-management', 'pr')
      assertEquals(opened.code, 0, `open-release-pr failed\n${opened.stdout}${opened.stderr}`)
      assertStringIncludes(`${opened.stdout}${opened.stderr}`, 'created release PR #')

      const pulls = await world.github<Array<{ title: string; labels: Array<{ name: string }> }>>(
        '/repos/admin/fixture/pulls?state=open',
      )
      assertEquals(pulls.body?.length, 1, JSON.stringify(pulls.body))
      assertEquals(pulls.body?.[0].title, 'chore(release): version packages')
      assertEquals(pulls.body?.[0].labels.map((label) => label.name), ['release'])
    })

    await session.phase('release PR closes when no intents remain', async (world) => {
      const closed = await world.tool('github-release-management', 'pr')
      assertEquals(closed.code, 0, `open-release-pr failed\n${closed.stdout}${closed.stderr}`)
      assertStringIncludes(`${closed.stdout}${closed.stderr}`, 'closed release PR #')

      const pulls = await world.github<unknown[]>('/repos/admin/fixture/pulls?state=open')
      assertEquals(pulls.body?.length, 0, JSON.stringify(pulls.body))
    })
  } finally {
    await session.close()
  }
})
