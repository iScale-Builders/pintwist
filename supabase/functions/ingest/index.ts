import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_BATCH_SIZE = 100;
const RATE_LIMIT_WINDOW_SEC = 60;
const RATE_LIMIT_MAX_BATCHES = 10;
const PIN_ID_REGEX = /^[0-9]{6,20}$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PinSubmission {
  pin_id: string;
  saves?: number | null;
  reactions?: number | null;
  shares?: number | null;
  repins?: number | null;
  comments?: number | null;
  pin_created_at?: string | null;
  image_url?: string | null;
  is_video?: boolean | null;
  source_url?: string | null;
  search_terms?: string | null;
  seen_at?: string;
}

interface IngestPayload {
  install_id: string;
  batch: PinSubmission[];
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "content-type, authorization, x-client-info, apikey",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function cleanInt(n: unknown): number | null {
  if (n === null || n === undefined) return null;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1_000_000_000) return null;
  return Math.floor(n);
}

function cleanString(s: unknown, maxLen = 2048): string | null {
  if (s === null || s === undefined) return null;
  if (typeof s !== "string") return null;
  const trimmed = s.slice(0, maxLen);
  return trimmed.length ? trimmed : null;
}

// Only accept pinterest.com URLs; null everything else so non-Pinterest browsing
// history never leaks into the DB even if the extension misfires off-platform.
function cleanPinterestUrl(s: unknown): string | null {
  const str = cleanString(s, 2048);
  if (!str) return null;
  try {
    const u = new URL(str);
    if (u.protocol !== "https:") return null;
    if (!/(^|\.)pinterest\.com$/i.test(u.hostname)) return null;
    return str;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let payload: IngestPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  if (!payload.install_id || !UUID_REGEX.test(payload.install_id)) {
    return jsonResponse({ error: "invalid_install_id" }, 400);
  }
  if (!Array.isArray(payload.batch) || payload.batch.length === 0) {
    return jsonResponse({ error: "empty_batch" }, 400);
  }
  if (payload.batch.length > MAX_BATCH_SIZE) {
    return jsonResponse({ error: "batch_too_large", max: MAX_BATCH_SIZE }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Atomic rate limit: single INSERT ... ON CONFLICT DO UPDATE RETURNING.
  // Fail-open on infra error — better to accept a batch than drop legit data.
  const windowStartMs =
    Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SEC * 1000)) *
    RATE_LIMIT_WINDOW_SEC *
    1000;
  const windowStart = new Date(windowStartMs).toISOString();

  const { data: rl, error: rlErr } = await supabase
    .rpc("bump_rate_limit", {
      p_install_id: payload.install_id,
      p_window_start: windowStart,
      p_limit: RATE_LIMIT_MAX_BATCHES,
    })
    .single();

  if (rlErr) {
    console.error("rate_limit rpc error:", rlErr);
  } else if (rl && rl.allowed === false) {
    return jsonResponse(
      { error: "rate_limited", retry_after: RATE_LIMIT_WINDOW_SEC },
      429,
    );
  }

  const valid: PinSubmission[] = [];
  const rejected: { pin_id: unknown; reason: string }[] = [];

  for (const item of payload.batch) {
    if (!item || typeof item !== "object") {
      rejected.push({ pin_id: null, reason: "not_object" });
      continue;
    }
    if (!item.pin_id || typeof item.pin_id !== "string" || !PIN_ID_REGEX.test(item.pin_id)) {
      rejected.push({ pin_id: item.pin_id, reason: "invalid_pin_id" });
      continue;
    }
    valid.push(item);
  }

  if (valid.length === 0) {
    return jsonResponse({ accepted: 0, rejected }, 200);
  }

  const pinMap = new Map<string, PinSubmission>();
  for (const p of valid) pinMap.set(p.pin_id, p);

  const pinRows = [...pinMap.values()].map((p) => ({
    pin_id: p.pin_id,
    image_url: cleanString(p.image_url, 512),
    is_video: typeof p.is_video === "boolean" ? p.is_video : null,
    pin_created_at: cleanString(p.pin_created_at, 64),
    last_seen: new Date().toISOString(),
  }));

  const { error: pinsErr } = await supabase
    .from("pins")
    .upsert(pinRows, { onConflict: "pin_id", ignoreDuplicates: false });
  if (pinsErr) {
    console.error("pins upsert error:", pinsErr);
    return jsonResponse({ error: "db_error", stage: "pins" }, 500);
  }

  const snapshotRows = valid.map((p) => ({
    pin_id: p.pin_id,
    install_id: payload.install_id,
    seen_at: cleanString(p.seen_at, 64) ?? new Date().toISOString(),
    source_url: cleanPinterestUrl(p.source_url),
    search_terms: cleanString(p.search_terms, 512),
    saves: cleanInt(p.saves),
    reactions: cleanInt(p.reactions),
    shares: cleanInt(p.shares),
    repins: cleanInt(p.repins),
    comments: cleanInt(p.comments),
  }));

  const { error: snapErr } = await supabase
    .from("pin_snapshots")
    .insert(snapshotRows);
  if (snapErr) {
    console.error("snapshots insert error:", snapErr);
    return jsonResponse({ error: "db_error", stage: "snapshots" }, 500);
  }

  return jsonResponse({ accepted: valid.length, rejected });
});
