# Git 分支切换（dsh-git-branch）

## 它做什么

在对话界面里放一个分支控件，点开就能看到当前分支、本地与远程分支列表、工作区改动数量，并直接切换或新建分支。目录还不是 Git 仓库时，同一个控件里可以直接初始化仓库。

三处入口共用同一套 git 逻辑：

- 对话界面的分支控件（点击展开面板）；
- agent 工具 `git_branch`（`action` 为 `list`、`switch`、`create`、`init`、`delete`）；
- 斜杠命令 `/branch`（`/branch`、`/branch switch <名>`、`/branch create <名> [起点]`、`/branch init`）。

## 怎么用

1. 点分支控件：显示当前分支名与工作区改动点。
2. 面板里可筛选、点分支名切换；本地不存在的远程分支会在切换时自动 `--track` 建立同名本地分支。
3. 「新建分支」填名字、选起点（默认当前 HEAD），回车或点「创建并切换」。
4. 目录不是仓库时，面板显示目录路径与「在此目录创建 Git 仓库」按钮。
5. 切换失败（例如本地改动会被覆盖、分支被其它 worktree 占用）时，面板显示 git 原始错误首行，不做自动兜底。

控件按会话记住上一次读到的分支状态：重新进入会话时直接显示分支名，后台静默刷新；首次读取期间显示「分支加载中…」并自动重试（400ms / 900ms / 1.8s / 3.2s），窗口重新获得焦点时再刷新一次，所以在终端里换过分支也会同步过来。

## 显示位置

设置 → 「Git 分支」里可选五个位置，每个选项都带一张输入框示意图，标出控件会落在哪里。五项均为 DSH 官方 list slot，不会替换任何内置控件：

| 选项 | slot |
| --- | --- |
| 输入框内左侧（默认） | `conversation.input.left` |
| 输入框内右侧 | `conversation.input.right` |
| 输入框上方 | `conversation.input.dock` |
| 输入框下方 | `conversation.composer.dock` |
| 会话标题右侧 | `conversation.session.header.utilities` |

位置偏好按浏览器保存在 `localStorage`（键 `dsh-git-branch:placement`），不写入 DSH 配置，换浏览器或清除站点数据后回到默认位置。

## 限制

- 只处理工作目录所在仓库，不管理 worktree、不处理 stash、不推送。
- 工作区有冲突改动时不会被强制切换，`git switch` 报什么就显示什么。
- 删除分支只走 `git branch -d`（已合并才删），不会强删未合并分支。
- 需要本机 `PATH` 里有 `git`；缺失时控件显示不可用。
- 单次 git 命令有 15 秒超时；同一目录的写操作串行执行，避免 `index.lock` 冲突。
