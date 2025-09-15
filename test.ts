// index.ts
// Self-contained test suite for your search function logic.
// Run: deno test -A index.ts
// Or:  deno run  -A index.ts   (executes tests manually)
// This file intentionally does NOT Deno.serve(); it's only tests and logs.

// ----------------------------- Utilities -----------------------------
type Row = Record<string, any>;

function sanitizeWord(w: string) {
  return w.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function keyOf(r: any) {
  return [
    r.book,
    r.start_chapter,
    r.start_verse ?? -1,
    r.end_chapter ?? r.start_chapter,
    r.end_verse ?? -1,
  ].join("|");
}

// ----------------------------- Mocks -----------------------------
// Mock: OpenAI embeddings fetch
async function mockEmbeddingFetch(url: string, init?: RequestInit) {
  if (!url.includes("/v1/embeddings")) {
    throw new Error("Unexpected fetch URL in mock: " + url);
  }
  // Minimal mock response
  return new Response(
    JSON.stringify({
      data: [{ embedding: Array.from({ length: 5 }, (_, i) => i * 0.01 + 0.1) }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// Mock: Supabase client with programmable responses
class MockSupabase {
  // Preloaded fixtures
  ftsRows: Row[] = [];
  vecRows: Row[] = [];
  explanationsTable: { id: number | string; body: string }[] = [];

  setFTS(rows: Row[]) {
    this.ftsRows = rows;
  }
  setVec(rows: Row[]) {
    this.vecRows = rows;
  }
  setBodies(rows: { id: number | string; body: string }[]) {
    this.explanationsTable = rows;
  }

  // rpc mocks
  async rpc(name: string, args: Record<string, any>) {
    console.log(`[rpc] name=${name} args=`, args);
    if (name === "search_explanations_with_mentions") {
      return { data: this.ftsRows, error: null };
    }
    if (name === "search_by_embedding") {
      return { data: this.vecRows, error: null };
    }
    return { data: null, error: { message: "unknown rpc" } };
  }

  // table selection mock
  from(table: string) {
    const self = this;
    return {
      select(sel: string) {
        console.log(`[from.select] table=${table} select=${sel}`);
        return {
          in(col: string, ids: (number | string)[]) {
            console.log(`[from.select.in] col=${col} ids=${JSON.stringify(ids)}`);
            if (table !== "explanation") {
              // Simulate a table name mismatch → no rows
              return Promise.resolve({ data: [], error: null });
            }
            const map = new Map(self.explanationsTable.map((r) => [String(r.id), r]));
            const out = ids
              .map((id) => map.get(String(id)))
              .filter(Boolean)
              .map((r) => ({ id: r!.id, body: r!.body }));
            return Promise.resolve({ data: out, error: null });
          },
        };
      },
    };
  }
}

// ----------------------------- Core under test -----------------------------
// This is your handler logic refactored as a function so we can test deterministically.
async function handleSearchTest(opts: {
  q: string;
  preferBook?: string;
  supabase: MockSupabase;
  OPENAI_API_KEY?: string; // presence toggles embedding branch
  WEIGHT_FTS?: number;
  WEIGHT_VEC?: number;
  fetchImpl?: typeof fetch;
}) {
  const {
    q,
    preferBook = "",
    supabase,
    OPENAI_API_KEY = "test_key_present",
    WEIGHT_FTS = 0.55,
    WEIGHT_VEC = 0.45,
    fetchImpl = mockEmbeddingFetch,
  } = opts;

  if (!q || !q.trim()) {
    return {
      status: 400,
      body: "Add ?q=search+terms",
    };
  }

  const words = q.split(/\s+/).map(sanitizeWord).filter(Boolean);

  // --- FTS
  const tsquery = words.length ? words.map((t) => t + ":*").join(" | ") : "";
  let ftsRows: Row[] = [];
  if (tsquery) {
    const { data, error } = await supabase.rpc("search_explanations_with_mentions", {
      tsquery_input: tsquery,
      prefer_book: preferBook || null,
    });
    if (error) throw new Error(error.message || "FTS rpc error");
    ftsRows = data ?? [];
  }

  // --- Embedding
  let vecRows: Row[] = [];
  if (OPENAI_API_KEY) {
    try {
      const er = await fetchImpl("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small", input: q }),
      });
      if (er.ok) {
        const ej = await er.json();
        const qemb: number[] = ej.data[0].embedding;
        const vr = await supabase.rpc("search_by_embedding", {
          q: qemb,
          prefer_book: preferBook || null,
        });
        if (!vr.error) vecRows = vr.data ?? [];
        else console.warn("Vec RPC error:", vr.error);
      } else {
        console.warn("Embedding error:", await er.text());
      }
    } catch (e) {
      console.warn("Embedding call failed:", e);
    }
  }

  // --- Normalize
  const fMax = Math.max(0.00001, ...ftsRows.map((r) => r.rank || 0));
  for (const r of ftsRows) r._fts = (r.rank || 0) / fMax;

  const dists = vecRows.map((r) => r.dist).filter((d) => typeof d === "number");
  const dMin = dists.length ? Math.min(...dists) : 0;
  const dMax = dists.length ? Math.max(...dists) : 1;
  for (const r of vecRows) {
    const norm = dMax > dMin ? (r.dist - dMin) / (dMax - dMin) : 0.5;
    r._vec = 1 - norm;
  }

  const bucket = new Map<string, Row>();
  for (const r of ftsRows) bucket.set(keyOf(r), { ...r, _vec: 0 });
  for (const r of vecRows) {
    const k = keyOf(r);
    const ex = bucket.get(k);
    if (ex) ex._vec = r._vec ?? ex._vec;
    else bucket.set(k, { ...r, rank: 0, snippet: r.snippet ?? "", _fts: 0, _vec: r._vec ?? 0 });
  }

  const merged = Array.from(bucket.values())
    .map((r) => ({ ...r, score: WEIGHT_FTS * (r._fts || 0) + WEIGHT_VEC * (r._vec || 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);

  // --- Enrich with body
  console.log("Any explanation_id in merged?", merged.some((r) => r?.explanation_id != null));
  const ids = Array.from(
    new Set(merged.map((r) => r?.explanation_id).filter((v) => v !== null && v !== undefined))
  );
  console.log("explanation ids to fetch:", ids);

  if (ids.length) {
    const { data: bodies, error: bErr } = await supabase
      .from("explanation")
      .select("id, body")
      .in("id", ids as (number | string)[]);
    if (bErr) {
      console.warn("Body fetch error:", bErr);
    } else {
      const bodyMap = new Map(bodies.map((b: any) => [b.id, b.body]));
      for (const r of merged as any[]) {
        r.body = r?.explanation_id != null ? bodyMap.get(r.explanation_id) ?? null : null;
      }
    }
  } else {
    console.warn("No explanation_id found on merged rows; cannot enrich bodies.");
    for (const r of merged as any[]) r.body = null;
  }

  return {
    status: 200,
    body: {
      q,
      terms: words,
      results: merged,
    },
  };
}

// ----------------------------- Test Fixtures -----------------------------
function makeFTSRow(partial: Partial<Row> = {}): Row {
  return {
    book: "John",
    start_chapter: 3,
    start_verse: 1,
    end_chapter: 3,
    end_verse: 5,
    rank: 0.8,
    snippet: "Nick at night…",
    explanation_id: 101,
    ...partial,
  };
}

function makeVecRow(partial: Partial<Row> = {}): Row {
  return {
    book: "John",
    start_chapter: 3,
    start_verse: 1,
    end_chapter: 3,
    end_verse: 5,
    dist: 0.12,
    explanation_id: 101,
    ...partial,
  };
}

// ----------------------------- Tests (Deno.test) -----------------------------
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("400 on missing q", async () => {
  console.log("\n--- TEST: 400 on missing q ---");
  const supa = new MockSupabase();
  const res = await handleSearchTest({ q: "", supabase: supa });
  console.log("status:", res.status, "body:", res.body);
  assertEquals(res.status, 400);
  assert(typeof res.body === "string");
});

Deno.test("FTS only returns body via enrichment", async () => {
  console.log("\n--- TEST: FTS only returns body ---");
  const supa = new MockSupabase();
  supa.setFTS([makeFTSRow({ rank: 0.9, explanation_id: 201 })]);
  supa.setBodies([{ id: 201, body: "FTS explanation body" }]);
  // Force embeddings branch off by removing API key
  const res = await handleSearchTest({
    q: "born again",
    supabase: supa,
    OPENAI_API_KEY: "", // disable embeddings call
  });
  assertEquals(res.status, 200);
  const first = (res.body as any).results[0];
  console.log("result[0]:", first);
  assertEquals(first.body, "FTS explanation body");
});

Deno.test("Vector + FTS merged; body present", async () => {
  console.log("\n--- TEST: Vector + FTS merge; body present ---");
  const supa = new MockSupabase();
  const base = { book: "John", start_chapter: 3, start_verse: 1, end_chapter: 3, end_verse: 5 };
  supa.setFTS([makeFTSRow({ ...base, rank: 0.6, explanation_id: 301 })]);
  supa.setVec([makeVecRow({ ...base, dist: 0.05, explanation_id: 301 })]);
  supa.setBodies([{ id: 301, body: "Merged explanation body" }]);

  const res = await handleSearchTest({ q: "water and spirit", supabase: supa });
  assertEquals(res.status, 200);
  const first = (res.body as any).results[0];
  console.log("merged top:", first);
  assertEquals(first.body, "Merged explanation body");
  assert("score" in first);
});

Deno.test("Vector rows WITHOUT explanation_id do not crash; body remains null", async () => {
  console.log("\n--- TEST: Vector rows w/o explanation_id ---");
  const supa = new MockSupabase();
  const base = { book: "John", start_chapter: 3, start_verse: 1, end_chapter: 3, end_verse: 5 };
  // FTS returns a DIFFERENT passage; vector returns a passage lacking explanation_id
  supa.setFTS([
    makeFTSRow({ ...base, start_verse: 10, end_verse: 12, rank: 0.7, explanation_id: 401 }),
  ]);
  supa.setVec([
    makeVecRow({ ...base, dist: 0.09, explanation_id: undefined }), // missing
  ]);
  supa.setBodies([{ id: 401, body: "FTS body only" }]);

  const res = await handleSearchTest({ q: "spirit blows", supabase: supa });
  assertEquals(res.status, 200);
  const results = (res.body as any).results;
  console.log("results:", results);
  // One row has body, the other (vec-only) should have null
  const hasNullBody = results.some((r: any) => r.body === null);
  assert(hasNullBody);
  const hasNonNullBody = results.some((r: any) => r.body === "FTS body only");
  assert(hasNonNullBody);
});

Deno.test("Scoring normalization: higher rank & better vec earns higher score", async () => {
  console.log("\n--- TEST: Scoring normalization ---");
  const supa = new MockSupabase();
  const A = makeFTSRow({ rank: 0.2, explanation_id: 501, start_verse: 1 });
  const B = makeFTSRow({ rank: 0.8, explanation_id: 502, start_verse: 5 });
  const VA = makeVecRow({ dist: 0.2, explanation_id: 501, start_verse: 1 });
  const VB = makeVecRow({ dist: 0.05, explanation_id: 502, start_verse: 5 });

  supa.setFTS([A, B]);
  supa.setVec([VA, VB]);
  supa.setBodies([
    { id: 501, body: "A body" },
    { id: 502, body: "B body" },
  ]);

  const res = await handleSearchTest({ q: "query", supabase: supa });
  const results = (res.body as any).results;
  console.log("ordered keys:", results.map((r: any) => ({ k: keyOf(r), score: r.score })));
  // Expect the B item (rank .8 + better vec .95) to outrank A
  assertEquals(results[0].explanation_id, 502);
  assertEquals(results[0].body, "B body");
});

Deno.test("Prefer book param is passed to RPCs", async () => {
  console.log("\n--- TEST: prefer_book propagation ---");
  const supa = new MockSupabase();
  supa.setFTS([makeFTSRow({ explanation_id: 601 })]);
  supa.setVec([makeVecRow({ explanation_id: 601 })]);
  supa.setBodies([{ id: 601, body: "Body 601" }]);

  const res = await handleSearchTest({ q: "query", supabase: supa, preferBook: "John" });
  assertEquals(res.status, 200);
  const first = (res.body as any).results[0];
  console.log("first result:", first);
  assertEquals(first.body, "Body 601");
});

// ----------------------------- Manual runner (optional) -----------------------------
// If you prefer: `deno run -A index.ts` will execute a quick smoke test.
if (import.meta.main) {
  (async () => {
    console.log("\n=== Manual smoke test ===");
    const supa = new MockSupabase();
    supa.setFTS([makeFTSRow({ rank: 0.9, explanation_id: 777 })]);
    supa.setVec([makeVecRow({ dist: 0.04, explanation_id: 777 })]);
    supa.setBodies([{ id: 777, body: "Manual body text" }]);

    const res = await handleSearchTest({ q: "manual test", supabase: supa });
    console.log("status:", res.status);
    console.log("top result:", (res.body as any).results[0]);
  })();
}
