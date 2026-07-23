# Somnus Ghost deployment

This directory contains the reproducible Ghost 6 deployment, the custom
`somnus-yohaku` theme, and the Zola-to-Ghost migration tooling.

后台登录、写作、内部标签和评论账号说明见 [ADMIN_GUIDE.md](ADMIN_GUIDE.md)。
艺术风格、字体和本地预览说明见 [DESIGN.md](DESIGN.md)。
文章阅读量、实时在线和点赞服务见 [ANALYTICS_GUIDE.md](ANALYTICS_GUIDE.md)。

## 跨设备维护指南

这个项目可以在新设备上直接 `clone` 后继续维护，但 Git 只同步代码，
不会同步 Ghost 数据库、文章、上传图片或任何私密密钥。

### 哪些内容通过什么方式同步

| 内容 | 保存位置 | 跨设备方式 |
| --- | --- | --- |
| Ghost 主题、Worker、部署脚本和文档 | GitHub 仓库 | `git pull` / `git push` |
| 线上文章、Page、会员和站点设置 | 腾讯云 Ghost 数据库 | 直接登录线上 Ghost Admin |
| 本地文章、Page 和本地管理员 | 每台设备自己的 `content/`、`mysql/` | 不自动同步；按需运行 `make demo` 或在本地后台创建 |
| 生产环境变量和服务密钥 | 腾讯云、GitHub Actions、Cloudflare、Tinybird | 在对应平台单独配置，禁止提交到 Git |
| 本地开发环境变量 | 本机 `.env` | 从 `.env.example` 创建，禁止提交到 Git |

只修改文章内容时不需要 clone 项目，直接登录
`https://blog.somnus.wiki/ghost/` 即可。修改主题、Worker、部署配置或脚本时，
才需要使用本仓库。

### 1. 准备新设备

安装以下工具：

- Git
- Docker Desktop
- Python 3
- Node.js/npm（`make check`、Cloudflare Worker 和 Tinybird 会使用）

为每台新设备单独创建 SSH 密钥，不要通过网盘或 Git 复制旧设备的私钥：

```bash
ssh-keygen -t ed25519
```

把新设备的公钥添加到 GitHub。需要维护腾讯云服务器时，再把该公钥添加到
服务器的 `~/.ssh/authorized_keys`，并在本机 `~/.ssh/config` 中配置别名：

```sshconfig
Host tencent-cloud
    HostName <腾讯云服务器地址>
    User ubuntu
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
```

测试连接：

```bash
ssh -T git@github.com
ssh tencent-cloud
```

SSH 私钥、服务器地址、密码和 Token 都不能写入本仓库。

### 2. Clone 并初始化本地环境

```bash
git clone git@github.com:somnus0917/ghost-blog.git
cd ghost-blog
cp .env.example .env
```

如果选择 HTTPS clone，则需要使用 GitHub Credential Manager、Personal Access
Token 或 `gh auth login` 完成 push 身份验证。

编辑本机 `.env`，至少为 MySQL 用户和 root 设置两个不同的随机密码。本地开发
不需要复制生产环境的 Resend、Tinybird、Turnstile 或 Ghost Admin API 密钥。

启动 Docker Desktop，然后运行：

```bash
make dev
```

第一次启动后访问：

```text
http://127.0.0.1:2369/ghost/
```

完成本地 Ghost 管理员初始化，再运行：

```bash
make demo
```

`make demo` 会添加仓库内的示例内容并激活主题，但不会复制生产数据库。
需要测试只在特定 slug 下生效的 Page 模板时，要在本地 Ghost Admin 创建同名
Page。例如 `page-latex.hbs` 需要一个已发布且 slug 为 `latex` 的本地 Page，
否则访问 `/latex/` 会返回 404。

### 3. 每次开始开发

不要在两台设备上同时保留未推送的修改。开始前先检查并更新代码：

```bash
cd ghost-blog
git status
git switch main
git pull --ff-only origin main
make dev
```

`make dev` 会把 `theme/somnus-yohaku/` 和 `routes.yaml` 同步到本地 Ghost。
修改主题文件后，如果浏览器没有出现新效果，再运行一次 `make dev` 并强制刷新。

### 4. 完成修改并推送

```bash
make check
git diff --check
git status
git add <本次修改的文件>
git commit -m "描述本次修改"
git pull --rebase origin main
git push origin main
```

如果 `git pull` 提示本地有未提交修改，先提交、暂存或明确处理这些修改，
不要使用 `git reset --hard` 覆盖它们。

推送 `main` 后：

- `theme/**` 等主题相关修改会触发 GitHub Actions，验证通过后通过
  Ghost Admin API 自动部署到线上。
- GitHub Actions 的 `GHOST_ADMIN_API_URL` 和 `GHOST_ADMIN_API_KEY`
  保存在 GitHub 仓库 Secrets 中，新设备不需要复制。
- 文章、Page 和会员数据不会被主题部署覆盖。

在 GitHub 仓库的 Actions 页面确认部署成功后，再检查线上页面。

### 5. 不会自动部署的修改

`git push` 只会自动部署工作流中声明的主题相关文件。以下修改需要额外操作：

- `routes.yaml`：需要上传到 Ghost Admin 的 Routes 设置，或同步到腾讯云并重启
  Ghost；只 push 不会更新线上路由。
- `worker/**`：需要在 `worker/` 目录完成 Wrangler 登录和配置后运行
  `npx wrangler deploy`。
- `server/**`、`docker-compose.yml`、生产 `.env`：需要通过 SSH/rsync 同步到
  腾讯云并按部署文档执行。
- Ghost 文章和 Page：直接在 Ghost Admin 编辑，不通过 Git 部署。

