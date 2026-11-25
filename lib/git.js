/**
 * dsh-git-branch - git core.
 *
 * Pure: every function receives a `run(args)` adapter and never imports a DSH
 * package, so the whole module is testable with a fake runner.
 *
 * run(args: string[]) => Promise<{ code: number, stdout: string, stderr: string }>
 * where `args` are git arguments (no leading 'git').
 */

export class GitError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.name = 'GitError'
    this.code = code
    if (detail !== undefined) this.detail = detail
  }
}

const MAX_OUTPUT_BYTES = 512 * 1024
const MAX_ERROR_BYTES = 64 * 1024

export const outputLimits = { stdout: MAX_OUTPUT_BYTES, stderr: MAX_ERROR_BYTES }

/** First non-empty line of a git error, trimmed to a readable length. */
export function firstLine(text) {
  if (typeof text !== 'string') return ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line !== '') return line.length > 300 ? line.slice(0, 300) : line
  }
  return ''
}

/**
 * `git switch` refuses to start when the target tree would overwrite local work.
 * It prints a header line, one tab-indented path per blocked file, then a
 * trailer. Parsing that list lets the caller explain the problem in the user's
 * language instead of relaying an English paragraph.
 */
export function parseOverwriteConflict(text) {
  if (typeof text !== 'string') return undefined
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index]
    if (!header.includes('would be overwritten by')) continue
    const untracked = header.toLowerCase().includes('untracked')
    const files = []
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next]
      if (!line.startsWith('\t')) break
      const name = line.slice(1).trim()
      if (name !== '') files.push(name)
    }
    if (files.length === 0) continue
    return { untracked, files }
  }
  return undefined
}

/** Human-readable form of a `parseOverwriteConflict` result. */
export function describeOverwriteConflict(conflict, branch) {
  const names = conflict.files.map((file) => `「${file}」`).join('、')
  if (conflict.untracked) {
    return `未跟踪文件${names}会被 ${branch} 覆盖；请先移动、删除或加入 .gitignore，再创建分支`
  }
  return `本地改动${names}尚未提交，会被 ${branch} 覆盖；请先提交或 stash，再创建分支`
}

/**
 * `git rev-parse --show-toplevel` is the only reliable repository probe: it
 * reports the worktree root (so a subdirectory of a repository is recognized)
 * and fails with a distinct message outside a repository.
 */
export async function detectRepo(run, cwd) {
  const result = await run(['rev-parse', '--show-toplevel'])
  if (result.code !== 0) {
    throw new GitError('NOT_A_REPO', '当前目录不是 Git 仓库', firstLine(result.stderr))
  }
  const root = result.stdout.trim()
  if (root === '') throw new GitError('NOT_A_REPO', '当前目录不是 Git 仓库')
  return { root, cwd }
}

/** `git init` in the given directory. Idempotent: an existing repository is reported, not re-initialized. */
export async function initRepo(run, cwd) {
  try {
    const existing = await detectRepo(run, cwd)
    return { created: false, root: existing.root }
  } catch (error) {
    if (!(error instanceof GitError) || error.code !== 'NOT_A_REPO') throw error
  }
  const result = await run(['init'])
  if (result.code !== 0) {
    throw new GitError('INIT_FAILED', firstLine(result.stderr) || 'git init 失败', firstLine(result.stderr))
  }
  const detected = await detectRepo(run, cwd)
  return { created: true, root: detected.root }
}

function parseTrack(track) {
  // `%(upstream:track)` renders `[ahead 1, behind 2]`, `[gone]`, or nothing.
  const value = typeof track === 'string' ? track.trim() : ''
  if (value === '') return { ahead: 0, behind: 0, gone: false }
  if (value === '[gone]') return { ahead: 0, behind: 0, gone: true }
  const ahead = /ahead (\d+)/.exec(value)
  const behind = /behind (\d+)/.exec(value)
  return {
    ahead: ahead === null ? 0 : Number(ahead[1]),
    behind: behind === null ? 0 : Number(behind[1]),
    gone: false,
  }
}

