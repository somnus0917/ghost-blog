#!/usr/bin/env python3
"""Build redirects from Zola paths to the slugs Ghost actually accepted."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from urllib.parse import quote

import migrate_zola as migration
from migrate_zola import PAGE_SECTIONS, parse_front_matter, yaml_quote
from provision_ghost import DEFAULT_CREDENTIALS, GhostClient


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = REPO_ROOT / "build" / "redirects.yaml"


def login(client: GhostClient, credentials_path: Path) -> None:
    credentials = json.loads(credentials_path.read_text(encoding="utf-8"))
    client.json_request(
        "POST",
        "/ghost/api/admin/session/",
        {"username": credentials["email"], "password": credentials["password"]},
    )


def items_by_title(client: GhostClient, resource: str) -> dict[str, list[dict]]:
    response = client.request(
        "GET",
        f"/ghost/api/admin/{resource}/?limit=all&fields=id,title,slug,status",
    )
    grouped: dict[str, list[dict]] = defaultdict(list)
    for item in response.get(resource, []):
        grouped[item["title"]].append(item)
    return grouped


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:2368")
    parser.add_argument("--credentials", type=Path, default=DEFAULT_CREDENTIALS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--zola-root",
        type=Path,
        default=migration.DEFAULT_ZOLA_ROOT,
        help="Zola project containing content/ (default: repository parent)",
    )
    args = parser.parse_args()
    migration.CONTENT_ROOT = args.zola_root.resolve() / "content"

    client = GhostClient(args.url)
    login(client, args.credentials)
    remote = {
        "posts": items_by_title(client, "posts"),
        "pages": items_by_title(client, "pages"),
    }

    redirects: list[tuple[str, str]] = []
    failures: list[str] = []
    for source in migration.iter_content():
        metadata, _ = parse_front_matter(source)
        section = source.relative_to(migration.CONTENT_ROOT).parts[0]
        resource = "pages" if section in PAGE_SECTIONS else "posts"
        title = str(metadata.get("title") or source.stem)
        matches = remote[resource].get(title, [])
        if len(matches) != 1:
            failures.append(f"{resource}:{title!r} matched {len(matches)} remote items")
            continue

        old_url = f"/{str(metadata['path']).strip('/')}/"
        prefix = "" if resource == "pages" else ("p" if section == "posts" else section)
        new_url = f"/{prefix + '/' if prefix else ''}{matches[0]['slug']}/"
        if old_url != new_url:
            redirects.append((old_url, new_url))
            encoded_old_url = quote(old_url, safe="/")
            if encoded_old_url != old_url:
                redirects.append((encoded_old_url, new_url))

    if failures:
        for failure in failures:
            print(f"error: {failure}")
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    lines = ["301:"]
    for old_url, new_url in sorted(set(redirects)):
        lines.append(f"  {yaml_quote(old_url)}: {yaml_quote(new_url)}")
    lines.extend(["", "302:", ""])
    args.output.write_text("\n".join(lines), encoding="utf-8")
    print(f"rebuilt redirects: {len(set(redirects))} exact old-to-new mappings")
    print(args.output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
