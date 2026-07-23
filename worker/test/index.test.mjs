import test from "node:test";
import assert from "node:assert/strict";

import {
  default as worker,
  checkRateLimit,
  formatTinybirdUrl,
  hasValidProxySecret,
  isAllowedOrigin,
  isMembersMagicLinkPath,
  parseRoute,
  requiresTurnstile
} from "../src/index.mjs";

const postUuid = "6c3dfb40-8b72-49f2-bf50-735885f0b76b";
const proxySecret = "test-worker-proxy-secret-32-chars";
const visitorSalt = "test-visitor-hash-salt-32-characters";

function proxyHeaders(extra = {}) {
  return {
    "origin": "https://blog.somnus.wiki",
    "x-somnus-worker-proxy": proxySecret,
    "x-somnus-client-ip": "203.0.113.10",
    ...extra
  };
}

function createD1Stub(statements = []) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          statements.push({sql, values});
          return {
            async first() {
              return sql.includes("SELECT 1 AS liked") ? null : {count: 0};
            },
            async run() {
              return {success: true, meta: {changes: 1}};
            }
          };
        }
      };
    }
  };
}

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

test("accepts only the configured Caddy proxy credential", () => {
  assert.equal(
    hasValidProxySecret(
      new Request("https://engagement.somnus.wiki/", {
        headers: {"x-somnus-worker-proxy": proxySecret}
      }),
      proxySecret
    ),
    true
  );
  assert.equal(
    hasValidProxySecret(new Request("https://engagement.somnus.wiki/"), proxySecret),
    false
  );
  assert.equal(
    hasValidProxySecret(
      new Request("https://engagement.somnus.wiki/", {
        headers: {"x-somnus-worker-proxy": `${proxySecret}-forged`}
      }),
      proxySecret
    ),
    false
  );
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

test("rate limiting fails open when unconfigured and rejects exhausted keys", async () => {
  assert.equal(await checkRateLimit(undefined, "visitor"), true);
  assert.equal(
    await checkRateLimit(undefined, "signup", {failOpen: false}),
    false
  );
  assert.equal(
    await checkRateLimit({limit: async () => ({success: false})}, "visitor"),
    false
  );
});

test("rate-limits repeated signup requests before forwarding", async () => {
  const request = new Request("https://engagement.somnus.wiki/members/api/send-magic-link/", {
    method: "POST",
    headers: proxyHeaders({
      "content-type": "application/json",
    }),
    body: JSON.stringify({
      email: "reader@example.com",
      emailType: "signup",
      integrityToken: "ghost-integrity-token",
      turnstileToken: "turnstile-token"
    })
  });
  const response = await worker.fetch(request, {
    ALLOWED_ORIGIN: "https://blog.somnus.wiki",
    WORKER_PROXY_SECRET: proxySecret,
    GHOST_MEMBERS_PROXY_URL: "https://blog.somnus.wiki/members/api/_origin/send-magic-link/",
    MEMBERS_PROXY_SECRET: "test-proxy-secret",
    VISITOR_HASH_SALT: visitorSalt,
    SIGNUP_RATE_LIMITER: {limit: async () => ({success: false})}
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
});

test("rejects signup requests without a Turnstile token", async () => {
  const request = new Request("https://engagement.somnus.wiki/members/api/send-magic-link/", {
    method: "POST",
    headers: proxyHeaders({
      "content-type": "application/json",
    }),
    body: JSON.stringify({
      email: "reader@example.com",
      emailType: "signup",
      integrityToken: "ghost-integrity-token"
    })
  });
  const response = await worker.fetch(request, {
    ALLOWED_ORIGIN: "https://blog.somnus.wiki",
    WORKER_PROXY_SECRET: proxySecret,
    VISITOR_HASH_SALT: visitorSalt,
    GHOST_MEMBERS_PROXY_URL: "https://blog.somnus.wiki/members/api/_origin/send-magic-link/",
    MEMBERS_PROXY_SECRET: "test-proxy-secret",
    SIGNUP_RATE_LIMITER: {limit: async () => ({success: true})}
  });
  assert.equal(response.status, 403);
  assert.match(await response.text(), /Human verification failed/);
});

test("rejects direct requests that bypass Caddy", async () => {
  const response = await worker.fetch(
    new Request(`https://engagement.somnus.wiki/api/engagement/${postUuid}`),
    {
      ALLOWED_ORIGIN: "https://blog.somnus.wiki",
      WORKER_PROXY_SECRET: proxySecret,
      VISITOR_HASH_SALT: visitorSalt
    }
  );
  assert.equal(response.status, 403);
  assert.match(await response.text(), /proxy authentication required/);
});

test("issues and then accepts a signed HttpOnly visitor cookie", async () => {
  const env = {
    ALLOWED_ORIGIN: "https://blog.somnus.wiki",
    WORKER_PROXY_SECRET: proxySecret,
    VISITOR_HASH_SALT: visitorSalt,
    DB: createD1Stub()
  };
  const firstResponse = await worker.fetch(
    new Request(`https://engagement.somnus.wiki/api/engagement/${postUuid}`, {
      headers: proxyHeaders({"x-like-visitor": "legacy_like_visitor_12345"})
    }),
    env
  );
  assert.equal(firstResponse.status, 200);
  assert.equal(firstResponse.headers.get("cache-control"), "no-store");
  assert.equal(firstResponse.headers.get("x-content-type-options"), "nosniff");
  const cookie = firstResponse.headers.get("set-cookie");
  assert.match(cookie, /^__Host-somnus_visitor=legacy_like_visitor_12345\./);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);

  const cookieValue = cookie.split(";")[0];
  const secondResponse = await worker.fetch(
    new Request(`https://engagement.somnus.wiki/api/engagement/${postUuid}`, {
      headers: proxyHeaders({cookie: cookieValue})
    }),
    env
  );
  assert.equal(secondResponse.status, 200);
  assert.equal(secondResponse.headers.get("set-cookie"), null);
});

test("rejects an invalid engagement method without issuing a visitor cookie", async () => {
  const response = await worker.fetch(
    new Request(`https://engagement.somnus.wiki/api/engagement/${postUuid}`, {
      method: "POST",
      headers: proxyHeaders({"content-type": "application/json"}),
      body: "{}"
    }),
    {
      ALLOWED_ORIGIN: "https://blog.somnus.wiki",
      WORKER_PROXY_SECRET: proxySecret,
      VISITOR_HASH_SALT: visitorSalt,
      DB: createD1Stub()
    }
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  assert.equal(response.headers.get("set-cookie"), null);
});

test("rate-limits likes by signed visitor and trusted client IP", async () => {
  const rateLimitKeys = [];
  const response = await worker.fetch(
    new Request(`https://engagement.somnus.wiki/api/engagement/${postUuid}/like`, {
      method: "POST",
      headers: proxyHeaders({"content-type": "application/json"}),
      body: JSON.stringify({visitor: "attacker-controlled-value", liked: true})
    }),
    {
      ALLOWED_ORIGIN: "https://blog.somnus.wiki",
      WORKER_PROXY_SECRET: proxySecret,
      VISITOR_HASH_SALT: visitorSalt,
      DB: createD1Stub(),
      ENGAGEMENT_RATE_LIMITER: {
        async limit({key}) {
          rateLimitKeys.push(key);
          return {success: true};
        }
      }
    }
  );
  assert.equal(response.status, 200);
  assert.equal(rateLimitKeys.length, 2);
  assert.equal(rateLimitKeys.some((key) => key.startsWith("like:visitor:")), true);
  assert.equal(rateLimitKeys.some((key) => key.startsWith("like:client:")), true);
  assert.equal(rateLimitKeys.some((key) => key.includes("attacker-controlled-value")), false);
});

test("rejects a chunked JSON body larger than the configured limit", async () => {
  const response = await worker.fetch(
    new Request(`https://engagement.somnus.wiki/api/engagement/${postUuid}/like`, {
      method: "POST",
      headers: proxyHeaders({"content-type": "application/json"}),
      body: JSON.stringify({liked: true, padding: "x".repeat(4096)})
    }),
    {
      ALLOWED_ORIGIN: "https://blog.somnus.wiki",
      WORKER_PROXY_SECRET: proxySecret,
      VISITOR_HASH_SALT: visitorSalt,
      DB: createD1Stub()
    }
  );
  assert.equal(response.status, 400);
  assert.match(await response.text(), /invalid like request/);
});

test("scheduled cleanup is bounded and uses the last_seen predicate", async () => {
  const statements = [];
  await worker.scheduled(null, {DB: createD1Stub(statements)});
  assert.equal(statements.length, 1);
  assert.match(statements[0].sql, /last_seen < \?/);
  assert.match(statements[0].sql, /LIMIT \?/);
  assert.equal(statements[0].values[1], 5000);
});
