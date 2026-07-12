#!/usr/bin/env python3
"""
sync_currency_names_from_poe2db.py — F1 enabler (iter 85).

One-shot / periodic importer that closes the "remaining ~276 untranslated
api_ids" gap documented in STATUS.md (F1 — blocked on live API access).

This script does NOT run inside the FastAPI backend. It is a CLI tool meant
to be executed locally by a maintainer who has live network access to:
  1. https://poe2scout.com/api  (to enumerate all api_ids + EN names)
  2. https://poe2db.tw/ru/           (to fetch Russian translations)

Both endpoints are blocked from Russia (see docs/CORS_PROXY_GUIDE.md), which
is why F1 has been blocked since iter 32. Running this script from a non-RU
IP (or via a VPN/proxy) is the only way to close the gap.

------------------------------------------------------------------------------
PIPELINE — 4 INDEPENDENT STAGES
------------------------------------------------------------------------------

Each stage is a separate subcommand. Outputs are cached as JSON files under
`scripts/.cache/` so stages can be re-run independently (e.g. you can re-run
--diff after manually editing the cached files without re-fetching).

  Stage 1 — --fetch-ids
    Hits poe2scout.com API for every category, paginates through all
    ByCategory responses, and writes a flat list of
    `{api_id, en_name, category_api_id}` tuples to
    `scripts/.cache/poe2scout_items.json`.

  Stage 2 — --fetch-ru
    Hits poe2db.tw/ru/ for every configured category page, parses the
    HTML tables, and writes an EN→RU map per category to
    `scripts/.cache/poe2db_ru_names.json`.

  Stage 3 — --diff
    Reads poe2scout_items.json + poe2db_ru_names.json + the existing
    backend/data/currency_names.json, computes the set of api_ids that
    are still missing RU translations, attempts to match them against
    the poe2db.ru map by normalized EN name, and writes a patch file to
    `scripts/.cache/currency_names_patch.json` containing the proposed
    additions (api_id → {en_name, ru_name, category, source, confidence}).

  Stage 4 — --apply
    Reads the reviewed patch file and writes the new entries into
    backend/data/currency_names.json. Requires --confirm flag.
    After --apply, the maintainer MUST manually bump the count assertions
    in tests/test_currency_names_ru.py (lines 30-33) to match the new
    totals, then run `pytest tests/test_currency_names_ru.py` to verify.

------------------------------------------------------------------------------
FALLBACK MODE — --from-cache-snapshot
------------------------------------------------------------------------------

If you do NOT have live poe2scout.com access (most common case for
maintainers in Russia), you can still use this script in a limited mode:

    python scripts/sync_currency_names_from_poe2db.py --from-cache-snapshot

This extracts the 138 api_ids already cached in
`src/data/cache-snapshot.json` and writes them to the same
`scripts/.cache/poe2scout_items.json` file. Then you can run --fetch-ru
against poe2db.tw (which may be accessible from RU) and --diff to produce
a smaller patch covering only those 138 ids. NOTE: all 138 are already
translated per STATUS.md, so this mode is mostly useful for VERIFICATION
that no drift has crept in.

------------------------------------------------------------------------------
USAGE EXAMPLES
------------------------------------------------------------------------------

  # Full pipeline (maintainer with live poe2scout + poe2db access):
  python scripts/sync_currency_names_from_poe2db.py --fetch-ids
  python scripts/sync_currency_names_from_poe2db.py --fetch-ru
  python scripts/sync_currency_names_from_poe2db.py --diff
  # ... manually review scripts/.cache/currency_names_patch.json ...
  python scripts/sync_currency_names_from_poe2db.py --apply --confirm

  # Limited pipeline (maintainer with only poe2db.tw access):
  python scripts/sync_currency_names_from_poe2db.py --from-cache-snapshot
  python scripts/sync_currency_names_from_poe2db.py --fetch-ru
  python scripts/sync_currency_names_from_poe2db.py --diff

  # Verify a patch without applying it (default — --apply requires --confirm):
  python scripts/sync_currency_names_from_poe2db.py --diff --verbose

------------------------------------------------------------------------------
EXIT CODES
------------------------------------------------------------------------------

  0 — stage completed successfully (or no-op when there's nothing to do)
  1 — network error (retryable)
  2 — file I/O error (permission denied, disk full)
  3 — validation error (patch file malformed, RU/EN key drift, etc.)
  4 — CLI usage error (missing required flag combination)

------------------------------------------------------------------------------
ENVIRONMENT VARIABLES
------------------------------------------------------------------------------

  POE2_API_BASE_URL       — Override poe2scout.com API base URL.
                             Default: https://poe2scout.com/api
  POE2DB_BASE_URL         — Override poe2db.tw base URL.
                             Default: https://poe2db.tw
  POE2_SNAPSHOT_REALM     — Realm path segment for poe2scout.
                             Default: poe2
  POE2_SNAPSHOT_LEAGUE    — League name for poe2scout.
                             Default: runes (current PoE2 league as of iter 85)
  HTTP_PROXY / HTTPS_PROXY — Standard proxy env vars; respected by urllib.

------------------------------------------------------------------------------
MAINTAINER NOTES
------------------------------------------------------------------------------

  - This script is IDEMPOTENT — re-running any stage overwrites the cache
    file for that stage. Re-running --apply with the same patch is a no-op
    (entries already present in currency_names.json are skipped).
  - The script NEVER overwrites an existing translation. If an api_id is
    already in currency_names.json with a different ru_name, the new
    candidate is added to the patch with `action: "conflict"` instead of
    `action: "add"` — the maintainer must manually resolve conflicts.
  - All HTTP requests include a 15s timeout and 3 retries with exponential
    backoff (1s, 2s, 4s). 429 responses trigger an extra 5s cooldown.
  - The poe2db.tw HTML parser is intentionally lenient — it tries multiple
    CSS selectors and falls back to regex. If poe2db changes their layout,
    the parser may need updating; check the WARNING log lines.
  - The script uses only stdlib (urllib, json, html, re, pathlib, argparse)
    so it works without `pip install` anything beyond the project's existing
    requirements.txt.
"""

from __future__ import annotations

import argparse
import html
import json
import logging
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = Path(__file__).resolve().parent / ".cache"
CURRENCY_NAMES_PATH = REPO_ROOT / "backend" / "data" / "currency_names.json"
CACHE_SNAPSHOT_PATH = REPO_ROOT / "src" / "data" / "cache-snapshot.json"

POE2SCOUT_ITEMS_CACHE = CACHE_DIR / "poe2scout_items.json"
POE2DB_RU_CACHE = CACHE_DIR / "poe2db_ru_names.json"
PATCH_CACHE = CACHE_DIR / "currency_names_patch.json"
TRANSLATION_AUDIT_CACHE = CACHE_DIR / "translation_audit.json"

DEFAULT_POE2SCOUT_BASE = "https://poe2scout.com/api"
DEFAULT_POE2DB_BASE = "https://poe2db.tw"
DEFAULT_REALM = "poe2"
DEFAULT_LEAGUE = "Runes of Aldur"  # Current PoE2 league as of iter 137 (was "runes" at iter 85; was "Dawn of the Hunt" before that)

# All 17 categories from config.yaml → league.currency_categories.
# Used for both poe2scout ByCategory pagination AND poe2db.tw/ru/<Category> URL construction.
ALL_CATEGORIES = [
    "currency", "fragments", "runes", "essences", "ultimatum",
    "expedition", "ritual", "vaultkeys", "breach", "abyss",
    "uncutgems", "lineagesupportgems", "delirium", "incursion",
    "idol", "verisium", "vaal",
]

