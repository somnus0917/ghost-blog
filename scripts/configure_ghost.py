#!/usr/bin/env python3
"""Apply the non-secret publication settings used by this blog."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from provision_ghost import DEFAULT_CREDENTIALS, GhostClient


BASE_SETTINGS = {
    "title": "Somnus的博客",
    "description": "记录技术实践、学习笔记、项目实验和日常观察。",
    "locale": "zh",
    "timezone": "Asia/Shanghai",
    "facebook": None,
    "twitter": None,
}
REPORT_KEYS = {"members_signup_access", "comments_enabled", "cover_image"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="https://blog.somnus.wiki")
    parser.add_argument("--credentials", type=Path, default=DEFAULT_CREDENTIALS)
    parser.add_argument(
        "--cover-image",
        help="Publication cover URL; defaults to the versioned theme share image.",
    )
    parser.add_argument("--report", action="store_true")
    args = parser.parse_args()

    credentials = json.loads(args.credentials.read_text(encoding="utf-8"))
    client = GhostClient(args.url)
    client.json_request(
        "POST",
        "/ghost/api/admin/session/",
        {"username": credentials["email"], "password": credentials["password"]},
    )
    if args.report:
        response = client.request("GET", "/ghost/api/admin/settings/")
        visible = {
            item["key"]: item.get("value")
            for item in response.get("settings", [])
            if item.get("key") in REPORT_KEYS
        }
        print(json.dumps(visible, ensure_ascii=False, sort_keys=True))
        return 0
    settings = dict(BASE_SETTINGS)
    settings["cover_image"] = args.cover_image or (
        f"{args.url.rstrip('/')}/assets/images/site-cover-v1.png"
    )
    response = client.json_request(
        "PUT",
        "/ghost/api/admin/settings/",
        {"settings": [{"key": key, "value": value} for key, value in settings.items()]},
    )
    updated = {item["key"] for item in response.get("settings", [])}
    missing = set(settings) - updated
    if missing:
        raise RuntimeError(f"settings response did not include: {', '.join(sorted(missing))}")
    print(f"configured Ghost publication: {len(settings)} settings")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
