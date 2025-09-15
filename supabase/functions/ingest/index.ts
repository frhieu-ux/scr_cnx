// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Optional: we’ll try embeddings only if this is set
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

const BOOK_MAP: Record<string, string> = {
  // Pentateuch etc. (keep your existing ones too)
  "gen":"Genesis","ge":"Genesis","gn":"Genesis",
  "ex":"Exodus","exo":"Exodus",
  "lev":"Leviticus","lv":"Leviticus",
  "num":"Numbers","nm":"Numbers",
  "deut":"Deuteronomy","dt":"Deuteronomy","deu":"Deuteronomy",

  "jos":"Joshua","josh":"Joshua",
  "judg":"Judges","jdg":"Judges","jg":"Judges",
  "rut":"Ruth","ru":"Ruth",

  "1 sam":"1 Samuel","i sam":"1 Samuel","1 sm":"1 Samuel",
  "2 sam":"2 Samuel","ii sam":"2 Samuel","2 sm":"2 Samuel",
  "1 kgs":"1 Kings","i kgs":"1 Kings","1 ki":"1 Kings","1 kings":"1 Kings",
  "2 kgs":"2 Kings","ii kgs":"2 Kings","2 ki":"2 Kings","2 kings":"2 Kings",

  "1 chron":"1 Chronicles","i chron":"1 Chronicles","1 chr":"1 Chronicles","1 ch":"1 Chronicles",
  "2 chron":"2 Chronicles","ii chron":"2 Chronicles","2 chr":"2 Chronicles","2 ch":"2 Chronicles",

  "ezra":"Ezra","ezr":"Ezra",
  "neh":"Nehemiah","ne":"Nehemiah",
  "esth":"Esther","est":"Esther",

  "job":"Job",
  "ps":"Psalms","pss":"Psalms","psalm":"Psalms","psalms":"Psalms",
  "prov":"Proverbs","prv":"Proverbs","pr":"Proverbs",
  "eccl":"Ecclesiastes","qohelet":"Ecclesiastes", // not Ecclesiasticus
  "song":"Song of Songs","song of songs":"Song of Songs",
  "canticles":"Song of Songs","canticle of canticles":"Song of Songs",
  "song of solomon":"Song of Songs","cant":"Song of Songs",

  "isa":"Isaiah","is":"Isaiah",
  "jer":"Jeremiah","je":"Jeremiah",
  "lam":"Lamentations","la":"Lamentations",
  "ezek":"Ezekiel","ez":"Ezekiel",
  "dan":"Daniel","dn":"Daniel",

  "hos":"Hosea","ho":"Hosea",
  "joel":"Joel","jl":"Joel",
  "amos":"Amos","am":"Amos",
  "obad":"Obadiah","ob":"Obadiah",
  "jonah":"Jonah","jon":"Jonah",
  "mic":"Micah","mi":"Micah",
  "nah":"Nahum","na":"Nahum",
  "hab":"Habakkuk","hb":"Habakkuk",
  "zeph":"Zephaniah","zp":"Zephaniah",
  "hag":"Haggai","hg":"Haggai",
  "zech":"Zechariah","zec":"Zechariah","zc":"Zechariah",
  "mal":"Malachi","ml":"Malachi",

  // Deuterocanon / Catholic books
  "tob":"Tobit","tobit":"Tobit","tb":"Tobit",
  "jdt":"Judith","judith":"Judith",
  "wis":"Wisdom","ws":"Wisdom","sap":"Wisdom","wisdom":"Wisdom","wisdom of solomon":"Wisdom",
  "sir":"Sirach","sirach":"Sirach","ecclus":"Sirach","ecclesiasticus":"Sirach",
  "bar":"Baruch","baruch":"Baruch","letter of jeremiah":"Baruch",
  "1 macc":"1 Maccabees","i macc":"1 Maccabees","1 mac":"1 Maccabees","1 mach":"1 Maccabees","1 maccabees":"1 Maccabees",
  "2 macc":"2 Maccabees","ii macc":"2 Maccabees","2 mac":"2 Maccabees","2 mach":"2 Maccabees","2 maccabees":"2 Maccabees",

  // Gospels & NT
  "mt":"Matthew","matt":"Matthew","matthew":"Matthew",
  "mk":"Mark","mrk":"Mark","mark":"Mark",
  "lk":"Luke","luke":"Luke",
  "jn":"John","john":"John",
  "acts":"Acts",
  "rom":"Romans","ro":"Romans",
  "1 cor":"1 Corinthians","i cor":"1 Corinthians",
  "2 cor":"2 Corinthians","ii cor":"2 Corinthians",
  "gal":"Galatians",
  "eph":"Ephesians",
  "phil":"Philippians","php":"Philippians","phl":"Philippians",
  "col":"Colossians",
  "1 thess":"1 Thessalonians","i thess":"1 Thessalonians","1 thes":"1 Thessalonians",
  "2 thess":"2 Thessalonians","ii thess":"2 Thessalonians","2 thes":"2 Thessalonians",
  "1 tim":"1 Timothy","i tim":"1 Timothy",
  "2 tim":"2 Timothy","ii tim":"2 Timothy",
  "tit":"Titus","titus":"Titus",
  "philem":"Philemon","phm":"Philemon","philemon":"Philemon",
  "heb":"Hebrews",
  "jas":"James","jam":"James","jm":"James",
  "1 pet":"1 Peter","i pet":"1 Peter",
  "2 pet":"2 Peter","ii pet":"2 Peter",
  "1 jn":"1 John","i jn":"1 John",
  "2 jn":"2 John","ii jn":"2 John",
  "3 jn":"3 John","iii jn":"3 John",
  "jude":"Jude","jud":"Jude",
  "rev":"Revelation","apocalypse":"Revelation","rv":"Revelation"
};