# poe2db.tw URL path mapping. Most categories map 1:1 to /ru/<Category> but
# some have different URL slugs on the wiki. Adjust if 404s appear.
POE2DB_CATEGORY_PATHS: dict[str, str] = {
    "currency": "Currency",
    "fragments": "Fragment",
    "runes": "Rune",
    "essences": "Essence",
    "ultimatum": "Ultimatum",
    "expedition": "Expedition",
    "ritual": "Ritual",
    "vaultkeys": "Vaultkey",
    "breach": "Breach",
    "abyss": "Abyss",
    "uncutgems": "Uncut_Gem",
    "lineagesupportgems": "Support_Gem",
    "delirium": "Delirium",
    "incursion": "Incursion",
    "idol": "Idol",
    "verisium": "Verisium",
    "vaal": "Vaal",
}

HTTP_TIMEOUT = 15  # seconds
HTTP_RETRIES = 3
HTTP_RETRY_DELAYS = [1.0, 2.0, 4.0]  # exponential backoff
HTTP_RATE_LIMIT_COOLDOWN = 5.0  # extra pause on 429
HTTP_USER_AGENT = "PoE2-Market-Dashboard-SyncScript/1.0 (maintainer tool; contact: project maintainers)"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("sync_currency_names")


# ---------------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------------

def _http_get(url: str, *, accept: str = "application/json") -> bytes:
    """HTTP GET with retry + backoff. Returns raw response bytes.

    Raises urllib.error.URLError after all retries are exhausted.
    """
    last_exc: Exception | None = None
    for attempt in range(HTTP_RETRIES + 1):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": HTTP_USER_AGENT,
                    "Accept": accept,
                    "Accept-Language": "ru,en;q=0.8",
                },
            )
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            last_exc = e
            if e.code == 429:
                cooldown = HTTP_RATE_LIMIT_COOLDOWN + (HTTP_RETRY_DELAYS[min(attempt, len(HTTP_RETRY_DELAYS) - 1)] if attempt else 0)
                log.warning("  HTTP 429 from %s — cooling down %.1fs (attempt %d/%d)",
                            url, cooldown, attempt + 1, HTTP_RETRIES + 1)
                time.sleep(cooldown)
                continue
            if e.code in (500, 502, 503, 504) and attempt < HTTP_RETRIES:
                delay = HTTP_RETRY_DELAYS[min(attempt, len(HTTP_RETRY_DELAYS) - 1)]
                log.warning("  HTTP %d from %s — retrying in %.1fs (attempt %d/%d)",
                            e.code, url, delay, attempt + 1, HTTP_RETRIES + 1)
                time.sleep(delay)
                continue
            raise
        except urllib.error.URLError as e:
            last_exc = e
            if attempt < HTTP_RETRIES:
                delay = HTTP_RETRY_DELAYS[min(attempt, len(HTTP_RETRY_DELAYS) - 1)]
                log.warning("  URLError %s — retrying in %.1fs (attempt %d/%d)",
                            e.reason, delay, attempt + 1, HTTP_RETRIES + 1)
                time.sleep(delay)
                continue
            raise
    # Should not reach here, but satisfy the type checker.
    raise last_exc if last_exc else RuntimeError("unreachable")


def _http_get_json(url: str) -> Any:
    """HTTP GET + JSON decode."""
    raw = _http_get(url, accept="application/json")
    return json.loads(raw.decode("utf-8"))


def _http_get_html(url: str) -> str:
    """HTTP GET + decode as UTF-8 text (for HTML scraping)."""
    raw = _http_get(url, accept="text/html,application/xhtml+xml")
    return raw.decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------

