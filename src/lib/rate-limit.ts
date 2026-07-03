import { headers } from "next/headers";
import { Redis } from "@upstash/redis";

// Distributed rate limiter. Uses Upstash Redis when configured (required for
// any multi-instance / serverless / autoscaled deploy — otherwise each
// instance keeps its own counters and the real limit is max × instanceCount).
// Falls back to a per-process in-memory map for local dev, and also if a Redis
// call throws, so a Redis outage degrades gracefully instead of locking
// everyone out or removing all protection.
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
    : null;

type RateLimitResult = { allowed: boolean; retryAfterMs: number };

// ---- In-memory fallback (single instance only) ----------------------------
const attempts = new Map<string, { count: number; resetAt: number }>();

function checkInMemory(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (entry.count >= max) return { allowed: false, retryAfterMs: entry.resetAt - now };
  entry.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

// ---- Redis fixed-window ----------------------------------------------------
async function checkRedis(key: string, max: number, windowMs: number): Promise<RateLimitResult> {
  const k = `rl:${key}`;
  const count = await redis!.incr(k);
  if (count === 1) await redis!.pexpire(k, windowMs);
  if (count > max) {
    const ttl = await redis!.pttl(k);
    return { allowed: false, retryAfterMs: ttl > 0 ? ttl : windowMs };
  }
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Fixed-window rate limit for `key`: at most `max` requests per `windowMs`.
 * Async because the Redis backend is a network call. On any Redis error it
 * falls back to the in-memory limiter rather than failing the request.
 */
export async function checkRateLimit(key: string, max: number, windowMs: number): Promise<RateLimitResult> {
  if (!redis) return checkInMemory(key, max, windowMs);
  try {
    return await checkRedis(key, max, windowMs);
  } catch (err) {
    console.error("[rate-limit] Redis error, falling back to in-memory:", err);
    return checkInMemory(key, max, windowMs);
  }
}

/**
 * Best-effort client IP from proxy headers (`x-forwarded-for` is what most
 * reverse proxies / load balancers set; falls back to `x-real-ip`). Trusting
 * these is fine behind a proxy that sets them itself and strips client-supplied
 * ones — NOT fine if the app is exposed directly to the internet, since then a
 * client could forge the header. In local dev neither exists, so this returns
 * "unknown" and every local request shares one bucket — expected, not a bug.
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwardedFor = h.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

/** Combines a per-identity limit (e.g. tenant+email) with a coarser per-IP limit — either tripping blocks the request. Stops both "one attacker hammering one account" and "one attacker spraying many accounts from one IP". */
export async function checkRateLimitWithIp(
  identityKey: string,
  identityMax: number,
  ipMax: number,
  windowMs: number
): Promise<RateLimitResult> {
  const ip = await getClientIp();
  const [identityResult, ipResult] = await Promise.all([
    checkRateLimit(identityKey, identityMax, windowMs),
    checkRateLimit(`ip:${ip}`, ipMax, windowMs),
  ]);

  if (!identityResult.allowed || !ipResult.allowed) {
    return {
      allowed: false,
      retryAfterMs: Math.max(identityResult.retryAfterMs, ipResult.retryAfterMs),
    };
  }
  return { allowed: true, retryAfterMs: 0 };
}
