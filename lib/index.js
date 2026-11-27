/**
 * dsh-git-branch - host half.
 *
 * Responsibilities:
 *   - one git core (delegated to ./git.js) used by every caller;
 *   - five HTTP routes consumed by the web client half, admitted by the host's
 *     request gate when the host publishes one and loopback-only otherwise;
 *   - the `git_branch` agent tool and the `/branch` session command, which call
 *     the same helpers instead of re-implementing git plumbing.
 */

import {
  GitError,
  createBranch,
  deleteBranch,
  initRepo,
  outputLimits,
  readState,
  switchBranch,
} from './git.js'

export const name = 'dsh-git-branch'

export const inject = ['webServer', 'subprocess', 'tools', 'commands', 'workingDirectory']

const ROUTE_PREFIX = '/dsh-git-branch'
const MAX_BODY_BYTES = 64 * 1024
const CLIENT_HEADER = 'x-dsh-git-branch'
const GIT_TIMEOUT_MS = 15000

function log(message) {
  try {
    console.warn(`[dsh-git-branch] ${message}`)
  } catch {
    /* logging is optional */
  }
}

function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function isLoopbackHostname(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'
}

// A present-but-foreign http(s) origin is refused. Opaque origins (`null`), file:
// and custom app: schemes are allowed: the desktop shell renders the conversation
// from one of those, and the three conditions in guardMutation already carry the
// cross-site protection there.
function isForeignOrigin(req) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return false
  let parsed
  try {
    parsed = new URL(origin)
  } catch {
    return true
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  return !isLoopbackHostname(parsed.hostname)
}

// Host admission is answered from request facts rather than the bare
// IncomingMessage: both the older `requestRejection` and the current `admit`
// read the absolute URL.
function admissionFacts(req) {
  const scheme = req.socket?.encrypted === true ? 'https' : 'http'
  const host = req.headers.host ?? 'localhost'
  let url
  try {
    url = new URL(req.url ?? '/', `${scheme}://${host}`).href
  } catch {
    url = `${scheme}://localhost/`
  }
  return { method: req.method ?? 'GET', headers: req.headers, socket: req.socket, url }
}

function sendJson(res, statusCode, value) {
  const body = JSON.stringify(value)
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', String(Buffer.byteLength(body)))
  res.end(body)
}

async function readJsonBody(req) {
  req.setEncoding('utf8')
  let text = ''
  for await (const chunk of req) {
    text += chunk
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new Error('request body exceeds 64 KiB')
  }
  if (text.length === 0) throw new Error('request body is required')
  const value = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('request body must be an object')
  }
  return value
}

