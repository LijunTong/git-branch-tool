#!/usr/bin/env node
/**
 * Submit this plugin to the awesome-dsh-plugin list
 * (https://github.com/awesome-dsh-plugin/awesome-dsh-plugin).
 *
 * A submission is one YAML file: `data/plugins/<owner>__<repo>.yml`.
 * This script checks the admission rules from `contributing.md`, writes that
 * entry locally, and (with --apply) forks the list, commits the entry and opens
 * the pull request for you.
 *
 * Usage:
 *   node scripts/publish-market.mjs                 # dry run: check + write entry
 *   node scripts/publish-market.mjs --repo o/r      # repo not detected from origin
 *   GITHUB_TOKEN=xxx node scripts/publish-market.mjs --apply
 *
 * Options:
 *   --repo <owner/name>   target GitHub repository (default: the `origin` remote)
 *   --category <name>     list category (default: git)
 *   --en <text>           override the English description
 *   --zh <text>           override the Chinese description
 *   --icon <url>          optional GitHub-hosted raster tile (png/jpg/webp)
 *   --out <path>          where the dry run writes the entry
 *   --no-check            skip the GitHub-side checks (offline)
 *   --apply               fork + commit + open the pull request
 *   --help
 *
 * Environment:
 *   GITHUB_TOKEN / GH_TOKEN   token with `public_repo` scope, required by --apply
 *
 * Nothing here writes secrets anywhere; the token is only sent to api.github.com.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const API = 'https://api.github.com'
const UPSTREAM = 'awesome-dsh-plugin/awesome-dsh-plugin'
const UPSTREAM_REPO = 'awesome-dsh-plugin'
const UPSTREAM_BRANCH = 'main'
const ENTRY_DIR = 'data/plugins'
const MIN_AGE_DAYS = 1
const TOPIC = 'dsh-plugin'
const CATEGORIES = new Set([
  'agi', 'ui', 'usage', 'theme', 'model', 'identity', 'session', 'memory', 'tools', 'wsl',
  'browser', 'vision', 'voice', 'docs', 'skill', 'workflow', 'git', 'notify', 'dev', 'security',
  'remote', 'market', 'fun',
])

const DEFAULT_EN =
  'Switch and create Git branches from a chip next to the DSH composer, with a matching git_branch tool and /branch command.'
const DEFAULT_ZH = '在 DSH 输入框旁用控件切换与创建 Git 分支，并提供 git_branch 工具与 /branch 命令。'

function parseArgs(argv) {
  const options = { apply: false, check: true, category: 'git', out: null, icon: null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      index += 1
      if (index >= argv.length) throw new Error(`${arg} needs a value`)
      return argv[index]
    }
    if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--apply') options.apply = true
    else if (arg === '--no-check') options.check = false
    else if (arg === '--repo') options.repo = next()
    else if (arg === '--category') options.category = next()
    else if (arg === '--en') options.en = next()
    else if (arg === '--zh') options.zh = next()
    else if (arg === '--icon') options.icon = next()
    else if (arg === '--out') options.out = next()
    else throw new Error(`unknown option: ${arg}`)
  }
  return options
}

function readJson(relative) {
  return JSON.parse(readFileSync(join(ROOT, relative), 'utf8'))
}

function token() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-git-branch-publish' }
  const secret = token()
  if (auth && secret) headers.authorization = `Bearer ${secret}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let data = null
  if (text !== '') {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  return { status: response.status, ok: response.ok, data }
}

async function apiOrThrow(path, options) {
  const result = await api(path, options)
  if (!result.ok) {
    const message = result.data && typeof result.data === 'object' ? result.data.message : result.data
    const error = new Error(`${options && options.method ? options.method : 'GET'} ${path} -> ${result.status} ${message ?? ''}`.trim())
    error.status = result.status
    throw error
  }
  return result.data
}

function remoteRepo() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }).trim()
    const match =
      /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url) || /github\.com\/([^/]+)\/([^/]+)/.exec(url)
    if (match) return `${match[1]}/${match[2].replace(/\.git$/, '')}`
  } catch {
    /* no origin remote */
  }
  return null
}

function localChecks(pkg) {
  const issues = []
  const notes = []
  const patch = pkg.dsh?.bundle?.patch
  if (typeof patch !== 'string' || patch === '') {
    issues.push('package.json 缺少 dsh.bundle.patch —— 市场按这个判断能否用 dsh plugin add 安装')
  } else if (!existsSync(join(ROOT, patch))) {
    issues.push(`dsh.bundle.patch 指向的 ${patch} 不存在`)
  } else {
    notes.push(`dsh.bundle.patch = ${patch}`)
  }
  if (pkg.dsh?.client?.platform === 'web') notes.push('同时带 dsh.client（web UI）')
  if (!Array.isArray(pkg.files) || !pkg.files.includes('cordis.patch.yml')) {
    notes.push('提示：package.json 的 files 里建议包含 cordis.patch.yml')
  }
  if (typeof pkg.version !== 'string' || pkg.version === '') issues.push('package.json 缺少 version')
  return { issues, notes }
}

