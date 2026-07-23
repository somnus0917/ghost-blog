import test from "node:test";
import assert from "node:assert/strict";

import {
  default as worker,
  formatTinybirdUrl,
  isAllowedOrigin,
  isMembersMagicLinkPath,
  parseRoute,
  requiresTurnstile
} from "../src/index.mjs";

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

test("recognizes only the Ghost magic-link endpoint", () => {
  assert.equal(isMembersMagicLinkPath("/members/api/send-magic-link"), true);
  assert.equal(isMembersMagicLinkPath("/members/api/send-magic-link/"), true);
  assert.equal(isMembersMagicLinkPath("/members/api/integrity-token/"), false);
  assert.equal(isMembersMagicLinkPath("/ghost/api/admin/session/"), false);
});

test("requires Turnstile for registration but not existing-member sign in", () => {
  assert.equal(requiresTurnstile("signup"), true);
  assert.equal(requiresTurnstile("subscribe"), true);
  assert.equal(requiresTurnstile("signin"), false);
});

test("rejects signup requests without a Turnstile token", async () => {
  const request = new Request("https://engagement.somnus.wiki/members/api/send-magic-link/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "origin": "https://blog.somnus.wiki"
    },
    body: JSON.stringify({
      email: "reader@example.com",
      emailType: "signup",
      integrityToken: "ghost-integrity-token"
    })
  });
  const response = await worker.fetch(request, {
    ALLOWED_ORIGIN: "https://blog.somnus.wiki",
    GHOST_MEMBERS_PROXY_URL: "https://blog.somnus.wiki/members/api/_origin/send-magic-link/",
    MEMBERS_PROXY_SECRET: "test-proxy-secret"
  });
  assert.equal(response.status, 403);
  assert.match(await response.text(), /Human verification failed/);
});