export function apply(ctx) {
  const webServer = ctx.get('webServer')
  const subprocess = ctx.get('subprocess')
  const tools = ctx.get('tools')
  const commands = ctx.get('commands')
  const workingDirectory = ctx.get('workingDirectory')

  if (webServer === undefined || subprocess === undefined) {
    throw new Error('dsh-git-branch requires the webServer and subprocess services')
  }

  // Admission is published on the host's `connection` service. Injecting
  // `connection.authentication` as well matters: a host that reads it inside
  // `admit` throws without the scope, which would refuse every request.
  let gateCtx
  let gateScope
  if (typeof ctx.inject === 'function') {
    gateScope = ctx.inject(['connection', 'connection.authentication'], (inner) => {
      gateCtx = inner
      return () => {
        if (gateCtx === inner) gateCtx = undefined
      }
    })
  }
  ctx.effect(() => () => {
    gateCtx = undefined
    if (typeof gateScope?.dispose === 'function') gateScope.dispose()
  }, 'dsh-git-branch: admission scope')

  // `{ rejection }` refuses, `{}` admits, and `null` means this host publishes
  // no gate at all (the loopback check then stands in). A gate that throws is a
  // refusal: an unreadable admission answer must not open the routes.
  function hostGate(req) {
    const connection = (gateCtx ?? ctx).get('connection')
    if (connection === undefined || connection === null) return null
    if (typeof connection.requestRejection === 'function') {
      return { rejection: connection.requestRejection(req) }
    }
    if (typeof connection.admit !== 'function') return null
    const answer = connection.admit(admissionFacts(req))
    if (typeof answer?.rejection === 'number') return { rejection: answer.rejection }
    return { rejection: answer === undefined ? 403 : undefined }
  }

  let gitExecutable = null

  async function resolveGit(signal) {
    if (gitExecutable !== null) return gitExecutable
    try {
      const resolved = await subprocess.resolveExecutable('git', undefined, signal)
      gitExecutable = typeof resolved === 'string' && resolved !== '' ? resolved : 'git'
    } catch {
      throw new GitError('GIT_MISSING', '找不到 git 可执行文件，请先安装 Git 并确保它在 PATH 中')
    }
    return gitExecutable
  }

  /** Spawn one git command and collect bounded output. */
  async function runGit(cwd, args, signal) {
    const executable = await resolveGit(signal)
    const timeout = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(GIT_TIMEOUT_MS) : undefined
    const combined = signal !== undefined && timeout !== undefined && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([signal, timeout])
      : (signal ?? timeout)
    const handle = subprocess.spawn({
      argv: [executable, ...args],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: outputLimits.stdout },
        stderr: { maxBytes: outputLimits.stderr },
      },
      graceMs: 2000,
      ...(combined === undefined ? {} : { signal: combined }),
    })
    const outcome = await handle.done
    let stdout = ''
    let stderr = ''
    try {
      stdout = handle.collected?.stdout?.readFrom(0)?.text ?? ''
    } catch {
      stdout = ''
    }
    try {
      stderr = handle.collected?.stderr?.readFrom(0)?.text ?? ''
    } catch {
      stderr = ''
    }
    const code = typeof outcome.exitCode === 'number' ? outcome.exitCode : -1
    if (code === -1 && outcome.signal !== null && outcome.signal !== undefined) {
      throw new GitError('TIMEOUT', `git ${args[0]} 超时或被中止`)
    }
    return { code, stdout, stderr }
  }

  // ---------------------------------------------------------------- sessions

  function resolveSession(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
    try {
      const sessions = ctx.get('sessions')
      const found = sessions?.get?.(sessionId)
      if (found !== undefined && found !== null) return found
    } catch {
      /* service may be absent in this profile */
    }
    try {
      const agents = ctx.get('agents')
      const agent = agents?.get?.(sessionId)
      if (agent !== undefined && agent !== null) return agent.session ?? agent
    } catch {
      /* service may be absent in this profile */
    }
    return undefined
  }

  async function cwdForSession(sessionId, signal) {
    const session = resolveSession(sessionId)
    if (session === undefined) throw new GitError('NO_SESSION', '找不到该会话的工作目录')
    if (workingDirectory !== undefined) {
      try {
        const current = workingDirectory.get(session)
        if (typeof current === 'string' && current !== '') return current
      } catch {
        /* fall through to ensure() */
      }
      try {
        const ensured = await workingDirectory.ensure(session, signal)
        if (typeof ensured === 'string' && ensured !== '') return ensured
      } catch {
        /* fall through to NO_SESSION */
      }
    }
    throw new GitError('NO_SESSION', '找不到该会话的工作目录')
  }

  async function cwdForAgent(agent, signal) {
    if (workingDirectory !== undefined && agent !== undefined) {
      try {
        const ensured = await workingDirectory.ensure(agent, signal)
        if (typeof ensured === 'string' && ensured !== '') return ensured
      } catch {
        /* fall through */
      }
      try {
        const current = workingDirectory.get(agent.session ?? agent)
        if (typeof current === 'string' && current !== '') return current
      } catch {
        /* fall through */
      }
    }
    throw new GitError('NO_SESSION', '找不到当前会话的工作目录')
  }

  // ------------------------------------------------------------- operations

  // git writes share one index, so commands on the same directory are queued
  // instead of racing into `index.lock`.
  const queues = new Map()

  function serialize(cwd, task) {
    const previous = queues.get(cwd) ?? Promise.resolve()
    const next = previous.then(task, task)
    const settled = next.then(
      () => undefined,
      () => undefined,
    )
    queues.set(cwd, settled)
    settled.then(() => {
      if (queues.get(cwd) === settled) queues.delete(cwd)
    })
    return next
  }

  function toFailure(error) {
    if (error instanceof GitError) {
      return { ok: false, code: error.code, message: error.message, detail: error.detail ?? '' }
    }
    return { ok: false, code: 'GIT_FAILED', message: error instanceof Error ? error.message : String(error) }
  }

  async function listFor(cwd, signal) {
    try {
      const state = await readState((args) => runGit(cwd, args, signal), cwd)
      return { ok: true, repo: state }
    } catch (error) {
      if (error instanceof GitError && error.code === 'NOT_A_REPO') {
        return { ok: false, code: 'NOT_A_REPO', message: '当前目录不是 Git 仓库', cwd }
      }
      return { ...toFailure(error), cwd }
    }
  }

  async function mutateFor(cwd, task, signal) {
    return serialize(cwd, async () => {
      try {
        const result = await task((args) => runGit(cwd, args, signal), cwd)
        const state = await readState((args) => runGit(cwd, args, signal), cwd)
        return { ok: true, ...result, repo: state }
      } catch (error) {
        return toFailure(error)
      }
    })
  }

  // ------------------------------------------------------------------ routes

  const route = (path, handler) => ({
    kind: 'exact',
    path: `${ROUTE_PREFIX}${path}`,
    async handler(req, res) {
      let gate
      try {
        gate = hostGate(req)
      } catch {
        sendJson(res, 403, { ok: false, code: 'FORBIDDEN', message: 'admission check failed' })
        return
      }
      if (gate !== null && gate.rejection !== undefined) {
        const status = gate.rejection
        sendJson(res, status, {
          ok: false,
          code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
          message: status === 401 ? '需要宿主登录，请从 DSH 页面重试' : '宿主拒绝了该请求',
        })
        return
      }
      // Without a host gate the loopback stand-in still applies; with one the
      // host has already fenced Host and Origin in front of this route.
      if (gate === null && !isLoopbackAddress(req.socket?.remoteAddress)) {
        sendJson(res, 403, { ok: false, code: 'FORBIDDEN', message: 'loopback only' })
        return
      }
      try {
        await handler(req, res, gate !== null)
      } catch (error) {
        sendJson(res, 500, { ok: false, code: 'GIT_FAILED', message: error instanceof Error ? error.message : String(error) })
      }
    },
  })

  // The custom header forces a CORS preflight for any cross-site caller, and no
  // route answers OPTIONS, so the browser refuses before the request lands here.
  // The Origin stand-in stops once the host gate admitted the request: that gate
  // already fenced Host and Origin, and repeating the check would refuse writes
  // on a trusted-hostname deployment.
  function guardMutation(req, res, gated) {
    if (req.headers[CLIENT_HEADER] !== '1') {
      sendJson(res, 403, { ok: false, code: 'FORBIDDEN', message: 'missing client header' })
      return false
    }
    const contentType = req.headers['content-type'] ?? ''
    if (!String(contentType).toLowerCase().startsWith('application/json')) {
      sendJson(res, 415, { ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'expected application/json' })
      return false
    }
    if (!gated && isForeignOrigin(req)) {
      sendJson(res, 403, { ok: false, code: 'FORBIDDEN', message: 'cross-origin request rejected' })
      return false
    }
    return true
  }

  ctx.effect(() => webServer.register(route('/state', async (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'GET only' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const sessionId = url.searchParams.get('sessionId') ?? ''
    let cwd
    try {
      cwd = await cwdForSession(sessionId)
    } catch (error) {
      sendJson(res, 200, toFailure(error))
      return
    }
    sendJson(res, 200, await listFor(cwd))
  })), 'dsh-git-branch: state route')

  ctx.effect(() => webServer.register(route('/switch', async (req, res, gated) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'POST only' })
      return
    }
    if (!guardMutation(req, res, gated)) return
    const body = await readJsonBody(req)
    let cwd
    try {
      cwd = await cwdForSession(typeof body.sessionId === 'string' ? body.sessionId : '')
    } catch (error) {
      sendJson(res, 200, toFailure(error))
      return
    }
    const branch = typeof body.name === 'string' ? body.name : ''
    sendJson(res, 200, await mutateFor(cwd, async (run) => ({ switched: await switchBranch(run, cwd, branch) })))
  })), 'dsh-git-branch: switch route')

  ctx.effect(() => webServer.register(route('/create', async (req, res, gated) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'POST only' })
      return
    }
    if (!guardMutation(req, res, gated)) return
    const body = await readJsonBody(req)
    let cwd
    try {
      cwd = await cwdForSession(typeof body.sessionId === 'string' ? body.sessionId : '')
    } catch (error) {
      sendJson(res, 200, toFailure(error))
      return
    }
    const branch = typeof body.name === 'string' ? body.name : ''
    const from = typeof body.from === 'string' ? body.from : ''
    sendJson(res, 200, await mutateFor(cwd, async (run) => ({ created: await createBranch(run, cwd, branch, from) })))
  })), 'dsh-git-branch: create route')

  ctx.effect(() => webServer.register(route('/init', async (req, res, gated) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'POST only' })
      return
    }
    if (!guardMutation(req, res, gated)) return
    const body = await readJsonBody(req)
    let cwd
    try {
      cwd = await cwdForSession(typeof body.sessionId === 'string' ? body.sessionId : '')
    } catch (error) {
      sendJson(res, 200, toFailure(error))
      return
    }
    sendJson(res, 200, await mutateFor(cwd, async (run) => ({ init: await initRepo(run, cwd) })))
  })), 'dsh-git-branch: init route')

  ctx.effect(() => webServer.register(route('/delete', async (req, res, gated) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'POST only' })
      return
    }
    if (!guardMutation(req, res, gated)) return
    const body = await readJsonBody(req)
    let cwd
    try {
      cwd = await cwdForSession(typeof body.sessionId === 'string' ? body.sessionId : '')
    } catch (error) {
      sendJson(res, 200, toFailure(error))
      return
    }
    const branch = typeof body.name === 'string' ? body.name : ''
    sendJson(res, 200, await mutateFor(cwd, async (run) => ({ deleted: await deleteBranch(run, cwd, branch) })))
  })), 'dsh-git-branch: delete route')

  // ------------------------------------------------------------------- tool

  const ACTIONS = ['list', 'switch', 'create', 'init', 'delete']

  if (tools !== undefined) {
    ctx.effect(() => tools.register({
      name: 'git_branch',
      description: [
        'Work with Git branches in the current session working directory.',
        'Use it to see where you are before branching, to switch to an existing branch,',
        'to create and switch to a new branch, or to initialize a repository when the',
        'directory is not one yet. Never guess branch names: call action=list first.',
        'action=switch 切到已有分支；action=create 新建并切过去；action=init 在当前目录初始化仓库。',
      ].join(' '),
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: ACTIONS,
            description: 'list shows branches and dirty state; switch/create/init/delete change the repository.',
          },
          branch: {
            type: 'string',
            description: 'Branch name for switch, create, or delete. Required except for list and init.',
          },
          from: {
            type: 'string',
            description: 'Optional start point for create (a branch, tag, or commit). Defaults to the current HEAD.',
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['report'],
          properties: {
            report: { type: 'string', description: 'Human readable branch state and the outcome of the action.' },
          },
        },
        render(_args, value) {
          const report = typeof value?.report === 'string' ? value.report : JSON.stringify(value, null, 2)
          return [{ type: 'text', text: report }]
        },
      },
      async execute(args, exec) {
        const action = typeof args?.action === 'string' ? args.action : ''
        const signal = exec?.signal
        let cwd
        try {
          cwd = await cwdForAgent(exec?.agent, signal)
        } catch (error) {
          return { report: toolReport(action, toFailure(error)) }
        }
        const result = await runAction(action, args, cwd, signal)
        return { report: toolReport(action, result) }
      },
    }), 'dsh-git-branch: git_branch tool')
  }

  async function runAction(action, args, cwd, signal) {
    if (action === 'list') return listFor(cwd, signal)
    if (action === 'init') {
      return mutateFor(cwd, async (run) => ({ init: await initRepo(run, cwd) }), signal)
    }
    const branch = typeof args?.branch === 'string' ? args.branch : ''
    if (branch === '') {
      return { ok: false, code: 'INVALID_NAME', message: `action=${action} 需要 branch 参数` }
    }
    if (action === 'switch') {
      return mutateFor(cwd, async (run) => ({ switched: await switchBranch(run, cwd, branch) }), signal)
    }
    if (action === 'create') {
      const from = typeof args?.from === 'string' ? args.from : ''
      return mutateFor(cwd, async (run) => ({ created: await createBranch(run, cwd, branch, from) }), signal)
    }
    if (action === 'delete') {
      return mutateFor(cwd, async (run) => ({ deleted: await deleteBranch(run, cwd, branch) }), signal)
    }
    return { ok: false, code: 'UNKNOWN_ACTION', message: `未知 action：${action}` }
  }

  // ---------------------------------------------------------------- command

  if (commands !== undefined) {
    ctx.effect(() => commands.register({
      name: 'branch',
      description: '查看、切换或新建 Git 分支（/branch、/branch switch <名>、/branch create <名> [起点]、/branch init）',
      input: { hint: '[list | switch <name> | create <name> [from] | init]' },
      async handler(invocation) {
        const raw = typeof invocation.rawInput === 'string' ? invocation.rawInput.trim() : ''
        const words = raw === '' ? [] : raw.split(/\s+/)
        const action = words.length === 0 ? 'list' : words[0]
        let cwd
        try {
          cwd = await cwdForAgent(invocation.agent, invocation.signal)
        } catch (error) {
          const failure = toFailure(error)
          return { kind: 'error', text: `${failure.code}: ${failure.message}` }
        }

        if (action === 'list') {
          const result = await listFor(cwd, invocation.signal)
          if (result.ok === false) {
            const hint = result.code === 'NOT_A_REPO' ? '\n用 /branch init 在这个目录创建 Git 仓库。' : ''
            return { kind: 'error', text: `${result.message}${hint}` }
          }
          return { kind: 'success', text: describeState(result.repo) }
        }

        if (action === 'init') {
          const result = await mutateFor(cwd, async (run) => ({ init: await initRepo(run, cwd) }), invocation.signal)
          if (result.ok === false) return { kind: 'error', text: `${result.code}: ${result.message}` }
          const created = result.init?.created === true
          return {
            kind: 'success',
            text: `${created ? '已创建 Git 仓库' : '目录已在 Git 仓库内'}：${result.repo.root}\n当前分支：${result.repo.current || '(detached)'}`,
          }
        }

        const branch = words[1] ?? ''
        if (branch === '') return { kind: 'error', text: `用法：/branch ${action} <分支名>` }
        if (action === 'switch') {
          const result = await mutateFor(cwd, async (run) => ({ switched: await switchBranch(run, cwd, branch) }), invocation.signal)
          if (result.ok === false) return { kind: 'error', text: `${result.code}: ${result.message}` }
          const tracked = result.switched?.tracked === true ? ` （跟踪 ${result.switched.remote}/${branch}）` : ''
          return { kind: 'success', text: `已切换到 ${branch}${tracked}${describeDirty(result.repo)}` }
        }
        if (action === 'create') {
          const from = words[2] ?? ''
          const result = await mutateFor(cwd, async (run) => ({ created: await createBranch(run, cwd, branch, from) }), invocation.signal)
          if (result.ok === false) return { kind: 'error', text: `${result.code}: ${result.message}` }
          const base = result.created?.from === null ? '当前 HEAD' : result.created.from
          return { kind: 'success', text: `已基于 ${base} 创建并切换到 ${branch}${describeDirty(result.repo)}` }
        }
        return { kind: 'error', text: `未知动作 ${action}；可用：list、switch、create、init` }
      },
    }), 'dsh-git-branch: /branch command')
  }

  function toolReport(action, result) {
    if (result.ok === false) {
      const hint = result.code === 'NOT_A_REPO' ? '（该目录还不是 Git 仓库，可用 action=init 创建）' : ''
      return `失败 ${result.code}：${result.message}${hint}`
    }
    const state = result.repo
    if (action === 'list') return describeState(state)
    if (action === 'init') {
      const head = result.init?.created === true ? '已创建 Git 仓库' : '目录已在 Git 仓库内'
      return `${head}\n${describeState(state)}`
    }
    if (action === 'switch') {
      const tracked = result.switched?.tracked === true ? `（跟踪 ${result.switched.remote}/${result.switched.branch}）` : ''
      return `已切换到 ${result.switched?.branch ?? ''}${tracked}${describeDirty(state)}\n${describeState(state)}`
    }
    if (action === 'create') {
      const base = result.created?.from === null || result.created?.from === undefined ? '当前 HEAD' : result.created.from
      return `已基于 ${base} 创建并切换到 ${result.created?.branch ?? ''}${describeDirty(state)}\n${describeState(state)}`
    }
    if (action === 'delete') {
      return `已删除分支 ${result.deleted?.branch ?? ''}\n${describeState(state)}`
    }
    return describeState(state)
  }

  function describeDirty(state) {
    const { total, staged, unstaged, untracked } = state.dirty
    if (total === 0) return '；工作区干净'
    const parts = []
    if (staged > 0) parts.push(`已暂存 ${staged}`)
    if (unstaged > 0) parts.push(`未暂存 ${unstaged}`)
    if (untracked > 0) parts.push(`未跟踪 ${untracked}`)
    return `；工作区有改动（${parts.join('，')}）`
  }

  function describeState(state) {
    const head = state.detached ? `(detached ${state.head.slice(0, 7)})` : state.current
    const lines = [`仓库：${state.root}`, `当前分支：${head}`]
    if (state.upstream !== '') {
      lines.push(`上游：${state.upstream}（↑${state.ahead} ↓${state.behind}）`)
    }
    lines.push(`工作区：${state.dirty.total === 0 ? '干净' : `${state.dirty.total} 个改动`}`)
    const locals = state.branches.filter((branch) => !branch.remote)
    const remotes = state.branches.filter((branch) => branch.remote)
    if (locals.length > 0) {
      lines.push('本地分支：')
      for (const branch of locals) {
        const marker = branch.current ? '* ' : '  '
        const track = branch.upstream === '' ? '' : ` → ${branch.upstream}`
        lines.push(`${marker}${branch.name}${track}`)
      }
    }
    if (remotes.length > 0) {
      lines.push(`远程分支：${remotes.length} 个（用 /branch switch <名> 跟踪切出本地分支）`)
    }
    return lines.join('\n')
  }

  log(`ready on ${ROUTE_PREFIX}`)
}
