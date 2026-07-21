#!/usr/bin/env python3
"""Seed idempotent demo posts into a local Ghost instance via the Admin API."""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONTENT = ROOT / "fixtures" / "demo-posts.json"


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def make_token(api_key: str) -> str:
    try:
        key_id, secret = api_key.strip().split(":", 1)
        secret_bytes = bytes.fromhex(secret)
    except (ValueError, TypeError) as exc:
        raise RuntimeError("Ghost Admin API key must use the id:hex-secret format") from exc

    now = int(time.time())
    header = b64url(json.dumps({"alg": "HS256", "kid": key_id, "typ": "JWT"}).encode())
    payload = b64url(json.dumps({"iat": now, "exp": now + 300, "aud": "/admin/"}).encode())
    signature = hmac.new(secret_bytes, f"{header}.{payload}".encode(), hashlib.sha256).digest()
    return f"{header}.{payload}.{b64url(signature)}"


def local_docker_api_key() -> str:
    query = (
        "SELECT CONCAT(k.id, ':', k.secret) "
        "FROM api_keys k JOIN roles r ON r.id=k.role_id "
        "WHERE r.name='Admin Integration' AND k.type='admin' LIMIT 1;"
    )
    command = [
        "docker",
        "exec",
        "somnus-ghost-mysql",
        "sh",
        "-lc",
        'mysql -N -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" '
        f'-e "{query}" 2>/dev/null',
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    key = result.stdout.strip()
    if not key:
        raise RuntimeError("No local Ghost admin integration key was found")
    return key


class GhostAdmin:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    def request(self, method: str, path: str, payload: dict | None = None) -> dict:
        data = None
        headers = {
            "Accept": "application/json",
            "Accept-Version": "v6.0",
            "Authorization": f"Ghost {make_token(self.api_key)}",
        }
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            f"{self.base_url}{path}", data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"{method} {path} failed with {exc.code}: {detail[:800]}") from exc
        return json.loads(raw) if raw.strip() else {}


def seed(client: GhostAdmin, content_path: Path, update_existing: bool) -> tuple[int, int, int]:
    posts = json.loads(content_path.read_text(encoding="utf-8"))
    response = client.request(
        "GET", "/ghost/api/admin/posts/?limit=all&fields=id,title,slug,status,updated_at"
    )
    existing = {post["slug"]: post for post in response.get("posts", [])}
    created = updated = skipped = 0

    placeholder = existing.get("coming-soon")
    if (
        placeholder
        and placeholder["title"] == "Coming soon"
        and placeholder["status"] == "published"
    ):
        client.request(
            "PUT",
            f"/ghost/api/admin/posts/{placeholder['id']}/",
            {"posts": [{"status": "draft", "updated_at": placeholder["updated_at"]}]},
        )
        print("unpublished default: Coming soon")

    for source in posts:
        current = existing.get(source["slug"])
        post = {
            **source,
            "status": "published",
            "visibility": "public",
        }
        if current and not update_existing:
            skipped += 1
            print(f"skipped: {source['title']}")
            continue
        if current:
            post.pop("slug", None)
            post["updated_at"] = current["updated_at"]
            client.request(
                "PUT",
                f"/ghost/api/admin/posts/{current['id']}/?source=html",
                {"posts": [post]},
            )
            updated += 1
            print(f"updated: {source['title']}")
        else:
            client.request(
                "POST", "/ghost/api/admin/posts/?source=html", {"posts": [post]}
            )
            created += 1
            print(f"created: {source['title']}")
    return created, updated, skipped


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:2369")
    parser.add_argument("--content", type=Path, default=DEFAULT_CONTENT)
    parser.add_argument("--api-key", default=os.environ.get("GHOST_ADMIN_API_KEY"))
    parser.add_argument("--update-existing", action="store_true")
    parser.add_argument("--theme", default="somnus-yohaku")
    args = parser.parse_args()

    try:
        api_key = args.api_key or local_docker_api_key()
        client = GhostAdmin(args.url, api_key)
        created, updated, skipped = seed(client, args.content, args.update_existing)
        if args.theme:
            theme = urllib.parse.quote(args.theme, safe="")
            client.request("PUT", f"/ghost/api/admin/themes/{theme}/activate/", {})
    except Exception as exc:
        print(f"demo seed failed: {exc}", file=sys.stderr)
        return 1

    print(
        f"demo content ready: {created} created, {updated} updated, {skipped} skipped; "
        f"active theme: {args.theme}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
