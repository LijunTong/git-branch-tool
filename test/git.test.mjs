import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GitError,
  createBranch,
  deleteBranch,
  detectRepo,
  initRepo,
  readState,
  switchBranch,
} from '../lib/git.js'

const STATUS_BRANCH = [
  '# branch.oid 0123456789abcdef0123456789abcdef01234567',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 aaaa bbbb src/a.js',
  '1 M. N... 100644 100644 100644 cccc dddd src/b.js',
  '? src/new.js',
].join('\n')

const REFS = [
  ['refs/heads/main', 'main', 'origin/main', '[ahead 2, behind 1]', '2026-01-02T03:04:05+08:00', 'abc1234', 'feat: latest'].join('\u0000'),
  ['refs/heads/feature/login', 'feature/login', '', '', '2025-12-01T00:00:00+08:00', 'def5678', 'wip login'].join('\u0000'),
  ['refs/remotes/origin/main', 'origin/main', '', '', '2026-01-02T03:04:05+08:00', 'abc1234', 'feat: latest'].join('\u0000'),
  ['refs/remotes/origin/HEAD', 'origin/HEAD', '', '', '', 'abc1234', ''].join('\u0000'),
  ['refs/remotes/origin/feature/pay', 'origin/feature/pay', '', '', '2025-11-11T00:00:00+08:00', 'aaa1111', 'pay'].join('\u0000'),
].join('\n')

/**
 * A fake `run(args)` that answers from a table and records every call.
 * `handler` receives the argument array and returns `{ code, stdout, stderr }`.
 */
function makeRunner(handler) {
  const calls = []
  const run = async (args) => {
    calls.push(args)
    const result = handler(args, calls)
    return { code: 0, stdout: '', stderr: '', ...(result ?? {}) }
  }
  return { run, calls }
}

const repoHandler = (args) => {
  const joined = args.join(' ')
  if (joined === 'rev-parse --show-toplevel') return { stdout: 'E:/repo\n' }
  if (joined === 'status --porcelain=v2 --branch --untracked-files=normal') return { stdout: STATUS_BRANCH }
  if (args[0] === 'for-each-ref') return { stdout: REFS }
  if (args[0] === 'remote') return { stdout: 'origin\n' }
  return {}
}

test('detectRepo returns the worktree root', async () => {
  const { run, calls } = makeRunner(repoHandler)
  const repo = await detectRepo(run, 'E:/repo/sub')
  assert.equal(repo.root, 'E:/repo')
  assert.deepEqual(calls[0], ['rev-parse', '--show-toplevel'])
})

test('detectRepo raises NOT_A_REPO outside a repository', async () => {
  const { run } = makeRunner(() => ({ code: 128, stderr: 'fatal: not a git repository (or any of the parent directories)' }))
  await assert.rejects(
    () => detectRepo(run, 'E:/plain'),
    (error) => error instanceof GitError && error.code === 'NOT_A_REPO',
  )
})

test('readState parses branch, dirty buckets and both ref groups', async () => {
  const { run } = makeRunner(repoHandler)
  const state = await readState(run, 'E:/repo')
  assert.equal(state.root, 'E:/repo')
  assert.equal(state.current, 'main')
  assert.equal(state.detached, false)
  assert.equal(state.upstream, 'origin/main')
  assert.equal(state.ahead, 2)
  assert.equal(state.behind, 1)
  assert.deepEqual(state.dirty, { total: 3, staged: 1, unstaged: 1, untracked: 1 })
  assert.deepEqual(state.branches.map((branch) => branch.name), [
    'main',
    'feature/login',
    'origin/main',
    'origin/feature/pay',
  ])
  const main = state.branches[0]
  assert.equal(main.current, true)
  assert.equal(main.ahead, 2)
  assert.equal(main.behind, 1)
  assert.equal(main.sha, 'abc1234')
  assert.equal(main.subject, 'feat: latest')
  assert.equal(state.branches[2].remote, true)
  assert.equal(state.localCount, 2)
  assert.equal(state.remoteCount, 2)
})

