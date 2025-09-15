# --- scripts/setup.ps1 (minimal & safe) ---
param(
  [string]$ProjectRef  = "ompttfxrtfzrcooytnjh",
  [string]$ProjectUrl  = "https://ompttfxrtfzrcooytnjh.supabase.co",
  [string]$AnonKey     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tcHR0ZnhydGZ6cmNvb3l0bmpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTczNDk3NTksImV4cCI6MjA3MjkyNTc1OX0.k6W9-SMJGiw2jh3DHkENHbQsJaqUJyO42wU9htiN_ls",
  [string]$ServiceRole = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tcHR0ZnhydGZ6cmNvb3l0bmpoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzM0OTc1OSwiZXhwIjoyMDcyOTI1NzU5fQ.q44FFviJX7jjEiBveXcePWz3x2Nn7mp5J_OuZYy0Arc"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -Path ".\supabase")) {
  throw "Run this script from the project root where the 'supabase' folder exists."
}

# 1) Login (opens browser)
npx supabase login

# 2) Link to your remote project
npx supabase link --project-ref $ProjectRef

# 3) Push migrations to the remote DB
npx supabase db push

# 4) Set function secrets (URL + service role)
npx supabase secrets set SUPABASE_URL="$ProjectUrl" SUPABASE_SERVICE_ROLE="$ServiceRole"

# 5) Deploy Edge Functions
npx supabase functions deploy ingest
npx supabase functions deploy search