def normalize_for_match(s: str) -> str:
    """Normalize a name for fuzzy EN→RU matching.

    Lowercase, strip apostrophes, collapse whitespace, replace hyphens with spaces.
    Examples:
      "Mirror of Kalandra"      -> "mirror of kalandra"
      "Hinekora's Lock"         -> "hinekoras lock"
      "Greater Chaos Orb"       -> "greater chaos orb"
      "Xoph's Blood"            -> "xophs blood"
    """
    if not s:
        return ""
    s = html.unescape(s).lower()
    # Strip apostrophes (ASCII + curly variants). Use \u escapes to avoid
    # ambiguity — the curly chars can get mangled when copy-pasted.
    for ch in ("'", "\u2018", "\u2019", "\u201b", "\u2032"):
        s = s.replace(ch, "")
    # Strip curly double quotes too (rare but seen in some poe2db cells)
    for ch in ('"', "\u201c", "\u201d", "\u201e", "\u2033"):
        s = s.replace(ch, "")
    s = s.replace("-", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalize_api_id(api_id: str) -> str:
    """Normalize an api_id for STORAGE in currency_names.json.

    IMPORTANT: This is NOT the same as the backend's `_normalize_api_id`
    (poe2scout.py:58) which replaces hyphens with underscores for use in
    exchange-pair matching. The translation JSON file stores keys with
    hyphens (e.g. "hinekoras-lock", "fracturing-orb") — verified at iter 85:
    315 of 349 keys use hyphens, 0 use underscores.

    So we only lowercase + strip whitespace + strip apostrophes here. Hyphens
    are PRESERVED so the keys match what's in currency_names.json.
    """
    if not api_id:
        return ""
    return api_id.lower().replace(" ", "").replace("'", "").replace("'", "")


# ---------------------------------------------------------------------------
# Stage 1 — fetch api_ids + EN names from poe2scout.com
# ---------------------------------------------------------------------------

def fetch_poe2scout_items(*, base_url: str, realm: str, league: str) -> list[dict[str, str]]:
    """Fetch all currency items from poe2scout.com ByCategory endpoints.

    Returns a list of `{api_id, en_name, category_api_id}` dicts.
    """
    base = base_url.rstrip("/")
    items: list[dict[str, str]] = []
    seen_ids: set[str] = set()

    for category in ALL_CATEGORIES:
        page = 1
        while True:
            # KI-29: league + realm MUST be URL-encoded — league names like
            # "Runes of Aldur" contain spaces which crash http.client.
            url = (
                f"{base}/{urllib.parse.quote(realm, safe='')}/Leagues/"
                f"{urllib.parse.quote(league, safe='')}/Currencies/ByCategory"
                f"?Category={urllib.parse.quote(category)}&Page={page}&PerPage=250"
            )
            log.info("  Fetching %s page %d: %s", category, page, url)
            try:
                data = _http_get_json(url)
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    log.warning("  404 for category %s — skipping (not in this league)", category)
                    break
                raise
            if not isinstance(data, dict):
                log.warning("  Unexpected response shape for %s page %d — skipping", category, page)
                break

            page_items = data.get("Items") or []
            total_pages = int(data.get("Pages") or 1)

            for item in page_items:
                api_id = (item.get("ApiId") or "").strip()
                en_name = (item.get("Text") or "").strip()
                cat_api_id = (item.get("CategoryApiId") or category).strip()
                if not api_id or not en_name:
                    continue
                api_id_norm = normalize_api_id(api_id)
                if api_id_norm in seen_ids:
                    continue
                seen_ids.add(api_id_norm)
                items.append({
                    "api_id": api_id_norm,
                    "en_name": en_name,
                    "category_api_id": cat_api_id,
                })

            if page >= total_pages or not page_items:
                break
            page += 1

    return items


def extract_items_from_cache_snapshot() -> list[dict[str, str]]:
    """Extract api_ids + EN names from the bundled cache-snapshot.json.

    This is the FALLBACK path when live poe2scout.com is unreachable.
    Only covers the 6 categories present in cache-snapshot.json (currency,
    ritual, ultimatum, idol, vaultkeys, delirium) — typically 138 items.
    """
    if not CACHE_SNAPSHOT_PATH.exists():
        raise FileNotFoundError(f"cache-snapshot.json not found at {CACHE_SNAPSHOT_PATH}")
    with CACHE_SNAPSHOT_PATH.open(encoding="utf-8") as f:
        snapshot = json.load(f)

    items: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    for url, entry in snapshot.get("entries", {}).items():
        if "ByCategory" not in url:
            continue
        # Parse Category=... from URL query string
        parsed = urllib.parse.urlparse(url)
        qs = urllib.parse.parse_qs(parsed.query)
        category = (qs.get("Category") or ["unknown"])[0]

        page_items = (entry.get("data") or {}).get("Items") or []
        for item in page_items:
            api_id = (item.get("ApiId") or "").strip()
            en_name = (item.get("Text") or "").strip()
            cat_api_id = (item.get("CategoryApiId") or category).strip()
            if not api_id or not en_name:
                continue
            api_id_norm = normalize_api_id(api_id)
            if api_id_norm in seen_ids:
                continue
            seen_ids.add(api_id_norm)
            items.append({
                "api_id": api_id_norm,
                "en_name": en_name,
                "category_api_id": cat_api_id,
            })

    return items


# ---------------------------------------------------------------------------
# Stage 2 — fetch RU names from poe2db.tw/ru/
# ---------------------------------------------------------------------------

# poe2db.tw uses MediaWiki-style tables. Common patterns observed:
#   <table class="..."> with <tr><td><a href="...">English Name</a></td><td>Russian Name</td>...
#   OR <div class="..."> with <span class="...">name</span>
# We try multiple selectors and fall back to regex extraction.

_POE2DB_TABLE_ROW_RE = re.compile(
    r"<tr[^>]*>\s*"
    r"(?:<th[^>]*>.*?</th>\s*)?"  # optional header cell
    r"<td[^>]*>(?P<en_cell>.*?)</td>\s*"
    r"<td[^>]*>(?P<ru_cell>.*?)</td>",
    re.IGNORECASE | re.DOTALL,
)

_POE2DB_LINK_RE = re.compile(
    r'<a[^>]+href="([^"]+)"[^>]*>(?P<text>[^<]+)</a>',
    re.IGNORECASE,
)

_POE2DB_TITLE_RE = re.compile(
    r"<title[^>]*>(?P<title>[^<]+)</title>",
    re.IGNORECASE,
)


def _strip_html(s: str) -> str:
    """Strip HTML tags, decode entities, collapse whitespace."""
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _extract_name_from_cell(cell_html: str) -> tuple[str, str | None]:
    """Extract (display_text, href) from a table cell.

    Returns the visible text (after HTML stripping) and the href of the
    first <a> tag if any (used as a permalink to the item's wiki page).
    """
    href: str | None = None
    link_match = _POE2DB_LINK_RE.search(cell_html)
    if link_match:
        href = link_match.group(1)
    text = _strip_html(cell_html)
    return text, href


def parse_poe2db_category_html(html_text: str, category: str) -> list[dict[str, str]]:
    """Parse a poe2db.tw/ru/<Category> page and extract EN→RU name pairs.

    Returns a list of `{en_name, ru_name, category, href}` dicts.

    The parser is intentionally lenient — different category pages on
    poe2db.tw have slightly different table layouts. We try:
      1. Standard 2-column table (EN cell + RU cell)
      2. Standard 3-column table (icon + EN + RU) — we skip the icon cell
      3. Fallback: regex scan for any <a>...</a> + next sibling text
    """
    results: list[dict[str, str]] = []
    seen_pairs: set[tuple[str, str]] = set()

    # Strategy 1+2: parse all <tr> rows with at least 2 <td> cells.
    for row_match in _POE2DB_TABLE_ROW_RE.finditer(html_text):
        en_text, en_href = _extract_name_from_cell(row_match.group("en_cell"))
        ru_text, _ = _extract_name_from_cell(row_match.group("ru_cell"))
        if not en_text or not ru_text:
            continue
        # Skip header rows / navigation cruft
        if en_text.lower() in ("name", "english", "название", "currency", "item"):
            continue
        # Skip if both cells look identical (likely a header misparse)
        if normalize_for_match(en_text) == normalize_for_match(ru_text):
            continue
        key = (normalize_for_match(en_text), normalize_for_match(ru_text))
        if key in seen_pairs:
            continue
        seen_pairs.add(key)
        results.append({
            "en_name": en_text,
            "ru_name": ru_text,
            "category": category,
            "href": en_href or "",
        })

    # If we got nothing from tables, try a fallback regex scan for <a> tags
    # followed by parenthetical Russian text.
    if not results:
        log.warning("  No table rows parsed for category %s — trying fallback regex", category)
        fallback_re = re.compile(
            r'<a[^>]+title="([^"]+)"[^>]*>\s*\1\s*</a>[^<]*\(<[^>]+>([^<]+)<',
            re.IGNORECASE,
        )
        for m in fallback_re.finditer(html_text):
            en_text, ru_text = m.group(1), _strip_html(m.group(2))
            if en_text and ru_text and en_text != ru_text:
                key = (normalize_for_match(en_text), normalize_for_match(ru_text))
                if key not in seen_pairs:
                    seen_pairs.add(key)
                    results.append({
                        "en_name": en_text,
                        "ru_name": ru_text,
                        "category": category,
                        "href": "",
                    })

    return results


def fetch_poe2db_ru_names(*, base_url: str) -> dict[str, list[dict[str, str]]]:
    """Fetch EN→RU name pairs from poe2db.tw/ru/ for every configured category.

    Returns a dict keyed by category, where each value is a list of
    `{en_name, ru_name, category, href}` dicts.
    """
    base = base_url.rstrip("/")
    result: dict[str, list[dict[str, str]]] = {}

    for category, path_segment in POE2DB_CATEGORY_PATHS.items():
        url = f"{base}/ru/{path_segment}"
        log.info("  Fetching %s -> %s", category, url)
        try:
            html_text = _http_get_html(url)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                log.warning("  404 for category %s at %s — skipping (URL slug may need updating in POE2DB_CATEGORY_PATHS)",
                            category, url)
                result[category] = []
                continue
            raise

        title_match = _POE2DB_TITLE_RE.search(html_text)
        title = title_match.group("title").strip() if title_match else "?"
        log.info("    Page title: %s", title)

        pairs = parse_poe2db_category_html(html_text, category)
        log.info("    Parsed %d EN→RU pairs", len(pairs))
        result[category] = pairs

    return result


# ---------------------------------------------------------------------------
# Stage 2b — fetch RU names by per-item page title (iter 137, KI-30 fix)
# ---------------------------------------------------------------------------

# Suffix appended by poe2db to every page <title>.
_POE2DB_TITLE_SUFFIX = " - PoE2DB, Path of Exile Wiki ru"
_POE2DB_TITLE_SUFFIX_EN = " - PoE2DB, Path of Exile Wiki us"

# Items whose English name poe2scout reports with a different spelling than
# poe2db's URL slug. Add new entries here when the diff reports "no match" for
# an item that DOES exist on poe2db. Each value is the URL slug (no /ru/ prefix).
_POE2DB_URL_SLUG_OVERRIDES: dict[str, str] = {
    # poe2scout api_id -> poe2db URL slug
    # (empty by default — populated as drift is discovered)
}


def _en_name_to_poe2db_slug(en_name: str) -> str:
    """Convert a poe2scout English item name to its poe2db URL slug.

    poe2db URLs use underscores instead of spaces. Apostrophes are STRIPPED
    (not URL-encoded — %27 returns 404 on poe2db). Both "Atziri's_Communion"
    and "Atziris_Communion" resolve to the same page, so stripping is the
    safer choice.

    Examples:
      "Mirror of Kalandra" -> "Mirror_of_Kalandra"
      "Hinekora's Lock"     -> "Hinekoras_Lock"
      "Greater Chaos Orb"   -> "Greater_Chaos_Orb"
    """
    if not en_name:
        return ""
    # Strip apostrophes (ASCII + curly variants) — poe2db accepts the no-apostrophe form
    s = en_name
    for ch in ("'", "\u2018", "\u2019", "\u201b", "\u2032"):
        s = s.replace(ch, "")
    return s.replace(" ", "_")


def _build_poe2db_url(base_url: str, slug: str) -> str:
    """Build a poe2db URL with the slug URL-encoded.

    KI-33 fix (iter 145): non-ASCII characters in EN names (e.g. "Mórrigan's
    Insight", "Oisín's Oath") must be percent-encoded before being sent to
    urlopen, otherwise urllib raises UnicodeEncodeError ('ascii' codec can't
    encode). The slug function above strips apostrophes but keeps other non-
    ASCII chars (Cyrillic, accented Latin, etc.) intact — those need encoding.

    We use `urllib.parse.quote` with `safe="/%"` so slashes and percent signs
    in the override table pass through unchanged. Apostrophes are already
    stripped by `_en_name_to_poe2db_slug` before this function is called,
    but defensive-quote them too in case an override entry contains one.
    """
    encoded = urllib.parse.quote(slug, safe="/%'")
    return f"{base_url.rstrip('/')}/ru/{encoded}"


def _extract_ru_name_from_title(html_text: str) -> str | None:
    """Extract the Russian item name from a poe2db item page's <title> tag.

    poe2db item pages have title format: "<Russian Name> - PoE2DB, Path of Exile Wiki ru"
    Returns None if the page is not a valid item page (e.g. 404 search page,
    whose title is "Search Results - PoE2DB, ...").

    Args:
        html_text: Full HTML source of the poe2db item page.

    Returns:
        The Russian name, or None if the title doesn't match the expected pattern.
    """
    title_match = _POE2DB_TITLE_RE.search(html_text)
    if not title_match:
        return None
    title = html.unescape(title_match.group("title").strip())
    # Strip the suffix
    candidate: str | None = None
    if title.endswith(_POE2DB_TITLE_SUFFIX):
        candidate = title[: -len(_POE2DB_TITLE_SUFFIX)].strip()
    elif title.endswith(_POE2DB_TITLE_SUFFIX_EN):
        candidate = title[: -len(_POE2DB_TITLE_SUFFIX_EN)].strip()
    if not candidate:
        return None
    # Reject non-item pages: "Search Results", category landing pages, etc.
    # An item page's title is the item's display name. We require at least one
    # Cyrillic character to confirm we got an actual Russian translation.
    # (English-only titles mean poe2db has no Russian page for this item yet.)
    if not re.search(r"[А-Яа-яЁё]", candidate):
        return None
    # Reject obvious non-item page titles
    if candidate.lower() in ("search results", "search", "404 not found"):
        return None
    return candidate


def fetch_poe2db_ru_names_by_item(
    *,
    base_url: str,
    poe2scout_items: list[dict[str, str]],
    existing_names: dict[str, dict[str, str]],
    rate_limit_delay: float = 0.5,
) -> dict[str, list[dict[str, str]]]:
    """Fetch RU names by hitting each item's individual poe2db page.

    This is the KI-30 fix for the broken category-page parser. For each
    poe2scout item, we:
      1. Convert the EN name to a poe2db URL slug (spaces -> underscores).
      2. GET https://poe2db.tw/ru/<slug>
      3. Parse the <title> tag to extract the Russian name.
      4. If 404 or title doesn't match the item-page pattern, skip (no match).

    Items already translated (i.e. present in existing_names) are SKIPPED to
    save network calls — only items missing from currency_names.json are fetched.

    Args:
        base_url: poe2db base URL (default https://poe2db.tw).
        poe2scout_items: List of {api_id, en_name, category_api_id} from Stage 1.
        existing_names: The 4-dict structure loaded from currency_names.json.
        rate_limit_delay: Seconds to sleep between requests (default 0.5).

    Returns:
        Dict keyed by category, where each value is a list of
        `{en_name, ru_name, category, href}` dicts. Items that returned no
        match are simply omitted from the result (not included as empty pairs).
    """
    base = base_url.rstrip("/")
    existing_ru = existing_names["currency_names_ru"]
    existing_en = existing_names["currency_names_en"]

    # Build the list of items we need to fetch (skip already-translated items)
    to_fetch: list[dict[str, str]] = []
    for item in poe2scout_items:
        api_id = item["api_id"]
        if api_id in existing_ru and api_id in existing_en:
            continue  # already translated — skip
        to_fetch.append(item)

    log.info("  %d items to fetch (%d already translated, skipping)",
             len(to_fetch), len(poe2scout_items) - len(to_fetch))

    result: dict[str, list[dict[str, str]]] = {}
    fetched = 0
    matched = 0
    skipped_404 = 0
    skipped_no_title = 0

    for i, item in enumerate(to_fetch, 1):
        en_name = item["en_name"]
        category = item["category_api_id"]
        api_id = item["api_id"]

        # Check for manual slug overrides first
        slug = _POE2DB_URL_SLUG_OVERRIDES.get(api_id) or _en_name_to_poe2db_slug(en_name)
        if not slug:
            continue
        url = _build_poe2db_url(base, slug)  # KI-33: URL-encode non-ASCII chars

        if i % 25 == 0 or i == len(to_fetch):
            log.info("  [%d/%d] %s -> %s", i, len(to_fetch), en_name, url)

        try:
            html_text = _http_get_html(url)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                skipped_404 += 1
                time.sleep(rate_limit_delay)
                continue
            # On 5xx, retry (already done in _http_get); if it still fails, log and move on
            log.warning("  HTTP %d for %s — skipping", e.code, url)
            time.sleep(rate_limit_delay)
            continue
        except urllib.error.URLError as e:
            log.warning("  URLError %s for %s — skipping", e.reason, url)
            time.sleep(rate_limit_delay)
            continue
        except (UnicodeEncodeError, UnicodeDecodeError) as e:
            # KI-33: defensive — if a slug still slips through with bad chars
            log.warning("  UnicodeError %s for %s (slug=%r) — skipping", e, url, slug)
            time.sleep(rate_limit_delay)
            continue

        fetched += 1
        ru_name = _extract_ru_name_from_title(html_text)
        if ru_name:
            matched += 1
            result.setdefault(category, []).append({
                "en_name": en_name,
                "ru_name": ru_name,
                "category": category,
                "href": f"/ru/{slug}",
            })
        else:
            skipped_no_title += 1

        time.sleep(rate_limit_delay)

    log.info("  Fetched %d pages, matched %d items, skipped %d (404) + %d (no title)",
             fetched, matched, skipped_404, skipped_no_title)
    return result


# ---------------------------------------------------------------------------
# Stage 3 — diff and build patch
# ---------------------------------------------------------------------------

def build_translation_patch(
    poe2scout_items: list[dict[str, str]],
    poe2db_ru_names: dict[str, list[dict[str, str]]],
    existing_names: dict[str, dict[str, str]],
) -> dict[str, Any]:
    """Build a patch file of proposed new translations.

    Args:
        poe2scout_items: List of `{api_id, en_name, category_api_id}` from Stage 1.
        poe2db_ru_names: Dict of category -> list of `{en_name, ru_name, ...}` from Stage 2.
        existing_names: The 4 dicts from currency_names.json
            (`currency_names_ru`, `currency_names_en`, etc.).

    Returns a patch dict with structure:
        {
          "generated_at": "ISO timestamp",
          "summary": {
            "total_poe2scout_items": N,
            "already_translated": N,
            "new_candidates": N,
            "conflicts": N,
            "no_match": N
          },
          "entries": [
            {
              "api_id": "...",
              "en_name": "...",
              "category_api_id": "...",
              "current_ru_name": null | "...",
              "proposed_ru_name": "..." | null,
              "match_source": "poe2db" | "manual" | "none",
              "match_confidence": 1.0 | 0.7 | 0.0,
              "action": "add" | "conflict" | "skip"
            },
            ...
          ]
        }
    """
    # Build a normalized EN -> RU lookup from poe2db data
    en_to_ru: dict[str, str] = {}
    for category_pairs in poe2db_ru_names.values():
        for pair in category_pairs:
            key = normalize_for_match(pair["en_name"])
            if key and pair["ru_name"]:
                en_to_ru.setdefault(key, pair["ru_name"])

    existing_ru = existing_names["currency_names_ru"]
    existing_en = existing_names["currency_names_en"]

    entries: list[dict[str, Any]] = []
    counts = {
        "total_poe2scout_items": 0,
        "already_translated": 0,
        "new_candidates": 0,
        "conflicts": 0,
        "no_match": 0,
    }

    for item in poe2scout_items:
        api_id = item["api_id"]
        en_name = item["en_name"]
        category = item["category_api_id"]
        counts["total_poe2scout_items"] += 1

        current_ru = existing_ru.get(api_id)
        if current_ru:
            counts["already_translated"] += 1
            # Already translated — skip silently (do not include in patch entries
            # unless there's a conflict, which we check below).
            # Conflict detection: if the existing EN name differs from the
            # poe2scout-reported EN name, flag for review.
            existing_en_for_id = existing_en.get(api_id)
            if existing_en_for_id and normalize_for_match(existing_en_for_id) != normalize_for_match(en_name):
                # The api_id maps to a different EN name than what poe2scout now reports.
                # This could mean the item was renamed, or our existing entry is stale.
                proposed = en_to_ru.get(normalize_for_match(en_name))
                entries.append({
                    "api_id": api_id,
                    "en_name": en_name,
                    "category_api_id": category,
                    "current_ru_name": current_ru,
                    "current_en_name_in_json": existing_en_for_id,
                    "proposed_ru_name": proposed,
                    "match_source": "poe2db" if proposed else "none",
                    "match_confidence": 1.0 if proposed else 0.0,
                    "action": "conflict",
                })
                counts["conflicts"] += 1
            continue

        # api_id not in existing translations — try to match by EN name
        proposed_ru = en_to_ru.get(normalize_for_match(en_name))
        if proposed_ru:
            entries.append({
                "api_id": api_id,
                "en_name": en_name,
                "category_api_id": category,
                "current_ru_name": None,
                "proposed_ru_name": proposed_ru,
                "match_source": "poe2db",
                "match_confidence": 1.0,
                "action": "add",
            })
            counts["new_candidates"] += 1
        else:
            entries.append({
                "api_id": api_id,
                "en_name": en_name,
                "category_api_id": category,
                "current_ru_name": None,
                "proposed_ru_name": None,
                "match_source": "none",
                "match_confidence": 0.0,
                "action": "skip",
            })
            counts["no_match"] += 1

    return {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime()),
        "summary": counts,
        "entries": entries,
    }


