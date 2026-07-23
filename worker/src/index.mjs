const POST_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_TYPE_PATTERN = /^(signin|signup|subscribe)$/;
const MEMBERS_MAGIC_LINK_PATH = /^\/members\/api\/send-magic-link\/?$/;
const ENGAGEMENT_API_VERSION = "3";
const ENGAGEMENT_HEALTH_PATH = "/api/engagement/health";
const PRESENCE_TTL_SECONDS = 75;
const PRESENCE_CLEANUP_BATCH_SIZE = 5000;
const VISITOR_COOKIE_NAME = "__Host-somnus_visitor";
const VISITOR_ID_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;
const VISITOR_SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;

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

function rateLimited() {
  return json(
    {errors: [{message: "Too many requests. Please try again later."}]},
    429,
    {"retry-after": "60"}
  );
}

export async function checkRateLimit(limiter, key, {failOpen = true} = {}) {
  if (!limiter || typeof limiter.limit !== "function") return failOpen;
  try {
    const result = await limiter.limit({key});
    return result.success === true;
  } catch (error) {
    console.error("Rate limiter unavailable", error);
    return failOpen;
  }
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

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function hasValidProxySecret(request, expectedSecret) {
  if (typeof expectedSecret !== "string" || expectedSecret.length < 32) return false;
  return constantTimeEqual(
    request.headers.get("x-somnus-worker-proxy") || "",
    expectedSecret
  );
}

export function formatTinybirdUrl(apiUrl, pipe, parameters) {
  const url = new URL(`/v0/pipes/${pipe}.json`, apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`);
  Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

async function readBody(request, maximumBytes = 2048) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maximumBytes) throw new Error("request body is too large");
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new Error("content type must be application/json");
  }
  if (!request.body) throw new Error("request body is required");

  const chunks = [];
  const reader = request.body.getReader();
  let totalBytes = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel("request body is too large");
      throw new Error("request body is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
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
  body.email = body.email.trim().toLowerCase();
  if (
    body.email.length > 320
    || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)
  ) {
    return json({errors: [{message: "Invalid registration request."}]}, 400);
  }
  if (!env.GHOST_MEMBERS_PROXY_URL || !env.MEMBERS_PROXY_SECRET) {
    console.error("Ghost members proxy is not configured");
    return json({errors: [{message: "Registration is temporarily unavailable."}]}, 503);
  }

  const clientIp = request.headers.get("x-somnus-client-ip") || "";
  if (clientIp) {
    const clientKey = await hashValue(clientIp, env.VISITOR_HASH_SALT);
    const clientAllowed = await checkRateLimit(
      env.SIGNUP_RATE_LIMITER,
      `client:${clientKey}`,
      {failOpen: false}
    );
    if (!clientAllowed) return rateLimited();
  }

  if (requiresTurnstile(body.emailType)) {
    const valid = await verifyTurnstile(request, env, body.turnstileToken);
    if (!valid) {
      return json({errors: [{message: "Human verification failed. Please try again."}]}, 403);
    }
  }

  const emailKey = await hashValue(body.email, env.VISITOR_HASH_SALT);
  if (!await checkRateLimit(
    env.SIGNUP_RATE_LIMITER,
    `email:${emailKey}`,
    {failOpen: false}
  )) {
    return rateLimited();
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

async function hashValue(value, salt) {
  if (!value) return null;
  const namespace = salt || "somnus-rate-limit";
  const bytes = new TextEncoder().encode(`${namespace}:${value}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readCookie(request, name) {
  const cookies = request.headers.get("cookie") || "";
  for (const item of cookies.split(";")) {
    const separator = item.indexOf("=");
    if (separator === -1) continue;
    if (item.slice(0, separator).trim() === name) {
      return item.slice(separator + 1).trim();
    }
  }
  return "";
}

function randomVisitorId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signVisitorId(visitorId, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {name: "HMAC", hash: "SHA-256"},
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(visitorId)
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function resolveVisitor(request, env) {
  if (typeof env.VISITOR_HASH_SALT !== "string" || env.VISITOR_HASH_SALT.length < 32) {
    throw new Error("VISITOR_HASH_SALT must be a random secret of at least 32 characters");
  }
  if (typeof env.VISITOR_COOKIE_SECRET !== "string" || env.VISITOR_COOKIE_SECRET.length < 32) {
    throw new Error("VISITOR_COOKIE_SECRET must be a random secret of at least 32 characters");
  }

  const value = readCookie(request, VISITOR_COOKIE_NAME);
  const [candidateId, candidateSignature, ...extra] = value.split(".");
  if (
    extra.length === 0
    && VISITOR_ID_PATTERN.test(candidateId || "")
    && VISITOR_SIGNATURE_PATTERN.test(candidateSignature || "")
  ) {
    const expectedSignature = await signVisitorId(candidateId, env.VISITOR_COOKIE_SECRET);
    if (constantTimeEqual(candidateSignature, expectedSignature)) {
      return {
        hash: await hashValue(candidateId, env.VISITOR_HASH_SALT),
        setCookie: ""
      };
    }
  }

  const visitorId = randomVisitorId();
  const signature = await signVisitorId(visitorId, env.VISITOR_COOKIE_SECRET);
  return {
    hash: await hashValue(visitorId, env.VISITOR_HASH_SALT),
    setCookie: `${VISITOR_COOKIE_NAME}=${visitorId}.${signature}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`
  };
}

function attachVisitorCookie(response, visitor) {
  if (visitor.setCookie) response.headers.append("set-cookie", visitor.setCookie);
  return response;
}

async function checkEngagementRateLimit(request, env, action, visitorHash) {
  const keys = [`${action}:visitor:${visitorHash}`];
  const clientIp = request.headers.get("x-somnus-client-ip") || "";
  if (clientIp) {
    const clientHash = await hashValue(clientIp, env.VISITOR_HASH_SALT);
    keys.push(`${action}:client:${clientHash}`);
  }
  const results = await Promise.all(
    keys.map((key) => checkRateLimit(env.ENGAGEMENT_RATE_LIMITER, key))
  );
  return results.every(Boolean);
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

async function getEngagement(env, postUuid, visitorHash) {
  const cutoff = Math.floor(Date.now() / 1000) - PRESENCE_TTL_SECONDS;
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

async function updatePresence(request, env, postUuid, visitorHash) {
  let body;
  try {
    body = await readBody(request);
  } catch (_error) {
    return json({error: "invalid presence request"}, 400);
  }
  if (!body || typeof body !== "object") return json({error: "invalid presence request"}, 400);
  if (!await checkEngagementRateLimit(request, env, "presence", visitorHash)) {
    return rateLimited();
  }
  const position = Math.max(0, Math.min(1, Number(body.position) || 0));
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - PRESENCE_TTL_SECONDS;
  await env.DB.prepare(`
    INSERT INTO post_presence (post_uuid, visitor_hash, position, last_seen)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (post_uuid, visitor_hash)
    DO UPDATE SET position = excluded.position, last_seen = excluded.last_seen
  `).bind(postUuid, visitorHash, position, now).run();
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM post_presence WHERE post_uuid = ? AND last_seen >= ?").bind(postUuid, cutoff).first();
  return json({online: Number(row?.count) || 1});
}

async function updateLike(request, env, postUuid, visitorHash) {
  let body;
  try {
    body = await readBody(request);
  } catch (_error) {
    return json({error: "invalid like request"}, 400);
  }
  if (!body || typeof body.liked !== "boolean") return json({error: "invalid like request"}, 400);
  if (!await checkEngagementRateLimit(request, env, "like", visitorHash)) {
    return rateLimited();
  }
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
  if (typeof env.WORKER_PROXY_SECRET !== "string" || env.WORKER_PROXY_SECRET.length < 32) {
    console.error("WORKER_PROXY_SECRET must be a random secret of at least 32 characters");
    return json({error: "service unavailable"}, 503);
  }
  if (typeof env.VISITOR_HASH_SALT !== "string" || env.VISITOR_HASH_SALT.length < 32) {
    console.error("VISITOR_HASH_SALT must be a random secret of at least 32 characters");
    return json({error: "service unavailable"}, 503);
  }
  if (typeof env.VISITOR_COOKIE_SECRET !== "string" || env.VISITOR_COOKIE_SECRET.length < 32) {
    console.error("VISITOR_COOKIE_SECRET must be a random secret of at least 32 characters");
    return json({error: "service unavailable"}, 503);
  }
  if (!hasValidProxySecret(request, env.WORKER_PROXY_SECRET)) {
    return json({error: "proxy authentication required"}, 403);
  }

  const allowedOrigin = env.ALLOWED_ORIGIN || "https://blog.somnus.wiki";
  if (!isAllowedOrigin(request, allowedOrigin)) return json({error: "origin not allowed"}, 403);
  if (request.method === "OPTIONS") {
    return new Response(null, {status: 204, headers: {"access-control-allow-origin": allowedOrigin, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type"}});
  }

  const pathname = new URL(request.url).pathname;
  if (pathname === ENGAGEMENT_HEALTH_PATH) {
    if (request.method !== "GET") return json({error: "method not allowed"}, 405, {allow: "GET"});
    return json(
      {status: "ok", apiVersion: ENGAGEMENT_API_VERSION},
      200,
      {"x-somnus-worker-version": ENGAGEMENT_API_VERSION}
    );
  }
  if (isMembersMagicLinkPath(pathname)) {
    if (request.method !== "POST") return json({error: "method not allowed"}, 405, {allow: "POST"});
    return forwardMagicLink(request, env);
  }

  const route = parseRoute(pathname);
  if (!route) return json({error: "not found"}, 404);
  const allowedMethod = route.action === "stats" ? "GET" : "POST";
  if (request.method !== allowedMethod) {
    return json({error: "method not allowed"}, 405, {allow: allowedMethod});
  }

  try {
    const visitor = await resolveVisitor(request, env);
    if (route.action === "stats") {
      return attachVisitorCookie(
        json(await getEngagement(env, route.postUuid, visitor.hash)),
        visitor
      );
    }
    if (route.action === "presence") {
      return attachVisitorCookie(
        await updatePresence(request, env, route.postUuid, visitor.hash),
        visitor
      );
    }
    return attachVisitorCookie(
      await updateLike(request, env, route.postUuid, visitor.hash),
      visitor
    );
  } catch (error) {
    console.error("Engagement request failed", error);
    return json({error: "service unavailable"}, 503);
  }
}

export default {
  fetch: handleRequest,
  async scheduled(_controller, env) {
    const cutoff = Math.floor(Date.now() / 1000) - PRESENCE_TTL_SECONDS;
    await env.DB.prepare(`
      DELETE FROM post_presence
      WHERE rowid IN (
        SELECT rowid
        FROM post_presence
        WHERE last_seen < ?
        ORDER BY last_seen
        LIMIT ?
      )
    `).bind(cutoff, PRESENCE_CLEANUP_BATCH_SIZE).run();
  }
};