const REF_RE = new RegExp(
  String.raw`\b(?:(\d|i{1,3})\s*)?` +                              // leading number: 1/2/3 or I/II/III
  // book: 1 to 4 tokens of letters or dots (to allow "Song. of", "Ecclus.", etc.)
  String.raw`([A-Za-z\.]{2,}(?:\s+[A-Za-z\.]{2,}){0,3})\s*` +
  String.raw`(\d{1,3})` +                                          // start chapter
  String.raw`(?::|\.|\s)?` +
  String.raw`(\d{1,3})?` +                                         // start verse (optional)
  String.raw`(?:\s*[-–]\s*` +
  String.raw`(\d{1,3})?` +                                         // end chapter (optional)
  String.raw`(?::|\.|\s)?` +
  String.raw`(\d{1,3})?` +                                         // end verse (optional)
  String.raw`)?\b`, "gi"
);


function romanToArabic(s: string): string | null {
  const t = s.toUpperCase().trim();
  if (t === "I") return "1";
  if (t === "II") return "2";
  if (t === "III") return "3";
  return null;
}

function cleanBookToken(raw: string) {
  let b = raw.toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // drop leading connectors like "cf.", "see", etc.
  b = b.replace(/^(?:cf|see(?: also)?|also|and)\s+/, "");
  return b;
}

