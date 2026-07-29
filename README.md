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

- 主题、Worker、Caddy、Routes 或字体相关修改会触发同一条生产部署流水线。
- 流水线完成完整检查后，依次同步持久字体、安装 Caddy 配置、部署 Routes、
  通过 Ghost Admin API 部署主题、应用 D1 migration、部署 Worker，最后运行
  完整生产冒烟测试。同一时间只允许一条生产部署运行。
- GitHub Actions 的 `GHOST_ADMIN_API_URL` 和 `GHOST_ADMIN_API_KEY`
  保存在 GitHub 仓库 Secrets 中，新设备不需要复制。
- 文章、Page 和会员数据不会被主题部署覆盖。

在 GitHub 仓库的 Actions 页面确认部署成功后，再检查线上页面。

### 5. 自动部署凭证与仍需手工处理的修改

生产流水线需要在 GitHub `production` Environment 配置：

```text
CLOUDFLARE_API_TOKEN
GHOST_ADMIN_API_URL
GHOST_ADMIN_API_KEY
PRODUCTION_SSH_HOST
PRODUCTION_SSH_KEY
PRODUCTION_SSH_KNOWN_HOSTS
```

缺少任意一项凭证时，验证仍会给出结果，但生产部署会明确失败，避免出现
“工作流绿色但线上没有更新”的假象。Cloudflare Token 只授予目标账号的
Worker、D1 和路由部署权限；SSH 固定使用受限的 `ghost-deploy` 账户及其单独
部署密钥。

生产流水线会让腾讯云主机拉取 `main`，因此 `routes.yaml`、字体、Compose 与
版本控制的服务器脚本都会随代码部署。Routes 内容未变化时不会重启 Ghost；内容
变化时会保留旧版本，重启和路由检查失败会自动回滚。字体在主题部署前同步并通过
公网 manifest 再次核对。以下修改仍需要额外操作：

- systemd unit 和生产 `.env` 不在 Git 中，需要通过 SSH 在服务器上单独安装或
  更新；`.env` 中的运行时路径与密钥不得提交。
- Ghost 文章和 Page：直接在 Ghost Admin 编辑，不通过 Git 部署。

`worker/wrangler.toml` 只保存可公开的绑定 ID 和变量，已纳入版本控制；
Worker Secret 仍只保存在 Cloudflare。`.env`、`.private/`、`.wrangler/`、
`content/` 和 `mysql/` 已被 `.gitignore` 排除，不要取消这些忽略规则。

部署后也可以从任意维护设备运行：

```bash
make monitor
make smoke
```

`make monitor` 只读取首页、文章、响应头和互动接口，适合定时监控。
`make smoke` 还会验证签名 Cookie 和在线状态写入。两者都不会修改点赞、文章、
会员或其他长期业务数据。GitHub Actions 每六小时自动运行一次只读监控。

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

The site self-hosts LXGW WenKai in WOFF2 format. The upstream OFL license is
included in `shared/fonts/OFL.txt`. The deployable theme contains a roughly
0.4 MiB core built from the public article corpus and interface copy. Complete
`unicode-range` shards for all remaining characters live outside the theme under
`shared/fonts/lxgw-wenkai-v2/` and are served from
`/content/images/fonts/lxgw-wenkai-v2/`. A normal page only fetches the core; a new
or rare character fetches its matching LXGW WenKai shard instead of falling back
to a visibly different system font. To refresh both deterministic layers:

```bash
npm install
python3 -m venv .venv-fonts
.venv-fonts/bin/pip install -r requirements-fonts.txt
npm run build:font
make check
```

Run `server/sync-fonts.sh` on production before pushing a rebuilt font manifest.
The deployment workflow refuses to activate a theme whose persistent manifest is
not already live. `make dev` performs the equivalent local sync automatically.
CSS `unicode-range` selects only the files needed by the characters on the current
page, while the core font is preloaded with the same URL used by the generated
CSS. Ghost Search loads after the first search action, while the comments UI loads
only when its section is within 800px of the viewport.

Theme source files live under `theme/src/`. JavaScript is split by runtime,
site interaction, engagement, and rich-content responsibilities; CSS is split
into core, Ghost cards, editorial, and feature layers. `make theme` bundles and
minifies those sources into `theme/somnus-yohaku/assets/`. Portal, Search, and
Comments UI are pinned and self-hosted in the theme so the public site does not
depend on jsDelivr at runtime.

For repeatable browser validation, use the isolated Ghost stack on port `2370`.
It has its own MySQL volume and test-only owner account and does not modify the
normal local site on port `2369`:

```bash
make e2e
make lighthouse
make e2e-down
```