test('readState reports a detached HEAD and an initial (empty) repository', async () => {
  const detached = makeRunner((args) => {
    const joined = args.join(' ')
    if (joined === 'rev-parse --show-toplevel') return { stdout: 'E:/repo\n' }
    if (joined.startsWith('status')) {
      return { stdout: ['# branch.oid 9f9f9f', '# branch.head (detached)'].join('\n') }
    }
    return { stdout: '' }
  })
  const state = await readState(detached.run, 'E:/repo')
  assert.equal(state.detached, true)
  assert.equal(state.current, '')
  assert.deepEqual(state.branches, [])

  const empty = makeRunner((args) => {
    if (args.join(' ') === 'rev-parse --show-toplevel') return { stdout: 'E:/repo\n' }
    if (args[0] === 'status') return { stdout: ['# branch.oid (initial)', '# branch.head main'].join('\n') }
    return { stdout: '' }
  })
  const emptyState = await readState(empty.run, 'E:/repo')
  assert.equal(emptyState.current, 'main')
  assert.equal(emptyState.detached, false)
  assert.equal(emptyState.dirty.total, 0)
})

test('switchBranch uses an existing local branch as is', async () => {
  const { run, calls } = makeRunner((args) => {
    if (args.join(' ') === 'rev-parse --show-toplevel') return { stdout: 'E:/repo\n' }
    if (args[0] === 'show-ref') return { code: 0 }
    return {}
  })
  const result = await switchBranch(run, 'E:/repo', 'feature/login')
  assert.deepEqual(result, { branch: 'feature/login', tracked: false })
  assert.deepEqual(calls[calls.length - 1], ['switch', '--no-guess', 'feature/login'])
})