const REF_FORMAT = [
  '%(refname)',
  '%(refname:short)',
  '%(upstream:short)',
  '%(upstream:track)',
  '%(committerdate:iso-strict)',
  '%(objectname:short)',
  '%(contents:subject)',
].join('%00')

/**
 * Full view of the repository: current branch, dirty buckets, local and remote
 * branches ordered by commit date (git sorts, we only group).
 */
export async function readState(run, cwd) {
  const repo = await detectRepo(run, cwd)
  const status = await run(['status', '--porcelain=v2', '--branch', '--untracked-files=normal'])
  if (status.code !== 0) {
    throw new GitError('STATUS_FAILED', firstLine(status.stderr) || 'git status 失败', firstLine(status.stderr))
  }

  let current = ''
  let head = ''
  let upstream = ''
  let ahead = 0
  let behind = 0
  let staged = 0
  let unstaged = 0
  let untracked = 0

  for (const raw of status.stdout.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line === '') continue
    if (line.startsWith('# ')) {
      const body = line.slice(2)
      if (body.startsWith('branch.oid ')) head = body.slice('branch.oid '.length).trim()
      else if (body.startsWith('branch.head ')) current = body.slice('branch.head '.length).trim()
      else if (body.startsWith('branch.upstream ')) upstream = body.slice('branch.upstream '.length).trim()
      else if (body.startsWith('branch.ab ')) {
        const match = /\+(\d+)\s+-(\d+)/.exec(body)
        if (match !== null) {
          ahead = Number(match[1])
          behind = Number(match[2])
        }
      }
      continue
    }
    const kind = line[0]
    if (kind === '1' || kind === '2') {
      const xy = line.slice(2, 4)
      if (xy[0] !== undefined && xy[0] !== '.') staged += 1
      if (xy[1] !== undefined && xy[1] !== '.') unstaged += 1
    } else if (kind === 'u') {
      staged += 1
      unstaged += 1
    } else if (kind === '?') {
      untracked += 1
    }
  }

  const detached = current === '(detached)' || current === ''
  const refs = await run([
    'for-each-ref',
    '--sort=-committerdate',
    `--format=${REF_FORMAT}`,
    'refs/heads',
    'refs/remotes',
  ])

  const local = []
  const remote = []
  for (const raw of refs.stdout.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line === '') continue
    const fields = line.split('\u0000')
    const full = fields[0] === undefined ? '' : fields[0]
    if (full === '') continue
    const isRemote = full.startsWith('refs/remotes/')
    const short = fields[1] === undefined ? '' : fields[1]
    // A remote HEAD symref is a pointer alias, not a branch to switch to.
    if (isRemote && short.endsWith('/HEAD')) continue
    const branch = {
      name: short,
      full,
      remote: isRemote,
      upstream: fields[2] === undefined ? '' : fields[2],
      ahead: 0,
      behind: 0,
      gone: false,
      date: fields[4] === undefined ? '' : fields[4],
      sha: fields[5] === undefined ? '' : fields[5],
      subject: fields[6] === undefined ? '' : fields[6],
      current: false,
    }
    const track = parseTrack(fields[3])
    branch.ahead = track.ahead
    branch.behind = track.behind
    branch.gone = track.gone
    if (!isRemote) branch.current = branch.name === current
    ;(isRemote ? remote : local).push(branch)
  }

  return {
    root: repo.root,
    cwd,
    current: detached ? '' : current,
    detached,
    head,
    upstream,
    ahead,
    behind,
    dirty: { total: staged + unstaged + untracked, staged, unstaged, untracked },
    branches: local.concat(remote),
    localCount: local.length,
    remoteCount: remote.length,
  }
}

const UNSAFE_NAME = /[\s~^:?*[\\]|]/

