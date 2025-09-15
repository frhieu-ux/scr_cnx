$project = "ompttfxrtfzrcooytnjh"
$anon="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tcHR0ZnhydGZ6cmNvb3l0bmpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTczNDk3NTksImV4cCI6MjA3MjkyNTc1OX0.k6W9-SMJGiw2jh3DHkENHbQsJaqUJyO42wU9htiN_ls"

$headers = @{ Authorization = "Bearer $anon"; apikey = $anon }

Invoke-RestMethod -Uri "https://$project.supabase.co/functions/v1/search?q=birth&book=Luke" -Headers $headers









