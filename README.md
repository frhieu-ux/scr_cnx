# Scripture Connections — README

A lightweight pipeline for ingesting homilies/explanations, extracting Scripture refs, building hybrid search (FTS + embeddings), and returning full bodies with references.

---

## Quick start

### Prereqs
- Node 18+ (for Supabase CLI)
- Python 3.9+ (for the CLI)
- Supabase project (with pgvector installed)
- OpenAI API key (for embeddings; optional but recommended)
- (Windows) PostgreSQL **Command Line Tools** installed for `pg_dump/psql`

---

## Repo layout

```
supabase/
  functions/
    ingest/      # Edge Function: POST new explanations, extract refs, write embedding
    search/      # Edge Function: GET hybrid search, returns refs + snippet + body
  migrations/
    YYYYMMDDHHMMSS_schema_checkpoint.sql  # DB schema snapshot
    seed_lookup.sql                       # Optional lookup data (theme, synonym)
cli/
  scx_cli.py     # Your Python interactive CLI
README.md
.env.example
```

---

## Environment variables

Create a **`.env`** (not committed) based on `.env.example`:

```dotenv
# Client (CLI) side
SUPABASE_PROJECT=ompttfxrtfzrcooytnjh
SUPABASE_URL=https://ompttfxrtfzrcooytnjh.supabase.co
SUPABASE_ANON_KEY=...

# Edge Function runtime (set these as Supabase function secrets)
SB_URL=https://ompttfxrtfzrcooytnjh.supabase.co
SB_SERVICE_ROLE=...
OPENAI_API_KEY=sk-...

# Optional weights for search
WEIGHT_FTS=0.55
WEIGHT_VEC=0.45
```

> **Do not commit `.env`.** Commit `.env.example` only.

---

## Supabase function secrets (cloud)

Set once per project (from your repo root):

```bash
npx supabase@latest link --project-ref <project-ref>
npx supabase@latest secrets set SB_URL=https://<project-ref>.supabase.co
npx supabase@latest secrets set SB_SERVICE_ROLE=<service-role-key>
npx supabase@latest secrets set OPENAI_API_KEY=sk-...
```

---

## Local development

### Serve Edge Functions locally

**PowerShell (Windows):**
```powershell
# Use shell env vars or a local .env file (see `.env.example`)
npx supabase@latest functions serve ingest
# in another terminal
npx supabase@latest functions serve search
```

### Deploy to cloud

```powershell
npx supabase@latest functions deploy ingest
npx supabase@latest functions deploy search
```

---

## Database setup

### Required extensions
- `pgvector` (for embeddings)
- `pg_trgm`, `unaccent`, `pgcrypto` (used by FTS/ids)

### RPCs used
- `public.search_explanations_with_mentions(tsquery_input text, prefer_book text, prefer_author text)`
  - Returns: `explanation_id, title, author, snippet, rank, book, start_chapter, start_verse, end_chapter, end_verse, granularity, body`
- `public.search_by_embedding(q vector, prefer_book text, prefer_author text)`
  - Returns: `explanation_id, title, author, book, start_chapter, start_verse, end_chapter, end_verse, dist, body`

> These are included in the schema checkpoint.

---

## CLI usage

From the repo root:

```bash
python cli/scx_cli.py
```

You’ll see a menu:
- **Search** → calls `/functions/v1/search` (hybrid). Prints refs, titles, scores, and **body**.
- **Add new entry** → calls `/functions/v1/ingest` to store explanation + refs (+ embedding if OPENAI set).

CLI expects `SUPABASE_URL` (or `SUPABASE_PROJECT`) and `SUPABASE_ANON_KEY` in your environment.

---

## How search works (high level)

1. **FTS (keyword)**: tokenized query → `to_tsquery` → `search_explanations_with_mentions`  
2. **Embeddings (semantic)**: query → OpenAI embedding → `search_by_embedding` (pgvector)  
3. **Merge**: dedupe by passage coords; compute `_fts` and `_vec`; hybrid `score = w1*_fts + w2*_vec`  
4. **Attach body**: Edge Function fetches `explanation.body` for the merged results  
5. **Return**: JSON to client with refs, title, author, snippet, **body**, `_vec`, `dist`, `score`

---

## Backup / checkpoint (DB)

You already have:

- `supabase/migrations/<timestamp>_schema_checkpoint.sql` (schema only)
- `supabase/migrations/seed_lookup.sql` (contents of `theme` and `synonym`)

### Create a new checkpoint (Windows, PowerShell)

```powershell
# Encode password if using URI; or use discrete flags + $env:PGPASSWORD
$PGURI = "postgresql://postgres:ENCODED_PASSWORD@db.<project-ref>.supabase.co:5432/postgres?sslmode=require"

# Schema
$STAMP = (Get-Date -Format "yyyyMMddHHmmss")
pg_dump --schema-only --no-owner --no-privileges --schema=public `
  --file supabase/migrations/${STAMP}_schema_checkpoint.sql `
  "$PGURI"

# Optional: lookup/data seeds
pg_dump --data-only --no-owner --no-privileges `
  --table=public.theme --table=public.synonym `
  --file supabase/migrations/${STAMP}_seed_lookup.sql `
  "$PGURI"
```

> If your password contains `@:/?#`, **URL-encode** it or use `$env:PGPASSWORD` and discrete flags.

### Restore

```powershell
psql "$PGURI" -f supabase/migrations/<timestamp>_schema_checkpoint.sql
psql "$PGURI" -f supabase/migrations/<timestamp>_seed_lookup.sql  # optional
```

To snapshot **content** as well (optional):

```powershell
pg_dump --data-only --no-owner --no-privileges `
  --table=public.explanation `
  --table=public.passage_mention `
  --table=public.explanation_theme `
  --file supabase/migrations/<timestamp>_seed_content.sql `
  "$PGURI"
```

---

## Version control & releases

```powershell
git add .
git commit -m "checkpoint: hybrid search + bodies"
git tag -a v0.1-hybrid-bodies -m "Stable checkpoint"
git push -u origin master
git push origin --tags
```

> If GitHub blocks a push due to secrets, **rotate the key** and use `git filter-repo` to remove leaked files or redact `sk-...` tokens from history.

---

## Configuration toggles

- **Weights**: `WEIGHT_FTS`, `WEIGHT_VEC` (Edge Function env)
- **Include body**: current function always includes `body`. You can make it opt-in: `?include=body`
- **Catholic book support**: `ingest` includes a rich `BOOK_MAP` + regex that handles deuterocanon and multi-word titles.

---

## Troubleshooting

**No `body` in results**
- Ensure Edge Function’s post-merge fetch runs (Option A), or RPCs return `body`.

**No `_vec` / `dist`**
- Confirm `OPENAI_API_KEY` is set in **function secrets** and **ingest** populated `explanation.embedding`.

**Local serve complains about `.env`**
- Either set env vars in shell or pass `--env-file .env`.

**`pg_dump`/`psql` URI errors**
- URL-encode password or use `$env:PGPASSWORD` with discrete flags.

---

## Security

- Never commit secrets. Keep `.env` local; commit `.env.example` only.
- Use Supabase **Function Secrets** for production.
- Consider adding pre-commit secret scanning (e.g., `detect-secrets`).

---

## License / Contributing

- Your choice (e.g., MIT).  
- PRs welcome—please avoid attaching real `.env` or data dumps with private content.
