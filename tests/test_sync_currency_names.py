"""
Unit tests for scripts/sync_currency_names_from_poe2db.py (iter 85, F1 enabler).

These tests do NOT make network calls — they cover:
  - normalize_for_match / normalize_api_id (the bug-fixed version that
    preserves hyphens, matching currency_names.json convention)
  - parse_poe2db_category_html (HTML parser — table-row strategy + fallback)
  - build_translation_patch (diff logic — already_translated vs new candidate
    vs conflict vs no-match)
  - apply_patch (in-memory mutation — idempotency + RU/EN key parity)
  - extract_items_from_cache_snapshot (the bundled-snapshot fallback path)

The script is imported as a module (sys.path manipulation) since it lives
under scripts/ (not a Python package). This mirrors how the existing
verify-flips-vs-fixtures.py script is structured — sibling scripts are
not packaged but are testable via sys.path insert.

Run with:
    pytest tests/test_sync_currency_names.py -v
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Import the script as a module (it lives under scripts/, not a package)
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import sync_currency_names_from_poe2db as sync  # noqa: E402


# ---------------------------------------------------------------------------
# normalize_for_match
# ---------------------------------------------------------------------------

class TestNormalizeForMatch:
    def test_lowercases(self):
        assert sync.normalize_for_match("Mirror of Kalandra") == "mirror of kalandra"

    def test_strips_apostrophes(self):
        assert sync.normalize_for_match("Hinekora's Lock") == "hinekoras lock"
        # Curly apostrophes (typical from poe2db HTML)
        assert sync.normalize_for_match("Hinekora\u2019s Lock") == "hinekoras lock"

    def test_replaces_hyphens_with_spaces(self):
        assert sync.normalize_for_match("Greater-Chaos-Orb") == "greater chaos orb"

    def test_collapses_whitespace(self):
        assert sync.normalize_for_match("  Greater   Chaos   Orb  ") == "greater chaos orb"

    def test_empty(self):
        assert sync.normalize_for_match("") == ""
        assert sync.normalize_for_match(None) == ""  # type: ignore[arg-type]

    def test_decodes_html_entities(self):
        # &amp;#39; unescapes to &#39; (literal), then &#39; unescapes to '
        # html.unescape only does one pass, so &amp;#39; -> &#39; (literal text).
        # The &#39; entity (numeric apostrophe) DOES get unescaped to '.
        assert sync.normalize_for_match("Xoph&#39;s Blood") == "xophs blood"
        assert sync.normalize_for_match("Xoph&apos;s Blood") == "xophs blood"


# ---------------------------------------------------------------------------
# normalize_api_id (iter 85 bug-fix — hyphens PRESERVED)
# ---------------------------------------------------------------------------

class TestNormalizeApiId:
    def test_lowercases(self):
        assert sync.normalize_api_id("Mirror") == "mirror"

    def test_preserves_hyphens(self):
        """HYPHENS MUST BE PRESERVED — currency_names.json stores keys with hyphens.

        This is the regression test for the iter 85 bug where the script was
        incorrectly converting hyphens to underscores (matching the backend's
        _normalize_api_id from poe2scout.py:58, which is used for a DIFFERENT
        purpose — exchange-pair matching, not translation lookups).
        """
        assert sync.normalize_api_id("hinekoras-lock") == "hinekoras-lock"
        assert sync.normalize_api_id("fracturing-orb") == "fracturing-orb"
        assert sync.normalize_api_id("perfect-chaos-orb") == "perfect-chaos-orb"

    def test_strips_apostrophes(self):
        assert sync.normalize_api_id("Hinekora's-Lock") == "hinekoras-lock"

    def test_strips_spaces(self):
        # poe2scout never returns api_ids with spaces, but be defensive
        assert sync.normalize_api_id("mirror of kalandra") == "mirrorofkalandra"

    def test_empty(self):
        assert sync.normalize_api_id("") == ""
        assert sync.normalize_api_id(None) == ""  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# parse_poe2db_category_html
# ---------------------------------------------------------------------------

POE2DB_SAMPLE_HTML_2COL = """
<html><body>
<h1>Currency</h1>
<table class="wiki-table">
  <tr><th>English</th><th>Russian</th></tr>
  <tr>
    <td><a href="/ru/Currency/Mirror_of_Kalandra">Mirror of Kalandra</a></td>
    <td>Зеркало Каландры</td>
  </tr>
  <tr>
    <td><a href="/ru/Currency/Exalted_Orb">Exalted Orb</a></td>
    <td>Благородная сфера</td>
  </tr>
