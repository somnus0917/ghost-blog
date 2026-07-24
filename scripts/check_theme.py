#!/usr/bin/env python3
"""Run dependency-free checks for the Somnus Ghost theme bundle."""

from __future__ import annotations

import json
import re
import struct
import sys
import zipfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
THEME_ROOT = REPO_ROOT / "theme" / "somnus-yohaku"
THEME_SOURCE_ROOT = REPO_ROOT / "theme" / "src"
SHARED_FONT = REPO_ROOT / "shared" / "fonts" / "LXGWWenKai-Regular.woff2"
WEB_FONT_DIR = THEME_ROOT / "assets" / "fonts" / "lxgw-wenkai-v2"
FALLBACK_FONT_DIR = REPO_ROOT / "shared" / "fonts" / "lxgw-wenkai-v2"
FONT_MANIFEST = WEB_FONT_DIR / "manifest.json"
FALLBACK_FONT_MANIFEST = FALLBACK_FONT_DIR / "manifest.json"
FALLBACK_PUBLIC_URL = "/content/images/fonts/lxgw-wenkai-v2"
ARCHIVE = REPO_ROOT / "build" / "somnus-yohaku.zip"
WORKER_ROOT = REPO_ROOT / "worker"
REQUIRED = {
    "default.hbs",
    "index.hbs",
    "post.hbs",
    "privacy-ripfullpage.hbs",
    "package.json",
    "assets/css/screen.css",
    "assets/css/sodo-search-1.8.212.css",
    "assets/js/main.js",
    "assets/js/theme-bootstrap.js",
    "assets/js/portal-2.69.201.min.js",
    "assets/js/portal.LICENSE.txt",
    "assets/js/sodo-search-1.8.212.min.js",
    "assets/js/sodo-search.LICENSE.txt",
    "assets/js/comments-ui-1.5.211.min.js",
    "assets/js/comments-ui.LICENSE.txt",
    "assets/js/mathjax.js",
    "assets/js/mathjax.LICENSE.txt",
    "assets/fonts/lxgw-wenkai-v2/font.css",
    "assets/fonts/lxgw-wenkai-v2/manifest.json",
    "assets/fonts/lxgw-wenkai-v2/OFL.txt",
    "assets/images/site-cover-v1.png",
    "partials/route-description.hbs",
}


