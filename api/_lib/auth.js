// Shared Clerk JWT verification (via public JWKS, no secret key needed)
// and Supabase service-role client for Pintwist API routes.
//
// Env vars required on Vercel:
//   SUPABASE_URL              — https://tzuvthfkdguxisquxlnb.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — Supabase dashboard / Management API
//   CLERK_FRONTEND_API_URL    — https://clerk.iscalelabs.com (Clerk's frontend API for this instance)
//   PINTWIST_ADMIN_EMAIL      — contact@iscalelabs.com (default if unset)

import { createRemoteJWKSet, jwtVerify } from "jose";
import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = (process.env.PINTWIST_ADMIN_EMAIL || "contact@iscalelabs.com").toLowerCase();
const ADMIN_USER_IDS = (process.env.PINTWIST_ADMIN_USER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const FRONTEND_API = (process.env.CLERK_FRONTEND_API_URL || "https://clerk.iscalelabs.com").replace(/\/$/, "");

let _supabase = null;
export function supabase() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  _supabase = createClient(url, key, { auth: { persistSession: false } });
  return _supabase;
}

// Cache the JWKS fetcher across warm invocations.
let _jwks = null;
function jwks() {
  if (_jwks) return _jwks;
  _jwks = createRemoteJWKSet(new URL(FRONTEND_API + "/.well-known/jwks.json"));
  return _jwks;
}

/**
 * Verifies Authorization: Bearer <clerk_session_token>.
 * Uses Clerk's public JWKS — no secret key required.
 * Returns { userId, email, isAdmin } on success, or null on failure.
 */
export async function verifyAuth(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, jwks(), {
      issuer: FRONTEND_API,
    });

    const userId = payload.sub;
    if (!userId) return null;

    // Clerk default session tokens don't include `email` — you'd need a
    // JWT template to add it. Match on user ID allowlist (PINTWIST_ADMIN_USER_IDS)
    // as the primary admin check; email match is a fallback for when a
    // JWT template is eventually set up.
    const email = ((payload.email || payload.primary_email_address || "") + "").toLowerCase();

    const isAdmin =
      ADMIN_USER_IDS.includes(userId) ||
      (email && email === ADMIN_EMAIL);

    return { userId, email, isAdmin };
  } catch (err) {
    console.warn("verifyAuth failed:", err.message);
    return null;
  }
}

export async function requireAuth(req, res) {
  const auth = await verifyAuth(req);
  if (!auth) {
    res.status(401).json({ error: "unauthorized" });
    return null;
  }
  return auth;
}

export async function requireAdmin(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return null;
  if (!auth.isAdmin) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return auth;
}

export function jsonError(res, status, message, extra = {}) {
  res.status(status).json(Object.assign({ error: message }, extra));
}

/**
 * Atomic per-user rate limit check via bump_api_rate_limit.
 * Returns { allowed: bool, count: int } — caller should 429 if !allowed.
 *
 * Usage:
 *   const rl = await checkRateLimit({ userId }, "trending", { perMinute: 60 });
 *   if (!rl.allowed) return jsonError(res, 429, "rate_limited", { retry_after: 60 });
 *
 * Buckets are minute-based by default. For longer windows pass { perDay: N }.
 */
export async function checkRateLimit(auth, route, opts = {}) {
  if (!auth || !auth.userId) return { allowed: false, count: 0 };
  const sb = supabase();

  // Minute bucket (default). Converts timestamp to integer minute count.
  if (opts.perMinute) {
    const minute = Math.floor(Date.now() / 60_000);
    const windowKey = `m:${route}:${minute}`;
    const expires = new Date((minute + 2) * 60_000).toISOString(); // 2 min TTL
    const { data, error } = await sb
      .rpc("bump_api_rate_limit", {
        p_user_id: auth.userId,
        p_window_key: windowKey,
        p_expires_at: expires,
        p_limit: opts.perMinute,
      })
      .single();
    if (error) {
      console.warn("rate_limit rpc error (fail-open):", error.message);
      return { allowed: true, count: 0 };
    }
    if (!data || !data.allowed) return { allowed: false, count: data?.current_count ?? 0 };
  }

  // Daily bucket (for expensive endpoints like /api/suggest)
  if (opts.perDay) {
    const day = new Date().toISOString().slice(0, 10);
    const windowKey = `d:${route}:${day}`;
    const expires = new Date(Date.now() + 2 * 86_400_000).toISOString(); // 2 day TTL
    const { data, error } = await sb
      .rpc("bump_api_rate_limit", {
        p_user_id: auth.userId,
        p_window_key: windowKey,
        p_expires_at: expires,
        p_limit: opts.perDay,
      })
      .single();
    if (error) {
      console.warn("rate_limit rpc error (fail-open):", error.message);
      return { allowed: true, count: 0 };
    }
    if (!data || !data.allowed) return { allowed: false, count: data?.current_count ?? 0, daily: true };
  }

  return { allowed: true };
}
