# 投稿到插件市场（awesome-dsh-plugin）

[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的收录规则见仓库根的
`contributing.md`：**一次投稿 = 一个 YAML 文件**，路径 `data/plugins/<owner>__<repo>.yml`。

`scripts/publish-market.mjs` 把这件事收成命令：先按规则自检，再生成条目，需要时直接 fork + 提交 + 开 PR。

## 一次性准备

1. **把仓库推到 GitHub**（脚本要按 `owner/repo` 生成 URL，`url` 必须与仓库完全一致）。没有 `origin` 时用
   `--repo owner/name` 指定。
2. 给仓库加 **`dsh-plugin`** topic（仓库页 About → Topics）。
3. 确认下面几条，脚本会检查，CI 也会：

   - `package.json` 有 `dsh.bundle.patch`（本仓库指向 `./cordis.patch.yml`）；只声明 `dsh.client` 不可安装，会被拒。
   - 仓库创建满 **1 天**（自动检查）。
   - 仓库里有真实代码，不是占位或纯 README。
   - 描述只说功能，不带营销词，英文以句号结尾。

4. 准备 token（仅 `--apply` 需要）：环境变量 `GITHUB_TOKEN` 或 `GH_TOKEN`。
   classic PAT 勾 `public_repo` 即可。**不要写进仓库或脚本**，只在命令行临时给。

## 用法

```bash
# 1) 自检 + 生成本地条目（不联网提交）
npm run market

# 2) 真正提交：fork 列表仓库 → 建分支 → 写条目 → 开 PR
GITHUB_TOKEN=xxx npm run market:apply
```

常用参数（两者都支持）：

| 参数 | 说明 |
| --- | --- |
| `--repo owner/name` | 目标仓库；默认取 `git remote get-url origin` |
| `--category <name>` | 分类，默认 `git`；可选 `agi ui usage theme model identity session memory tools wsl browser vision voice docs skill workflow git notify dev security remote market fun` |
| `--en "<text>"` / `--zh "<text>"` | 覆盖默认描述 |
| `--icon <url>` | 可选市场卡片图，必须是 **GitHub 托管的位图**（png/jpg/webp，方形最佳） |
| `--no-check` | 跳过 GitHub 侧检查（离线/仓库还没推上去时用） |
| `--out <path>` | 自检产物写到别处（默认 `market/<owner>__<repo>.yml`） |

默认描述（与代码对应，改前先确认功能）：

- en: `Switch and create Git branches from a chip next to the DSH composer, with a matching git_branch tool and /branch command.`
- zh: `在 DSH 输入框旁用控件切换与创建 Git 分支，并提供 git_branch 工具与 /branch 命令。`

## 脚本检查了什么

本地：

- `dsh.bundle.patch` 存在且指向真实文件；`version` 存在。
- 带 `dsh.client.platform: web` 时给出提示（有前端 UI）。
- 描述：英文句号结尾、中文句号结尾、不含营销词。

远端（用 GitHub API，不需要 token）：

- 仓库存在、未归档、非私有。
- 仓库创建时间 ≥ 1 天。
- 有 `dsh-plugin` topic。
- 远端默认分支的 `package.json` 里确实有 `dsh.bundle.patch`（提醒你先 push）。

有硬性不达标项时脚本以非零码退出，并逐条列出要改什么，**不会**提交。

## 提交之后

- CI 依次检查：条目数（一个 PR 最多 3 条）、`dsh.bundle`、仓库年龄、`awesome-lint` 与站点构建。
- 维护者会读代码核对描述里的每个声明（数字、命令名、API），夸大是最常见的打回原因。
- 需要修改时会打 `held: author` 标签：把修改推到**同一个分支**，留**一条**评论说明改了什么即可，不要反复推送催。
- README 是生成的，不要手改；只改 `data/plugins/<owner>__<repo>.yml`，也**只改自己那一条**。
- 冲突（通常发生在生成的 README 行上）由维护者 rebase 解决，你自己推什么都改不了那一栏。

## 可选的加分项

- **发 npm**：预构建安装可跳过 `allowBuilds` 构建授权。本仓库 `package.json` 现在是 `"private": true`，
  要发布需改成 `false`，并补 `repository` 字段指回 GitHub 仓库（否则市场不会把包和仓库关联）。发布后以
  `registry.npmjs.org/<name>` 的 `dist-tags.latest` 与可下载的 `dist.tarball` 为准，别只看 `npm publish` 的提示。
- **GitHub Release tarball**：不发 npm 时，把预构建 `.tgz` 挂到 Release，用条目里的 `tarball:` 指向它；
  若用 `latest/download/`，资产名不要带版本号（否则下次发版就 404）。
- **截图**：在仓库里放 `screenshots.json`（1–8 张，相对路径），市场详情页按它展示，后续换图只推自己的仓库。
- **图标**：条目 `icon:` 只接受 GitHub 托管的位图。本仓库目前只有 `icon.svg`，不填 `icon:` 时市场回退到作者头像；
  想要自定义卡片图，先导出一张方形 PNG（≤ 256 KiB）放进 `assets/` 再 `--icon` 指向它。
- **官方包依赖**：若将来引入 `@deepseek-ai/*`，请用 `peerDependencies`，且 peer 范围要带显式预发布分支，
  否则会静默排除预发布版 harness。

## 版本策略

- `1.0.0`：功能完整的首个版本（控件面板、`git_branch` 工具、`/branch` 命令、非仓库目录建库、五个可切换位置）。
- 之后：修 bug 走 `1.0.x`；加位置选项、新的分支操作等行为变化走 `1.1.0`。
- 条目本身不带版本号，市场按仓库 `package.json` 读取；改版本只需改 `package.json` 并 push。