def fail(message: str) -> None:
    print(f"theme check failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def parse_unicode_range(value: str) -> set[int]:
    points: set[int] = set()
    for token in value.split(","):
        match = re.fullmatch(
            r"U\+([0-9A-F]+)(?:-([0-9A-F]+))?",
            token.strip(),
            flags=re.IGNORECASE,
        )
        if not match:
            fail(f"unsupported unicode-range token: {token}")
        start = int(match.group(1), 16)
        end = int(match.group(2) or match.group(1), 16)
        points.update(range(start, end + 1))
    return points


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
    home_template = (THEME_ROOT / "home.hbs").read_text(encoding="utf-8")
    post_template = (THEME_ROOT / "post.hbs").read_text(encoding="utf-8")
    main_bundle = THEME_ROOT / "assets" / "js" / "main.js"
    bootstrap_bundle = THEME_ROOT / "assets" / "js" / "theme-bootstrap.js"
    main_js = "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted((THEME_SOURCE_ROOT / "js").rglob("*.js"))
    )
    if main_bundle.stat().st_size > 30 * 1024:
        fail("bundled main.js exceeds the 30 KiB performance budget")
    if len(css.encode("utf-8")) > 40 * 1024:
        fail("bundled screen.css exceeds the 40 KiB performance budget")
    if bootstrap_bundle.stat().st_size > 1024:
        fail("theme-bootstrap.js exceeds the 1 KiB performance budget")
    privacy_template = (THEME_ROOT / "privacy-ripfullpage.hbs").read_text(encoding="utf-8")
    routes = (REPO_ROOT / "routes.yaml").read_text(encoding="utf-8")
    compose = (REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    caddy = (REPO_ROOT / "Caddyfile.snippet").read_text(encoding="utf-8")
    production_workflow = (
        REPO_ROOT / ".github" / "workflows" / "production-cicd.yml"
    ).read_text(encoding="utf-8")
    monitor_workflow = REPO_ROOT / ".github" / "workflows" / "production-monitor.yml"
    font_stylesheet = (
        '<link rel="stylesheet" href="{{asset "fonts/lxgw-wenkai-v2/font.css"}}">'
    )
    screen_stylesheet = '<link rel="stylesheet" href="{{asset "css/screen.css"}}">'
    if font_stylesheet not in default_template:
        fail("default.hbs must load the complete LXGW WenKai shard stylesheet")
    if default_template.index(font_stylesheet) > default_template.index(screen_stylesheet):
        fail("webfont stylesheet must be discovered before the main stylesheet")
    if not SHARED_FONT.is_file():
        fail(f"missing shared web font: {SHARED_FONT}")
    if not FONT_MANIFEST.is_file():
        fail(f"missing webfont manifest: {FONT_MANIFEST}")
    if not FALLBACK_FONT_MANIFEST.is_file():
        fail(f"missing persistent webfont manifest: {FALLBACK_FONT_MANIFEST}")
    if FONT_MANIFEST.read_bytes() != FALLBACK_FONT_MANIFEST.read_bytes():
        fail("theme and persistent webfont manifests must be identical")
    manifest = json.loads(FONT_MANIFEST.read_text(encoding="utf-8"))
    if manifest.get("schema") != 1:
        fail("webfont manifest schema must be 1")
    if manifest.get("fallbackBaseUrl") != FALLBACK_PUBLIC_URL:
        fail("webfont manifest must use the persistent fallback font URL")
    core_file = str(manifest.get("coreFile", ""))
    core_font = WEB_FONT_DIR / core_file
    if not core_file or not core_font.is_file():
        fail("webfont manifest points to a missing core file")
    if core_font.stat().st_size > 700 * 1024:
        fail("core webfont is unexpectedly large")
    core_preload = f'href="/assets/fonts/lxgw-wenkai-v2/{core_file}"'
    if core_preload not in default_template or 'rel="preload"' not in default_template:
        fail("default.hbs must preload the core webfont")
    font_css_path = WEB_FONT_DIR / "font.css"
    if not font_css_path.is_file():
        fail(f"missing shard stylesheet: {font_css_path}")
    font_css = font_css_path.read_text(encoding="utf-8")
    for token in ('font-family:"LXGW WenKai Web"', "unicode-range:", 'local("LXGW WenKai")'):
        if token not in font_css:
            fail(f"webfont stylesheet is missing {token}")
    core_css_points: set[int] = set()
    fallback_css_points: set[int] = set()
    for face in re.findall(r"@font-face\{[^}]+\}", font_css):
        file_match = re.search(r'url\("([^"]+\.woff2)"\)', face)
        range_match = re.search(r"unicode-range:([^;}]+);", face)
        if not file_match or not range_match:
            fail("every generated font face must declare a file and unicode-range")
        points = parse_unicode_range(range_match.group(1))
        if Path(file_match.group(1)).name == core_file:
            if file_match.group(1) != f"./{core_file}":
                fail("core webfont must remain inside the theme bundle")
            core_css_points.update(points)
        else:
            if not file_match.group(1).startswith(f"{FALLBACK_PUBLIC_URL}/"):
                fail("fallback webfonts must use the persistent content URL")
            fallback_css_points.update(points)
    if not core_css_points or not fallback_css_points:
        fail("webfont stylesheet must include both core and fallback ranges")
    if core_css_points & fallback_css_points:
        fail("core and fallback unicode ranges must be disjoint")
    fallback_fonts = sorted(
        FALLBACK_FONT_DIR.glob("LXGWWenKai-Fallback-v2-*.woff2")
    )
    if len(fallback_fonts) < 100:
        fail("complete webfont fallback shard set is missing")
    if manifest.get("fallbackFileCount") != len(fallback_fonts):
        fail("webfont fallback count does not match the manifest")
    if font_css.rfind(core_file) <= font_css.rfind("LXGWWenKai-Fallback-v2-"):
        fail("core webfont faces must follow fallback faces so overlaps prefer the core")
    referenced_fonts = {
        Path(match).name
        for match in re.findall(r'url\("([^"]+\.woff2)"\)', font_css)
    }
    actual_font_names = {core_font.name, *(path.name for path in fallback_fonts)}
    if referenced_fonts != actual_font_names:
        fail("webfont stylesheet references do not match the generated shard files")
    fallback_bytes = sum(path.stat().st_size for path in fallback_fonts)
    total_font_bytes = core_font.stat().st_size + fallback_bytes
    if manifest.get("coreBytes") != core_font.stat().st_size:
        fail("core webfont size does not match the manifest")
    if manifest.get("fallbackBytes") != fallback_bytes:
        fail("fallback webfont size does not match the manifest")
    if manifest.get("totalFontBytes") != total_font_bytes:
        fail("total webfont size does not match the manifest")
    if total_font_bytes > 16 * 1024 * 1024:
        fail("complete webfont shard inventory is unexpectedly large")
    cover_image = THEME_ROOT / "assets" / "images" / "site-cover-v1.png"
    with cover_image.open("rb") as image_file:
        if image_file.read(8) != b"\x89PNG\r\n\x1a\n":
            fail("site cover must be a PNG")
        chunk_length = struct.unpack(">I", image_file.read(4))[0]
        if image_file.read(4) != b"IHDR" or chunk_length != 13:
            fail("site cover has an invalid PNG header")
        width, height = struct.unpack(">II", image_file.read(8))
    if (width, height) != (1200, 630):
        fail(f"site cover must be 1200x630, got {width}x{height}")
    if cover_image.stat().st_size > 500 * 1024:
        fail("site cover is unexpectedly large")
    if "cdn.jsdelivr.net" in default_template:
        fail("runtime frontend dependencies must be self-hosted")
    if 'data-mathjax-src="{{asset "js/mathjax.js"}}"' not in default_template:
        fail("default.hbs must expose the local MathJax bundle for lazy loading")
    if '<script async src="{{asset "js/mathjax.js"}}"' in default_template:
        fail("MathJax must not load eagerly on every page")
    if '<script defer src="{{asset "js/mermaid.js"}}"' in default_template:
        fail("Mermaid must not load eagerly on every page")
    if "pageContainsMath" not in main_js or "somnus-mermaid" not in main_js:
        fail("main.js must lazy-load MathJax and Mermaid")
    ghost_head_match = re.search(r'{{ghost_head exclude="([^"]+)"}}', default_template)
    ghost_head_excludes = set(ghost_head_match.group(1).split(",")) if ghost_head_match else set()
    if not {"portal", "search", "comment_counts"}.issubset(ghost_head_excludes):
        fail("Portal, Search, and comment counts must be excluded from eager ghost_head")
    if "data-portal-src=" not in default_template or "function loadPortal()" not in main_js:
        fail("Ghost Portal must load on demand")
    if "data-search-src=" not in default_template or "function loadSearch()" not in main_js:
        fail("Ghost Search must load on demand")
    for asset in (
        'js/portal-2.69.201.min.js',
        'js/sodo-search-1.8.212.min.js',
        'css/sodo-search-1.8.212.css',
        'js/comments-ui-1.5.211.min.js',
    ):
        if asset not in default_template:
            fail(f"default.hbs must expose self-hosted {asset}")
    if re.search(r"<script>(?!\s*</script>)", default_template):
        fail("default.hbs must not contain executable inline scripts")
    if "pointerenter" not in main_js or "prewarmSearch" not in main_js:
        fail("Ghost Search must prewarm on user intent")
    if 'excerpt words="22"' in home_template or home_template.count('data-character-excerpt="80"') != 2:
        fail("Chinese homepage excerpts must use character-based truncation")
    if 'querySelectorAll("[data-character-excerpt]")' not in main_js:
        fail("custom Chinese excerpts must receive a client-side character limit")
    if 'mode="auto"' not in post_template or "comments-dark" not in main_js:
        fail("Ghost comments must synchronize with the site color mode")
    if "data-comments-template" not in post_template or "function activateComments(" not in main_js:
        fail("Ghost comments must load near the viewport instead of eagerly")
    if 'data-post-uuid="{{uuid}}"' not in post_template or "data-like-post" not in post_template:
        fail("post.hbs must expose the engagement controls")
    if (
        'classList.add("article-layout--no-toc")' not in main_js
        or ".article-layout--no-toc" not in css
    ):
        fail("posts without enough headings must retain the full article width")
    if not re.search(
        r"\.gh-content img\s*\{[^}]*height:\s*auto;[^}]*max-width:\s*100%;",
        css,
        flags=re.DOTALL,
    ):
        fail("article images must preserve their intrinsic aspect ratio")
    if '"/api/engagement/"' not in main_js or '"/presence"' not in main_js or '"/like"' not in main_js:
        fail("main.js must connect the post engagement API")
    if "traffic-analytics:" not in compose or "tinybird-deploy:" not in compose:
        fail("Docker Compose must include optional Ghost Analytics services")
    if "ghost:6-alpine@sha256:" not in compose or "mysql:8.0@sha256:" not in compose:
        fail("production Ghost and MySQL images must be pinned by digest")
    if "healthcheck:" not in compose:
        fail("Docker Compose must expose container health checks")
    if "handle_path /.ghost/analytics/*" not in caddy:
        fail("Caddy must route Ghost Analytics events to the proxy service")
    for header in (
        "Strict-Transport-Security",
        "X-Content-Type-Options",
        "Referrer-Policy",
        "Permissions-Policy",
        "Content-Security-Policy-Report-Only",
        "Content-Security-Policy",
        "Cache-Control",
    ):
        if header not in caddy:
            fail(f"Caddy must set {header}")
    if "X-Somnus-Worker-Proxy" not in caddy:
        fail("Caddy must authenticate requests to the engagement Worker")
    for worker_file in (
        WORKER_ROOT / "src" / "index.mjs",
        WORKER_ROOT / "migrations" / "0001_engagement.sql",
        WORKER_ROOT / "migrations" / "0002_presence_cleanup_index.sql",
        WORKER_ROOT / "wrangler.toml.example",
    ):
        if not worker_file.is_file():
            fail(f"missing Worker file: {worker_file.relative_to(REPO_ROOT)}")
    for server_file in (
        REPO_ROOT / "server" / "deploy-routes.sh",
        REPO_ROOT / "server" / "check-production.sh",
        REPO_ROOT / "server" / "verify-backup.sh",
        REPO_ROOT / "server" / "ghost-blog-backup-verify.service",
        REPO_ROOT / "server" / "ghost-blog-backup-verify.timer",
    ):
        if not server_file.is_file():
            fail(f"missing operations file: {server_file.relative_to(REPO_ROOT)}")
        if server_file.suffix == ".sh" and not (server_file.stat().st_mode & 0o111):
            fail(f"operations script is not executable: {server_file.relative_to(REPO_ROOT)}")
    if not monitor_workflow.is_file():
        fail("missing scheduled production monitor workflow")
    for deployment_contract in (
        "group: ${{ github.event_name == 'pull_request'",
        "deploy-server:",
        "needs: deploy-server",
        "needs: deploy-theme",
        "server/deploy-routes.sh",
        "server/sync-fonts.sh",
    ):
        if deployment_contract not in production_workflow:
            fail(f"production workflow is missing {deployment_contract}")
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
        archive_fonts = {name for name in names if name.endswith(".woff2")}
        expected_fonts = {f"assets/fonts/lxgw-wenkai-v2/{core_font.name}"}
        if archive_fonts != expected_fonts:
            fail("archive must contain the core font but no persistent fallback shards")
        bad = [name for name in names if name.startswith("/") or ".." in Path(name).parts]
        if bad:
            fail("archive contains unsafe paths")
    size_mib = ARCHIVE.stat().st_size / (1024 * 1024)
    if size_mib > 5:
        fail(f"archive is unexpectedly large: {size_mib:.1f} MiB")
    print(
        f"theme check passed: {len(names)} files, {size_mib:.1f} MiB; "
        f"{len(fallback_fonts)} persistent font shards"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
