/**
 * dsh-git-branch - web client half.
 *
 * One chip, registered into five optional composer/session slots (`list`
 * slots only, all replaceRisk=none). Exactly the slot named by the saved
 * placement renders the chip; every other registration returns null, so a
 * placement change is a store update instead of a register/unregister dance.
 */

window.__ModuleLoader__.load({
  id: 'dsh-git-branch',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var ReactDOM = require('react-dom')

    var PACKAGE_ID = 'dsh-git-branch'
    var API = '/dsh-git-branch'
    var STORAGE_KEY = PACKAGE_ID + ':placement'
    var STYLE_ID = PACKAGE_ID + '-styles'

    /** Slot candidates. Every one is a `list` slot with replaceRisk=none. */
    var PLACEMENTS = [
      { id: 'input-left', slot: 'conversation.input.left', labelKey: 'placementInputLeft' },
      { id: 'input-right', slot: 'conversation.input.right', labelKey: 'placementInputRight' },
      { id: 'input-dock', slot: 'conversation.input.dock', labelKey: 'placementInputDock' },
      { id: 'composer-dock', slot: 'conversation.composer.dock', labelKey: 'placementComposerDock' },
      { id: 'session-header', slot: 'conversation.session.header.utilities', labelKey: 'placementSessionHeader' },
    ]
    var DEFAULT_PLACEMENT = 'input-left'

    var COPY = {
      en: {
        chipLabel: 'Git branch',
        settingsNav: 'Git branch',
        loading: 'Branches…',
        notRepo: 'No Git repository',
        unavailable: 'Branches unavailable',
        popTitle: 'Git branches',
        search: 'Filter branches',
        local: 'Local',
        remote: 'Remote',
        current: 'current',
        refresh: 'Refresh',
        newBranch: 'New branch',
        newBranchPlaceholder: 'branch name',
        newBranchStart: 'from',
        create: 'Create and switch',
        working: 'Working…',
        empty: 'No branches yet',
        noMatch: 'No branch matches',
        initTitle: 'This directory is not a Git repository',
        initButton: 'Create a Git repository here',
        initNote: 'Runs git init in the session working directory.',
        settingsTitle: 'Git branch',
        settingsIntro: 'Choose where the branch switcher appears in the conversation.',
        settingsNote: 'The placement is stored per browser profile, not in the DSH profile.',
        placementInputLeft: 'Inside the input, left (default)',
        placementInputRight: 'Inside the input, right',
        placementInputDock: 'Above the input',
        placementComposerDock: 'Below the input',
        placementSessionHeader: 'Session title, right side',
        dirty: 'Uncommitted changes',
        detached: 'detached HEAD',
      },
      zh: {
        chipLabel: 'Git 分支',
        settingsNav: 'Git 分支',
        loading: '分支…',
        notRepo: '非 Git 仓库',
        unavailable: '分支不可用',
        popTitle: 'Git 分支',
        search: '筛选分支',
        local: '本地',
        remote: '远程',
        current: '当前',
        refresh: '刷新',
        newBranch: '新建分支',
        newBranchPlaceholder: '分支名',
        newBranchStart: '起点',
        create: '创建并切换',
        working: '处理中…',
        empty: '还没有分支',
        noMatch: '没有匹配的分支',
        initTitle: '当前目录不是 Git 仓库',
        initButton: '在此目录创建 Git 仓库',
        initNote: '会在当前会话工作目录执行 git init。',
        settingsTitle: 'Git 分支',
        settingsIntro: '选择分支切换控件显示在对话界面的哪个位置。',
        settingsNote: '位置按浏览器保存，不写入 DSH 配置。',
        placementInputLeft: '输入框内左侧（默认）',
        placementInputRight: '输入框内右侧',
        placementInputDock: '输入框上方',
        placementComposerDock: '输入框下方',
        placementSessionHeader: '会话标题右侧',
        dirty: '有未提交改动',
        detached: '分离头指针',
      },
    }

    var hostLocale = null

    function hostLanguage() {
      try {
        if (hostLocale !== null && typeof hostLocale.getLocale === 'function') {
          var value = hostLocale.getLocale()
          if (typeof value === 'string' && value !== '') return value
        }
      } catch (error) {
        /* fall through to the browser language */
      }
      try {
        return navigator.language || 'en'
      } catch (error) {
        return 'en'
      }
    }

    function copy() {
      return String(hostLanguage()).toLowerCase().indexOf('zh') === 0 ? COPY.zh : COPY.en
    }

    function readLocaleService(ctx) {
      try {
        var service = ctx.get('locale')
        if (service !== undefined && service !== null && typeof service.getLocale === 'function') return service
      } catch (error) {
        /* the service is optional */
      }
      return null
    }

    // ------------------------------------------------------------- placement

    var listeners = new Set()

    function isKnownPlacement(value) {
      for (var i = 0; i < PLACEMENTS.length; i += 1) {
        if (PLACEMENTS[i].id === value) return true
      }
      return false
    }

    function readStoredPlacement() {
      try {
        var value = window.localStorage.getItem(STORAGE_KEY)
        if (value !== null && isKnownPlacement(value)) return value
      } catch (error) {
        /* storage may be unavailable */
      }
      return DEFAULT_PLACEMENT
    }

    var placement = readStoredPlacement()

    function subscribePlacement(listener) {
      listeners.add(listener)
      return function () {
        listeners.delete(listener)
      }
    }

    function getPlacement() {
      return placement
    }

    function setPlacement(next) {
      if (!isKnownPlacement(next) || next === placement) return
      placement = next
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch (error) {
        /* the in-memory value still applies for this session */
      }
      listeners.forEach(function (listener) {
        try {
          listener()
        } catch (error) {
          /* one broken listener must not block the rest */
        }
      })
    }

    function usePlacement() {
      if (typeof React.useSyncExternalStore === 'function') {
        return React.useSyncExternalStore(subscribePlacement, getPlacement, getPlacement)
      }
      var state = React.useState(getPlacement())
      React.useEffect(function () {
        return subscribePlacement(function () {
          state[1](getPlacement())
        })
      }, [])
      return state[0]
    }

    // ------------------------------------------------------------------ data

    function requestState(sessionId) {
      var url = API + '/state?sessionId=' + encodeURIComponent(sessionId)
      return fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } }).then(function (response) {
        return response.json()
      })
    }

    function postJson(path, payload) {
      return fetch(API + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
      }).then(function (response) {
        return response.json()
      })
    }

    function failureText(result) {
      if (result === undefined || result === null) return copy().unavailable
      if (typeof result.message === 'string' && result.message !== '') return result.message
      if (typeof result.code === 'string') return result.code
      return copy().unavailable
    }

    // ----------------------------------------------------------------- styles

    var CSS = [
      '.dgb-chip{display:inline-flex;align-items:center;gap:6px;height:28px;max-width:220px;padding:0 8px;',
      'border:none;border-radius:var(--dsw-radius-sm);background-color:transparent;color:var(--dsw-alias-label-secondary);',
      'font:inherit;font-size:13px;font-weight:500;line-height:20px;cursor:pointer;white-space:nowrap;user-select:none;',
      'transition:background-color .1s ease,opacity .14s ease}',
      '@media (hover:hover){.dgb-chip:hover:not([disabled]){background-color:var(--dsw-alias-interactive-bg-hover)}}',
      '.dgb-chip:focus-visible{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);outline-offset:1px}',
      '.dgb-chip[disabled]{cursor:progress;opacity:.7}',
      '.dgb-chip[data-state="notRepo"]{color:var(--dsw-alias-label-tertiary)}',
      '.dgb-chip[data-state="error"]{color:var(--dsw-alias-state-error-primary)}',
      '.dgb-name{min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.dgb-dot{width:6px;height:6px;border-radius:999px;flex:none;background:var(--dsw-alias-state-idle-primary)}',
      '.dgb-chip[data-state="ok"] .dgb-dot{background:var(--dsw-alias-state-success-primary)}',
      '.dgb-chip[data-dirty="1"] .dgb-dot{background:var(--dsw-alias-state-warn-primary)}',
      '.dgb-icon{width:14px;height:14px;flex:none;display:block;opacity:.85}',
      '@media (max-width:860px){.dgb-label{display:none}}',
      '.dgb-pop{position:fixed;z-index:2147483000;display:flex;flex-direction:column;min-height:0;',
      'border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);',
      'color:var(--dsw-alias-label-primary);box-shadow:0 14px 40px color-mix(in srgb,#000 22%,transparent);',
      'font-size:13px;line-height:1.5;overflow:hidden}',
      '.dgb-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dgb-title{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dgb-quiet{display:inline-flex;align-items:center;justify-content:center;height:24px;padding:0 8px;',
      'border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);',
      'font:inherit;font-size:12px;cursor:pointer}',
      '.dgb-quiet:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.dgb-body{display:flex;flex-direction:column;gap:2px;padding:6px;overflow:auto;min-height:0}',
      '.dgb-search{margin:8px 12px 0;height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);',
      'background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}',
      '.dgb-group{padding:6px 6px 2px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
      '.dgb-row{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:none;border-radius:6px;',
      'background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;cursor:pointer}',
      '.dgb-row:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dgb-row[data-current="1"]{font-weight:600}',
      '.dgb-row[disabled]{cursor:progress;opacity:.6}',
      '.dgb-rowname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dgb-meta{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.dgb-empty{padding:10px 12px;color:var(--dsw-alias-label-tertiary);font-size:12px}',
      '.dgb-foot{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dgb-footrow{display:flex;align-items:center;gap:6px}',
      '.dgb-input{flex:1;min-width:0;height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);',
      'background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}',
      '.dgb-select{height:28px;max-width:120px;padding:0 4px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);',
      'background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px}',
      '.dgb-primary{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 12px;border-radius:6px;',
      'border:1px solid transparent;background:var(--dsw-alias-brand-primary);color:#fff;font:inherit;font-size:12px;cursor:pointer}',
      '.dgb-primary:disabled{opacity:.55;cursor:not-allowed}',
      '.dgb-error{margin:0 12px 8px;padding:6px 8px;border-radius:6px;font-size:12px;',
      'color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}',
      '.dgb-note{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dgb-settings{display:flex;flex-direction:column;gap:12px;max-width:640px}',
      '.dgb-settings h2{margin:0;font-size:15px;font-weight:600}',
      '.dgb-option{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:8px;',
      'border:1px solid var(--dsw-alias-border-l1);cursor:pointer}',
      '.dgb-option:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dgb-option[data-active="1"]{border-color:var(--dsw-alias-brand-primary)}',
      '.dgb-optiontext{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.dgb-optionlabel{font-size:13px}',
      '.dgb-optionhint{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}',
      '@media (prefers-reduced-motion:reduce){.dgb-chip{transition:none}}',
    ].join('')

    function injectStyles() {
      try {
        var element = document.getElementById(STYLE_ID)
        if (element === null) {
          element = document.createElement('style')
          element.id = STYLE_ID
          document.head.appendChild(element)
        }
        if (element.textContent !== CSS) element.textContent = CSS
      } catch (error) {
        /* a missing stylesheet only costs polish */
      }
    }

    // ------------------------------------------------------------- chip parts

    function BranchIcon() {
      return React.createElement(
        'svg',
        {
          className: 'dgb-icon',
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.4',
          strokeLinecap: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        React.createElement('circle', { cx: '4.5', cy: '3', r: '1.6' }),
        React.createElement('circle', { cx: '4.5', cy: '13', r: '1.6' }),
        React.createElement('circle', { cx: '11.5', cy: '5.5', r: '1.6' }),
        React.createElement('path', { d: 'M4.5 4.6v6.8' }),
        React.createElement('path', { d: 'M11.5 7.1c0 2.2-1.6 3.2-3.4 3.6' }),
      )
    }

    function popoverStyle(rect) {
      var width = Math.min(340, Math.max(260, window.innerWidth - 24))
      var margin = 8
      var left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin)
      var spaceBelow = window.innerHeight - rect.bottom
      var spaceAbove = rect.top
      if (spaceBelow < 260 && spaceAbove > spaceBelow) {
        return {
          left: left,
          bottom: Math.max(margin, window.innerHeight - rect.top + 6),
          width: width,
          maxHeight: Math.min(460, Math.max(200, spaceAbove - 16)),
        }
      }
      return {
        left: left,
        top: Math.max(margin, rect.bottom + 6),
        width: width,
        maxHeight: Math.min(460, Math.max(200, spaceBelow - 16)),
      }
    }

    function BranchPanel(props) {
      var sessionId = props.sessionId
      var t = copy()
      var state = React.useState({ phase: 'loading' })
      var data = state[0]
      var setData = state[1]
      var errorState = React.useState('')
      var error = errorState[0]
      var setError = errorState[1]
      var busyState = React.useState('')
      var busy = busyState[0]
      var setBusy = busyState[1]
      var queryState = React.useState('')
      var query = queryState[0]
      var setQuery = queryState[1]
      var nameState = React.useState('')
      var newName = nameState[0]
      var setNewName = nameState[1]
      var fromState = React.useState('')
      var from = fromState[0]
      var setFrom = fromState[1]
      var showRemoteState = React.useState(true)
      var showRemote = showRemoteState[0]
      var setShowRemote = showRemoteState[1]

      var load = React.useCallback(
        function () {
          setData({ phase: 'loading' })
          setError('')
          return requestState(sessionId)
            .then(function (result) {
              if (result !== null && result !== undefined && result.ok === true) {
                setData({ phase: 'ok', repo: result.repo })
                props.onLoaded(result.repo)
              } else {
                setData({ phase: result && result.code === 'NOT_A_REPO' ? 'notRepo' : 'error', result: result })
                if (result && result.code !== 'NOT_A_REPO') setError(failureText(result))
              }
            })
            .catch(function (failure) {
              setData({ phase: 'error' })
              setError(String(failure && failure.message ? failure.message : failure))
            })
        },
        [sessionId],
      )

      React.useEffect(function () {
        load()
      }, [load])

      function applyResult(result) {
        if (result !== null && result !== undefined && result.ok === true) {
          setData({ phase: 'ok', repo: result.repo })
          props.onLoaded(result.repo)
          setError('')
          return true
        }
        setError(failureText(result))
        return false
      }

      function runSwitch(name) {
        if (busy !== '') return
        setBusy('switch:' + name)
        postJson('/switch', { sessionId: sessionId, name: name })
          .then(function (result) {
            if (applyResult(result)) {
              setQuery('')
              props.onClose()
            }
          })
          .catch(function (failure) {
            setError(String(failure && failure.message ? failure.message : failure))
          })
          .then(function () {
            setBusy('')
          })
      }

      function runCreate() {
        var name = newName.trim()
        if (name === '' || busy !== '') return
        setBusy('create')
        postJson('/create', { sessionId: sessionId, name: name, from: from })
          .then(function (result) {
            if (applyResult(result)) {
              setNewName('')
              props.onClose()
            }
          })
          .catch(function (failure) {
            setError(String(failure && failure.message ? failure.message : failure))
          })
          .then(function () {
            setBusy('')
          })
      }

      function runInit() {
        if (busy !== '') return
        setBusy('init')
        postJson('/init', { sessionId: sessionId })
          .then(function (result) {
            applyResult(result)
          })
          .catch(function (failure) {
            setError(String(failure && failure.message ? failure.message : failure))
          })
          .then(function () {
            setBusy('')
          })
      }

      var repo = data.phase === 'ok' ? data.repo : null
      var branches = repo === null ? [] : repo.branches
      var lowered = query.trim().toLowerCase()
      var filtered = lowered === '' ? branches : branches.filter(function (branch) {
        return branch.name.toLowerCase().indexOf(lowered) !== -1
      })
      var locals = filtered.filter(function (branch) {
        return !branch.remote
      })
      var remotes = filtered.filter(function (branch) {
        return branch.remote
      })

      var rows = []

      rows.push(
        React.createElement(
          'div',
          { className: 'dgb-head', key: 'head' },
          React.createElement('span', { className: 'dgb-title' }, t.popTitle),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dgb-quiet',
              onClick: function () {
                load()
              },
            },
            t.refresh,
          ),
        ),
      )

      if (data.phase === 'ok' && repo !== null) {
        rows.push(
          React.createElement('input', {
            key: 'search',
            className: 'dgb-search',
            placeholder: t.search,
            value: query,
            onChange: function (event) {
              setQuery(event.target.value)
            },
            'aria-label': t.search,
          }),
        )
      }

      var listItems = []
      if (data.phase === 'loading') {
        listItems.push(React.createElement('div', { className: 'dgb-empty', key: 'loading' }, t.loading))
      } else if (data.phase === 'notRepo') {
        listItems.push(
          React.createElement(
            'div',
            { className: 'dgb-body', key: 'notrepo' },
            React.createElement('div', { className: 'dgb-empty' }, t.initTitle),
            data.result && data.result.cwd
              ? React.createElement('div', { className: 'dgb-empty' }, data.result.cwd)
              : null,
            React.createElement(
              'div',
              { className: 'dgb-empty' },
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dgb-primary',
                  disabled: busy !== '',
                  onClick: runInit,
                },
                busy === 'init' ? t.working : t.initButton,
              ),
            ),
            React.createElement('div', { className: 'dgb-empty' }, t.initNote),
          ),
        )
      } else if (data.phase === 'error') {
        listItems.push(React.createElement('div', { className: 'dgb-empty', key: 'error' }, error || t.unavailable))
      } else if (branches.length === 0) {
        listItems.push(React.createElement('div', { className: 'dgb-empty', key: 'empty' }, t.empty))
      } else if (filtered.length === 0) {
        listItems.push(React.createElement('div', { className: 'dgb-empty', key: 'nomatch' }, t.noMatch))
      } else {
        if (locals.length > 0) {
          listItems.push(React.createElement('div', { className: 'dgb-group', key: 'local' }, t.local))
          locals.forEach(function (branch) {
            listItems.push(branchRow(branch, 'local:' + branch.name))
          })
        }
        if (remotes.length > 0) {
          listItems.push(
            React.createElement(
              'div',
              { className: 'dgb-group', key: 'remote', style: { display: 'flex', gap: '6px', alignItems: 'center' } },
              React.createElement('span', { style: { flex: 1 } }, t.remote),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dgb-quiet',
                  onClick: function () {
                    setShowRemote(!showRemote)
                  },
                },
                showRemote ? '−' : '+',
              ),
            ),
          )
          if (showRemote) {
            remotes.forEach(function (branch) {
              listItems.push(branchRow(branch, 'remote:' + branch.name))
            })
          }
        }
      }

      function branchRow(branch, key) {
        var target = branch.remote ? branch.name.replace(/^[^/]+\//, '') : branch.name
        var meta = []
        if (branch.ahead > 0) meta.push('↑' + branch.ahead)
        if (branch.behind > 0) meta.push('↓' + branch.behind)
        return React.createElement(
          'button',
          {
            key: key,
            type: 'button',
            className: 'dgb-row',
            'data-current': branch.current ? '1' : '0',
            disabled: busy !== '' || branch.current,
            title: branch.subject || branch.name,
            onClick: function () {
              runSwitch(branch.remote ? target : branch.name)
            },
          },
          React.createElement('span', { className: 'dgb-rowname' }, branch.name),
          meta.length > 0 ? React.createElement('span', { className: 'dgb-meta' }, meta.join(' ')) : null,
          branch.current ? React.createElement('span', { className: 'dgb-meta' }, t.current) : null,
        )
      }

      rows.push(
        React.createElement('div', { className: 'dgb-body', key: 'body' }, listItems),
      )

      if (error !== '' && data.phase !== 'error') {
        rows.push(React.createElement('div', { className: 'dgb-error', key: 'err' }, error))
      }

      if (data.phase === 'ok' && repo !== null) {
        var fromOptions = [React.createElement('option', { key: '', value: '' }, repo.current === '' ? t.detached : repo.current)]
        repo.branches
          .filter(function (branch) {
            return !branch.remote
          })
          .forEach(function (branch) {
            if (branch.name === repo.current) return
            fromOptions.push(React.createElement('option', { key: branch.name, value: branch.name }, branch.name))
          })
        rows.push(
          React.createElement(
            'div',
            { className: 'dgb-foot', key: 'foot' },
            React.createElement('div', { className: 'dgb-group', style: { padding: 0 } }, t.newBranch),
            React.createElement(
              'div',
              { className: 'dgb-footrow' },
              React.createElement('input', {
                className: 'dgb-input',
                placeholder: t.newBranchPlaceholder,
                value: newName,
                onChange: function (event) {
                  setNewName(event.target.value)
                },
                onKeyDown: function (event) {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    runCreate()
                  }
                },
                'aria-label': t.newBranchPlaceholder,
              }),
              React.createElement(
                'select',
                {
                  className: 'dgb-select',
                  value: from,
                  onChange: function (event) {
                    setFrom(event.target.value)
                  },
                  title: t.newBranchStart,
                  'aria-label': t.newBranchStart,
                },
                fromOptions,
              ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dgb-primary',
                  disabled: busy !== '' || newName.trim() === '',
                  onClick: runCreate,
                },
                busy === 'create' ? t.working : t.create,
              ),
            ),
          ),
        )
      }

      return ReactDOM.createPortal(
        React.createElement(
          'div',
          {
            className: 'dgb-pop',
            style: popoverStyle(props.anchorRect),
            role: 'dialog',
            'aria-label': t.popTitle,
          },
          rows,
        ),
        document.body,
      )
    }

    function BranchChip(props) {
      var t = copy()
      var placementNow = usePlacement()
      var sessionId = props.sessionId
      var state = React.useState({ phase: 'loading' })
      var data = state[0]
      var setData = state[1]
      var openState = React.useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      var anchorState = React.useState(null)
      var anchor = anchorState[0]
      var setAnchor = anchorState[1]
      var buttonRef = React.useRef(null)

      React.useEffect(function () {
        if (typeof sessionId !== 'string' || sessionId === '') return undefined
        var cancelled = false
        requestState(sessionId)
          .then(function (result) {
            if (cancelled) return
            if (result !== null && result !== undefined && result.ok === true) {
              setData({ phase: 'ok', repo: result.repo })
            } else {
              setData({ phase: result && result.code === 'NOT_A_REPO' ? 'notRepo' : 'error', result: result })
            }
          })
          .catch(function () {
            if (!cancelled) setData({ phase: 'error' })
          })
        return function () {
          cancelled = true
        }
      }, [sessionId])

      var closePanel = React.useCallback(function () {
        setOpen(false)
        setAnchor(null)
      }, [])

      if (placementNow !== props.placementId || typeof sessionId !== 'string' || sessionId === '') return null

      function toggle(event) {
        event.preventDefault()
        event.stopPropagation()
        if (open) {
          closePanel()
          return
        }
        var element = buttonRef.current
        if (element === null) return
        setAnchor(element.getBoundingClientRect())
        setOpen(true)
      }

      var label = ''
      var stateName = data.phase
      if (data.phase === 'loading') label = t.loading
      else if (data.phase === 'notRepo') label = t.notRepo
      else if (data.phase === 'error') label = t.unavailable
      else {
        label = data.repo.detached ? t.detached : data.repo.current || t.detached
      }
      var dirty = data.phase === 'ok' && data.repo.dirty.total > 0 ? '1' : '0'

      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dgb-chip',
            ref: buttonRef,
            'data-state': stateName,
            'data-dirty': dirty,
            'aria-haspopup': 'dialog',
            'aria-expanded': open ? 'true' : 'false',
            title:
              data.phase === 'ok'
                ? t.popTitle + (dirty === '1' ? ' · ' + t.dirty : '')
                : data.phase === 'notRepo'
                  ? t.notRepo
                  : t.popTitle,
            onClick: toggle,
          },
          React.createElement(BranchIcon, null),
          React.createElement('span', { className: 'dgb-name dgb-label' }, label),
          React.createElement('span', { className: 'dgb-dot' }),
        ),
        open && anchor !== null
          ? React.createElement(BranchPanel, {
              sessionId: sessionId,
              anchorRect: anchor,
              onClose: closePanel,
              onLoaded: function (repo) {
                setData({ phase: 'ok', repo: repo })
              },
            })
          : null,
      )
    }

    function makeSlotComponent(placementEntry) {
      return function SlotChip(props) {
        var input = props === null || props === undefined ? {} : props
        return React.createElement(BranchChip, {
          sessionId: input.sessionId,
          placementId: placementEntry.id,
        })
      }
    }

    // --------------------------------------------------------------- settings

    function SettingsNavIcon(props) {
      var size = props !== null && props !== undefined && typeof props.size === 'number' ? props.size : 16
      return React.createElement(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: '1.4',
          strokeLinecap: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        React.createElement('circle', { cx: '4.5', cy: '3', r: '1.6' }),
        React.createElement('circle', { cx: '4.5', cy: '13', r: '1.6' }),
        React.createElement('circle', { cx: '11.5', cy: '5.5', r: '1.6' }),
        React.createElement('path', { d: 'M4.5 4.6v6.8' }),
        React.createElement('path', { d: 'M11.5 7.1c0 2.2-1.6 3.2-3.4 3.6' }),
      )
    }

    function SettingsSection() {
      var t = copy()
      var current = usePlacement()
      var options = PLACEMENTS.map(function (entry) {
        var label = t[entry.labelKey]
        return React.createElement(
          'label',
          {
            key: entry.id,
            className: 'dgb-option',
            'data-active': current === entry.id ? '1' : '0',
          },
          React.createElement('input', {
            type: 'radio',
            name: 'dsh-git-branch-placement',
            value: entry.id,
            checked: current === entry.id,
            onChange: function () {
              setPlacement(entry.id)
            },
          }),
          React.createElement(
            'span',
            { className: 'dgb-optiontext' },
            React.createElement('span', { className: 'dgb-optionlabel' }, label),
            React.createElement('span', { className: 'dgb-optionhint' }, entry.slot),
          ),
        )
      })
      return React.createElement(
        'div',
        { className: 'dgb-settings' },
        React.createElement('h2', null, t.settingsTitle),
        React.createElement('p', { className: 'dgb-note' }, t.settingsIntro),
        options,
        React.createElement('p', { className: 'dgb-note' }, t.settingsNote),
      )
    }

    // ------------------------------------------------------------------ apply

    function apply(ctx) {
      hostLocale = readLocaleService(ctx)
      injectStyles()

      PLACEMENTS.forEach(function (entry) {
        try {
          ctx.slots.inject(entry.slot, function () {
            return ctx.slots.register(
              {
                name: entry.slot,
                id: PACKAGE_ID + '-' + entry.id,
                order: 40,
                label: function () {
                  return copy().chipLabel
                },
                inject: function (sessionId) {
                  return { sessionId: sessionId }
                },
              },
              makeSlotComponent(entry),
            )
          })
        } catch (error) {
          try {
            console.error('[' + PACKAGE_ID + '] failed to register ' + entry.slot, error)
          } catch (ignored) {
            /* nothing to do */
          }
        }
      })

      try {
        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register(
            {
              name: 'settings.section',
              id: PACKAGE_ID,
              order: 62,
              label: function () {
                return copy().settingsNav
              },
            },
            SettingsSection,
          )
        })
      } catch (error) {
        try {
          console.error('[' + PACKAGE_ID + '] failed to register settings section', error)
        } catch (ignored) {
          /* nothing to do */
        }
      }

      try {
        ctx.slots.inject('settings.section.icon', function () {
          return ctx.slots.register(
            {
              name: 'settings.section.icon',
              id: PACKAGE_ID,
              order: 62,
              label: function () {
                return copy().settingsNav
              },
            },
            SettingsNavIcon,
          )
        })
      } catch (error) {
        try {
          console.error('[' + PACKAGE_ID + '] failed to register settings icon', error)
        } catch (ignored) {
          /* nothing to do */
        }
      }
    }

    module.exports = {
      name: PACKAGE_ID,
      inject: ['slots'],
      apply: apply,
    }
    return module.exports
  },
})
