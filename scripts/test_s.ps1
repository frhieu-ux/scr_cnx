# Fill these with your real values
$anon="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tcHR0ZnhydGZ6cmNvb3l0bmpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTczNDk3NTksImV4cCI6MjA3MjkyNTc1OX0.k6W9-SMJGiw2jh3DHkENHbQsJaqUJyO42wU9htiN_ls"

$project = "ompttfxrtfzrcooytnjh"

# 1) Search using a synonym ("birth" should find "Nativity")
$res = Invoke-RestMethod `
  -Uri "https://$project.supabase.co/functions/v1/search?q=birth" `
  -Headers @{ Authorization="Bearer $anon" }

# See the expanded terms used in the query (should include 'nativity', etc.)
$res.expanded_terms

# See the passages that matched (book + range + why)
$res.results | Format-Table title, book, start_chapter, start_verse, end_chapter, end_verse, granularity

# If you want to read the snippet with highlights:
$res.results[0].snippet
