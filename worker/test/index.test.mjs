import test from "node:test";
import assert from "node:assert/strict";

import {formatTinybirdUrl, isAllowedOrigin, parseRoute} from "../src/index.mjs";

const postUuid = "6c3dfb40-8b72-49f2-bf50-735885f0b76b";

test("parses supported engagement routes", () => {
  assert.deepEqual(parseRoute(`/api/engagement/${postUuid}`), {postUuid, action: "stats"});
  assert.deepEqual(parseRoute(`/api/engagement/${postUuid}/presence`), {postUuid, action: "presence"});
  assert.deepEqual(parseRoute(`/api/engagement/${postUuid}/like`), {postUuid, action: "like"});
});

test("rejects malformed post identifiers and unrelated paths", () => {
  assert.equal(parseRoute("/api/engagement/not-a-uuid"), null);
  assert.equal(parseRoute("/api/engagement/6c3dfb40-8b72-49f2-bf50-735885f0b76b/delete"), null);
  assert.equal(parseRoute("/ghost/api/admin/posts/"), null);
});

test("allows same-origin requests and rejects foreign origins", () => {
  const allowed = "https://blog.somnus.wiki";
  assert.equal(isAllowedOrigin(new Request("https://blog.somnus.wiki/api/engagement/x"), allowed), true);
  assert.equal(isAllowedOrigin(new Request("https://blog.somnus.wiki/api/engagement/x", {headers: {origin: allowed}}), allowed), true);
  assert.equal(isAllowedOrigin(new Request("https://blog.somnus.wiki/api/engagement/x", {headers: {origin: "https://example.com"}}), allowed), false);
});

test("builds a scoped Tinybird pipe URL", () => {
  const url = formatTinybirdUrl("https://api.example.tinybird.co", "api_post_visitor_counts", {
    site_uuid: "site-id",
    post_uuids: postUuid
  });
  assert.equal(url.origin, "https://api.example.tinybird.co");
  assert.equal(url.pathname, "/v0/pipes/api_post_visitor_counts.json");
  assert.equal(url.searchParams.get("site_uuid"), "site-id");
  assert.equal(url.searchParams.get("post_uuids"), postUuid);
});
