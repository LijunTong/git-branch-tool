# dsh-git-branch

DSH bundle：在对话里切换 / 新建 Git 分支，支持为非 Git 目录初始化仓库，控件位置可在设置里改。

- 控件：composer / 会话标题右侧等 5 个位置之一（设置 → Git 分支）
- 工具：`git_branch`（list / switch / create / init / delete）
- 命令：`/branch [list | switch <名> | create <名> [起点] | init]`

## 安装

用 `plugin_manager` 的 `install_bundle` 指向这个目录（本地目录会被链接安装，不需要打包）：

```
plugin_manager action=install_bundle target=<此目录绝对路径>
```

## 结构

| 文件 | 作用 |
| --- | --- |
| `lib/git.js` | 纯 git 核心：探测仓库、读状态、切换、新建、初始化、删除；只依赖注入的 `run(args)` |
| `lib/index.js` | Host 半侧：4 个 loopback HTTP 路由 + `git_branch` 工具 + `/branch` 命令 |
| `lib/client.js` | Client 半侧：分支控件、面板、设置页；只 require `react` 与 `react-dom` |
| `cordis.patch.yml` | bundle 插入行 |
| `locale/*.json` | Plugin Manager 的标题 / 描述 / 详情路径 |
| `docs/DETAIL.md` | 详情页文档 |
| `test/git.test.mjs` | 假 runner 的核心逻辑测试（不需要真仓库） |
| `scripts/publish-market.mjs` | 投稿到 awesome-dsh-plugin：自检 + 生成条目 + 可选一键 fork/PR |
| `docs/MARKET.md` | 投稿说明与前置条件 |

## 开发

```bash
node --test test/
```

只测 `lib/git.js`（纯函数 + 注入 runner），Host 路由与 UI 通过安装后的实际界面验证。

## 投稿到插件市场

```bash
npm run market                              # 自检 + 生成 market/<owner>__<repo>.yml
GITHUB_TOKEN=xxx npm run market:apply       # fork 列表仓库并开 PR
```

细节见 `docs/MARKET.md`。

## 显示位置

见 `docs/DETAIL.md`。偏好存 `localStorage`，不写 profile 配置。