function daysSince(iso) {
  return (Date.now() - new Date(iso).getTime()) / 86400000
}

async function remoteChecks(repo) {
  const issues = []
  const notes = []
  const info = await api(`/repos/${repo}`, { auth: false })
  if (info.status === 404) {
    issues.push(`GitHub 上找不到 ${repo} —— 先把仓库推上去再投稿`)
    return { issues, notes }
  }
  if (!info.ok) {
    issues.push(`读取 /repos/${repo} 失败：${info.status}`)
    return { issues, notes }
  }
  const data = info.data
  const age = daysSince(data.created_at)
  notes.push(`仓库创建于 ${data.created_at.slice(0, 10)}（${age.toFixed(1)} 天）`)
  if (age < MIN_AGE_DAYS) issues.push(`仓库还不满 ${MIN_AGE_DAYS} 天，CI 会拦下；过几小时再提即可`)
  if (data.archived) issues.push('仓库已归档')
  if (data.private) issues.push('仓库是私有仓库')
  const topics = Array.isArray(data.topics) ? data.topics : []
  if (!topics.includes(TOPIC)) issues.push(`仓库缺少 ${TOPIC} topic —— 在 GitHub 仓库页 About 的 Topics 里加上`)
  else notes.push(`已带 ${TOPIC} topic`)

  const raw = await fetch(`https://raw.githubusercontent.com/${repo}/${data.default_branch}/package.json`)
  if (raw.ok) {
    let remotePkg = null
    try {
      remotePkg = await raw.json()
    } catch {
      remotePkg = null
    }
    if (remotePkg === null) issues.push('远端 package.json 解析失败')
    else if (typeof remotePkg.dsh?.bundle?.patch !== 'string') {
      issues.push('远端 package.json 没有 dsh.bundle.patch —— 请先把本地改动 push 到 GitHub')
    } else notes.push(`远端 dsh.bundle.patch = ${remotePkg.dsh.bundle.patch}`)
  } else {
    notes.push('未能读取远端 package.json（默认分支可能不是 main，CI 会自行读取）')
  }
  return { issues, notes }
}

function yamlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function buildEntry({ repo, category, en, zh, icon }) {
  const lines = [
    `url: https://github.com/${repo}`,
    `name: ${repo}`,
    `category: ${category}`,
    'description:',
    `  en: ${yamlString(en)}`,
    `  zh: ${yamlString(zh)}`,
  ]
  if (icon) lines.push(`icon: ${yamlString(icon)}`)
  return `${lines.join('\n')}\n`
}

function entryFileName(repo) {
  return `${repo.replace('/', '__')}.yml`
}

function checkDescriptions(en, zh) {
  const issues = []
  if (!en.trim().endsWith('.')) issues.push('英文描述要以句号结尾（contributing.md 要求）')
  if (!zh.trim().endsWith('。')) issues.push('中文描述要以句号结尾')
  const marketing = /revolutionary|best-in-class|amazing|powerful|科|神器|最强/i
  if (marketing.test(en) || marketing.test(zh)) issues.push('描述不要带营销词')
  return issues
}

function prBody({ repo, pkg, notes }) {
  return [
    `Adds **${repo}** under \`git\`.`,
    '',
    'Checked locally before opening this pull request:',
    '',
    ...notes.map((note) => `- ${note}`),
    `- entry file only: \`${ENTRY_DIR}/${entryFileName(repo)}\``,
    '',
    `This is a DSH bundle (\`${pkg.name}@${pkg.version}\`): host side registers a \`git_branch\` tool,`,
    'a `/branch` command and HTTP routes; client side adds a composer chip with five',
    'selectable placements plus a settings section. Branch switching and creation run',
    'through the local `git` binary.',
    '',
    'The READMEs are generated, so nothing else is touched.',
  ].join('\n')
}

