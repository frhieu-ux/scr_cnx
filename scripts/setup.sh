#!/usr/bin/env bash
set -euo pipefail

echo "=== Scripture Connections — Setup (Bash) ==="

read -p "Enter YOUR_PROJECT_REF (e.g., abcd1234): " PROJECT_REF
read -p "Enter Project URL (https://...supabase.co): " PROJECT_URL
read -p "Enter anon public key: " ANON_KEY
read -p "Enter service_role key (keep private): " SERVICE_ROLE

# 1) Login (opens browser)
npx supabase login

# 2) Link project
npx supabase link --project-ref "$PROJECT_REF"

# 3) Push migrations
npx supabase db push

# 4) Set secrets
npx supabase secrets set SUPABASE_URL="$PROJECT_URL" SUPABASE_SERVICE_ROLE="$SERVICE_ROLE"

# 5) Deploy functions
npx supabase functions deploy ingest
npx supabase functions deploy search

echo "=== Done! Test with: ==="
echo "curl -X POST -H "Authorization: Bearer $ANON_KEY" -H "Content-Type: application/json" https://$PROJECT_REF.supabase.co/functions/v1/ingest -d '{"title":"Test","author":"You","body":"Luke 2:1-20 mentions the Nativity."}'"
echo "curl "https://$PROJECT_REF.supabase.co/functions/v1/search?q=birth" -H "Authorization: Bearer $ANON_KEY""