async function assertBranchName(run, name) {
  const value = typeof name === 'string' ? name.trim() : ''
  if (value === '') throw new GitError('INVALID_NAME', '分支名不能为空')
  if (value.startsWith('-')) throw new GitError('INVALID_NAME', '分支名不能以 - 开头')
  if (value.startsWith('@{')) throw new GitError('INVALID_NAME', '分支名不能以 @{ 开头')
  if (value.includes('..')) throw new GitError('INVALID_NAME', '分支名不能包含连续两个点')
  if (value.endsWith('/') || value.endsWith('.')) throw new GitError('INVALID_NAME', '分支名不能以 / 或 . 结尾')
  if (value.endsWith('.lock')) throw new GitError('INVALID_NAME', '分支名不能以 .lock 结尾')
  if (UNSAFE_NAME.test(value)) throw new GitError('INVALID_NAME', `分支名包含非法字符：${value}`)
  const valid = await run(['check-ref-format', '--branch', value])
  if (valid.code !== 0) throw new GitError('INVALID_NAME', firstLine(valid.stderr) || `分支名不合法：${value}`)
  return value
}

async function localExists(run, name) {
  const result = await run(['show-ref', '--verify', '--quiet', `refs/heads/${name}`])
  return result.code === 0
}

async function remotes(run) {
  const result = await run(['remote'])
  if (result.code !== 0) return []
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/**
 * Switch to an existing branch. A name that exists only as a remote ref is
 * created locally with `--track` from that remote.
 */
export async function switchBranch(run, cwd, name) {
  const branch = await assertBranchName(run, name)
  if (await localExists(run, branch)) {
    const result = await run(['switch', '--no-guess', branch])
    if (result.code !== 0) {
      throw new GitError('SWITCH_FAILED', firstLine(result.stderr) || `切换到 ${branch} 失败`, firstLine(result.stderr))
    }
    return { branch, tracked: false }
  }
  for (const remote of await remotes(run)) {
    const probe = await run(['show-ref', '--verify', '--quiet', `refs/remotes/${remote}/${branch}`])
    if (probe.code !== 0) continue
    const result = await run(['switch', '--no-guess', '-c', branch, '--track', `${remote}/${branch}`])
    if (result.code !== 0) {
      throw new GitError('SWITCH_FAILED', firstLine(result.stderr) || `从 ${remote}/${branch} 创建本地分支失败`, firstLine(result.stderr))
    }
    return { branch, tracked: true, remote }
  }
  throw new GitError('NO_SUCH_BRANCH', `分支不存在：${branch}`)
}

/** Create a branch and switch to it, optionally from an explicit start point. */
export async function createBranch(run, cwd, name, from) {
  const branch = await assertBranchName(run, name)
  if (await localExists(run, branch)) {
    throw new GitError('BRANCH_EXISTS', `分支已存在：${branch}`)
  }
  const args = ['switch', '-c', branch]
  const start = typeof from === 'string' ? from.trim() : ''
  if (start !== '') args.push(start)
  const result = await run(args)
  if (result.code !== 0) {
    const conflict = parseOverwriteConflict(result.stderr)
    if (conflict !== undefined) {
      throw new GitError('CREATE_FAILED', describeOverwriteConflict(conflict, branch), firstLine(result.stderr))
    }
    throw new GitError('CREATE_FAILED', firstLine(result.stderr) || `创建 ${branch} 失败`, firstLine(result.stderr))
  }
  return { branch, from: start === '' ? null : start }
}

/** Remove a merged local branch. Never deletes unmerged work. */
export async function deleteBranch(run, cwd, name) {
  const branch = await assertBranchName(run, name)
  const result = await run(['branch', '-d', branch])
  if (result.code !== 0) {
    throw new GitError('DELETE_FAILED', firstLine(result.stderr) || `删除 ${branch} 失败`, firstLine(result.stderr))
  }
  return { branch }
}
