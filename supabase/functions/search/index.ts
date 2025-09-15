// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

function sanitizeWord(w: string) { return w.toLowerCase().replace(/[^a-z0-9]+/g, ""); }

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const preferBook = (url.searchParams.get("book") || "").trim() || null;
  const preferAuthor = (url.searchParams.get("author") || "").trim() || null;

  try {
    if (!q) return new Response("Add ?q=search+terms", { status: 400 });

    const sbUrl = Deno.env.get("SB_URL");
    const sbRole = Deno.env.get("SB_SERVICE_ROLE");
    const supabase = createClient(sbUrl!, sbRole!);

    // --- FTS (literal) ---
    const words = q.split(/\s+/).map(sanitizeWord).filter(Boolean);
    const tsquery = words.length ? words.map(t => `${t}:*`).join(" | ") : "";
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

    // --- Normalize & merge ---
    const WEIGHT_FTS = parseFloat(Deno.env.get("WEIGHT_FTS") ?? "0.55");
    const WEIGHT_VEC = parseFloat(Deno.env.get("WEIGHT_VEC") ?? "0.45");

    // FTS rank -> [0..1]
    const fMax = Math.max(0.00001, ...ftsRows.map(r => r.rank || 0));
    for (const r of ftsRows) r._fts = (r.rank || 0) / fMax;

    // Vector distance -> similarity [0..1]
    const dists = vecRows.map((r: any) => r.dist).filter((d: number) => typeof d === "number");
    const dMin = dists.length ? Math.min(...dists) : 0;
    const dMax = dists.length ? Math.max(...dists) : 1;
    for (const r of vecRows) {
      const norm = dMax > dMin ? (r.dist - dMin) / (dMax - dMin) : 0.5;
      r._vec = 1 - norm;
    }

    const key = (r: any) => [
      r.book,
      r.start_chapter,
      r.start_verse ?? -1,
      r.end_chapter ?? r.start_chapter,
      r.end_verse ?? -1,
    ].join("|");

    const bucket = new Map<string, any>();

    // Seed with FTS (includes title/author/snippet from RPC)
    for (const r of ftsRows) {
      bucket.set(key(r), { ...r, _vec: 0 });
    }

    // Merge in vector hits (preserve existing title/author/snippet if already present)
    for (const r of vecRows) {
      const k = key(r);
      const ex = bucket.get(k);
      if (ex) {
        ex._vec = r._vec ?? ex._vec;
        // If vector rows also include title/author/snippet and FTS lacked them, you could backfill here.
        if (ex.title == null && r.title != null)   ex.title = r.title;
        if (ex.author == null && r.author != null) ex.author = r.author;
        if (ex.snippet == null && r.snippet != null) ex.snippet = r.snippet;
      } else {
        bucket.set(k, { ...r, rank: r.rank ?? 0, _fts: r._fts ?? 0, _vec: r._vec ?? 0 });
      }
    }

    const merged = Array.from(bucket.values())
      .map(r => ({
        ...r,
        score: WEIGHT_FTS * (r._fts || 0) + WEIGHT_VEC * (r._vec || 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
    // after computing `merged`
    const ids = [...new Set(merged.map((r:any) => r.explanation_id).filter(Boolean))];

if (ids.length) {
  const { data: exps, error } = await supabase
    .from("explanation")
    .select("id, body")
    .in("id", ids);

  if (!error && exps) {
    const byId = new Map(exps.map((e:any) => [e.id, e.body]));
    const MAX_CHARS = 2000; // optional, to keep responses light
    for (const r of merged) {
      const full = r.explanation_id ? byId.get(r.explanation_id) : null;
      r.body = full
        ? (full.length > MAX_CHARS ? full.slice(0, MAX_CHARS) + "…" : full)
        : null;
    }
  } else {
    // Don’t fail the whole request if this secondary fetch has an issue
    console.warn("explanation body fetch error:", error);
    for (const r of merged) r.body = null;
  }
}

    // Build response (no client-side enrichment needed)
    const payload: any = {
      q,
      terms: words,
      weights: { fts: WEIGHT_FTS, vector: WEIGHT_VEC },
      results: merged,
    };

    return Response.json(payload);
  } catch (e) {
    return new Response(`Error: ${e}`, { status: 500 });
  }
});
