#!/usr/bin/env python3
r"""
Scripture Connections CLI (Interactive Menu)
- Ingest: POST a text to your Supabase Edge Function to extract passages + store an embedding
- Search: GET hybrid results (BM25 + embeddings) with pretty-printed references first

Environment (read-only; no interactive overrides):
  SUPABASE_PROJECT    (e.g., ompttfxrtfzrcooytnjh)
  SUPABASE_URL        (optional; if unset, built from SUPABASE_PROJECT)
  SUPABASE_ANON_KEY   (your anon public key)
"""

import json
import os
import sys
import textwrap
from typing import Any, Dict, Optional
import requests

DEF_TIMEOUT = 30

# ----------------------------
# Config helpers (env-only)
# ----------------------------
def build_url(_url_opt: Optional[str], _project_opt: Optional[str]) -> str:
    """Build base Supabase URL strictly from env; no interactive overrides."""
    url_env = os.getenv("SUPABASE_URL")
    proj_env = os.getenv("SUPABASE_PROJECT")
    if url_env:
        return url_env.rstrip("/")
    if proj_env:
        return f"https://{proj_env}.supabase.co"
    sys.exit("Missing Supabase URL/project. Set SUPABASE_URL or SUPABASE_PROJECT.")

def get_anon(_anon_opt: Optional[str]) -> str:
    """Fetch anon key strictly from env; no interactive overrides."""
    anon = os.getenv("SUPABASE_ANON_KEY")
    if not anon:
        sys.exit("Missing anon key. Set SUPABASE_ANON_KEY.")
    return anon

def headers_for(anon_key: str) -> Dict[str, str]:
    # Both headers are accepted by Supabase Edge Functions
    return {
        "Authorization": f"Bearer {anon_key}",
        "apikey": anon_key,
    }

