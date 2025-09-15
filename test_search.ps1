# --- CONFIG ---
$FUNCTION_URL = "https://ompttfxrtfzrcooytnjh.functions.supabase.co/search?q=birth&debug=1"
$ANON_KEY     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tcHR0ZnhydGZ6cmNvb3l0bmpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTczNDk3NTksImV4cCI6MjA3MjkyNTc1OX0.k6W9-SMJGiw2jh3DHkENHbQsJaqUJyO42wU9htiN_ls"

# --- HEADERS (required if Verify JWT is ON) ---
$headers = @{
  "apikey"        = $ANON_KEY
  "Authorization" = "Bearer $ANON_KEY"
}

# --- REQUEST ---
try {
  $resp = Invoke-WebRequest -Uri $FUNCTION_URL -Headers $headers -Method GET -UseBasicParsing -ErrorAction Stop
  $status  = $resp.StatusCode
  $content = $resp.Content
} catch {
  if ($_.Exception.Response) {
    $status = $_.Exception.Response.StatusCode.value__
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $content = $reader.ReadToEnd()
  } else {
    $status = -1
    $content = $_.Exception.Message
  }
}

"HTTP Status: $status"

# --- PARSE JSON SAFELY ---
$j = $null
if ($content -and ($content.Trim().StartsWith("{") -or $content.Trim().StartsWith("["))) {
  try { $j = $content | ConvertFrom-Json } catch {}
}

if ($j -eq $null) {
  "`nRaw response:`n$content"
  return
}

# --- TOPLINE ---
$resultsCount = 0
if ($j.PSObject.Properties.Name -contains 'results' -and $j.results) {
  $resultsCount = $j.results.Count
}

"Results: $resultsCount"

if ($resultsCount -gt 0) {
  $topExpId   = $j.results[0].explanation_id
  $topHasBody = $false
  if ($j.results[0].PSObject.Properties.Name -contains 'body') {
    $topHasBody = [bool]$j.results[0].body
  }
  "Top explanation_id: $topExpId"
  "Top has body? $topHasBody"
}

# --- DEBUG BLOCKS (if present) ---
if ($j.PSObject.Properties.Name -contains 'debug' -and $j.debug) {
  # Find helper
  function Find-DebugEntry($name) {
    foreach ($d in $j.debug) {
      if ($d.PSObject.Properties.Name -contains $name) { return $d.$name }
    }
    return $null
  }

  $envs             = Find-DebugEntry 'envs'
  $counts           = Find-DebugEntry 'counts'
  $hasExpId         = Find-DebugEntry 'hasExpId'
  $enrichment       = Find-DebugEntry 'enrichment'
  $enrichmentResult = Find-DebugEntry 'enrichmentResult'
  $samples          = Find-DebugEntry 'samples'
  $merged0_after    = Find-DebugEntry 'merged0_after'

  "`n=== ENV CHECK ==="
  if ($envs) { $envs | Format-List } else { "n/a" }

  "`n=== ROW COUNTS ==="
  if ($counts) { $counts | Format-List } else { "n/a" }

  "`n=== HAS explanation_id ==="
  if ($hasExpId) { $hasExpId | Format-List } else { "n/a" }

  "`n=== ENRICHMENT IDS ==="
  if ($enrichment) { $enrichment | Format-List } else { "n/a" }

  "`n=== ENRICHMENT RESULT ==="
  if ($enrichmentResult) { $enrichmentResult | Format-List } else { "n/a" }

  "`n=== SAMPLE ROWS ==="
  if ($samples) {
    "fts0:"; if ($samples.fts0) { $samples.fts0 | Format-List } else { "null" }
    "vec0:"; if ($samples.vec0) { $samples.vec0 | Format-List } else { "null" }
  } else { "n/a" }

  "merged0_after:"; if ($merged0_after) { $merged0_after | Format-List } else { "null" }
}