# ---------------------------------------------------------------------------
# Stage 4 — apply patch
# ---------------------------------------------------------------------------

def apply_patch(patch: dict[str, Any], existing_names: dict[str, dict[str, str]]) -> tuple[int, int, int]:
    """Apply a reviewed patch to the in-memory existing_names dict.

    Mutates `existing_names` in place. Returns (added, conflicts_resolved, skipped).

    - For action="add" entries: inserts into currency_names_ru + currency_names_en.
    - For action="conflict" entries: SKIPS (maintainer must resolve manually).
    - For action="skip" entries: no-op (no proposed_ru_name).
    """
    added = 0
    conflicts = 0
    skipped = 0

    for entry in patch.get("entries", []):
        action = entry.get("action")
        api_id = entry.get("api_id")
        proposed_ru = entry.get("proposed_ru_name")
        en_name = entry.get("en_name")

        if not api_id:
            skipped += 1
            continue

        if action == "add" and proposed_ru and en_name:
            if api_id in existing_names["currency_names_ru"]:
                # Idempotency guard — should not happen if --diff was correct,
                # but be defensive.
                log.warning("  api_id %s already present — skipping (not overwriting)", api_id)
                skipped += 1
                continue
            existing_names["currency_names_ru"][api_id] = proposed_ru
            existing_names["currency_names_en"][api_id] = en_name
            added += 1
        elif action == "conflict":
            log.warning("  CONFLICT for api_id %s — current_ru=%r, current_en_in_json=%r, poe2scout_en=%r, proposed_ru=%r — SKIPPING (resolve manually)",
                        api_id,
                        entry.get("current_ru_name"),
                        entry.get("current_en_name_in_json"),
                        en_name,
                        proposed_ru)
            conflicts += 1
        else:
            skipped += 1

    return added, conflicts, skipped


