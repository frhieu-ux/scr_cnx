# Scripture Connections — Supabase Starter

This repo sets up:
- Postgres tables & indexes for explanations, passage mentions, themes, and synonyms
- An RPC to perform synonym-aware full-text search
- Two Supabase Edge Functions:
  - `ingest` (POST): stores a text, auto-detects Scripture references
  - `search` (GET): synonym-aware search that returns passages + snippets

## Prereqs (manual install steps you do once)
1) Node.js LTS and npm (you already have these)
2) Supabase CLI via npx (no global install required):
   ```bash
   npx supabase --version
   ```

## Quick Start (Windows PowerShell)
1. In the Supabase Dashboard, copy:
   - Project Ref (e.g., abcd1234)
   - Project URL (starts with https://...supabase.co)
   - `anon` public key
   - `service_role` key (keep this private)

2. Open **PowerShell** in this folder and run:
   ```powershell
   scripts\setup.ps1
   ```
   It will ask for the values above and then:
   - `npx supabase login` (opens a browser to authorize)
   - `npx supabase link --project-ref ...`
   - `npx supabase db push` (applies the SQL migration to your remote DB)
   - set Edge Function secrets (URL + service role)
   - deploy `ingest` and `search` functions

3. Test (replace YOUR_PROJECT_REF + ANON KEY):
   ```bash
   curl -X POST      -H "Authorization: Bearer YOUR_ANON_PUBLIC_KEY"      -H "Content-Type: application/json"      https://YOUR_PROJECT_REF.supabase.co/functions/v1/ingest      -d '{"title":"Christmas Homily","author":"Fr. Example","body":"Luke 2:1-20 describes the Nativity. See also Mt 1:18-25 and Mic 5:2.","themes":["nativity"]}'
   ```

   ```bash
   curl "https://YOUR_PROJECT_REF.supabase.co/functions/v1/search?q=birth"      -H "Authorization: Bearer YOUR_ANON_PUBLIC_KEY"
   ```

## Quick Start (macOS/Linux)
Use the Bash script:
```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

## Notes
- The SQL migration lives in `supabase/migrations/20250908_init.sql`.
- You can add more synonyms in the `theme` and `synonym` tables anytime.
- This starter keeps RLS enabled and uses Edge Functions with the service role key for DB access.
