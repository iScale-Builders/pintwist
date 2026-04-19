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

    // Clerk session tokens include primary email in the default template as
    // `email` (if present) or can require a JWT template to include it.
    // Fall back to the reserved `primary_email_address` claim.
    const email = ((payload.email || payload.primary_email_address || "") + "").toLowerCase();

    return {
      userId,
      email,
      isAdmin: email === ADMIN_EMAIL,
    };
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
