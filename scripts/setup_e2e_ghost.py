#!/usr/bin/env python3
"""Prepare a deterministic local Ghost instance for browser regression tests."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from provision_ghost import GhostClient, ensure_owner


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FIXTURES = REPO_ROOT / "fixtures" / "demo-posts.json"
DEFAULT_THEME_ARCHIVE = REPO_ROOT / "build" / "somnus-yohaku.zip"
DEFAULT_E2E_CREDENTIALS = REPO_ROOT / "build" / "e2e" / "ghost-owner.json"

E2E_POSTS = [
    {
        "title": "E2E 无标题正文",
        "slug": "e2e-no-headings",
        "custom_excerpt": "用于验证没有目录标题时的文章布局。",
        "html": "<p>这是一篇没有二级标题的测试文章。</p><p>正文应当保持完整宽度。</p>",
        "tags": [{"name": "#文章", "slug": "hash-posts"}],
    },
    {
        "title": "E2E 公式与图表",
        "slug": "e2e-rich-content",
        "custom_excerpt": "用于验证 MathJax 与 Mermaid 按需加载。",
        "html": (
            "<p>行内公式 $a^2+b^2=c^2$。</p>"
            "<h2>流程图</h2>"
            '<pre><code class="language-mermaid">flowchart LR\nA[开始] --> B[完成]</code></pre>'
            "<h2>代码</h2><pre><code>make check</code></pre>"
        ),
        "tags": [{"name": "#文章", "slug": "hash-posts"}],
    },
]

E2E_PAGES = [
    {
        "title": "关于",
        "slug": "about",
        "html": "<p>这是本地浏览器测试使用的关于页面。</p>",
    },
    {
        "title": "LaTeX",
        "slug": "latex",
        "html": "<h2>常用公式</h2><p>勾股定理：$a^2+b^2=c^2$。</p>",
    },
]


def upsert_items(client: GhostClient, resource: str, items: list[dict]) -> None:
    response = client.request(
        "GET", f"/ghost/api/admin/{resource}/?limit=all&fields=id,slug,updated_at"
    )
    existing = {item["slug"]: item for item in response.get(resource, [])}
    for source in items:
        current = existing.get(source["slug"])
        payload = {
            **source,
            "status": "published",
            "visibility": "public",
        }
        if current:
            payload.pop("slug", None)
            payload["updated_at"] = current["updated_at"]
            client.json_request(
                "PUT",
                f"/ghost/api/admin/{resource}/{current['id']}/?source=html",
                {resource: [payload]},
            )
        else:
            client.json_request(
                "POST",
                f"/ghost/api/admin/{resource}/?source=html",
                {resource: [payload]},
            )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:2370")
    parser.add_argument("--credentials", type=Path, default=DEFAULT_E2E_CREDENTIALS)
    parser.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURES)
    parser.add_argument("--theme", type=Path, default=DEFAULT_THEME_ARCHIVE)
    args = parser.parse_args()

    client = GhostClient(args.url)
    try:
        ensure_owner(client, args.credentials)
        demo_posts = json.loads(args.fixtures.read_text(encoding="utf-8"))
        upsert_items(client, "posts", [*demo_posts, *E2E_POSTS])
        upsert_items(client, "pages", E2E_PAGES)
        theme_name = client.upload_theme(args.theme)
        client.json_request(
            "PUT",
            f"/ghost/api/admin/themes/{theme_name}/activate/",
            {},
        )
    except Exception as exc:
        print(f"E2E setup failed: {exc}", file=sys.stderr)
        return 1

    print(
        f"E2E Ghost ready: {len(demo_posts) + len(E2E_POSTS)} posts, "
        f"{len(E2E_PAGES)} pages, theme {theme_name}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
