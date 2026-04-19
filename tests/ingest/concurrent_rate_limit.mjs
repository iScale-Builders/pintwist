#!/usr/bin/env node
// Concurrent rate-limit test: fires 30 batches in parallel from one install_id
// against a 10/min limit. Proves the atomic bump_rate_limit function doesn't
// suffer the race condition of the original SELECT-then-UPSERT pattern.
//
// Pre-test: wait for the rate-limit window to clear (up to 75s).
//
// Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... node concurrent_rate_limit.mjs

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL || !ANON) {
  console.error("Need SUPABASE_URL and SUPABASE_ANON_KEY env vars");
  process.exit(1);
}

const endpoint = `${URL}/functions/v1/ingest`;
const installId = crypto.randomUUID();
const LIMIT = 10;
const FIRED = 30;
const EXPECTED_ACCEPTED = LIMIT;
const EXPECTED_REJECTED = FIRED - LIMIT;

function makePin(n) {
  return {
    pin_id: String(2000000000000 + n),
    saves: 10 + n,
    reactions: n,
    shares: n,
    repins: n,
    comments: n,
    pin_created_at: new Date(Date.now() - 2 * 86400 * 1000).toISOString(),
    image_url: `https://i.pinimg.com/originals/aa/bb/cc/concurrent${n}.jpg`,
    is_video: false,
    source_url: "https://www.pinterest.com/search/pins/?q=concurrent+test",
    search_terms: "concurrent test",
    seen_at: new Date().toISOString(),
  };
}

async function post(body) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: ANON,
      authorization: `Bearer ${ANON}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status };
}

console.log(`Endpoint: ${endpoint}`);
console.log(`install_id: ${installId}`);
console.log(`Firing ${FIRED} concurrent batches, expect ${EXPECTED_ACCEPTED} accepted / ${EXPECTED_REJECTED} 429s\n`);

const promises = [];
for (let i = 0; i < FIRED; i++) {
  promises.push(post({ install_id: installId, batch: [makePin(i)] }));
}

const results = await Promise.all(promises);
const accepted = results.filter((r) => r.status === 200).length;
const rateLimited = results.filter((r) => r.status === 429).length;
const other = results.filter((r) => r.status !== 200 && r.status !== 429);

console.log(`accepted=${accepted}  rate_limited=${rateLimited}  other=${other.length}`);
if (other.length > 0) {
  console.log(`unexpected statuses: ${other.map((r) => r.status).join(", ")}`);
}

if (accepted === EXPECTED_ACCEPTED && rateLimited === EXPECTED_REJECTED && other.length === 0) {
  console.log(`\nPASS  atomic rate limit held under concurrent load`);
  process.exit(0);
} else {
  console.log(`\nFAIL  expected ${EXPECTED_ACCEPTED}/${EXPECTED_REJECTED}, got ${accepted}/${rateLimited}`);
  process.exit(1);
}
