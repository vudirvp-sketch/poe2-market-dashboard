// ============================================================================
// Unit tests for lib/case-transform.ts — snake_case → camelCase transformer
//
// Covers the KI-20 regression: `_<digit>` patterns (e.g. `delta_7d_pct`) must
// be fully camelCased (`delta7dPct`), not left with a stray underscore.
//
// These tests import the REAL case-transform module — no mocks. They break
// if the regex or transformKeys behaviour changes.
// ============================================================================

import { toCamelCase, transformKeys } from "@/lib/case-transform";

describe("toCamelCase", () => {
  // ---- Baseline (already-camelCase keys are idempotent) ----
  test("returns already-camelCase keys unchanged", () => {
    expect(toCamelCase("simpleKey")).toBe("simpleKey");
    expect(toCamelCase("a")).toBe("a");
    expect(toCamelCase("ABC")).toBe("ABC");
    expect(toCamelCase("camelCaseAlready")).toBe("camelCaseAlready");
  });

  test("returns plain lowercase keys unchanged", () => {
    expect(toCamelCase("name")).toBe("name");
    expect(toCamelCase("price")).toBe("price");
  });

  // ---- Basic snake_case → camelCase ----
  test("converts simple snake_case to camelCase", () => {
    expect(toCamelCase("hello_world")).toBe("helloWorld");
    expect(toCamelCase("user_id")).toBe("userId");
    expect(toCamelCase("price_history")).toBe("priceHistory");
  });

  test("converts multi-segment snake_case to camelCase", () => {
    expect(toCamelCase("one_two_three")).toBe("oneTwoThree");
    expect(toCamelCase("a_b_c_d")).toBe("aBCD");
  });

  test("does NOT match `_<uppercase>` (left as-is — uppercase isn't in [a-z0-9])", () => {
    // The regex is `_([a-z0-9])` — uppercase letters are NOT matched, so
    // `hello_World` stays as `hello_World`. This is by design: a key like
    // `user_ID` is already partially camelCased and shouldn't be touched.
    expect(toCamelCase("hello_World")).toBe("hello_World");
    expect(toCamelCase("user_ID")).toBe("user_ID");
  });

  // ---- KI-20 regression: `_<digit>` patterns (the bug we fixed) ----
  test("KI-20: converts `_<digit>` segment to camelCase (digit kept, underscore removed)", () => {
    // These were the failing cases in KI-20 — previously produced
    // `delta_7dPct` / `rolling_7d` / `volume_24h` with leftover underscores.
    expect(toCamelCase("delta_7d_pct")).toBe("delta7dPct");
    expect(toCamelCase("rolling_7d")).toBe("rolling7d");
    expect(toCamelCase("volume_24h")).toBe("volume24h");
  });

  test("KI-20: converts `_<digit>` at the start of a segment", () => {
    expect(toCamelCase("change_30d")).toBe("change30d");
    expect(toCamelCase("lookback_14d_window")).toBe("lookback14dWindow");
  });

  test("KI-20: converts pure-digit segments after underscore", () => {
    expect(toCamelCase("tier_1")).toBe("tier1");
    expect(toCamelCase("level_99")).toBe("level99");
    expect(toCamelCase("phase_2_subsection_3")).toBe("phase2Subsection3");
  });

  test("KI-20: converts mixed digit+letter segment correctly", () => {
    // After the first char (digit), the rest of the segment is preserved as-is.
    expect(toCamelCase("rolling_7d_avg")).toBe("rolling7dAvg");
    expect(toCamelCase("price_24h_change_pct")).toBe("price24hChangePct");
  });

  // ---- Edge cases ----
  // (moved: `_<uppercase>` is now covered in the dedicated test above)

  test("handles consecutive underscores (only the last underscore before a match is replaced)", () => {
    // `__a` → `_A` (the first `_` has no matching `[a-z0-9]` after it because
    // the next char is another `_`; the second `_a` matches and becomes `A`).
    expect(toCamelCase("__a")).toBe("_A");
    expect(toCamelCase("a__b")).toBe("a_B");
  });

  test("handles trailing underscore (no match — left as-is)", () => {
    expect(toCamelCase("foo_")).toBe("foo_");
    expect(toCamelCase("foo_bar_")).toBe("fooBar_");
  });

  test("handles empty string", () => {
    expect(toCamelCase("")).toBe("");
  });

  test("handles single underscore", () => {
    expect(toCamelCase("_")).toBe("_");
  });

  test("handles underscore followed by digit at start of string", () => {
    // The regex matches `_1` at the start too — it replaces `_1` with the
    // uppercase of `1` (no-op for digits), so `_1foo` becomes `1foo`.
    // Leading underscores are rare in backend response keys, so this edge
    // case is acceptable. (If a private-field marker like `_internalField`
    // needs to survive transformKeys, that's a separate concern — the regex
    // would need a negative lookbehind, which isn't worth the complexity.)
    expect(toCamelCase("_1foo")).toBe("1foo");
    expect(toCamelCase("_7d")).toBe("7d");
  });
});

