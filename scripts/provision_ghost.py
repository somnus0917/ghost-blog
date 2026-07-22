#!/usr/bin/env python3
"""Initialize Ghost, import converted Zola content, and activate the theme."""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BUILD = REPO_ROOT / "build"
DEFAULT_CREDENTIALS = REPO_ROOT / ".private" / "ghost-owner.json"


class GhostClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def request(self, method: str, path: str, data: bytes | None = None, headers: dict | None = None) -> dict:
        request_headers = {
            "Accept": "application/json",
            "Accept-Version": "v6.0",
            "Origin": self.base_url,
        }
        if headers:
            request_headers.update(headers)
        request = urllib.request.Request(
            f"{self.base_url}{path}", data=data, headers=request_headers, method=method
        )
        try:
            with self.opener.open(request, timeout=60) as response:
                payload = response.read()
                content_type = response.headers.get_content_type()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"{method} {path} failed with {exc.code}: {detail[:1000]}") from exc
        if not payload.strip() or content_type != "application/json":
            return {}
        try:
            return json.loads(payload)
        except json.JSONDecodeError as exc:
            preview = payload[:500].decode("utf-8", errors="replace")
            raise RuntimeError(f"{method} {path} returned invalid JSON: {preview!r}") from exc

    def json_request(self, method: str, path: str, payload: dict) -> dict:
        return self.request(
            method,
            path,
            json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            {"Content-Type": "application/json"},
        )

    def upload_theme(self, archive: Path) -> str:
        boundary = f"----somnus-{uuid.uuid4().hex}"
        file_bytes = archive.read_bytes()
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{archive.name}"\r\n'
            "Content-Type: application/zip\r\n\r\n"
        ).encode("utf-8") + file_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")
        response = self.request(
            "POST",
            "/ghost/api/admin/themes/upload/",
            body,
            {"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        return response["themes"][0]["name"]


def ensure_owner(client: GhostClient, credentials_path: Path) -> dict:
    setup = client.request("GET", "/ghost/api/admin/authentication/setup/")
    is_setup = bool(setup.get("setup", [{}])[0].get("status"))
    if credentials_path.exists():
        credentials = json.loads(credentials_path.read_text(encoding="utf-8"))
    else:
        credentials = {
            "name": "Somnus",
            "email": "mailmeblog@somnus.wiki",
            "password": secrets.token_urlsafe(24),
        }
        credentials_path.parent.mkdir(parents=True, exist_ok=True)
        credentials_path.write_text(json.dumps(credentials, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        credentials_path.chmod(0o600)

    if not is_setup:
        client.json_request(
            "POST",
            "/ghost/api/admin/authentication/setup/",
            {"setup": [{**credentials, "blogTitle": "Somnus的博客"}]},
        )
        print("created Ghost owner account")

    client.json_request(
        "POST",
        "/ghost/api/admin/session/",
        {"username": credentials["email"], "password": credentials["password"]},
    )
    return credentials


def current_items(client: GhostClient, resource: str) -> list[dict]:
    response = client.request(
        "GET", f"/ghost/api/admin/{resource}/?limit=all&fields=id,slug,title,updated_at"
    )
    return response.get(resource, [])


def import_content(
    client: GhostClient, export_path: Path, update_existing: bool = False
) -> tuple[int, int, list[tuple[str, str]]]:
    export = json.loads(export_path.read_text(encoding="utf-8"))
    data = export["data"]
    tags_by_id = {tag["id"]: {"name": tag["name"], "slug": tag["slug"]} for tag in data["tags"]}
    tag_ids_by_post: dict[str, list[str]] = {}
    for relation in data["posts_tags"]:
        tag_ids_by_post.setdefault(relation["post_id"], []).append(relation["tag_id"])

    existing_items = {resource: current_items(client, resource) for resource in ("posts", "pages")}
    existing_slugs = {
        resource: {item["slug"] for item in items} for resource, items in existing_items.items()
    }
    existing_titles = {
        resource: {item["title"] for item in items} for resource, items in existing_items.items()
    }
    by_title = {
        resource: {item["title"]: item for item in items} for resource, items in existing_items.items()
    }
    imported = 0
    updated = 0
    actual_urls: list[tuple[str, str]] = []

    for source in data["posts"]:
        resource = "pages" if source["type"] == "page" else "posts"
        existing_item = by_title[resource].get(source["title"])
        if existing_item and not update_existing:
            continue
        if not existing_item and (
            source["slug"] in existing_slugs[resource]
            or source["title"] in existing_titles[resource]
        ):
            continue
        post = {
            key: value
            for key, value in source.items()
            if key
            in {
                "title",
                "slug",
                "html",
                "status",
                "visibility",
                "published_at",
                "custom_excerpt",
            }
        }
        post["tags"] = [tags_by_id[tag_id] for tag_id in tag_ids_by_post.get(source["id"], [])]
        if "published_at" in post:
            post["published_at"] = post["published_at"].replace(" ", "T") + ".000Z"
        if existing_item:
            post.pop("slug", None)
            post["updated_at"] = existing_item["updated_at"]
            response = client.json_request(
                "PUT",
                f"/ghost/api/admin/{resource}/{existing_item['id']}/?source=html",
                {resource: [post]},
            )
            updated += 1
            print(f"updated {resource[:-1]} {updated}: {source['title']}")
        else:
            response = client.json_request(
                "POST", f"/ghost/api/admin/{resource}/?source=html", {resource: [post]}
            )
        created = response[resource][0]
        if not existing_item:
            imported += 1
            existing_slugs[resource].add(created["slug"])
            existing_titles[resource].add(created["title"])
            by_title[resource][created["title"]] = created
            print(f"imported {resource[:-1]} {imported}: {source['title']}")
        actual_urls.append((source["slug"], created.get("url", "")))
    return imported, updated, actual_urls


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:2368")
    parser.add_argument("--build", type=Path, default=DEFAULT_BUILD)
    parser.add_argument("--credentials", type=Path, default=DEFAULT_CREDENTIALS)
    parser.add_argument("--update-existing", action="store_true")
    args = parser.parse_args()

    client = GhostClient(args.url)
    try:
        ensure_owner(client, args.credentials)
        imported, updated, actual_urls = import_content(
            client, args.build / "somnus-zola.ghost.json", update_existing=args.update_existing
        )
        theme_name = client.upload_theme(args.build / "somnus-yohaku.zip")
        client.json_request("PUT", f"/ghost/api/admin/themes/{urllib.parse.quote(theme_name)}/activate/", {})
    except Exception as exc:
        print(f"provisioning failed: {exc}", file=sys.stderr)
        return 1

    (args.build / "imported-urls.json").write_text(
        json.dumps(actual_urls, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        f"provisioned Ghost: {imported} new items, {updated} updated items; "
        f"active theme: {theme_name}"
    )
    print(f"owner credentials stored at {args.credentials.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
