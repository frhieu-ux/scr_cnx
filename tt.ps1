

$Headers = @{Authorization="Bearer $env:SUPABASE_ANON_KEY"; apikey=$env:SUPABASE_ANON_KEY}
Invoke-RestMethod -Method GET -Headers $Headers -Uri "$env:SUPABASE_URL/functions/v1/search?q=birth" | ConvertTo-Json -Depth 6

