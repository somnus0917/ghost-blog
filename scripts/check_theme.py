#!/usr/bin/env python3
"""Run dependency-free checks for the Somnus Ghost theme bundle."""

from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
THEME_ROOT = REPO_ROOT / "theme" / "somnus-yohaku"
SHARED_FONT = REPO_ROOT / "shared" / "fonts" / "LXGWWenKai-Regular.woff2"
ARCHIVE = REPO_ROOT / "build" / "somnus-yohaku.zip"
WORKER_ROOT = REPO_ROOT / "worker"
REQUIRED = {
    "default.hbs",
    "index.hbs",
    "post.hbs",
    "privacy-ripfullpage.hbs",
    "package.json",
    "assets/css/screen.css",
    "assets/js/main.js",
    "assets/js/mathjax.js",
    "assets/js/mathjax.LICENSE.txt",
}


def fail(message: str) -> None:
    print(f"theme check failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> int:
    if not ARCHIVE.is_file():
        fail(f"missing archive: {ARCHIVE}")
    package = json.loads((THEME_ROOT / "package.json").read_text(encoding="utf-8"))
    if "ghost-theme" not in package.get("keywords", []):
        fail("package.json must include the ghost-theme keyword")
    if not str(package.get("engines", {}).get("ghost", "")).startswith(">=6"):
        fail("theme must target Ghost 6 or newer")
    css = (THEME_ROOT / "assets" / "css" / "screen.css").read_text(encoding="utf-8")
    default_template = (THEME_ROOT / "default.hbs").read_text(encoding="utf-8")
    post_template = (THEME_ROOT / "post.hbs").read_text(encoding="utf-8")
    main_js = (THEME_ROOT / "assets" / "js" / "main.js").read_text(encoding="utf-8")
    privacy_template = (THEME_ROOT / "privacy-ripfullpage.hbs").read_text(encoding="utf-8")
    routes = (REPO_ROOT / "routes.yaml").read_text(encoding="utf-8")
    compose = (REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    caddy = (REPO_ROOT / "Caddyfile.snippet").read_text(encoding="utf-8")
    if "LXGW WenKai Web" not in css or "@font-face" not in css:
        fail("LXGW WenKai web font is not wired into screen.css")
    if "/content/images/fonts/LXGWWenKai-Regular.woff2" not in css:
        fail("LXGW WenKai must use the persistent Ghost content font path")
    if not SHARED_FONT.is_file():
        fail(f"missing shared web font: {SHARED_FONT}")
    if "cdn.jsdelivr.net/npm/mathjax" in default_template:
        fail("MathJax must be loaded from the theme bundle")
    if 'asset "js/mathjax.js"' not in default_template:
        fail("default.hbs must load the local MathJax bundle")
    if 'mode="auto"' not in post_template or "comments-dark" not in main_js:
        fail("Ghost comments must synchronize with the site color mode")
    if 'data-post-uuid="{{uuid}}"' not in post_template or "data-like-post" not in post_template:
        fail("post.hbs must expose the engagement controls")
    if '"/api/engagement/"' not in main_js or '"/presence"' not in main_js or '"/like"' not in main_js:
        fail("main.js must connect the post engagement API")
    if "traffic-analytics:" not in compose or "tinybird-deploy:" not in compose:
        fail("Docker Compose must include optional Ghost Analytics services")
    if "handle_path /.ghost/analytics/*" not in caddy:
        fail("Caddy must route Ghost Analytics events to the proxy service")
    for worker_file in (
        WORKER_ROOT / "src" / "index.mjs",
        WORKER_ROOT / "migrations" / "0001_engagement.sql",
        WORKER_ROOT / "wrangler.toml.example",
    ):
        if not worker_file.is_file():
            fail(f"missing Worker file: {worker_file.relative_to(REPO_ROOT)}")
    if "/privacy/ripfullpage/:" not in routes or "template: privacy-ripfullpage" not in routes:
        fail("ripfullpage privacy route must use the dedicated template")
    if "contact@somnus.wiki" not in privacy_template:
        fail("ripfullpage privacy page must include its support address")
    with zipfile.ZipFile(ARCHIVE) as archive:
        names = set(archive.namelist())
        missing = sorted(REQUIRED - names)
        if missing:
            fail(f"archive is missing: {', '.join(missing)}")
        if "assets/fonts/MapleMono-NF-CN-Regular.woff2" in names:
            fail("unused Maple Mono font must not be shipped")
        if any(name.endswith(".woff2") for name in names):
            fail("large fonts must stay outside the repeatedly uploaded theme archive")
        bad = [name for name in names if name.startswith("/") or ".." in Path(name).parts]
        if bad:
            fail("archive contains unsafe paths")
    size_mib = ARCHIVE.stat().st_size / (1024 * 1024)
    if size_mib > 2:
        fail(f"archive is unexpectedly large: {size_mib:.1f} MiB")
    print(f"theme check passed: {len(names)} files, {size_mib:.1f} MiB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
