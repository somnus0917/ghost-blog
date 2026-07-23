const POST_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VISITOR_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;
const EMAIL_TYPE_PATTERN = /^(signin|signup|subscribe)$/;
const MEMBERS_MAGIC_LINK_PATH = /^\/members\/api\/send-magic-link\/?$/;
const PRESENCE_TTL_SECONDS = 45;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders
    }
  });
}

export function parseRoute(pathname) {
  const match = pathname.match(/^\/api\/engagement\/([^/]+)(?:\/(presence|like))?\/?$/);
  if (!match) return null;
  const postUuid = decodeURIComponent(match[1]);
  if (!POST_UUID_PATTERN.test(postUuid)) return null;
  return {postUuid: postUuid.toLowerCase(), action: match[2] || "stats"};
}

export function isAllowedOrigin(request, allowedOrigin) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === allowedOrigin;
}

export function formatTinybirdUrl(apiUrl, pipe, parameters) {
  const url = new URL(`/v0/pipes/${pipe}.json`, apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`);
  Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

async function readBody(request, maximumBytes = 2048) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maximumBytes) throw new Error("request body is too large");
  return request.json();
}

export function isMembersMagicLinkPath(pathname) {
  return MEMBERS_MAGIC_LINK_PATH.test(pathname);
}

export function requiresTurnstile(emailType) {
  return emailType === "signup" || emailType === "subscribe";
}

async function verifyTurnstile(request, env, token) {
  if (!env.TURNSTILE_SECRET || typeof token !== "string" || token.length < 10 || token.length > 2048) {
    return false;
  }
  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET,
    response: token
  });
  const remoteIp = request.headers.get("x-somnus-client-ip");
  if (remoteIp) body.set("remoteip", remoteIp);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: {"content-type": "application/x-www-form-urlencoded"},
    body
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true
    && result.hostname === (env.TURNSTILE_HOSTNAME || "blog.somnus.wiki")
    && result.action === (env.TURNSTILE_ACTION || "member-signup");
}

async function forwardMagicLink(request, env) {
  let body;
  try {
    body = await readBody(request, 8192);
  } catch (_error) {
    return json({errors: [{message: "Invalid registration request."}]}, 400);
  }

  if (!body || typeof body.email !== "string" || !EMAIL_TYPE_PATTERN.test(body.emailType || "")) {
    return json({errors: [{message: "Invalid registration request."}]}, 400);
  }
  if (!env.GHOST_MEMBERS_PROXY_URL || !env.MEMBERS_PROXY_SECRET) {
    console.error("Ghost members proxy is not configured");
    return json({errors: [{message: "Registration is temporarily unavailable."}]}, 503);
  }

  if (requiresTurnstile(body.emailType)) {
    const valid = await verifyTurnstile(request, env, body.turnstileToken);
    if (!valid) {
      return json({errors: [{message: "Human verification failed. Please try again."}]}, 403);
    }
  }

  delete body.turnstileToken;
  const response = await fetch(env.GHOST_MEMBERS_PROXY_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-somnus-members-proxy": env.MEMBERS_PROXY_SECRET,
      "user-agent": "somnus-blog-members-proxy/1.0"
    },
    body: JSON.stringify(body),
    redirect: "manual"
  });
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
    "x-content-type-options": "nosniff"
  });
  return new Response(response.body, {status: response.status, headers});
}

async function hashVisitor(visitor, salt) {
  if (!VISITOR_PATTERN.test(visitor || "") || !salt) return null;
  const bytes = new TextEncoder().encode(`${salt}:${visitor}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function queryTinybird(env, pipe, parameters) {
  if (!env.TINYBIRD_API_URL || !env.TINYBIRD_STATS_TOKEN || !env.TINYBIRD_SITE_UUID) return null;
  const url = formatTinybirdUrl(env.TINYBIRD_API_URL, pipe, {
    site_uuid: env.TINYBIRD_SITE_UUID,
    ...parameters
  });
  const response = await fetch(url, {
    headers: {authorization: `Bearer ${env.TINYBIRD_STATS_TOKEN}`},
    cf: {cacheTtl: 30, cacheEverything: true}
  });
  if (!response.ok) throw new Error(`Tinybird ${pipe} returned ${response.status}`);
  return response.json();
}

async function getViews(env, postUuid) {
  try {
    const payload = await queryTinybird(env, "api_post_visitor_counts", {post_uuids: postUuid});
    if (!payload) return null;
    const row = Array.isArray(payload.data) ? payload.data[0] : null;
    return row ? Number(row.visits) || 0 : 0;
  } catch (error) {
    console.error("Unable to read Tinybird views", error);
    return null;
  }
}

async function getEngagement(env, postUuid, visitor) {
  const cutoff = Math.floor(Date.now() / 1000) - PRESENCE_TTL_SECONDS;
  const visitorHash = visitor ? await hashVisitor(visitor, env.VISITOR_HASH_SALT) : null;
  const likesQuery = env.DB.prepare("SELECT COUNT(*) AS count FROM post_likes WHERE post_uuid = ?").bind(postUuid).first();
  const presenceQuery = env.DB.prepare("SELECT COUNT(*) AS count FROM post_presence WHERE post_uuid = ? AND last_seen >= ?").bind(postUuid, cutoff).first();
  const likedQuery = visitorHash
    ? env.DB.prepare("SELECT 1 AS liked FROM post_likes WHERE post_uuid = ? AND visitor_hash = ? LIMIT 1").bind(postUuid, visitorHash).first()
    : Promise.resolve(null);
  const [views, likes, presence, liked] = await Promise.all([
    getViews(env, postUuid),
    likesQuery,
    presenceQuery,
    likedQuery
  ]);
  return {
    views,
    likes: Number(likes?.count) || 0,
    online: Number(presence?.count) || 0,
    liked: Boolean(liked)
  };
}

async function updatePresence(request, env, postUuid) {
  const body = await readBody(request);
  const visitorHash = await hashVisitor(body.visitor, env.VISITOR_HASH_SALT);
  if (!visitorHash) return json({error: "invalid visitor"}, 400);
  const position = Math.max(0, Math.min(1, Number(body.position) || 0));
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - PRESENCE_TTL_SECONDS;
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO post_presence (post_uuid, visitor_hash, position, last_seen)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (post_uuid, visitor_hash)
      DO UPDATE SET position = excluded.position, last_seen = excluded.last_seen
    `).bind(postUuid, visitorHash, position, now),
    env.DB.prepare("DELETE FROM post_presence WHERE last_seen < ?").bind(cutoff)
  ]);
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM post_presence WHERE post_uuid = ? AND last_seen >= ?").bind(postUuid, cutoff).first();
  return json({online: Number(row?.count) || 1});
}

async function updateLike(request, env, postUuid) {
  const body = await readBody(request);
  const visitorHash = await hashVisitor(body.visitor, env.VISITOR_HASH_SALT);
  if (!visitorHash || typeof body.liked !== "boolean") return json({error: "invalid like request"}, 400);
  if (body.liked) {
    await env.DB.prepare("INSERT OR IGNORE INTO post_likes (post_uuid, visitor_hash, created_at) VALUES (?, ?, ?)")
      .bind(postUuid, visitorHash, Math.floor(Date.now() / 1000))
      .run();
  } else {
    await env.DB.prepare("DELETE FROM post_likes WHERE post_uuid = ? AND visitor_hash = ?")
      .bind(postUuid, visitorHash)
      .run();
  }
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM post_likes WHERE post_uuid = ?").bind(postUuid).first();
  return json({likes: Number(row?.count) || 0, liked: body.liked});
}

async function handleRequest(request, env) {
  const allowedOrigin = env.ALLOWED_ORIGIN || "https://blog.somnus.wiki";
  if (!isAllowedOrigin(request, allowedOrigin)) return json({error: "origin not allowed"}, 403);
  if (request.method === "OPTIONS") {
    return new Response(null, {status: 204, headers: {"access-control-allow-origin": allowedOrigin, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, x-like-visitor"}});
  }

  const pathname = new URL(request.url).pathname;
  if (isMembersMagicLinkPath(pathname)) {
    if (request.method !== "POST") return json({error: "method not allowed"}, 405, {allow: "POST"});
    return forwardMagicLink(request, env);
  }

  const route = parseRoute(pathname);
  if (!route) return json({error: "not found"}, 404);

  try {
    if (route.action === "stats" && request.method === "GET") {
      const visitor = request.headers.get("x-like-visitor") || "";
      return json(await getEngagement(env, route.postUuid, visitor));
    }
    if (route.action === "presence" && request.method === "POST") return updatePresence(request, env, route.postUuid);
    if (route.action === "like" && request.method === "POST") return updateLike(request, env, route.postUuid);
    return json({error: "method not allowed"}, 405, {allow: route.action === "stats" ? "GET" : "POST"});
  } catch (error) {
    console.error("Engagement request failed", error);
    return json({error: "service unavailable"}, 503);
  }
}

export default {
  fetch: handleRequest,
  async scheduled(_controller, env) {
    const cutoff = Math.floor(Date.now() / 1000) - PRESENCE_TTL_SECONDS;
    await env.DB.prepare("DELETE FROM post_presence WHERE last_seen < ?").bind(cutoff).run();
  }
};