</table>
</body></html>
"""

POE2DB_SAMPLE_HTML_3COL = """
<html><body>
<table>
  <tr><th>Icon</th><th>Name</th><th>Название</th></tr>
  <tr>
    <td><img src="mirror.png" /></td>
    <td><a href="/ru/Currency/Mirror_of_Kalandra">Mirror of Kalandra</a></td>
    <td>Зеркало Каландры</td>
  </tr>
  <tr>
    <td><img src="exalted.png" /></td>
    <td><a href="/ru/Currency/Exalted_Orb">Exalted Orb</a></td>
    <td>Благородная сфера</td>
  </tr>
</table>
</body></html>
"""

POE2DB_SAMPLE_HTML_EMPTY = """
<html><body><h1>No items yet</h1></body></html>
"""

POE2DB_SAMPLE_HTML_HEADER_MISPARSE = """
<table>
  <tr><th>Name</th><th>Name</th></tr>
  <tr><td>Mirror of Kalandra</td><td>Mirror of Kalandra</td></tr>
</table>
"""


class TestParsePoe2dbCategoryHtml:
    def test_parses_2_column_table(self):
        results = sync.parse_poe2db_category_html(POE2DB_SAMPLE_HTML_2COL, "currency")
        assert len(results) == 2
        assert results[0]["en_name"] == "Mirror of Kalandra"
        assert results[0]["ru_name"] == "Зеркало Каландры"
        assert results[0]["category"] == "currency"
        assert results[0]["href"] == "/ru/Currency/Mirror_of_Kalandra"
        assert results[1]["en_name"] == "Exalted Orb"
        assert results[1]["ru_name"] == "Благородная сфера"

    def test_parses_3_column_table_skipping_icon_cell(self):
        """3-column tables (icon + EN + RU) — the icon cell is the first <td>,
        so the parser sees (icon_cell, en_cell) and tries to extract names.
        The icon cell has no text, so that row should be SKIPPED, and the
        parser should NOT find any valid pairs from the (en_cell, ru_cell)
        pairing because the regex only captures the first two <td>s.

        This is a known limitation — if poe2db switches to 3-column tables
        with an icon column, the parser will need updating. For now the test
        documents the current behavior.
        """
        results = sync.parse_poe2db_category_html(POE2DB_SAMPLE_HTML_3COL, "currency")
        # The current regex captures the first 2 <td> cells per row.
        # In a 3-column layout, that's (icon, en) — and the icon cell has no
        # visible text, so the row is skipped. Result: 0 pairs.
        # This is acceptable — poe2db.tw currently uses 2-column layouts for
        # most category pages.
        assert len(results) == 0  # documented limitation

    def test_empty_html_returns_empty_list(self):
        results = sync.parse_poe2db_category_html(POE2DB_SAMPLE_HTML_EMPTY, "currency")
        assert results == []

    def test_skips_header_only_rows(self):
        """Rows where both cells are the same word (e.g. 'Name'/'Name') are skipped."""
        results = sync.parse_poe2db_category_html(POE2DB_SAMPLE_HTML_HEADER_MISPARSE, "currency")
        assert results == []

    def test_dedupes_identical_pairs(self):
        html = """
        <table>
          <tr><th>EN</th><th>RU</th></tr>
          <tr><td>Mirror of Kalandra</td><td>Зеркало Каландры</td></tr>
          <tr><td>Mirror of Kalandra</td><td>Зеркало Каландры</td></tr>
        </table>
        """
        results = sync.parse_poe2db_category_html(html, "currency")
        assert len(results) == 1


# ---------------------------------------------------------------------------
# build_translation_patch
# ---------------------------------------------------------------------------

class TestBuildTranslationPatch:
    def setup_method(self):
        self.poe2scout_items = [
            {"api_id": "exalted", "en_name": "Exalted Orb", "category_api_id": "currency"},
            {"api_id": "mirror", "en_name": "Mirror of Kalandra", "category_api_id": "currency"},
            {"api_id": "new-currency-1", "en_name": "Brand New Currency", "category_api_id": "currency"},
            {"api_id": "new-currency-2", "en_name": "Unmatched Item", "category_api_id": "fragments"},
        ]
        self.poe2db_ru_names = {
            "currency": [
                {"en_name": "Mirror of Kalandra", "ru_name": "Зеркало Каландры", "category": "currency", "href": ""},
                {"en_name": "Brand New Currency", "ru_name": "Новая валюта", "category": "currency", "href": ""},
            ],
        }
        self.existing_names = {
            "category_names_ru": {"currency": "Валюта"},
            "category_names_en": {"currency": "Currency"},
            "currency_names_ru": {
                "exalted": "Благородная сфера",
                "mirror": "Зеркало Каландры",
            },
            "currency_names_en": {
                "exalted": "Exalted Orb",
                "mirror": "Mirror of Kalandra",
            },
        }

    def test_marks_already_translated_as_skip(self):
        patch = sync.build_translation_patch(
            self.poe2scout_items, self.poe2db_ru_names, self.existing_names
        )
        s = patch["summary"]
        assert s["total_poe2scout_items"] == 4
        assert s["already_translated"] == 2  # exalted + mirror
        assert s["new_candidates"] == 1  # new-currency-1
        assert s["no_match"] == 1  # new-currency-2

    def test_adds_new_candidate_with_proposed_ru(self):
        patch = sync.build_translation_patch(
            self.poe2scout_items, self.poe2db_ru_names, self.existing_names
        )
        add_entries = [e for e in patch["entries"] if e["action"] == "add"]
        assert len(add_entries) == 1
        assert add_entries[0]["api_id"] == "new-currency-1"
        assert add_entries[0]["proposed_ru_name"] == "Новая валюта"
        assert add_entries[0]["match_source"] == "poe2db"
        assert add_entries[0]["match_confidence"] == 1.0
        assert add_entries[0]["current_ru_name"] is None

    def test_marks_no_match_as_skip(self):
        patch = sync.build_translation_patch(
            self.poe2scout_items, self.poe2db_ru_names, self.existing_names
        )
        skip_entries = [e for e in patch["entries"] if e["action"] == "skip"]
        # 2 already-translated are NOT included in entries (only add/conflict/skip)
        # 1 new-currency-2 is unmatched -> skip
        assert len(skip_entries) == 1
        assert skip_entries[0]["api_id"] == "new-currency-2"
        assert skip_entries[0]["proposed_ru_name"] is None
        assert skip_entries[0]["match_source"] == "none"

    def test_detects_conflict_when_en_name_differs(self):
        """If api_id exists in JSON but poe2scout now reports a different EN name -> conflict."""
        # Modify poe2scout to report a different EN name for "mirror"
        items = list(self.poe2scout_items)
        items[1] = {"api_id": "mirror", "en_name": "Mirror of Kalandra (Updated)", "category_api_id": "currency"}
        patch = sync.build_translation_patch(
            items, self.poe2db_ru_names, self.existing_names
        )
        conflicts = [e for e in patch["entries"] if e["action"] == "conflict"]
        assert len(conflicts) == 1
        assert conflicts[0]["api_id"] == "mirror"
        assert conflicts[0]["current_ru_name"] == "Зеркало Каландры"
        assert conflicts[0]["current_en_name_in_json"] == "Mirror of Kalandra"
        assert conflicts[0]["en_name"] == "Mirror of Kalandra (Updated)"
        assert patch["summary"]["conflicts"] == 1

    def test_fuzzy_matching_via_normalized_en_name(self):
        """poe2db stores 'Hinekora's Lock' with apostrophe; poe2scout stores 'Hinekoras Lock'.
        normalize_for_match should make them match.
        """
        items = [
            {"api_id": "hinekoras-lock", "en_name": "Hinekora's Lock", "category_api_id": "currency"},
        ]
        poe2db = {
            "currency": [
                # Different apostrophe, different case — should still match
                {"en_name": "Hinekora\u2019s lock", "ru_name": "Прядь Хинекоры", "category": "currency", "href": ""},
            ],
        }
        existing = {
            "category_names_ru": {}, "category_names_en": {},
            "currency_names_ru": {}, "currency_names_en": {},
        }
        patch = sync.build_translation_patch(items, poe2db, existing)
        add_entries = [e for e in patch["entries"] if e["action"] == "add"]
        assert len(add_entries) == 1
        assert add_entries[0]["api_id"] == "hinekoras-lock"
        assert add_entries[0]["proposed_ru_name"] == "Прядь Хинекоры"


# ---------------------------------------------------------------------------
# apply_patch
# ---------------------------------------------------------------------------

class TestApplyPatch:
    def setup_method(self):
        self.existing_names = {
            "category_names_ru": {"currency": "Валюта"},
            "category_names_en": {"currency": "Currency"},
            "currency_names_ru": {"exalted": "Благородная сфера"},
            "currency_names_en": {"exalted": "Exalted Orb"},
        }

    def test_adds_new_entries_to_both_ru_and_en(self):
        patch = {
            "entries": [
                {
                    "api_id": "mirror",
                    "en_name": "Mirror of Kalandra",
                    "category_api_id": "currency",
                    "current_ru_name": None,
                    "proposed_ru_name": "Зеркало Каландры",
                    "match_source": "poe2db",
                    "match_confidence": 1.0,
                    "action": "add",
                },
            ]
        }
        added, conflicts, skipped = sync.apply_patch(patch, self.existing_names)
        assert added == 1
        assert conflicts == 0
        assert skipped == 0
        assert self.existing_names["currency_names_ru"]["mirror"] == "Зеркало Каландры"
        assert self.existing_names["currency_names_en"]["mirror"] == "Mirror of Kalandra"

    def test_idempotent_does_not_overwrite_existing(self):
        """If api_id already in JSON, --apply should SKIP (not overwrite)."""
        patch = {
            "entries": [
                {
                    "api_id": "exalted",  # already exists
                    "en_name": "Exalted Orb",
                    "category_api_id": "currency",
                    "current_ru_name": None,
                    "proposed_ru_name": "DIFFERENT NAME",
                    "match_source": "poe2db",
                    "match_confidence": 1.0,
                    "action": "add",
                },
            ]
        }
        added, conflicts, skipped = sync.apply_patch(patch, self.existing_names)
        assert added == 0
        assert skipped == 1
        # Original RU name preserved
        assert self.existing_names["currency_names_ru"]["exalted"] == "Благородная сфера"

    def test_conflict_entries_are_skipped_not_applied(self):
        """Conflicts must be manually resolved — apply_patch skips them with a warning."""
        patch = {
            "entries": [
                {
                    "api_id": "exalted",
                    "en_name": "Exalted Orb (Updated)",
                    "category_api_id": "currency",
                    "current_ru_name": "Благородная сфера",
                    "current_en_name_in_json": "Exalted Orb",
                    "proposed_ru_name": "Новое имя",
                    "match_source": "poe2db",
                    "match_confidence": 1.0,
                    "action": "conflict",
                },
            ]
        }
        added, conflicts, skipped = sync.apply_patch(patch, self.existing_names)
        assert added == 0
        assert conflicts == 1
        assert skipped == 0
        # Original RU name preserved
        assert self.existing_names["currency_names_ru"]["exalted"] == "Благородная сфера"

    def test_skip_entries_are_no_op(self):
        patch = {
            "entries": [
                {
                    "api_id": "unknown-item",
                    "en_name": "Unknown Item",
                    "category_api_id": "currency",
                    "current_ru_name": None,
                    "proposed_ru_name": None,
                    "match_source": "none",
                    "match_confidence": 0.0,
                    "action": "skip",
                },
            ]
        }
        added, conflicts, skipped = sync.apply_patch(patch, self.existing_names)
        assert added == 0
        assert conflicts == 0
        assert skipped == 1
        assert "unknown-item" not in self.existing_names["currency_names_ru"]

    def test_preserves_ru_en_key_parity(self):
        """After apply, RU and EN dicts must have identical key sets."""
        patch = {
            "entries": [
                {
                    "api_id": "mirror", "en_name": "Mirror of Kalandra",
                    "category_api_id": "currency", "current_ru_name": None,
                    "proposed_ru_name": "Зеркало Каландры", "match_source": "poe2db",
                    "match_confidence": 1.0, "action": "add",
                },
                {
                    "api_id": "divine", "en_name": "Divine Orb",
                    "category_api_id": "currency", "current_ru_name": None,
                    "proposed_ru_name": "Божественная сфера", "match_source": "poe2db",
                    "match_confidence": 1.0, "action": "add",
                },
            ]
        }
        sync.apply_patch(patch, self.existing_names)
        ru_keys = set(self.existing_names["currency_names_ru"].keys())
        en_keys = set(self.existing_names["currency_names_en"].keys())
        assert ru_keys == en_keys
        assert ru_keys == {"exalted", "mirror", "divine"}


# ---------------------------------------------------------------------------
# extract_items_from_cache_snapshot
# ---------------------------------------------------------------------------

class TestExtractItemsFromCacheSnapshot:
    def test_extracts_items_from_bundled_snapshot(self):
        """The bundled src/data/cache-snapshot.json should yield ~138 items
        (the count documented in STATUS.md F1 entry).
        """
        items = sync.extract_items_from_cache_snapshot()
        assert len(items) >= 130  # allow minor fluctuation
        # Every item must have the 3 required fields
        for item in items:
            assert "api_id" in item
            assert "en_name" in item
            assert "category_api_id" in item
            assert item["api_id"], f"empty api_id in {item}"
            assert item["en_name"], f"empty en_name in {item}"
        # All api_ids must be unique
        api_ids = [i["api_id"] for i in items]
        assert len(api_ids) == len(set(api_ids)), "duplicate api_ids in cache-snapshot extraction"
        # All api_ids should preserve hyphens (iter 85 bug fix regression check)
        hyphen_ids = [aid for aid in api_ids if "-" in aid]
        assert len(hyphen_ids) > 0, "expected at least some hyphenated api_ids in cache-snapshot"
        # No api_id should contain underscores (would indicate the old buggy normalization)
        underscore_ids = [aid for aid in api_ids if "_" in aid]
        assert underscore_ids == [], f"api_ids with underscores found (regression): {underscore_ids[:5]}"

    def test_mirror_is_in_snapshot(self):
        items = sync.extract_items_from_cache_snapshot()
        api_ids = {i["api_id"] for i in items}
        assert "mirror" in api_ids
        assert "exalted" in api_ids
        # Hyphenated api_id regression check
        assert "hinekoras-lock" in api_ids


# ---------------------------------------------------------------------------
# CLI argument parsing
# ---------------------------------------------------------------------------

class TestCli:
    def test_no_args_returns_4(self, capsys):
        rc = sync.main([])
        assert rc == 4
        out = capsys.readouterr().out
        assert "usage:" in out.lower()

    def test_multiple_stages_returns_4(self, capsys):
        rc = sync.main(["--fetch-ids", "--fetch-ru"])
        assert rc == 4

    def test_apply_without_confirm_returns_4(self, capsys):
        rc = sync.main(["--apply"])
        assert rc == 4

    def test_fetch_ids_and_from_cache_snapshot_mutually_exclusive(self, capsys):
        # Both flags set -> stage_count will be 2, caught by the
        # "stage_count > 1" check before the mutual-exclusion check.
        # Either way, returns 4.
        rc = sync.main(["--fetch-ids", "--from-cache-snapshot"])
        assert rc == 4


# ---------------------------------------------------------------------------
# iter 137 additions — KI-29 URL encoding + KI-30 per-item title-tag fetcher
# ---------------------------------------------------------------------------

class TestEnNameToPoe2dbSlug:
    """KI-30: slug generation strips apostrophes (URL-encoded %27 returns 404)."""

    def test_replaces_spaces_with_underscores(self):
        assert sync._en_name_to_poe2db_slug("Mirror of Kalandra") == "Mirror_of_Kalandra"

    def test_strips_apostrophes(self):
        # poe2db accepts both "Hinekora's_Lock" and "Hinekoras_Lock" — strip is safer
        assert sync._en_name_to_poe2db_slug("Hinekora's Lock") == "Hinekoras_Lock"
        assert sync._en_name_to_poe2db_slug("Atziri's Communion") == "Atziris_Communion"

    def test_strips_curly_apostrophes(self):
        assert sync._en_name_to_poe2db_slug("Hinekora\u2019s Lock") == "Hinekoras_Lock"

    def test_empty(self):
        assert sync._en_name_to_poe2db_slug("") == ""
        assert sync._en_name_to_poe2db_slug(None) == ""  # type: ignore[arg-type]


class TestExtractRuNameFromTitle:
    """KI-30: extract Russian item name from poe2db page <title> tag."""

    def test_extracts_russian_name_from_ru_locale_title(self):
        html_text = '<html><head><title>Зеркало Каландры - PoE2DB, Path of Exile Wiki ru</title></head></html>'
        assert sync._extract_ru_name_from_title(html_text) == "Зеркало Каландры"

    def test_returns_none_for_search_results_page(self):
        """When poe2db has no item page, the title is 'Search Results' (English-only)."""
        html_text = '<title>Search Results - PoE2DB, Path of Exile Wiki ru</title>'
        assert sync._extract_ru_name_from_title(html_text) is None

    def test_returns_none_for_english_only_title(self):
        """If poe2db has the page but hasn't translated it, the title is English-only."""
        html_text = '<title>Vision Rune - PoE2DB, Path of Exile Wiki ru</title>'
        assert sync._extract_ru_name_from_title(html_text) is None

    def test_returns_none_for_unrecognized_title_format(self):
        """Non-item pages (homepage, category landing, etc.) have different title suffixes."""
        html_text = '<title>Path of Exile 2 Wiki</title>'
        assert sync._extract_ru_name_from_title(html_text) is None

    def test_returns_none_for_missing_title(self):
        assert sync._extract_ru_name_from_title("<html><body>no title</body></html>") is None

    def test_decodes_html_entities_in_title(self):
        """poe2db titles sometimes contain &amp; / &#39; entities."""
        html_text = '<title>Сущность &amp; пламя - PoE2DB, Path of Exile Wiki ru</title>'
        assert sync._extract_ru_name_from_title(html_text) == "Сущность & пламя"


class TestKi29UrlEncoding:
    """KI-29: --fetch-ids must URL-encode league names with spaces."""

    def test_fetch_poe2scout_items_url_encodes_league(self, monkeypatch):
        """Verify the URL passed to _http_get_json has the league URL-encoded."""
        captured_urls: list[str] = []

        class DummyResp:
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return None
            def read(self):
                return b'{"Items": [], "Pages": 1}'

        def fake_urlopen(req, timeout=None):
            captured_urls.append(req.full_url)
            return DummyResp()

        # Patch urlopen so no real network call is made
        monkeypatch.setattr(sync.urllib.request, "urlopen", fake_urlopen)

        sync.fetch_poe2scout_items(
            base_url="https://poe2scout.com/api",
            realm="poe2",
            league="Runes of Aldur",
        )
        # The URL must contain %20 (encoded space), not a raw space
        assert any("%20" in url and "Runes%20of%20Aldur" in url for url in captured_urls), (
            f"Expected URL-encoded league name, got: {captured_urls[:3]}"
        )
