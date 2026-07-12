#!/usr/bin/env python3
"""
Parallel runner for the KI-30 fix — fetches RU translations from poe2db by
hitting each item's individual page. Uses a thread pool for speed.

Writes the result to scripts/.cache/poe2db_ru_names.json in the same format
as --fetch-ru, so --diff can consume it.

Usage:
    python scripts/fetch_ru_by_item_parallel.py [--workers N] [--delay D]

Defaults: --workers 6, --delay 0.1 (so effective rate per worker = 10 req/s,
total = 60 req/s — poe2db can handle this easily).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

import sync_currency_names_from_poe2db as sync  # noqa: E402

POE2SCOUT_ITEMS_CACHE = sync.POE2SCOUT_ITEMS_CACHE
POE2DB_RU_CACHE = sync.POE2DB_RU_CACHE
CURRENCY_NAMES_PATH = sync.CURRENCY_NAMES_PATH
DEFAULT_POE2DB_BASE = sync.DEFAULT_POE2DB_BASE


def fetch_one(item: dict[str, str], base_url: str, delay: float) -> dict[str, str] | None:
    """Fetch a single item's poe2db page and extract its Russian name.

    Returns the {api_id, en_name, category, ru_name, href} dict on success,
    or None on no-match / 404 / network error.
    """
    en_name = item["en_name"]
    category = item["category_api_id"]
    api_id = item["api_id"]
    slug = sync._POE2DB_URL_SLUG_OVERRIDES.get(api_id) or sync._en_name_to_poe2db_slug(en_name)
    if not slug:
        return None
    # URL-encode the slug, but KEEP apostrophes raw (poe2db returns 404 for %27).
    # The slug from _en_name_to_poe2db_slug already has apostrophes stripped,
    # but the override table might contain them — be defensive.
    encoded = urllib.parse.quote(slug, safe="/%'")
    url = f"{base_url.rstrip('/')}/ru/{encoded}"
    try:
        html_text = sync._http_get_html(url)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        return None
    except urllib.error.URLError:
        return None
    finally:
        time.sleep(delay)
    ru_name = sync._extract_ru_name_from_title(html_text)
    if not ru_name:
        return None
    return {
        "api_id": api_id,
        "en_name": en_name,
        "category": category,
        "ru_name": ru_name,
        "href": f"/ru/{slug}",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=6,
                        help="Number of parallel HTTP workers (default: 6).")
    parser.add_argument("--delay", type=float, default=0.1,
                        help="Sleep per worker per request, seconds (default: 0.1).")
    parser.add_argument("--poe2db-base-url", default=DEFAULT_POE2DB_BASE,
                        help="poe2db base URL.")
    args = parser.parse_args(argv)

    if not POE2SCOUT_ITEMS_CACHE.exists():
        print(f"ERROR: missing {POE2SCOUT_ITEMS_CACHE}", file=sys.stderr)
        return 1
    if not CURRENCY_NAMES_PATH.exists():
        print(f"ERROR: missing {CURRENCY_NAMES_PATH}", file=sys.stderr)
        return 1

    with POE2SCOUT_ITEMS_CACHE.open(encoding="utf-8") as f:
        scout_data = json.load(f)
    with CURRENCY_NAMES_PATH.open(encoding="utf-8") as f:
        existing_names = json.load(f)

    existing_ru = existing_names["currency_names_ru"]
    existing_en = existing_names["currency_names_en"]

    # Filter to untranslated only
    to_fetch = [
        item for item in scout_data["items"]
        if item["api_id"] not in existing_ru or item["api_id"] not in existing_en
    ]
    print(f"Items to fetch: {len(to_fetch)} (out of {len(scout_data['items'])} total)")
    print(f"Workers: {args.workers}, per-request delay: {args.delay}s")

    results: list[dict[str, str]] = []
    matched = 0
    no_match = 0
    start = time.time()

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(fetch_one, item, args.poe2db_base_url, args.delay): item for item in to_fetch}
        for i, fut in enumerate(as_completed(futures), 1):
            res = fut.result()
            if res is None:
                no_match += 1
            else:
                matched += 1
                results.append(res)
            if i % 25 == 0 or i == len(to_fetch):
                elapsed = time.time() - start
                eta = (elapsed / i) * (len(to_fetch) - i) if i > 0 else 0
                print(f"  [{i}/{len(to_fetch)}] matched={matched} no_match={no_match} "
                      f"elapsed={elapsed:.0f}s eta={eta:.0f}s")

    # Group by category for the cache file format
    by_category: dict[str, list[dict[str, str]]] = {}
    for r in results:
        by_category.setdefault(r["category"], []).append({
            "en_name": r["en_name"],
            "ru_name": r["ru_name"],
            "category": r["category"],
            "href": r["href"],
        })

    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime()),
        "source": f"{args.poe2db_base_url}/ru/<Item_Name> (per-item page title extraction, parallel)",
        "total_pairs": len(results),
        "categories": by_category,
    }
    POE2DB_RU_CACHE.parent.mkdir(parents=True, exist_ok=True)
    with POE2DB_RU_CACHE.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print()
    print(f"DONE in {time.time() - start:.1f}s — matched {matched}, no_match {no_match}")
    print(f"Wrote {POE2DB_RU_CACHE.relative_to(REPO_ROOT)}")
    for cat, pairs in sorted(by_category.items()):
        print(f"  {cat:25s} -> {len(pairs):3d} pairs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