# ---------------------------------------------------------------------------
# Stage 5 — audit existing translations against poe2db (iter 145, KI-32)
# ---------------------------------------------------------------------------

def audit_translations(
    *,
    base_url: str,
    poe2scout_items: list[dict[str, str]],
    existing_names: dict[str, dict[str, str]],
    rate_limit_delay: float = 0.2,
) -> dict[str, Any]:
    """Compare every existing RU translation against poe2db's current RU title.

    This is the KI-32 audit. For every api_id that already has a RU translation
    in currency_names.json, fetch its poe2db page and compare the <title> tag's
    Russian name against the stored value.

    READ-ONLY — does NOT modify currency_names.json. Writes the report to
    scripts/.cache/translation_audit.json.

    Returns a dict with structure:
        {
          "generated_at": ISO,
          "summary": {
            "total_audited": N,
            "match": N,
            "mismatch": N,
            "no_poe2db_page": N,
            "no_cyrillic": N,        # poe2db page exists but title is English-only
          },
          "mismatches": [
            {
              "api_id": "...",
              "en_name": "...",
              "category_api_id": "...",
              "our_ru": "...",
              "poe2db_ru": "...",
              "poe2db_url": "...",
            },
            ...
          ],
          "no_poe2db_page": [ list of {api_id, en_name, attempted_url} ],
          "no_cyrillic": [ list of {api_id, en_name, poe2db_title} ],
        }
    """
    base = base_url.rstrip("/")
    existing_ru = existing_names["currency_names_ru"]

    summary = {
        "total_audited": 0,
        "match": 0,
        "mismatch": 0,
        "no_poe2db_page": 0,
        "no_cyrillic": 0,
    }
    mismatches: list[dict[str, str]] = []
    no_poe2db_page: list[dict[str, str]] = []
    no_cyrillic: list[dict[str, str]] = []

    for i, item in enumerate(poe2scout_items, 1):
        api_id = item["api_id"]
        en_name = item["en_name"]
        category = item["category_api_id"]
        our_ru = existing_ru.get(api_id)
        if not our_ru:
            # Not yet translated — not part of this audit (covered by F1 pipeline).
            continue
        summary["total_audited"] += 1

        slug = _POE2DB_URL_SLUG_OVERRIDES.get(api_id) or _en_name_to_poe2db_slug(en_name)
        if not slug:
            summary["no_poe2db_page"] += 1
            no_poe2db_page.append({
                "api_id": api_id, "en_name": en_name, "attempted_url": "<empty slug>",
            })
            continue
        url = _build_poe2db_url(base, slug)  # KI-33: URL-encode non-ASCII chars

        if i % 25 == 0 or i == len(poe2scout_items):
            log.info("  [%d/%d] auditing %s -> %s", i, len(poe2scout_items), en_name, url)

        try:
            html_text = _http_get_html(url)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                summary["no_poe2db_page"] += 1
                no_poe2db_page.append({
                    "api_id": api_id, "en_name": en_name, "attempted_url": url,
                })
                time.sleep(rate_limit_delay)
                continue
            log.warning("  HTTP %d for %s — skipping", e.code, url)
            time.sleep(rate_limit_delay)
            continue
        except urllib.error.URLError as e:
            log.warning("  URLError %s for %s — skipping", e.reason, url)
            time.sleep(rate_limit_delay)
            continue
        except (UnicodeEncodeError, UnicodeDecodeError) as e:
            # KI-33: defensive — if a slug still slips through with bad chars
            log.warning("  UnicodeError %s for %s (slug=%r) — skipping", e, url, slug)
            time.sleep(rate_limit_delay)
            continue

        poe2db_ru = _extract_ru_name_from_title(html_text)
        if poe2db_ru is None:
            # Page exists but title doesn't contain Cyrillic → poe2db has no RU translation yet.
            summary["no_cyrillic"] += 1
            title_match = _POE2DB_TITLE_RE.search(html_text)
            title = title_match.group("title").strip() if title_match else ""
            no_cyrillic.append({
                "api_id": api_id, "en_name": en_name, "poe2db_title": title,
            })
        elif poe2db_ru == our_ru:
            summary["match"] += 1
        else:
            summary["mismatch"] += 1
            mismatches.append({
                "api_id": api_id,
                "en_name": en_name,
                "category_api_id": category,
                "our_ru": our_ru,
                "poe2db_ru": poe2db_ru,
                "poe2db_url": url,
            })

        time.sleep(rate_limit_delay)

    return {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime()),
        "summary": summary,
        "mismatches": mismatches,
        "no_poe2db_page": no_poe2db_page,
        "no_cyrillic": no_cyrillic,
    }


