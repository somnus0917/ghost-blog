#!/usr/bin/env python3
"""Audit and safely remove duplicate items created during migration retries."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from collections import Counter
from pathlib import Path

from provision_ghost import DEFAULT_CREDENTIALS, GhostClient


def login(client: GhostClient, credentials_path: Path) -> None:
    credentials = json.loads(credentials_path.read_text(encoding="utf-8"))
    client.json_request(
        "POST",
        "/ghost/api/admin/session/",
        {"username": credentials["email"], "password": credentials["password"]},
    )


def duplicates(client: GhostClient, resource: str) -> list[list[dict]]:
    response = client.request(
        "GET",
        f"/ghost/api/admin/{resource}/?limit=all&fields=id,title,slug,created_at,status&order=created_at%20asc",
    )
    grouped: dict[str, list[dict]] = defaultdict(list)
    for item in response.get(resource, []):
        grouped[item["title"]].append(item)
    return [items for items in grouped.values() if len(items) > 1]


def fetch_items(client: GhostClient, resource: str, include_tags: bool = False) -> list[dict]:
    include = "&include=tags" if include_tags else ""
    response = client.request(
        "GET",
        f"/ghost/api/admin/{resource}/?limit=all&fields=id,title,slug,created_at,status{include}"
        "&order=created_at%20asc",
    )
    return response.get(resource, [])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:2368")
    parser.add_argument("--credentials", type=Path, default=DEFAULT_CREDENTIALS)
    parser.add_argument("--deduplicate", action="store_true")
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--remove-starter", action="store_true")
    args = parser.parse_args()

    client = GhostClient(args.url)
    login(client, args.credentials)
    if args.remove_starter:
        starter_signatures = {
            "posts": {("Coming soon", "coming-soon")},
            "pages": {("About this site", "about")},
        }
        for resource, signatures in starter_signatures.items():
            for item in fetch_items(client, resource):
                if (item["title"], item["slug"]) in signatures:
                    client.request("DELETE", f"/ghost/api/admin/{resource}/{item['id']}/")
                    print(f"removed Ghost starter {resource[:-1]}: {item['title']} ({item['slug']})")
    if args.report:
        posts = fetch_items(client, "posts", include_tags=True)
        pages = fetch_items(client, "pages")
        post_statuses = Counter(item["status"] for item in posts)
        page_statuses = Counter(item["status"] for item in pages)
        migrated_posts = []
        unclassified_posts = []
        for item in posts:
            tag_slugs = {tag["slug"] for tag in item.get("tags", [])}
            if tag_slugs & {"hash-posts", "hash-notes", "hash-essays", "hash-diary"}:
                migrated_posts.append(item)
            else:
                unclassified_posts.append(item)
        print(
            "content summary: "
            f"posts={len(posts)} {dict(post_statuses)}, pages={len(pages)} {dict(page_statuses)}, "
            f"classified_migration_posts={len(migrated_posts)}, unclassified_posts={len(unclassified_posts)}"
        )
        for item in unclassified_posts:
            print(
                f"unclassified post: {item['id']} {item['title']} "
                f"({item['slug']}, {item['status']})"
            )
        for item in pages:
            print(f"page: {item['id']} {item['title']} ({item['slug']}, {item['status']})")
    duplicate_count = 0
    for resource in ("posts", "pages"):
        for items in duplicates(client, resource):
            keep = items[0]
            print(f"{resource}: keep {keep['id']} {keep['title']} ({keep['slug']})")
            for item in items[1:]:
                duplicate_count += 1
                print(f"{resource}: duplicate {item['id']} {item['title']} ({item['slug']})")
                if args.deduplicate:
                    client.request("DELETE", f"/ghost/api/admin/{resource}/{item['id']}/")
                    print(f"{resource}: deleted {item['id']}")
    print(f"duplicate items: {duplicate_count}; mode: {'deleted' if args.deduplicate else 'audit only'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
