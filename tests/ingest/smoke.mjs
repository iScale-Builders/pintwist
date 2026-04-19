#!/usr/bin/env node
// Smoke test for the Pintwist ingest Edge Function.
// Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... node smoke.mjs

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL || !ANON) {
  console.error("Need SUPABASE_URL and SUPABASE_ANON_KEY env vars");
  process.exit(1);
}

const endpoint = `${URL}/functions/v1/ingest`;
const installId = crypto.randomUUID();
let pass = 0;
let fail = 0;

function ok(label) {
  console.log(`  PASS  ${label}`);
  pass++;
}
function bad(label, detail) {
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  fail++;
}

async function post(body, headers = {}) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: ANON,
      authorization: `Bearer ${ANON}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* ignore */
  }
  return { status: res.status, json };
}

function makePin(n, overrides = {}) {
  return {
    pin_id: String(1000000000000 + n),
    saves: 100 + n,
    reactions: 5 + n,
    shares: n,
    repins: n,
    comments: n,
    pin_created_at: new Date(Date.now() - 3 * 86400 * 1000).toISOString(),
    image_url: `https://i.pinimg.com/originals/aa/bb/cc/fake${n}.jpg`,
    is_video: false,
    source_url: "https://www.pinterest.com/search/pins/?q=smoke+test",
    search_terms: "smoke test",
    seen_at: new Date().toISOString(),
    ...overrides,
  };
}

console.log(`Endpoint: ${endpoint}`);
console.log(`install_id: ${installId}\n`);

// 1. Valid batch
{
  const r = await post({ install_id: installId, batch: [makePin(1), makePin(2), makePin(3)] });
  if (r.status === 200 && r.json?.accepted === 3) ok("valid batch of 3 accepted");
  else bad("valid batch", `status=${r.status} body=${JSON.stringify(r.json)}`);
}

// 2. Invalid install_id
{
  const r = await post({ install_id: "not-a-uuid", batch: [makePin(4)] });
  if (r.status === 400 && r.json?.error === "invalid_install_id") ok("invalid install_id rejected");
  else bad("invalid install_id", `status=${r.status} body=${JSON.stringify(r.json)}`);
}

// 3. Empty batch
{
  const r = await post({ install_id: installId, batch: [] });
  if (r.status === 400 && r.json?.error === "empty_batch") ok("empty batch rejected");
  else bad("empty batch", `status=${r.status} body=${JSON.stringify(r.json)}`);
}

// 4. Partial validity: some good pins, some bad
{
  const r = await post({
    install_id: installId,
    batch: [makePin(5), makePin(6, { pin_id: "abc" }), makePin(7, { pin_id: "" }), makePin(8)],
  });
  if (r.status === 200 && r.json?.accepted === 2 && Array.isArray(r.json?.rejected) && r.json.rejected.length === 2) {
    ok("partial validity: 2 accepted, 2 rejected");
  } else {
    bad("partial validity", `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
}

// 5a. Non-Pinterest source_url nulls out silently (pin still accepted)
{
  const r = await post({
    install_id: installId,
    batch: [makePin(50, { source_url: "https://evil.example.com/leak" })],
  });
  if (r.status === 200 && r.json?.accepted === 1 && (r.json?.rejected?.length ?? 0) === 0) {
    ok("non-pinterest source_url accepted with null (validated DB-side)");
  } else {
    bad("non-pinterest source_url", `status=${r.status} body=${JSON.stringify(r.json)}`);
  }
}

// 5. Missing JWT (anon key) = gateway 401
{
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ install_id: installId, batch: [makePin(9)] }),
  });
  if (res.status === 401) ok("missing anon key = 401");
  else bad("missing anon key", `status=${res.status}`);
}

// 6. Rate limit: we've already sent 3 batches. Send 8 more to cross the 10-batch/minute limit.
{
  const rlId = crypto.randomUUID();
  let sawRateLimit = false;
  let batchesBefore429 = 0;
  for (let i = 0; i < 15; i++) {
    const r = await post({ install_id: rlId, batch: [makePin(100 + i)] });
    if (r.status === 429) {
      sawRateLimit = true;
      break;
    }
    batchesBefore429++;
  }
  if (sawRateLimit && batchesBefore429 >= 10) {
    ok(`rate limit triggered after ${batchesBefore429} batches`);
  } else {
    bad("rate limit", `sawRateLimit=${sawRateLimit} batchesBefore429=${batchesBefore429}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