# ----------------------------
# I/O helpers
# ----------------------------
def read_text_file(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def prompt(line: str) -> str:
    return input(line).strip()

def prompt_optional(line: str) -> Optional[str]:
    s = input(line).strip()
    return s if s else None

def yesno(line: str, default: bool = False) -> bool:
    suffix = " [Y/n]: " if default else " [y/N]: "
    s = input(line + suffix).strip().lower()
    if not s:
        return default
    return s in ("y", "yes")

# ----------------------------
# Formatting search results
# ----------------------------
def format_ref(row: Dict[str, Any]) -> str:
    """Return a nice scripture reference like 'Luke 2:1–20'."""
    book = row.get("book") or "?"
    sc = row.get("start_chapter")
    sv = row.get("start_verse")
    ec = row.get("end_chapter")
    ev = row.get("end_verse")
    gran = (row.get("granularity") or "").lower()

    if sc is None:
        return book  # fallback

    ec = ec if ec is not None else sc
    en_dash = "–"

    if gran == "chapter" or (sv is None and (ev is None) and ec == sc):
        return f"{book} {sc}"

    if gran == "verse" or (sv is not None and (ev is None) and ec == sc):
        return f"{book} {sc}:{sv}"

    if ec != sc:  # spans chapters
        left = f"{book} {sc}:{sv if sv is not None else 1}"
        right = f"{ec}:{ev if ev is not None else ''}".rstrip(":")
        return f"{left}{en_dash}{right}"
    else:
        if sv is not None and ev is not None and ev != sv:
            return f"{book} {sc}:{sv}{en_dash}{ev}"
        elif sv is not None:
            return f"{book} {sc}:{sv}"
        else:
            return f"{book} {sc}"

def pretty_print_results(payload: Dict[str, Any]) -> None:
    results = payload.get("results") or []
    if not results:
        print("No results.")
        return

    print()
    print(f"Query: {payload.get('q','')}")
    weights = payload.get("weights") or {}
    if weights:
        print(f"Weights → FTS: {weights.get('fts')}, Vector: {weights.get('vector')}")
    print()

    results = sorted(results, key=lambda r: r.get("score", 0), reverse=True)

    for i, r in enumerate(results, 1):
        ref = format_ref(r)
        title = r.get("title") or "(untitled)"
        author = r.get("author")
        score = r.get("score")
        body = " ".join((r.get("body") or "").split())

        print(f"{i:>2}. {ref}")
        print(f"    • {title}")
        if author:
            print(f"      author: {author}")
        if score is not None:
            print(f"      score: {score:.3f}")
        if body:
            wrapped_body = textwrap.fill(body, width=88, subsequent_indent="      ")
            print(f"      body: {wrapped_body}")
        print()

# ----------------------------
# API calls (env-only)
# ----------------------------
def ingest_once() -> int:
    """Prompt user for ingest parameters and perform one ingest call."""
    url = build_url(None, None)
    anon = get_anon(None)

    print("\n--- Add New Entry (Ingest) ---")
    fp = prompt("Path to text file (or 'back' to return): ")
    if fp.lower() == "back":
        return 0
    if not os.path.isfile(fp):
        print("File not found.")
        return 1

    default_title = os.path.splitext(os.path.basename(fp))[0]
    title = prompt_optional(f"Title [{default_title}]: ") or default_title
    author = prompt_optional("Author (optional): ")
    themes_raw = prompt_optional("Themes (comma-separated, optional): ")
    themes = [t.strip() for t in themes_raw.split(",")] if themes_raw else []

    try:
        body_text = read_text_file(fp)
    except Exception as e:
        print(f"Failed to read file: {e}")
        return 1

    payload = {
        "title": title,
        "author": author,
        "body": body_text,
        "themes": themes,
    }

    endpoint = f"{url}/functions/v1/ingest"
    try:
        resp = requests.post(endpoint, headers=headers_for(anon), json=payload, timeout=DEF_TIMEOUT)
        data = resp.json() if resp.headers.get("content-type","").startswith("application/json") else {"raw": resp.text}
    except Exception as e:
        print(f"Request failed: {e}")
        return 1

    if not resp.ok:
        print(json.dumps(data, indent=2))
        return 1

    print("Ingest OK")
    print(json.dumps(data, indent=2))
    return 0

def search_once() -> int:
    """Prompt user for search parameters and perform one search call."""
    url = build_url(None, None)
    anon = get_anon(None)

    print("\n--- Search ---")
    q = prompt("Search query (or 'back' to return): ")
    if q.lower() == "back":
        return 0
    book = prompt_optional("Filter to a book (e.g., Luke) [optional]: ")
    author = prompt_optional("Filter to an author [optional]: ")

    params = {"q": q}
    if book:
        params["book"] = book
    if author:
        params["author"] = author

    endpoint = f"{url}/functions/v1/search"
    try:
        resp = requests.get(endpoint, headers=headers_for(anon), params=params, timeout=DEF_TIMEOUT)
        data = resp.json() if resp.headers.get("content-type","").startswith("application/json") else {"raw": resp.text}
    except Exception as e:
        print(f"Request failed: {e}")
        return 1

    if not resp.ok:
        print(json.dumps(data, indent=2))
        return 1

    pretty_print_results(data)
    return 0

# ----------------------------
# Mode loops (no env prompts)
# ----------------------------
def ingest_loop():
    """Stay in ingest mode until user declines to continue or types 'back' at filepath."""
    while True:
        rc = ingest_once()
        # rc==0 could be success or 'back'; either way we ask to continue.
        if not yesno("Ingest another file?", default=False):
            break

def search_loop():
    """Stay in search mode until user declines to continue or types 'back' at query."""
    while True:
        rc = search_once()
        if not yesno("Run another search?", default=True):
            break

# ----------------------------
# Main menu
# ----------------------------
def main():
    while True:
        print(textwrap.dedent("""
            === Scripture Connections CLI ===
            Select a task:
            1) Search
            2) Add new entry
            3) Quit
        """))
        choice = prompt("Enter choice: ")
        if choice == "1":
            search_loop()
        elif choice == "2":
            ingest_loop()
        elif choice == "3":
            print("Goodbye!")
            sys.exit(0)
        else:
            print("Invalid choice, try again.")

if __name__ == "__main__":
    main()