async function applySubmission({ repo, entry, entryPath, notes, pkg }) {
  const secret = token()
  if (secret === '') {
    throw new Error('--apply 需要 GITHUB_TOKEN（或 GH_TOKEN）环境变量，scope 至少 public_repo')
  }
  const me = (await apiOrThrow('/user')).login
  const forkName = `${me}/${UPSTREAM_REPO}`
  console.log(`→ fork ${UPSTREAM} → ${forkName}`)
  await api(`/repos/${UPSTREAM}/forks`, { method: 'POST', body: { default_branch_only: false } })
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const probe = await api(`/repos/${forkName}`)
    if (probe.ok) break
    await new Promise((resolve) => setTimeout(resolve, 3000))
    if (attempt === 19) throw new Error(`fork ${forkName} 未就绪，稍后重试`)
  }

  const branch = `add-${repo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const base = await apiOrThrow(`/repos/${forkName}/git/ref/heads/${UPSTREAM_BRANCH}`)
  const baseSha = base.object.sha
  const existing = await api(`/repos/${forkName}/git/ref/heads/${branch}`)
  if (!existing.ok) {
    console.log(`→ branch ${branch}`)
    await apiOrThrow(`/repos/${forkName}/git/refs`, {
      method: 'POST',
      body: { ref: `refs/heads/${branch}`, sha: baseSha },
    })
  }

  const current = await api(`/repos/${forkName}/contents/${entryPath}?ref=${branch}`)
  const putBody = {
    message: `Add ${repo}`,
    content: Buffer.from(entry, 'utf8').toString('base64'),
    branch,
  }
  if (current.ok && current.data && current.data.sha) putBody.sha = current.data.sha
  console.log(`→ ${entryPath}`)
  await apiOrThrow(`/repos/${forkName}/contents/${entryPath}`, { method: 'PUT', body: putBody })

  const pull = await api(`/repos/${UPSTREAM}/pulls`, {
    method: 'POST',
    body: {
      title: `Add ${repo}`,
      head: `${me}:${branch}`,
      base: UPSTREAM_BRANCH,
      body: prBody({ repo, pkg, notes }),
    },
  })
  if (!pull.ok) {
    const message = pull.data && pull.data.message ? pull.data.message : pull.status
    if (String(message).includes('already exists')) {
      throw new Error(`已有针对 ${me}:${branch} 的 PR，去 ${UPSTREAM} 看一下`)
    }
    throw new Error(`创建 PR 失败：${pull.status} ${message}`)
  }
  return pull.data.html_url
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8')
    const header = source.slice(source.indexOf('/**') + 3, source.indexOf('*/'))
    const text = header
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, ''))
      .join('\n')
      .trim()
    console.log(text)
    return
  }

  if (!CATEGORIES.has(options.category)) {
    throw new Error(`category 必须是：${[...CATEGORIES].join(' ')}`)
  }

  const pkg = readJson('package.json')
  const repo = options.repo ?? remoteRepo()
  if (repo === null || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error('无法确定目标仓库，请用 --repo owner/name 指定（或先 git remote add origin）')
  }

  const en = options.en ?? DEFAULT_EN
  const zh = options.zh ?? DEFAULT_ZH
  const issues = []
  const notes = []

  const local = localChecks(pkg)
  issues.push(...local.issues)
  notes.push(...local.notes)
  issues.push(...checkDescriptions(en, zh))

  if (options.check) {
    const remote = await remoteChecks(repo)
    issues.push(...remote.issues)
    notes.push(...remote.notes)
  } else {
    notes.push('跳过 GitHub 侧检查（--no-check）')
  }

  const entry = buildEntry({ repo, category: options.category, en, zh, icon: options.icon })
  const fileName = entryFileName(repo)
  const entryPath = `${ENTRY_DIR}/${fileName}`

  console.log(`仓库      ${repo}`)
  console.log(`分类      ${options.category}`)
  console.log(`版本      ${pkg.name}@${pkg.version}`)
  console.log(`条目文件  ${entryPath}`)
  for (const note of notes) console.log(`· ${note}`)
  console.log('\n--- 条目内容 ---')
  process.stdout.write(entry)

  if (issues.length > 0) {
    console.log('\n--- 还差这些 ---')
    for (const issue of issues) console.log(`✗ ${issue}`)
    console.log('\n先修好再提交；上面这些问题 CI 或维护者都会打回。')
    process.exitCode = 1
    return
  }

  if (!options.apply) {
    const out = options.out ?? join(ROOT, 'market', fileName)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, entry, 'utf8')
    console.log(`\n已写入 ${out}`)
    console.log('检查通过。真正提交（fork + commit + PR）：')
    console.log('  GITHUB_TOKEN=... node scripts/publish-market.mjs --apply')
    return
  }

  const url = await applySubmission({ repo, entry, entryPath, notes, pkg })
  console.log(`\nPR 已创建：${url}`)
}

main().catch((error) => {
  console.error(`\n失败：${error.message}`)
  process.exitCode = 1
})