`worker/wrangler.toml`、`.env`、`.private/`、`.wrangler/`、`content/` 和
`mysql/` 已被 `.gitignore` 排除。不要为了方便跨设备而取消这些忽略规则。

### 6. 结束本地开发

不必每次修改后执行 `make stop`。需要释放 Docker 占用的内存时运行：

```bash
make stop
```

这会停止本地容器，不会删除 `content/` 和 `mysql/` 中的本地数据。下次运行
`make dev` 可以继续使用。如果只是合上电脑或准备换设备，先确认：

```bash
git status
git log -1 --oneline
```

确保需要保留的代码已经 commit 并 push；未推送的提交和未提交文件只存在于
当前设备。

### 7. 常见问题

- `/latex/` 等 Page 返回 404：本地数据库缺少对应 slug 的已发布 Page。
- 修改主题后页面没变化：重新运行 `make dev`，然后强制刷新浏览器。
- `2369` 端口被占用：先运行 `make stop`，再运行 `make dev`。
- 新设备没有线上文章：这是正常现象；线上内容在腾讯云 Ghost 数据库中。
- Push 后线上没变化：先查看 GitHub Actions；确认修改属于自动部署的
  `theme/**` 范围。
- 需要恢复生产内容：使用服务器备份，不要把本地 `mysql/` 或 `content/`
  提交到 Git。

## Local theme workflow

The standalone project directory is this repository. From its root, run:

```bash
cp .env.example .env
make dev
make demo
make check
```

Start Docker Desktop first. `make dev` creates the required local Docker network,
starts a local Ghost instance at `http://127.0.0.1:2369`, and syncs the theme into
its content directory. On the first run, finish setup at
`http://127.0.0.1:2369/ghost/` and activate `somnus-yohaku`. Commit and push visual
changes to `main` after `make check` passes.

`make demo` idempotently adds sample articles, notes, and diary entries to the
local Ghost database and activates `somnus-yohaku`. It never writes a local Admin
API key to disk or command output. Run it again with
`python3 scripts/seed_demo_content.py --update-existing` to restore edited demo
posts to the repository versions.

The theme self-hosts LXGW WenKai in WOFF2 format. The upstream OFL license is
included in `shared/fonts/OFL.txt`. The font is installed once into Ghost's persistent
`content/images/fonts/` directory, keeping routine theme deployments small and fast.

## Turnstile-protected member signup

The `/signup/` route uses Cloudflare Turnstile before Ghost sends a membership
magic link. The public site key lives in `theme/somnus-yohaku/signup.hbs`.
The private Turnstile key and the private Caddy-to-Worker forwarding key are
stored only as runtime secrets:

```bash
cd worker
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put MEMBERS_PROXY_SECRET
```

`MEMBERS_PROXY_SECRET` must contain the same random value in the Caddy
container environment. Caddy intercepts `/members/api/send-magic-link/` so
signup and subscribe requests cannot bypass Turnstile. Existing-member sign-in
still uses Ghost's normal passwordless flow. Never commit either secret.

## GitHub Actions deployment

`.github/workflows/theme-cicd.yml` validates pull requests. Theme changes pushed to
`main` are built once and deployed through Ghost's official Admin API theme action.
This grants no Tencent Cloud shell access. Production secrets are stored in GitHub
Actions, not in this repository:

- `GHOST_ADMIN_API_URL`
- `GHOST_ADMIN_API_KEY`

## Build the migration bundle

Build the old Zola site first, then point the migration tool at that Zola project.
Run these commands from this Ghost repository:

```bash
zola --root /path/to/zola-site build --force --drafts
python3 scripts/migrate_zola.py --zola-root /path/to/zola-site
make theme
```

Generated files are written to `build/` and ignored by Git. If the Zola project is
the parent directory of this repository, `--zola-root` may be omitted.

## Deploy on the Tencent Cloud host

```bash
rsync -av \
  --exclude .git --exclude .env --exclude .private \
  --exclude build --exclude content --exclude mysql --exclude backups \
  ./ tencent-cloud:/home/ubuntu/ghost-blog/
ssh tencent-cloud 'bash /home/ubuntu/ghost-blog/server/bootstrap.sh'
```

During staging, Ghost is only exposed on remote `127.0.0.1:2368`. Preview it
through an SSH tunnel:

```bash
ssh -N -L 2368:127.0.0.1:2368 tencent-cloud
```

Provision through the tunnel. The script creates the owner on first run, imports
new content idempotently, and activates the theme:

```bash
python3 scripts/provision_ghost.py --url http://localhost:2368
python3 scripts/configure_ghost.py --url http://localhost:2368
```

After changing migration logic, update existing items in place while preserving
their Ghost-generated slugs:

```bash
python3 scripts/provision_ghost.py --url http://localhost:2368 --update-existing
python3 scripts/rebuild_redirects.py --url http://localhost:2368 --zola-root /path/to/zola-site
python3 scripts/reconcile_ghost.py --url http://localhost:2368 --report
```

Owner credentials are stored locally in `.private/ghost-owner.json` with mode
`0600`; the file is ignored by Git.

## Production cutover

Set `GHOST_URL=https://blog.somnus.wiki` in the server `.env`, append
`Caddyfile.snippet` to `/home/ubuntu/caddy/Caddyfile`, and recreate the two
Compose services. The snippet also proxies Ghost 6's hosted ActivityPub routes.

The production container remains bound to `127.0.0.1:2368`; only Caddy is
internet-facing. DNS should point `blog.somnus.wiki` to the Tencent Cloud host.

## Backups

`server/backup.sh` creates a compressed MySQL dump and content archive, keeps
14 days, and writes files with owner-only permissions. The included systemd
timer runs daily around 03:20 Asia/Shanghai.