function normalizeBook(rawBook: string, leading?: string) {
  let b = cleanBookToken(rawBook);

  // fold common multi-name aliases before lookup
  b = b
    .replace(/^psalms?$/,"psalms")
    .replace(/^songs?$/,"song of songs")
    .replace(/^canticles?$/,"canticles")
    .replace(/^canticle of canticles$/,"canticle of canticles")
    .replace(/^song of solomon$/,"song of songs")
    .replace(/^wisdom of solomon$/,"wisdom")
    .replace(/^ecclesiasticus$/,"sirach")
    .replace(/^ecclus$/,"sirach")
    .replace(/^qohelet$/,"ecclesiastes")
    .replace(/^apoc(?:alypse)?$/,"apocalypse")
    .replace(/^sap$/,"wis");

  // sometimes the book comes like "1    maccabees" or "i    macc"
  let num = leading?.trim() ?? "";
  const roman = romanToArabic(num);
  if (roman) num = roman;

  // Try direct lookup first (with/without leading number)
  const probe = (k: string) => BOOK_MAP[k] ?? null;

  // First pass: as given
  if (num) {
    const key = `${num} ${b}`.trim();
    const hit = probe(key);
    if (hit) return hit;
  }
  const hit0 = probe(b);
  if (hit0) return hit0;

  // Heuristic: if multi-word, try last two words (e.g., "of songs" → "song of songs" already folded)
  const parts = b.split(" ");
  for (let take = Math.min(3, parts.length); take >= 1; take--) {
    const tail = parts.slice(parts.length - take).join(" ");
    const key = num ? `${num} ${tail}` : tail;
    const hit = probe(key);
    if (hit) return hit;
  }

  // Fallback: title-case what we have (won’t fix unknowns but keeps output tidy)
  return (num ? `${num} ` : "") + b.replace(/\b\w/g, c => c.toUpperCase());
}


Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("Use POST", { status: 405 });

    const { title, author, lang="en", body, themes=[] } = await req.json();
    if (!body || typeof body !== "string") {
      return new Response("Missing 'body' string", { status: 400 });
    }

    const supabase = createClient(Deno.env.get("SB_URL")!, Deno.env.get("SB_SERVICE_ROLE")!);

    // 1) Store the explanation
    const { data: exp, error: expErr } = await supabase
      .from("explanation")
      .insert([{ title, author, lang, body }])
      .select()
      .single();
    if (expErr) throw expErr;

    // 2) Extract & store passage mentions
    const mentions: any[] = [];
    for (const m of body.matchAll(REF_RE)) {
      const [, leadingNum, rawBook, chA, vA, chB, vB] = m;
      const book = normalizeBook(rawBook, leadingNum);
      const start_chapter = parseInt(chA,10);
      const start_verse   = vA ? parseInt(vA,10) : null;
      const end_chapter   = chB ? parseInt(chB,10) : start_chapter;
      const end_verse     = vB ? parseInt(vB,10) : null;
      const granularity   = (start_verse==null && end_verse==null) ? "chapter"
                             : (end_chapter!==start_chapter || (vB && vA && vB!==vA)) ? "range"
                             : "verse";
      mentions.push({
        explanation_id: exp.id, book, start_chapter, start_verse, end_chapter, end_verse,
        ref_citation: m[0], granularity
      });
    }
    if (mentions.length) {
      const { error: mErr } = await supabase.from("passage_mention").insert(mentions);
      if (mErr) throw mErr;
    }

    // 3) Create & store an embedding (title + body) — optional but recommended
    if (OPENAI_API_KEY) {
      try {
        const input = [ (title ?? ""), body ].join("\n\n").slice(0, 8000);
        const er = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ model: "text-embedding-3-small", input })
        });
        if (er.ok) {
          const ej = await er.json();
          const emb: number[] = ej.data[0].embedding;
          await supabase.from("explanation").update({ embedding: emb }).eq("id", exp.id);
        } else {
          console.warn("Embedding failed:", await er.text());
        }
      } catch (e) {
        console.warn("Embedding error:", e);
      }
    }

    // 4) Optional: link themes (safe to ignore if you don’t use themes)
    if (Array.isArray(themes) && themes.length) {
      await supabase.from("theme").upsert(themes.map((lemma:string)=>({ lemma })), { onConflict: "lemma" });
      const { data: rows } = await supabase.from("theme").select("id, lemma").in("lemma", themes);
      if (rows?.length) {
        await supabase.from("explanation_theme").insert(
          rows.map((r:any)=>({ explanation_id: exp.id, theme_id: r.id, weight: 1.0 }))
        );
      }
    }

    return Response.json({ ok: true, explanation_id: exp.id, mentions_inserted: mentions.length });
  } catch (e) {
    return new Response(`Error: ${e}`, { status: 500 });
  }
});