# ---------------------------------------------------------------------------
# Main CLI
# ---------------------------------------------------------------------------

def cmd_fetch_ids(args: argparse.Namespace) -> int:
    base_url = args.poe2scout_base_url
    realm = args.realm
    league = args.league

    log.info("Stage 1 — fetching api_ids from poe2scout.com")
    log.info("  Base URL: %s", base_url)
    log.info("  Realm: %s, League: %s", realm, league)

    try:
        items = fetch_poe2scout_items(base_url=base_url, realm=realm, league=league)
    except urllib.error.URLError as e:
        log.error("Network error during fetch_poe2scout_items: %s", e)
        return 1
    except FileNotFoundError as e:
        log.error("File error: %s", e)
        return 2

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime()),
        "source": f"{base_url}/{realm}/Leagues/{league}",
        "count": len(items),
        "items": items,
    }
    with POE2SCOUT_ITEMS_CACHE.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    log.info("Stage 1 COMPLETE — %d items written to %s", len(items), POE2SCOUT_ITEMS_CACHE.relative_to(REPO_ROOT))
    return 0


def cmd_from_cache_snapshot(args: argparse.Namespace) -> int:
    log.info("Stage 1 (fallback) — extracting api_ids from bundled cache-snapshot.json")
    try:
        items = extract_items_from_cache_snapshot()
    except FileNotFoundError as e:
        log.error("File error: %s", e)
        return 2

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime()),
        "source": "src/data/cache-snapshot.json (bundled, no live API call)",
        "count": len(items),
        "items": items,
    }
    with POE2SCOUT_ITEMS_CACHE.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    log.info("Stage 1 (fallback) COMPLETE — %d items written to %s", len(items), POE2SCOUT_ITEMS_CACHE.relative_to(REPO_ROOT))
    log.info("  NOTE: cache-snapshot.json only contains 6 categories (currency/ritual/ultimatum/idol/vaultkeys/delirium).")
    log.info("  Most of these api_ids are already translated. Use --fetch-ids for full coverage.")
    return 0


def cmd_fetch_ru(args: argparse.Namespace) -> int:
    base_url = args.poe2db_base_url
    log.info("Stage 2 — fetching RU names from poe2db.tw/ru/")
    log.info("  Base URL: %s", base_url)

    try:
        result = fetch_poe2db_ru_names(base_url=base_url)
    except urllib.error.URLError as e:
        log.error("Network error during fetch_poe2db_ru_names: %s", e)
        return 1

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    total_pairs = sum(len(v) for v in result.values())
    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime()),
        "source": base_url,
        "total_pairs": total_pairs,
        "categories": result,
    }
    with POE2DB_RU_CACHE.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    log.info("Stage 2 COMPLETE — %d total EN→RU pairs across %d categories written to %s",
             total_pairs, len(result), POE2DB_RU_CACHE.relative_to(REPO_ROOT))
    log.info("  WARNING (KI-30): the category-page parser produces junk for most categories.")
    log.info("  Prefer --fetch-ru-by-item for the iter-137 pipeline.")
    return 0


def cmd_fetch_ru_by_item(args: argparse.Namespace) -> int:
    """Stage 2b — fetch RU names by hitting each item's individual poe2db page.

    This is the KI-30 fix. Reads poe2scout_items.json (Stage 1 output) and
    the existing currency_names.json, fetches each untranslated item's poe2db
    page, extracts the Russian name from the <title> tag, and writes the same
    cache file format as --fetch-ru (so --diff can consume either source).
    """
    base_url = args.poe2db_base_url
    log.info("Stage 2b — fetching RU names by per-item page (KI-30 fix)")
    log.info("  Base URL: %s", base_url)

    if not POE2SCOUT_ITEMS_CACHE.exists():
        log.error("Missing %s — run --fetch-ids (or --from-cache-snapshot) first.",
                  POE2SCOUT_ITEMS_CACHE)
        return 4
    if not CURRENCY_NAMES_PATH.exists():
        log.error("Missing %s — run from the repo root.", CURRENCY_NAMES_PATH)
        return 2

    with POE2SCOUT_ITEMS_CACHE.open(encoding="utf-8") as f:
        poe2scout_data = json.load(f)
    with CURRENCY_NAMES_PATH.open(encoding="utf-8") as f:
        existing_names = json.load(f)

    try:
        result = fetch_poe2db_ru_names_by_item(
            base_url=base_url,
            poe2scout_items=poe2scout_data["items"],
            existing_names=existing_names,
            rate_limit_delay=args.rate_limit_delay,
        )
    except urllib.error.URLError as e:
        log.error("Network error during fetch_poe2db_ru_names_by_item: %s", e)
        return 1

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    total_pairs = sum(len(v) for v in result.values())
    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime()),
        "source": f"{base_url}/ru/<Item_Name> (per-item page title extraction)",
        "total_pairs": total_pairs,
        "categories": result,
    }
    with POE2DB_RU_CACHE.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    log.info("Stage 2b COMPLETE — %d total EN→RU pairs across %d categories written to %s",
             total_pairs, len(result), POE2DB_RU_CACHE.relative_to(REPO_ROOT))
    return 0


