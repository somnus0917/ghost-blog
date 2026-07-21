# Somnus Ghost deployment

This directory contains the reproducible Ghost 6 deployment, the custom
`somnus-yohaku` theme, and the Zola-to-Ghost migration tooling.

后台登录、写作、内部标签和评论账号说明见 [ADMIN_GUIDE.md](ADMIN_GUIDE.md)。
艺术风格、字体和本地预览说明见 [DESIGN.md](DESIGN.md)。

## Local theme workflow

The standalone project directory is this repository. From its root, run:

```bash
cp .env.example .env
make dev
make check
```

Start Docker Desktop first. `make dev` creates the required local Docker network,
starts a local Ghost instance at `http://127.0.0.1:2369`, and syncs the theme into
its content directory. On the first run, finish setup at
`http://127.0.0.1:2369/ghost/` and activate `somnus-yohaku`. Commit and push visual
changes to `main` after `make check` passes.

The theme self-hosts LXGW WenKai in WOFF2 format. The upstream OFL license is
included in `theme/somnus-yohaku/assets/fonts/OFL.txt`.

## GitHub Actions deployment

`.github/workflows/theme-cicd.yml` validates pull requests. Theme changes pushed to
`main` are built once and deployed through Ghost's official Admin API theme action.
This grants no Tencent Cloud shell access. Production secrets are stored in GitHub
Actions, not in this repository:

- `GHOST_ADMIN_API_URL`
- `GHOST_ADMIN_API_KEY`

## Build the migration bundle

```bash
zola build --force --drafts
python3 ghost/scripts/migrate_zola.py
python3 ghost/scripts/build_theme.py
```

Generated files are written to `ghost/build/` and ignored by Git.

## Deploy on the Tencent Cloud host

```bash
rsync -av --exclude build --exclude .env ghost/ tencent-cloud:/home/ubuntu/ghost-blog/
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
python3 ghost/scripts/provision_ghost.py --url http://localhost:2368
python3 ghost/scripts/configure_ghost.py --url http://localhost:2368
```

After changing migration logic, update existing items in place while preserving
their Ghost-generated slugs:

```bash
python3 ghost/scripts/provision_ghost.py --url http://localhost:2368 --update-existing
python3 ghost/scripts/rebuild_redirects.py --url http://localhost:2368
python3 ghost/scripts/reconcile_ghost.py --url http://localhost:2368 --report
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
