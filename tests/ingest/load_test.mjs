#!/usr/bin/env node
// Load test: 500 distinct install_ids each flush 1 batch of 20 pins.
// Concurrency capped at 50 parallel in-flight requests.
// Validates Edge Function throughput + latency at realistic DAU burst.
//
// All test install_ids start with "ffffffff-ffff-" so they can be
// filtered out post-test without touching real user data.
//
// Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... node load_test.mjs

const URL_BASE = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL_BASE || !ANON) {
  console.error("Need SUPABASE_URL and SUPABASE_ANON_KEY env vars");
  process.exit(1);
}

const endpoint = `${URL_BASE}/functions/v1/ingest`;
const TOTAL_INSTALLS = 500;
const BATCH_SIZE = 20;
const CONCURRENCY = 50;
const TEST_UUID_PREFIX = "ffffffff-ffff-";

function makeInstallId() {
  const raw = crypto.randomUUID();
  return TEST_UUID_PREFIX + raw.slice(14);
}

function makePin(installIdx, pinIdx) {
  return {
    pin_id: String(9100000000000 + installIdx * 100 + pinIdx),
    saves: Math.floor(Math.random() * 10000),
    reactions: Math.floor(Math.random() * 50),
    shares: Math.floor(Math.random() * 20),
    repins: Math.floor(Math.random() * 20),
    comments: Math.floor(Math.random() * 30),
    pin_created_at: new Date(Date.now() - Math.random() * 30 * 86400 * 1000).toISOString(),
    image_url: `https://i.pinimg.com/originals/aa/bb/cc/load${installIdx}_${pinIdx}.jpg`,
    is_video: false,
    source_url: "https://www.pinterest.com/search/pins/?q=load+test",
    search_terms: "load test",
    seen_at: new Date().toISOString(),
  };
}

async function sendBatch(installIdx) {
  const installId = makeInstallId();
  const batch = Array.from({ length: BATCH_SIZE }, (_, i) => makePin(installIdx, i));
  const t0 = performance.now();
  let status = 0;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: ANON,
        authorization: `Bearer ${ANON}`,
      },
      body: JSON.stringify({ install_id: installId, batch }),
    });
    status = res.status;
    await res.text();
  } catch (err) {
    status = -1;
  }
  return { ms: performance.now() - t0, status };
}

async function runPool(total, concurrency, fn) {
  const results = new Array(total);
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= total) break;
      results[idx] = await fn(idx);
    }
  });
  await Promise.all(workers);
  return results;
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

console.log(`Load test: ${TOTAL_INSTALLS} install_ids × ${BATCH_SIZE} pins, concurrency ${CONCURRENCY}`);
console.log(`Endpoint:  ${endpoint}\n`);

const wallStart = performance.now();
const results = await runPool(TOTAL_INSTALLS, CONCURRENCY, sendBatch);
const wallMs = performance.now() - wallStart;

const byStatus = {};
for (const r of results) {
  byStatus[r.status] = (byStatus[r.status] || 0) + 1;
}
const latencies = results.filter((r) => r.status === 200).map((r) => r.ms).sort((a, b) => a - b);
const pinsInserted = (byStatus[200] || 0) * BATCH_SIZE;

console.log(`Wall time:       ${(wallMs / 1000).toFixed(2)}s`);
console.log(`Effective rps:   ${(TOTAL_INSTALLS / (wallMs / 1000)).toFixed(1)} batches/sec`);
console.log(`Pins inserted:   ${pinsInserted}`);
console.log(`Status breakdown:`, byStatus);
if (latencies.length) {
  console.log(`\nLatency (ms) for ${latencies.length} successful requests:`);
  console.log(`  min/p50/p95/p99/max: ${latencies[0].toFixed(0)} / ${percentile(latencies, 0.5).toFixed(0)} / ${percentile(latencies, 0.95).toFixed(0)} / ${percentile(latencies, 0.99).toFixed(0)} / ${latencies[latencies.length - 1].toFixed(0)}`);
}

const success = (byStatus[200] || 0) / TOTAL_INSTALLS;
console.log(`\nSuccess rate: ${(success * 100).toFixed(2)}%`);

// Pass criteria: ≥98% 2xx, p95 < 2000ms
const pass = success >= 0.98 && (latencies.length === 0 || percentile(latencies, 0.95) < 2000);
console.log(pass ? "\nPASS" : "\nFAIL");
process.exit(pass ? 0 : 1);