test('switchBranch tracks a remote-only branch', async () => {
  const calls = []
  const run = async (args) => {
    calls.push(args)
    if (args.join(' ') === 'rev-parse --show-toplevel') return { code: 0, stdout: 'E:/repo\n', stderr: '' }
    if (args[0] === 'show-ref') {
      const ref = args[3]
      if (ref === 'refs/remotes/origin/feature/pay') return { code: 0, stdout: '', stderr: '' }
      return { code: 1, stdout: '', stderr: '' }
    }
    if (args[0] === 'remote') return { code: 0, stdout: 'origin\n', stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
  const result = await switchBranch(run, 'E:/repo', 'feature/pay')
  assert.deepEqual(result, { branch: 'feature/pay', tracked: true, remote: 'origin' })
  assert.deepEqual(calls[calls.length - 1], ['switch', '--no-guess', '-c', 'feature/pay', '--track', 'origin/feature/pay'])
})

test('switchBranch surfaces a missing branch', async () => {
  const { run } = makeRunner((args) => {
    if (args.join(' ') === 'rev-parse --show-toplevel') return { stdout: 'E:/repo\n' }
    if (args[0] === 'show-ref') return { code: 1 }
    if (args[0] === 'remote') return { stdout: 'origin\n' }
    return {}
  })
  await assert.rejects(
    () => switchBranch(run, 'E:/repo', 'nope'),
    (error) => error instanceof GitError && error.code === 'NO_SUCH_BRANCH',
  )
})

test('switchBranch reports the first line of a refusal', async () => {
  const { run } = makeRunner((args) => {
    if (args.join(' ') === 'rev-parse --show-toplevel') return { stdout: 'E:/repo\n' }
    if (args[0] === 'show-ref') return { code: 0 }
    if (args[0] === 'switch') {
      return { code: 1, stderr: 'error: Your local changes to the following files would be overwritten\nmore' }
    }
    return {}
  })
  await assert.rejects(
    () => switchBranch(run, 'E:/repo', 'main'),
    (error) =>
      error instanceof GitError
      && error.code === 'SWITCH_FAILED'
      && error.message === 'error: Your local changes to the following files would be overwritten',
  )
})

test('createBranch validates the name and the start point', async () => {
  const { run, calls } = makeRunner((args) => {
    if (args.join(' ') === 'rev-parse --show-toplevel') return { stdout: 'E:/repo\n' }
    if (args[0] === 'check-ref-format') return { code: 0 }
    if (args[0] === 'show-ref') return { code: 1 }
    return {}
  })
  const result = await createBranch(run, 'E:/repo', 'feature/x', 'main')
  assert.deepEqual(result, { branch: 'feature/x', from: 'main' })
  assert.deepEqual(calls[calls.length - 1], ['switch', '-c', 'feature/x', 'main'])
})

test('createBranch rejects unsafe names before touching git', async () => {
  for (const name of ['', '  ', '-x', 'a b', 'x..y', '@{1}']) {
    const { run, calls } = makeRunner(() => ({ stdout: 'E:/repo\n' }))
    await assert.rejects(
      () => createBranch(run, 'E:/repo', name),
      (error) => error instanceof GitError && error.code === 'INVALID_NAME',
      `expected ${JSON.stringify(name)} to be rejected`,
    )
    assert.equal(calls.length, 0, `${JSON.stringify(name)} must not reach git`)
  }
})

test('createBranch refuses an existing local branch', async () => {
  const { run } = makeRunner((args) => {
    if (args.join(' ') === 'rev-parse --show-toplevel') return { stdout: 'E:/repo\n' }
    if (args[0] === 'check-ref-format') return { code: 0 }
    if (args[0] === 'show-ref') return { code: 0 }
    return {}
  })
  await assert.rejects(
    () => createBranch(run, 'E:/repo', 'main'),
    (error) => error instanceof GitError && error.code === 'BRANCH_EXISTS',
  )
})

test('initRepo initializes only when the directory is not a repository', async () => {
  let isRepo = false
  const { run, calls } = makeRunner((args) => {
    const joined = args.join(' ')
    if (joined === 'rev-parse --show-toplevel') {
      return isRepo ? { stdout: 'E:/plain\n' } : { code: 128, stderr: 'fatal: not a git repository' }
    }
    if (joined === 'init') {
      isRepo = true
      return { stdout: 'Initialized empty Git repository in E:/plain/.git/\n' }
    }
    if (args[0] === 'status') return { stdout: ['# branch.oid (initial)', '# branch.head main'].join('\n') }
    return { stdout: '' }
  })
  const created = await initRepo(run, 'E:/plain')
  assert.equal(created.created, true)
  assert.equal(created.root, 'E:/plain')
  assert.ok(calls.some((args) => args.join(' ') === 'init'))

  const again = await initRepo(run, 'E:/plain')
  assert.equal(again.created, false)
  assert.equal(calls.filter((args) => args.join(' ') === 'init').length, 1)
})

test('deleteBranch uses the safe delete and surfaces refusals', async () => {
  const ok = makeRunner((args) => {
    if (args.join(' ') === 'rev-parse --show-toplevel') return { stdout: 'E:/repo\n' }
    if (args[0] === 'check-ref-format') return { code: 0 }
    return {}
  })
  assert.deepEqual(await deleteBranch(ok.run, 'E:/repo', 'feature/old'), { branch: 'feature/old' })
  assert.deepEqual(ok.calls[ok.calls.length - 1], ['branch', '-d', 'feature/old'])

  const refused = makeRunner((args) => {
    if (args.join(' ') === 'rev-parse --show-toplevel') return { stdout: 'E:/repo\n' }
    if (args[0] === 'check-ref-format') return { code: 0 }
    if (args[0] === 'branch') return { code: 1, stderr: "error: the branch 'x' is not fully merged" }
    return {}
  })
  await assert.rejects(
    () => deleteBranch(refused.run, 'E:/repo', 'x'),
    (error) => error instanceof GitError && error.code === 'DELETE_FAILED',
  )
})