def cmd_diff(args: argparse.Namespace) -> int:
    log.info("Stage 3 — computing translation patch")

    if not POE2SCOUT_ITEMS_CACHE.exists():
        log.error("Missing %s — run --fetch-ids (or --from-cache-snapshot) first.", POE2SCOUT_ITEMS_CACHE)
        return 4
    if not POE2DB_RU_CACHE.exists():
        log.error("Missing %s — run --fetch-ru first.", POE2DB_RU_CACHE)
        return 4
    if not CURRENCY_NAMES_PATH.exists():
        log.error("Missing %s — run from the repo root.", CURRENCY_NAMES_PATH)
        return 2

    with POE2SCOUT_ITEMS_CACHE.open(encoding="utf-8") as f:
        poe2scout_data = json.load(f)
    with POE2DB_RU_CACHE.open(encoding="utf-8") as f:
        poe2db_data = json.load(f)
    with CURRENCY_NAMES_PATH.open(encoding="utf-8") as f:
        existing_names = json.load(f)

    patch = build_translation_patch(
        poe2scout_items=poe2scout_data["items"],
        poe2db_ru_names=poe2db_data["categories"],
        existing_names=existing_names,
    )

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with PATCH_CACHE.open("w", encoding="utf-8") as f:
        json.dump(patch, f, ensure_ascii=False, indent=2)

    s = patch["summary"]
    log.info("Stage 3 COMPLETE — patch written to %s", PATCH_CACHE.relative_to(REPO_ROOT))
    log.info("  Summary:")
    log.info("    Total poe2scout items:    %d", s["total_poe2scout_items"])
    log.info("    Already translated:       %d", s["already_translated"])
    log.info("    New candidates (matched): %d", s["new_candidates"])
    log.info("    Conflicts (needs review): %d", s["conflicts"])
    log.info("    No match (skip):          %d", s["no_match"])

    if args.verbose:
        log.info("  Patch entries (verbose):")
        for entry in patch["entries"]:
            if entry["action"] == "add":
                log.info("    + %-40s  %s  ->  %s", entry["api_id"], entry["en_name"], entry["proposed_ru_name"])
            elif entry["action"] == "conflict":
                log.info("    ! %-40s  EN json=%r vs poe2scout=%r  (current RU: %r)",
                         entry["api_id"],
                         entry.get("current_en_name_in_json"),
                         entry["en_name"],
                         entry.get("current_ru_name"))
            elif entry["action"] == "skip":
                log.info("    ? %-40s  %s  (no poe2db match)", entry["api_id"], entry["en_name"])

    if s["new_candidates"] == 0 and s["conflicts"] == 0:
        log.info("  Nothing to add — currency_names.json is up to date with poe2db.ru for the items poe2scout enumerates.")
    else:
        log.info("  Next steps:")
        log.info("    1. Review %s", PATCH_CACHE.relative_to(REPO_ROOT))
        log.info("    2. Manually edit any 'conflict' or 'skip' entries if you have a source for the RU name")
        log.info("    3. Run: python scripts/sync_currency_names_from_poe2db.py --apply --confirm")
        log.info("    4. Bump count assertions in tests/test_currency_names_ru.py (lines 30-33)")
        log.info("    5. Run: pytest tests/test_currency_names_ru.py")
    return 0