Playwright covers desktop/mobile navigation, theme persistence, article layouts,
lazy Search/Comments loading, and MathJax/Mermaid loading. Lighthouse CI enforces
performance, accessibility, best-practices, SEO, and total-byte budgets. The
`Theme browser regression` workflow runs both gates for relevant pull requests
and pushes. Caddy enforces CSP only on public routes, keeps Ghost Admin and member
endpoints outside that policy, and gives versioned assets immutable cache headers.

## Turnstile-protected member signup

The `/signup/` route uses Cloudflare Turnstile before Ghost sends a membership
magic link. The public site key lives in `theme/somnus-yohaku/signup.hbs`.
The private Turnstile key and both private proxy keys are stored only as runtime
secrets:

```bash
cd worker
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put MEMBERS_PROXY_SECRET
npx wrangler secret put VISITOR_HASH_SALT
npx wrangler secret put VISITOR_COOKIE_SECRET
npx wrangler secret put WORKER_PROXY_SECRET
```

`MEMBERS_PROXY_SECRET` must contain the same random value in the Caddy
container environment. Caddy intercepts `/members/api/send-magic-link/` so
signup and subscribe requests cannot bypass Turnstile. Existing-member sign-in
still uses Ghost's normal passwordless flow. The Caddy installer refuses to
reload when either proxy secret is missing, too short, or reused for both
boundaries.

`WORKER_PROXY_SECRET`, `MEMBERS_PROXY_SECRET`, `VISITOR_HASH_SALT`, and
`VISITOR_COOKIE_SECRET` must be four different random values of at least 32
characters. Configure both proxy secrets in Wrangler and in Caddy's environment.
The Worker rejects direct requests that do not carry the Caddy-injected worker
credential. It uses the dedicated cookie secret to sign an HttpOnly visitor
cookie, so engagement identity is no longer trusted from request JSON. Legacy
`X-Like-Visitor` values are intentionally ignored; a browser without a valid
signed cookie receives a fresh engagement identity. Never commit any of these
secrets, and do not rotate an existing `VISITOR_HASH_SALT` without planning a
like-identity migration.

For an existing production installation, roll this change out in this order to
avoid an API interruption:

1. Generate two different proxy keys, add `WORKER_PROXY_SECRET` and
   `MEMBERS_PROXY_SECRET` to Caddy's environment, and recreate the Caddy
   container.
2. Add the matching values with `npx wrangler secret put WORKER_PROXY_SECRET`
   and `npx wrangler secret put MEMBERS_PROXY_SECRET`.
3. Apply D1 migrations and deploy the Worker:

   ```bash
   npx wrangler d1 migrations apply somnus-blog-engagement --remote
   npx wrangler deploy
   ```

The presence cleanup cron runs every ten minutes and deletes at most 5,000 expired
rows per invocation. Live engagement queries already ignore expired rows. Public
statistics reads, presence writes, and like writes are all limited by signed
visitor identity and the client IP supplied by Caddy.

## GitHub Actions deployment

`.github/workflows/theme-cicd.yml` runs the complete project checks for theme pull
requests. `.github/workflows/production-cicd.yml` is the single production writer:
it serializes server configuration, persistent fonts, Ghost routes, the checked
theme archive, D1 migrations, and the Worker before running the production smoke
test. Missing credentials fail the relevant deployment instead of producing a
misleading successful run.
`.github/workflows/project-ci.yml` runs the same complete checks for Worker,
server, routing, and infrastructure changes. Actions are pinned to immutable commit
SHAs. Production secrets are stored in GitHub Actions, not in this repository:

- `CLOUDFLARE_API_TOKEN`
- `GHOST_ADMIN_API_URL`
- `GHOST_ADMIN_API_KEY`
- `PRODUCTION_SSH_HOST`
- `PRODUCTION_SSH_USER`
- `PRODUCTION_SSH_KEY`
- `PRODUCTION_SSH_KNOWN_HOSTS`

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

Production code is a Git checkout; Ghost content, MySQL data, and backups live
outside it at `/home/ubuntu/ghost-data`. This lets deployments advance or roll
back the checkout without overwriting the site data. The host needs a read-only
GitHub Deploy Key (or equivalent GitHub App credential) for this repository.

For the one-time migration from the previous rsync layout, give the existing
directory a Git remote first. This preserves ignored runtime directories while
replacing tracked deployment files with `main` (the server needs its read-only
Deploy Key before `git fetch` will work):

```bash
ssh tencent-cloud '
  set -e
  cd /home/ubuntu/ghost-blog
  git init
  git remote add origin git@github.com:somnus0917/ghost-blog.git 2>/dev/null || \
    git remote set-url origin git@github.com:somnus0917/ghost-blog.git
  git fetch --prune origin main
  git checkout -f -B main origin/main
'
```

Then run the migration:

