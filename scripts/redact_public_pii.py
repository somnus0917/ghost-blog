#!/usr/bin/env python3
"""Redact obvious identity fields from one Ghost post with a local backup."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from provision_ghost import DEFAULT_CREDENTIALS, REPO_ROOT, GhostClient


DEFAULT_BACKUP_DIR = REPO_ROOT / ".private" / "redaction-backups"
FIELD_PATTERNS = {
    "student_number": re.compile(r"学号[：:]\s*([0-9]{8,})"),
    "name": re.compile(r"姓名[：:]\s*([\u3400-\u9fff]{2,8})"),
}


def redact_text(value: str) -> tuple[str, list[str]]:
    replacements: dict[str, str] = {}
    matched_fields: list[str] = []
    for field, pattern in FIELD_PATTERNS.items():
        match = pattern.search(value)
        if match:
            replacements[match.group(1)] = "[已脱敏]"
            matched_fields.append(field)
    for original, replacement in replacements.items():
        value = value.replace(original, replacement)
    return value, matched_fields


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="https://blog.somnus.wiki")
    parser.add_argument("--credentials", type=Path, default=DEFAULT_CREDENTIALS)
    parser.add_argument("--slug", default="2026-05-21")
    parser.add_argument("--backup-dir", type=Path, default=DEFAULT_BACKUP_DIR)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    if not args.credentials.is_file():
        raise SystemExit(
            f"Ghost owner credentials are missing: {args.credentials}. "
            "Run this only from a trusted device that has the ignored credentials file."
        )
    credentials = json.loads(args.credentials.read_text(encoding="utf-8"))
    client = GhostClient(args.url)
    client.json_request(
        "POST",
        "/ghost/api/admin/session/",
        {"username": credentials["email"], "password": credentials["password"]},
    )
    response = client.request(
        "GET",
        f"/ghost/api/admin/posts/slug/{quote(args.slug)}/?formats=lexical",
    )
    post = response["posts"][0]
    lexical = post.get("lexical") or ""
    redacted, matched_fields = redact_text(lexical)
    if not matched_fields:
        print(f"no configured identity fields found in post: {args.slug}")
        return 0
    print(f"found fields to redact: {', '.join(sorted(matched_fields))}")
    if not args.apply:
        print("dry run only; pass --apply to back up and update the post")
        return 0

    args.backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = args.backup_dir / f"{args.slug}-{timestamp}.json"
    backup.write_text(
        json.dumps(response, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    backup.chmod(0o600)

    client.json_request(
        "PUT",
        f"/ghost/api/admin/posts/{post['id']}/",
        {
            "posts": [
                {
                    "lexical": redacted,
                    "updated_at": post["updated_at"],
                }
            ]
        },
    )
    print(f"redacted post {args.slug}; original saved to {backup}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