def cmd_apply(args: argparse.Namespace) -> int:
    if not args.confirm:
        log.error("--apply requires --confirm flag to prevent accidental writes.")
        log.error("  Re-run with: --apply --confirm")
        return 4

    log.info("Stage 4 — applying patch to backend/data/currency_names.json")

    if not PATCH_CACHE.exists():
        log.error("Missing %s — run --diff first.", PATCH_CACHE)
        return 4
    if not CURRENCY_NAMES_PATH.exists():
        log.error("Missing %s — run from the repo root.", CURRENCY_NAMES_PATH)
        return 2

    with PATCH_CACHE.open(encoding="utf-8") as f:
        patch = json.load(f)
    with CURRENCY_NAMES_PATH.open(encoding="utf-8") as f:
        existing_names = json.load(f)

    # Validation: ensure RU/EN key parity is preserved BEFORE we mutate.
    ru_keys = set(existing_names["currency_names_ru"].keys())
    en_keys = set(existing_names["currency_names_en"].keys())
    if ru_keys != en_keys:
        diff_ru = ru_keys - en_keys
        diff_en = en_keys - ru_keys
        log.error("Pre-existing RU/EN key drift in currency_names.json — refusing to apply.")
        log.error("  only-RU: %s", sorted(diff_ru)[:5])
        log.error("  only-EN: %s", sorted(diff_en)[:5])
        return 3

    added, conflicts, skipped = apply_patch(patch, existing_names)

    # Validation: ensure RU/EN key parity AFTER mutation.
    ru_keys = set(existing_names["currency_names_ru"].keys())
    en_keys = set(existing_names["currency_names_en"].keys())
    if ru_keys != en_keys:
        log.error("Post-apply RU/EN key drift — aborting write (in-memory state corrupted).")
        return 3

    # Write back atomically (write to temp, then rename).
    tmp_path = CURRENCY_NAMES_PATH.with_suffix(".json.tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(existing_names, f, ensure_ascii=False, indent=2)
        f.write("\n")  # trailing newline matches existing file convention
    tmp_path.replace(CURRENCY_NAMES_PATH)

    log.info("Stage 4 COMPLETE — %d added, %d conflicts (skipped), %d skipped (no-op).",
             added, conflicts, skipped)
    log.info("  Wrote: %s", CURRENCY_NAMES_PATH.relative_to(REPO_ROOT))
    log.info("  New counts: ru=%d, en=%d (was ru=%d, en=%d)",
             len(existing_names["currency_names_ru"]),
             len(existing_names["currency_names_en"]),
             len(existing_names["currency_names_ru"]) - added,
             len(existing_names["currency_names_en"]) - added)
    if added > 0:
        log.info("  NEXT: bump the count assertions in tests/test_currency_names_ru.py:")
        log.info("    assert len(CURRENCY_NAMES_RU) == %d   (was %d)",
                 len(existing_names["currency_names_ru"]),
                 len(existing_names["currency_names_ru"]) - added)
        log.info("    assert len(CURRENCY_NAMES_EN) == %d   (was %d)",
                 len(existing_names["currency_names_en"]),
                 len(existing_names["currency_names_en"]) - added)
        log.info("  Then run: pytest tests/test_currency_names_ru.py")
    return 0


def cmd_audit(args: argparse.Namespace) -> int:
    """Stage 5 (iter 145, KI-32) — audit existing translations against poe2db.

    READ-ONLY. Does NOT modify currency_names.json. Fetches each item's poe2db
    page and compares the current RU <title> against the stored RU translation.
    Writes a structured report to scripts/.cache/translation_audit.json.

    Requires scripts/.cache/poe2scout_items.json (Stage 1 output) to know which
    api_ids + EN names to audit. If missing, run --fetch-ids (or
    --from-cache-snapshot) first.
    """
    base_url = args.poe2db_base_url
    log.info("Stage 5 — auditing existing RU translations against poe2db")
    log.info("  Base URL: %s", base_url)

    if not POE2SCOUT_ITEMS_CACHE.exists():
        log.error("Missing %s — run --fetch-ids (or --from-cache-snapshot) first.",
                  POE2SCOUT_ITEMS_CACHE)
        return 4
    if not CURRENCY_NAMES_PATH.exists():
        log.error("Missing %s — run from the repo root.", CURRENCY_NAMES_PATH)
        return 2

    with POE2SCOUT_ITEMS_CACHE.open(encoding="utf-8") as f:
        poe2scout_data = json.load(f)
    with CURRENCY_NAMES_PATH.open(encoding="utf-8") as f:
        existing_names = json.load(f)

    try:
        report = audit_translations(
            base_url=base_url,
            poe2scout_items=poe2scout_data["items"],
            existing_names=existing_names,
            rate_limit_delay=args.rate_limit_delay,
        )
    except urllib.error.URLError as e:
        log.error("Network error during audit_translations: %s", e)
        return 1

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with TRANSLATION_AUDIT_CACHE.open("w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    s = report["summary"]
    log.info("Stage 5 COMPLETE — audit report written to %s",
             TRANSLATION_AUDIT_CACHE.relative_to(REPO_ROOT))
    log.info("  Summary:")
    log.info("    Total audited:        %d", s["total_audited"])
    log.info("    Match poe2db:         %d", s["match"])
    log.info("    Mismatch poe2db:      %d  (candidates for refresh)", s["mismatch"])
    log.info("    No poe2db page (404): %d", s["no_poe2db_page"])
    log.info("    No Cyrillic in title: %d  (poe2db page exists but no RU translation)",
             s["no_cyrillic"])
    log.info("  Next steps:")
    log.info("    1. Review %s", TRANSLATION_AUDIT_CACHE.relative_to(REPO_ROOT))
    log.info("    2. Inspect 'mismatches' array — these are existing translations")
    log.info("       that differ from poe2db's current RU title.")
    log.info("    3. To apply corrections: edit currency_names.json directly")
    log.info("       (future: --apply-audit flag will automate this — see TD-6).")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="sync_currency_names_from_poe2db.py",
        description="F1 enabler — sync Russian translations from poe2db.tw/ru/ into backend/data/currency_names.json.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="See module docstring for full pipeline description and usage examples.",
    )
    parser.add_argument("--fetch-ids", action="store_true",
                        help="Stage 1: fetch all api_ids + EN names from poe2scout.com API.")
    parser.add_argument("--from-cache-snapshot", action="store_true",
                        help="Stage 1 fallback: extract api_ids from bundled src/data/cache-snapshot.json (no network).")
    parser.add_argument("--fetch-ru", action="store_true",
                        help="Stage 2: fetch RU translations from poe2db.tw/ru/ (LEGACY — broken per KI-30).")
    parser.add_argument("--fetch-ru-by-item", action="store_true",
                        help="Stage 2b (iter 137, KI-30 fix): fetch RU translations by hitting each item's individual poe2db page and parsing the <title> tag. This is the recommended approach.")
    parser.add_argument("--diff", action="store_true",
                        help="Stage 3: compute patch of proposed new translations.")
    parser.add_argument("--apply", action="store_true",
                        help="Stage 4: apply patch to backend/data/currency_names.json (requires --confirm).")
    parser.add_argument("--audit", action="store_true",
                        help="Stage 5 (iter 145, KI-32): READ-ONLY audit of existing RU translations against poe2db current RU <title>. Writes scripts/.cache/translation_audit.json. Does NOT modify currency_names.json.")
    parser.add_argument("--confirm", action="store_true",
                        help="Confirmation flag for --apply (without it, --apply is a no-op).")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Verbose output (show every patch entry in --diff).")
    parser.add_argument("--rate-limit-delay", type=float, default=0.5,
                        help="Seconds to sleep between poe2db HTTP requests in --fetch-ru-by-item (default: 0.5). Lower = faster but risks rate-limiting.")

    parser.add_argument("--poe2scout-base-url", default=None,
                        help=f"Override poe2scout API base URL (default: ${'POE2_API_BASE_URL'!r} env or {DEFAULT_POE2SCOUT_BASE!r}).")
    parser.add_argument("--poe2db-base-url", default=None,
                        help=f"Override poe2db.tw base URL (default: ${'POE2DB_BASE_URL'!r} env or {DEFAULT_POE2DB_BASE!r}).")
    parser.add_argument("--realm", default=None,
                        help=f"Realm path segment for poe2scout (default: ${'POE2_SNAPSHOT_REALM'!r} env or {DEFAULT_REALM!r}).")
    parser.add_argument("--league", default=None,
                        help=f"League name for poe2scout (default: ${'POE2_SNAPSHOT_LEAGUE'!r} env or {DEFAULT_LEAGUE!r}).")

    args = parser.parse_args(argv)

    # Resolve env-var defaults
    if args.poe2scout_base_url is None:
        args.poe2scout_base_url = os_getenv("POE2_API_BASE_URL", DEFAULT_POE2SCOUT_BASE)
    if args.poe2db_base_url is None:
        args.poe2db_base_url = os_getenv("POE2DB_BASE_URL", DEFAULT_POE2DB_BASE)
    if args.realm is None:
        args.realm = os_getenv("POE2_SNAPSHOT_REALM", DEFAULT_REALM)
    if args.league is None:
        args.league = os_getenv("POE2_SNAPSHOT_LEAGUE", DEFAULT_LEAGUE)

    # Validate stage selection
    stage_count = sum([
        args.fetch_ids, args.from_cache_snapshot, args.fetch_ru, args.fetch_ru_by_item,
        args.diff, args.apply, args.audit,
    ])
    if stage_count == 0:
        parser.print_help()
        return 4
    if stage_count > 1:
        log.error("Specify exactly ONE stage flag (got %d). Stages are independent.", stage_count)
        return 4
    if args.fetch_ids and args.from_cache_snapshot:
        log.error("--fetch-ids and --from-cache-snapshot are mutually exclusive.")
        return 4

    if args.fetch_ids:
        return cmd_fetch_ids(args)
    if args.from_cache_snapshot:
        return cmd_from_cache_snapshot(args)
    if args.fetch_ru:
        return cmd_fetch_ru(args)
    if args.fetch_ru_by_item:
        return cmd_fetch_ru_by_item(args)
    if args.audit:
        return cmd_audit(args)
    if args.diff:
        return cmd_diff(args)
    if args.apply:
        return cmd_apply(args)
    return 0  # unreachable


def os_getenv(name: str, default: str) -> str:
    """Wrapper so the module doesn't need `import os` at top-level."""
    import os
    return os.environ.get(name, default)


if __name__ == "__main__":
    sys.exit(main())