```bash
ssh tencent-cloud '
  cd /home/ubuntu/ghost-blog &&
  git fetch --prune origin main &&
  git checkout --detach --force origin/main &&
  git reset --hard origin/main &&
  bash server/bootstrap.sh
'
```

`bootstrap.sh` takes a verified backup, stops the old containers, copies existing
`content/` and `mysql/` directories to `/home/ubuntu/ghost-data/` when needed,
then starts containers with the external paths. It leaves the old directories in
place as a rollback safety net; do not delete them until the site and a backup
restore check have both succeeded.

For an emergency manual code update after migration:

```bash
ssh tencent-cloud '
  cd /home/ubuntu/ghost-blog &&
  git fetch --prune origin main &&
  git checkout --detach --force origin/main &&
  git reset --hard origin/main &&
  bash server/bootstrap.sh
'
```

Ghost and MySQL images are pinned by multi-platform digest. On an existing
installation, `bootstrap.sh` creates and verifies a backup before pulling images,
atomically syncs the persistent fallback fonts, then waits for the Ghost health
check instead of treating a started container as a successful deployment. Update
the tags and digests deliberately in the same reviewed change.

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

`configure_ghost.py` also sets the publication cover to the versioned 1200×630
theme image, which replaces Ghost's placeholder image in link previews. To use a
different absolute image URL, pass `--cover-image`.

After changing migration logic, update existing items in place while preserving
their Ghost-generated slugs:

```bash
python3 scripts/provision_ghost.py --url http://localhost:2368 --update-existing
python3 scripts/rebuild_redirects.py --url http://localhost:2368 --zola-root /path/to/zola-site
python3 scripts/reconcile_ghost.py --url http://localhost:2368 --report
```

Owner credentials are stored locally in `.private/ghost-owner.json` with mode
`0600`; the file is ignored by Git.

Before publishing a diary or imported document, check names, student numbers,
addresses, phone numbers and original attachment filenames. The known
`2026-05-21` entry can be checked and redacted with:

```bash
python3 scripts/redact_public_pii.py
python3 scripts/redact_public_pii.py --apply
```

The first command is a dry run. `--apply` writes an owner-only JSON backup under
`.private/redaction-backups/` before updating Ghost. It requires the local owner
credentials file and therefore cannot run from CI.

## Production cutover

Set `GHOST_URL=https://blog.somnus.wiki` in the server `.env`, append
`Caddyfile.snippet` to `/home/ubuntu/caddy/Caddyfile`, and recreate the two
Compose services. The snippet also proxies Ghost 6's hosted ActivityPub routes.

The production container remains bound to `127.0.0.1:2368`; only Caddy is
internet-facing. DNS should point `blog.somnus.wiki` to the Tencent Cloud host.
`server/deploy-theme.sh` retains the previous theme until Ghost becomes healthy
and restores it automatically if the restart or health check fails.

## Backups

`server/backup.sh` creates and verifies a compressed MySQL dump and content archive,
keeps local copies for 14 days, and writes files with owner-only permissions. Runtime
logs, generated persistent font shards, and the transient theme rollback directory
are excluded from the content archive.
The included systemd timer runs daily around 03:20 Asia/Shanghai.
`server/verify-backup.sh` performs a real restore into an isolated temporary MySQL
container, checks the Ghost schema and post table, safely extracts the matching
content archive, and removes all temporary resources afterward. The included
verification timer runs this restore check every Sunday around 04:40.

Install or refresh both timers on the production host with:

```bash
sudo install -m 644 server/ghost-blog-backup.service server/ghost-blog-backup.timer \
  server/ghost-blog-backup-verify.service server/ghost-blog-backup-verify.timer \
  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ghost-blog-backup.timer ghost-blog-backup-verify.timer
systemctl list-timers 'ghost-blog-backup*'
```

Run an immediate restore verification after the first backup:

```bash
make verify-backup
```

For an encrypted offsite copy, install Restic on the server, create a password file
with mode `0600`, add `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE` and the provider's
backup-only credentials to `.env`, then initialize the repository exactly once:

```bash
cd /home/ubuntu/ghost-blog
set -a
source .env
set +a
restic init
systemctl start ghost-blog-backup.service
restic snapshots
```

When configured, each daily run uploads only the verified database/content archives
and retains 14 daily, 8 weekly and 12 monthly snapshots. Expensive Restic pruning
runs on Sunday by default; set `RESTIC_PRUNE_WEEKDAY` to another ISO weekday number
if needed. A repository error fails the systemd job instead of silently creating a
new repository, but the already verified local archives are retained so a temporary
offsite outage does not remove that day's local recovery point. The weekly
verification covers local archives; still perform a full restore from the encrypted
Restic repository at least quarterly.
