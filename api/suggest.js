// POST /api/suggest
//
// Sends top trending pins for a niche to Claude and returns
// structured t-shirt design concept proposals.
//
// Body: { niche: "boho wall art", days?: 30, limit?: 20, model?: "sonnet"|"opus" }
// Returns: { niche, days, pins_analyzed, pattern_summary, concepts: [...] }
//
// Auth: admin only.

import { requireAdmin, supabase, jsonError, checkRateLimit } from "./_lib/auth.js";

const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_DAYS = 90;

const MODELS = {
  sonnet: "claude-sonnet-4-5",
  opus: "claude-opus-4-1",
};
const DEFAULT_MODEL = "sonnet";

const SYSTEM_PROMPT = `You are a research assistant for a print-on-demand (POD) t-shirt designer.
The user gives you the top trending Pinterest pins for a niche. You find patterns and propose specific t-shirt design concepts they could create to capitalize on the demand signal.

Rules:
- Ground every concept in pins from the data. Do not invent themes that aren't supported.
- Confidence 9-10 means multiple pins clearly support the concept. 5-6 means the signal is there but thin. Below 5, don't propose it.
- Be specific about visuals (typography, imagery, palette). "Minimalist typography" is lazy; "bold sans-serif with a single illustrated element, black on cream" is useful.
- Target audience should be demographic-specific ("30-50 yr old women gifting Mother's Day" not "women").
- Return valid JSON only, no prose outside the JSON.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return jsonError(res, 405, "method_not_allowed");
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  // Expensive endpoint — Claude tokens cost money. Tight per-minute + daily cap.
  const rlMin = await checkRateLimit(auth, "suggest", { perMinute: 10 });
  if (!rlMin.allowed) return jsonError(res, 429, "rate_limited", { retry_after: 60 });
  const rlDay = await checkRateLimit(auth, "suggest", { perDay: 200 });
  if (!rlDay.allowed) return jsonError(res, 429, "daily_limit_exceeded", { retry_after: 86400 });

  const body = req.body || {};
  const niche = (body.niche || "").toString().trim();
  if (!niche) return jsonError(res, 400, "niche_required");

  const days = Math.min(MAX_DAYS, Math.max(1, Number(body.days) || DEFAULT_DAYS));
  const limit = Math.min(MAX_LIMIT, Math.max(5, Number(body.limit) || DEFAULT_LIMIT));
  const modelKey = (body.model || DEFAULT_MODEL).toLowerCase();
  const model = MODELS[modelKey] || MODELS[DEFAULT_MODEL];

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return jsonError(res, 500, "anthropic_key_missing");

  try {
    const sb = supabase();
    const { data: pins, error } = await sb.rpc("trending_agg", {
      p_days: days,
      p_q: niche,
      p_sort: "reach",
      p_limit: limit,
      p_offset: 0,
    });
    if (error) {
      console.error("suggest: trending_agg error:", error);
      return jsonError(res, 500, "db_error");
    }
    if (!pins || pins.length === 0) {
      return res.status(200).json({
        niche,
        days,
        model: modelKey,
        pins_analyzed: 0,
        pattern_summary: "No pins found for this niche in the selected window.",
        concepts: [],
      });
    }

    const pinSummaries = pins.map((p) => ({
      id: p.pin_id,
      saves: p.max_saves,
      comments: p.max_comments,
      reactions: p.max_reactions,
      repins: p.max_repins,
      reach: p.reach,
      source: p.latest_source,
      search_terms: p.latest_search_terms,
      pin_url: `https://www.pinterest.com/pin/${p.pin_id}/`,
    }));

    const userMsg = `Niche: "${niche}"
Window: last ${days} days
Top ${pinSummaries.length} pins (ranked by cross-user reach, then save count):

${JSON.stringify(pinSummaries, null, 2)}

Propose 3 distinct t-shirt design concepts for this niche. Use the data to find patterns (saves concentration, repeated search terms, URL path clues). Return JSON:

{
  "pattern_summary": "2-3 sentence synthesis of what's actually trending here based on the data",
  "concepts": [
    {
      "title": "short concept name",
      "theme": "what the design is about, the hook/angle",
      "visual_direction": "typography, imagery, palette — concrete",
      "target_audience": "specific demographic + buying occasion",
      "confidence": 8,
      "signal_pins": ["pin_id_1", "pin_id_2", "pin_id_3"]
    }
  ]
}`;

    const started = Date.now();
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMsg }],
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      console.error("anthropic error:", r.status, text.slice(0, 300));
      return jsonError(res, 502, "anthropic_error", { upstream_status: r.status });
    }
    const out = await r.json();
    const text = out.content?.[0]?.text || "";
    const elapsed_ms = Date.now() - started;

    // Extract JSON from Claude's response.
    let parsed = null;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch (err) {
      console.warn("parse error:", err.message);
    }
    if (!parsed) {
      return jsonError(res, 500, "parse_error", {
        raw_preview: text.slice(0, 500),
      });
    }

    res.setHeader("cache-control", "no-store");
    return res.status(200).json({
      niche,
      days,
      model: modelKey,
      pins_analyzed: pinSummaries.length,
      elapsed_ms,
      pattern_summary: parsed.pattern_summary || "",
      concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [],
      usage: out.usage || null,
    });
  } catch (err) {
    console.error("suggest handler error:", err);
    return jsonError(res, 500, "internal_error");
  }
}
