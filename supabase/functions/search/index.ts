// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

function sanitizeWord(w: string) {
  return w.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const preferBook = (url.searchParams.get("book") || "").trim() || null;
  const preferAuthor = (url.searchParams.get("author") || "").trim() || null;

  try {
    if (!q) return new Response("Add ?q=search+terms", { status: 400 });

    const sbUrl = Deno.env.get("SB_URL");
    const sbRole = Deno.env.get("SB_SERVICE_ROLE");
    if (!sbUrl || !sbRole) {
      return new Response("Server not configured (SB_URL / SB_SERVICE_ROLE missing).", { status: 500 });
    }
    const supabase = createClient(sbUrl, sbRole);

    // --- FTS (literal) ---
    const words = q.split(/\s+/).map(sanitizeWord).filter(Boolean);
    // Use prefix only for words >=4 chars to reduce noise on short tokens
    const tsquery = words.length
      ? words.map(t => (t.length >= 4 ? `${t}:*` : t)).join(" | ")
      : "";
    let ftsRows: any[] = [];
    if (tsquery) {
      const { data, error } = await supabase.rpc("search_explanations_with_mentions", {
        tsquery_input: tsquery,
        prefer_book: preferBook,
        prefer_author: preferAuthor,
      });
      if (error) throw error;
      ftsRows = data ?? [];
    }

    // --- Embedding (semantic) ---
    let vecRows: any[] = [];
    if (OPENAI_API_KEY) {
      try {
        const er = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: "text-embedding-3-small", input: q }),
        });
        if (er.ok) {
          const ej = await er.json();
          const qemb: number[] = ej.data[0].embedding;
          const vr = await supabase.rpc("search_by_embedding", {
            q: qemb,
            prefer_book: preferBook,
            prefer_author: preferAuthor,
          });
          if (!vr.error) vecRows = vr.data ?? [];
        }
      } catch {
        // embeddings are optional; ignore failures
      }
    }

    // --- Weights ---
    const WEIGHT_FTS = parseFloat(Deno.env.get("WEIGHT_FTS") ?? "0.55");
    const WEIGHT_VEC = parseFloat(Deno.env.get("WEIGHT_VEC") ?? "0.45");

    // --- FTS rank -> [0..1] ---
    const fMax = Math.max(0.00001, ...ftsRows.map((r) => r.rank || 0));
    for (const r of ftsRows) {
      r._fts = (r.rank || 0) / fMax;
    }

    // --- Vector distance -> similarity in [0,1] (robust) ---
    const dists = vecRows
      .map((r: any) => (typeof r.dist === "number" ? r.dist : Number.POSITIVE_INFINITY))
      .filter((d: number) => Number.isFinite(d));

    const dMin = dists.length ? Math.min(...dists) : 0;
    const dMax = dists.length ? Math.max(...dists) : 1;
    const spread = dMax - dMin;

    for (const r of vecRows) {
      if (!Number.isFinite(r.dist)) {
        r._vec = 0;
        continue;
      }
      // best (min dist) => 1.0, worst (max dist) => 0.0
      let sim = spread > 1e-9 ? 1 - ((r.dist - dMin) / spread) : 0.0;
      r._vec = Math.max(0, Math.min(1, sim)); // clamp hard
    }

    // --- Merge FTS + Vector hits ---
    const key = (r: any) =>
      [
        r.book,
        r.start_chapter,
        r.start_verse ?? -1,
        r.end_chapter ?? r.start_chapter,
        r.end_verse ?? -1,
      ].join("|");

    const bucket = new Map<string, any>();

    // Seed with FTS; force _vec=0 so nothing stale leaks in
    for (const r of ftsRows) {
      bucket.set(key(r), { ...r, _vec: 0 });
    }

    // Merge in vector hits using normalized _vec only
    for (const r of vecRows) {
      const k = key(r);
      const ex = bucket.get(k);
      const vecSim = typeof r._vec === "number" ? r._vec : 0; // normalized above
      if (ex) {
        ex._vec = vecSim; // overwrite with normalized similarity
        if (ex.dist == null && r.dist != null) ex.dist = r.dist; // keep for debug
        if (ex.title == null && r.title != null) ex.title = r.title;
        if (ex.author == null && r.author != null) ex.author = r.author;
        if (ex.snippet == null && r.snippet != null) ex.snippet = r.snippet;
      } else {
        bucket.set(k, { ...r, rank: r.rank ?? 0, _fts: r._fts ?? 0, _vec: vecSim });
      }
    }

    // Build merged list
    let merged = Array.from(bucket.values()).slice(0, 50);

    // Optional sanity guards for short/noisy queries like "sin"
    const shortQuery = q.replace(/\W+/g, "").length < 4;
    const VEC_WEIGHT = shortQuery ? WEIGHT_VEC * 0.2 : WEIGHT_VEC;
    // If you want to drop weak semantic hits entirely, set MIN_VEC_SIM > 0 and uncomment the filter
    // const MIN_VEC_SIM = 0.65;
    // merged = merged.filter(r => (r._fts ?? 0) > 0 || (r._vec ?? 0) >= MIN_VEC_SIM);

    // Force-normalize score from clamped _fts/_vec
    for (const r of merged) {
      const f = Math.max(0, Math.min(1, Number(r._fts) || 0));
      const v = Math.max(0, Math.min(1, Number(r._vec) || 0));
      r.score = WEIGHT_FTS * f + VEC_WEIGHT * v; // guaranteed in [0,1]
    }

    // Sort by final score
    merged = merged.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    // --- Attach bodies (secondary fetch; non-fatal on error) ---
    const ids = [...new Set(merged.map((r: any) => r.explanation_id).filter(Boolean))];
    if (ids.length) {
      const { data: exps, error } = await supabase
        .from("explanation")
        .select("id, body")
        .in("id", ids);

      if (!error && exps) {
        const byId = new Map(exps.map((e: any) => [e.id, e.body]));
        const MAX_CHARS = 2000; // optional, to keep responses light
        for (const r of merged) {
          const full = r.explanation_id ? byId.get(r.explanation_id) : null;
          r.body = full
            ? (full.length > MAX_CHARS ? full.slice(0, MAX_CHARS) + "…" : full)
            : null;
        }
      } else {
        console.warn("explanation body fetch error:", error);
        for (const r of merged) r.body = null;
      }
    }

    // Build response
    const payload: any = {
      q,
      terms: words,
      weights: { fts: WEIGHT_FTS, vector: WEIGHT_VEC },
      results: merged,
    };

    // Debug top-3 internals (visible in Edge Function logs)
    console.log(
      merged.slice(0, 3).map((r) => ({
        book: r.book,
        rank: r.rank,
        dist: r.dist,
        _fts: r._fts,
        _vec: r._vec,
        score: r.score,
      })),
    );

    return Response.json(payload);
  } catch (e) {
    return new Response(`Error: ${e}`, { status: 500 });
  }
});
