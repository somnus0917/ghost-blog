#!/usr/bin/env python3
"""Convert this Zola site's rendered pages into a Ghost 6 import bundle."""

from __future__ import annotations

import argparse
import ast
import datetime as dt
import html
import json
import re
import shutil
import sys
import unicodedata
import zipfile
from pathlib import Path
from urllib.parse import quote


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ZOLA_ROOT = REPO_ROOT.parent
CONTENT_ROOT = DEFAULT_ZOLA_ROOT / "content"
PUBLIC_ROOT = DEFAULT_ZOLA_ROOT / "public"
DEFAULT_OUTPUT = REPO_ROOT / "build"
SKIP_NAMES = {"_index.md", "AGENTS.md", "CLAUDE.md", "GEMINI.md"}
SECTION_TAGS = {
    "posts": ("#文章", "hash-posts"),
    "notes": ("#笔记", "hash-notes"),
    "essays": ("#随笔", "hash-essays"),
    "diary": ("#日记", "hash-diary"),
}
PAGE_SECTIONS = {"page", "privacy"}


def parse_front_matter(path: Path) -> tuple[dict, str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("+++\n"):
        raise ValueError(f"{path}: expected TOML front matter")
    marker = text.find("\n+++", 4)
    if marker < 0:
        raise ValueError(f"{path}: unterminated TOML front matter")
    metadata = parse_project_toml(text[4:marker], path)
    return metadata, text[marker + 4 :].lstrip("\n")


def parse_project_toml(source: str, path: Path) -> dict:
    """Parse the small TOML subset used by this repository's front matter."""
    result: dict = {}
    target = result
    for line_number, raw_line in enumerate(source.splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            target = result
            for part in line[1:-1].split("."):
                target = target.setdefault(part.strip(), {})
            continue
        if "=" not in line:
            continue
        key, raw_value = (part.strip() for part in line.split("=", 1))
        try:
            if raw_value in {"true", "false"}:
                value: object = raw_value == "true"
            elif raw_value.startswith(('"', "'", "[", "{")):
                value = ast.literal_eval(raw_value)
            elif re.fullmatch(r"[-+]?\d+(?:\.\d+)?", raw_value):
                value = float(raw_value) if "." in raw_value else int(raw_value)
            else:
                value = raw_value
        except (SyntaxError, ValueError) as exc:
            raise ValueError(f"{path}:{line_number}: unsupported TOML value {raw_value!r}") from exc
        target[key] = value
    return result


def ghost_datetime(value: object) -> str:
    if isinstance(value, dt.datetime):
        stamp = value
    elif isinstance(value, dt.date):
        stamp = dt.datetime.combine(value, dt.time(hour=8), tzinfo=dt.timezone(dt.timedelta(hours=8)))
    elif isinstance(value, str):
        stamp = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    else:
        stamp = dt.datetime.now(dt.timezone.utc)
    if stamp.tzinfo is not None:
        stamp = stamp.astimezone(dt.timezone.utc).replace(tzinfo=None)
    return stamp.strftime("%Y-%m-%d %H:%M:%S")


def clean_slug(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).strip().lower()
    value = value.replace("&", "-and-")
    value = re.sub(r"\s+", "-", value)
    value = re.sub(r"[\\/?#%:;@!$^*+=|<>\[\]{}\"'`,。，！？：；（）()]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-._")
    return value[:180] or "untitled"


def rendered_body(path_value: str) -> str:
    page_path = PUBLIC_ROOT / path_value.strip("/") / "index.html"
    if not page_path.exists():
        raise FileNotFoundError(f"rendered page not found: {page_path}; run `pnpm build` first")
    page = page_path.read_text(encoding="utf-8")
    match = re.search(
        r'<section\b[^>]*\bclass=(?:"[^"]*\bbody\b[^"]*"|\'[^\']*\bbody\b[^\']*\'|body)[^>]*>',
        page,
        flags=re.IGNORECASE,
    )
    if not match:
        raise ValueError(f"could not locate article body in {page_path}")
    content_start = match.end()
    depth = 1
    body = ""
    for tag in re.finditer(r"<(/?)section\b[^>]*>", page[content_start:], flags=re.IGNORECASE):
        if tag.group(1):
            depth -= 1
            if depth == 0:
                body = page[content_start : content_start + tag.start()].strip()
                break
        else:
            depth += 1
    if not body:
        raise ValueError(f"could not find closing article section in {page_path}")
    body = body.replace("https://blog.somnus.wiki/", "/")
    return body


def excerpt_from_html(body: str, fallback: str | None) -> str | None:
    if fallback:
        return str(fallback)[:300]
    plain = re.sub(r"<[^>]+>", " ", body)
    plain = html.unescape(re.sub(r"\s+", " ", plain)).strip()
    return plain[:240] if plain else None


def iter_content() -> list[Path]:
    return sorted(
        path
        for path in CONTENT_ROOT.rglob("*.md")
        if path.name not in SKIP_NAMES and "unpublished" not in path.relative_to(CONTENT_ROOT).parts
    )


def yaml_quote(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def build_bundle(output_dir: Path) -> tuple[int, int, int]:
    posts: list[dict] = []
    tags: list[dict] = []
    posts_tags: list[dict] = []
    tag_by_key: dict[tuple[str, str], str] = {}
    redirects: list[tuple[str, str]] = []

    def tag_id(name: str, slug: str) -> str:
        key = (name, slug)
        if key not in tag_by_key:
            identifier = f"tag-{len(tag_by_key) + 1:04d}"
            tag_by_key[key] = identifier
            tags.append({"id": identifier, "name": name, "slug": slug})
        return tag_by_key[key]

    for source in iter_content():
        metadata, _ = parse_front_matter(source)
        old_path = str(metadata["path"]).strip("/")
        parts = source.relative_to(CONTENT_ROOT).parts
        section = parts[0]
        is_page = section in PAGE_SECTIONS
        source_slug = old_path.rsplit("/", 1)[-1]
        slug = clean_slug(str(metadata.get("slug") or source_slug))

        if is_page:
            new_path = f"/{slug}/"
        else:
            prefix = "p" if section == "posts" else section
            new_path = f"/{prefix}/{slug}/"

        old_url = f"/{old_path}/"
        if old_url != new_path:
            redirects.append((old_url, new_path))

        body = rendered_body(old_path)
        published = ghost_datetime(metadata.get("date"))
        post_id = f"post-{len(posts) + 1:04d}"
        post = {
            "id": post_id,
            "title": str(metadata.get("title") or source.stem),
            "slug": slug,
            "html": body,
            "type": "page" if is_page else "post",
            "status": "draft" if metadata.get("draft", False) else "published",
            "visibility": "public",
            "created_at": published,
            "updated_at": published,
            "published_at": published,
        }
        excerpt = excerpt_from_html(body, metadata.get("description"))
        if excerpt:
            post["custom_excerpt"] = excerpt
        posts.append(post)

        if not is_page:
            internal_name, internal_slug = SECTION_TAGS[section]
            posts_tags.append({"post_id": post_id, "tag_id": tag_id(internal_name, internal_slug)})

        taxonomy = metadata.get("taxonomies", {})
        public_names: list[str] = []
        for category in taxonomy.get("categories", []):
            public_names.append(str(category))
        for name in taxonomy.get("tags", []):
            if str(name).casefold() not in {item.casefold() for item in public_names}:
                public_names.append(str(name))
        for name in public_names:
            posts_tags.append({"post_id": post_id, "tag_id": tag_id(name, clean_slug(name))})

    payload = {
        "meta": {
            "exported_on": int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000),
            "version": "6.0.0",
        },
        "data": {
            "posts": posts,
            "posts_meta": [],
            "tags": tags,
            "posts_tags": posts_tags,
            "users": [],
            "posts_authors": [],
        },
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    import_path = output_dir / "somnus-zola.ghost.json"
    import_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    redirects_path = output_dir / "redirects.yaml"
    lines = ["301:"]
    for old_url, new_url in redirects:
        lines.append(f"  {yaml_quote(old_url)}: {yaml_quote(new_url)}")
    lines.extend(["", "302:", ""])
    redirects_path.write_text("\n".join(lines), encoding="utf-8")
    shutil.copy2(REPO_ROOT / "routes.yaml", output_dir / "routes.yaml")

    zip_path = output_dir / "somnus-zola.ghost.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(import_path, import_path.name)

    manifest = {
        "content_items": len(posts),
        "posts": sum(post["type"] == "post" for post in posts),
        "pages": sum(post["type"] == "page" for post in posts),
        "drafts": sum(post["status"] == "draft" for post in posts),
        "tags": len(tags),
        "redirects": len(redirects),
        "files": [path.name for path in (import_path, zip_path, redirects_path, output_dir / "routes.yaml")],
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return len(posts), len(tags), len(redirects)


def main() -> int:
    global CONTENT_ROOT, PUBLIC_ROOT

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--zola-root",
        type=Path,
        default=DEFAULT_ZOLA_ROOT,
        help="Zola project containing content/ and public/ (default: repository parent)",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    zola_root = args.zola_root.resolve()
    CONTENT_ROOT = zola_root / "content"
    PUBLIC_ROOT = zola_root / "public"
    try:
        item_count, tag_count, redirect_count = build_bundle(args.output.resolve())
    except Exception as exc:
        print(f"migration failed: {exc}", file=sys.stderr)
        return 1
    print(f"built Ghost import: {item_count} items, {tag_count} tags, {redirect_count} redirects")
    print(args.output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