describe("transformKeys", () => {
  // ---- Primitives & null ----
  test("returns primitives as-is", () => {
    expect(transformKeys(42)).toBe(42);
    expect(transformKeys("hello")).toBe("hello");
    expect(transformKeys(true)).toBe(true);
  });

  test("returns null as-is", () => {
    expect(transformKeys(null)).toBeNull();
  });

  test("returns undefined as-is", () => {
    expect(transformKeys(undefined)).toBeUndefined();
  });

  // ---- Plain objects ----
  test("transforms top-level snake_case keys", () => {
    const input = { user_id: 1, price_history: [1, 2, 3] };
    const expected = { userId: 1, priceHistory: [1, 2, 3] };
    expect(transformKeys(input)).toEqual(expected);
  });

  test("transforms nested objects recursively", () => {
    const input = {
      outer_key: {
        inner_key: "value",
        another_inner: { deep_key: 42 },
      },
    };
    const expected = {
      outerKey: {
        innerKey: "value",
        anotherInner: { deepKey: 42 },
      },
    };
    expect(transformKeys(input)).toEqual(expected);
  });

  // ---- Arrays ----
  test("transforms each element of an array", () => {
    const input = [
      { item_id: "a", chaos_equivalent: 1.5 },
      { item_id: "b", chaos_equivalent: 2.5 },
    ];
    const expected = [
      { itemId: "a", chaosEquivalent: 1.5 },
      { itemId: "b", chaosEquivalent: 2.5 },
    ];
    expect(transformKeys(input)).toEqual(expected);
  });

  test("transforms arrays nested inside objects", () => {
    const input = {
      categories: [
        { category_name: "ring", delta_7d_pct: 0.12 },
        { category_name: "amulet", delta_7d_pct: -0.05 },
      ],
    };
    const expected = {
      categories: [
        { categoryName: "ring", delta7dPct: 0.12 },
        { categoryName: "amulet", delta7dPct: -0.05 },
      ],
    };
    expect(transformKeys(input)).toEqual(expected);
  });

  // ---- KI-20 regression: `_<digit>` in transformKeys (the bug we fixed) ----
  test("KI-20: transforms `_<digit>` keys via transformKeys (was the silent content-pulse bug)", () => {
    // This is the canonical KI-20 fixture — content-pulse categories carry
    // `delta_7d_pct` and `rolling_7d` from the backend. Before KI-20, the
    // proxy delivered `delta_7dPct` / `rolling_7d` (with leftover underscore),
    // so `category.delta7dPct` returned `undefined` in the widget.
    const input = {
      data_available: true,
      categories: [
        {
          category_name: "currency",
          delta_7d_pct: 12.5,
          rolling_7d: 100.0,
          volume_24h: 999,
        },
      ],
    };
    const expected = {
      dataAvailable: true,
      categories: [
        {
          categoryName: "currency",
          delta7dPct: 12.5,
          rolling7d: 100.0,
          volume24h: 999,
        },
      ],
    };
    expect(transformKeys(input)).toEqual(expected);
  });

  // ---- Mixed-case & already-camelCase idempotency ----
  test("leaves already-camelCase keys unchanged (idempotent)", () => {
    const input = { userId: 1, priceHistory: [1, 2], dataAvailable: true };
    expect(transformKeys(input)).toEqual(input);
  });

  test("handles mixed snake_case and camelCase keys", () => {
    const input = { user_id: 1, priceHistory: [1, 2], data_available: true };
    const expected = { userId: 1, priceHistory: [1, 2], dataAvailable: true };
    expect(transformKeys(input)).toEqual(expected);
  });

  // ---- Empty collections ----
  test("returns empty object as-is", () => {
    expect(transformKeys({})).toEqual({});
  });

  test("returns empty array as-is", () => {
    expect(transformKeys([])).toEqual([]);
  });

  // ---- Value preservation ----
  test("does NOT transform values that are strings (only keys)", () => {
    const input = { user_id: "snake_case_value" };
    const expected = { userId: "snake_case_value" };
    expect(transformKeys(input)).toEqual(expected);
  });

  test("preserves numeric values", () => {
    const input = { price_24h: 3.14, count: 42 };
    const expected = { price24h: 3.14, count: 42 };
    expect(transformKeys(input)).toEqual(expected);
  });

  test("preserves boolean values", () => {
    const input = { is_active: true, is_deleted: false };
    const expected = { isActive: true, isDeleted: false };
    expect(transformKeys(input)).toEqual(expected);
  });
});
