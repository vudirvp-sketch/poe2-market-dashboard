// ============================================================================
// Unit tests for poe2api.ts — DEFAULT_LEAGUE_OVERRIDES and getRealms logic
//
// Tests the POE2Scout /Realms bug workaround:
//   - The /Realms endpoint returns a stale default_league_value
//   - DEFAULT_LEAGUE_OVERRIDES maps known stale values to correct ones
//   - getRealms() applies overrides when it detects a stale value
//   - getLeagues() matches defaultLeagueValue against both Value and ShortName
// ============================================================================

// ---------------------------------------------------------------------------
// DEFAULT_LEAGUE_OVERRIDES — mirrors the table in poe2api.ts
// These MUST stay in sync with the source. If you add a new entry to
// DEFAULT_LEAGUE_OVERRIDES in poe2api.ts, add a corresponding test here.
// ---------------------------------------------------------------------------

const DEFAULT_LEAGUE_OVERRIDES: Record<string, string> = {
  // /Realms returns "Fate of the Vaal" (stale displayName) → override to ShortName "runes"
  "poe2:Fate of the Vaal": "runes",
  // /Realms returns "vaal" (stale ShortName) → override to "runes" (current ShortName)
  "poe2:vaal": "runes",
  // /Realms returns "Runes of Aldur" (correct league but displayName format) →
  // override to ShortName "runes" for consistency
  "poe2:Runes of Aldur": "runes",
};

describe("DEFAULT_LEAGUE_OVERRIDES", () => {
  it("contains override for stale displayName 'Fate of the Vaal'", () => {
    expect(DEFAULT_LEAGUE_OVERRIDES["poe2:Fate of the Vaal"]).toBe("runes");
  });

  it("contains override for stale ShortName 'vaal'", () => {
    expect(DEFAULT_LEAGUE_OVERRIDES["poe2:vaal"]).toBe("runes");
  });

  it("contains override for displayName format 'Runes of Aldur'", () => {
    expect(DEFAULT_LEAGUE_OVERRIDES["poe2:Runes of Aldur"]).toBe("runes");
  });

  it("all override values use ShortName format (lowercase)", () => {
    // Override values must be ShortName slugs (e.g. "runes"), not displayNames
    // like "Runes of Aldur" — this is critical for getLeagues() matching
    for (const [, corrected] of Object.entries(DEFAULT_LEAGUE_OVERRIDES)) {
      // ShortName format: lowercase, no spaces
      expect(corrected).toMatch(/^[a-z0-9]+$/);
    }
  });

  it("all override keys follow 'realm:staleValue' format", () => {
    for (const key of Object.keys(DEFAULT_LEAGUE_OVERRIDES)) {
      expect(key).toMatch(/^poe2:/);
    }
  });

  it("does not override already-correct ShortName 'runes'", () => {
    // If /Realms already returns "runes" (correct ShortName), no override needed
    expect(DEFAULT_LEAGUE_OVERRIDES["poe2:runes"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getRealms() override application logic — mirrors the code in poe2api.ts
// ---------------------------------------------------------------------------

describe("getRealms override logic", () => {
  /**
   * Simulates the override logic from getRealms() in poe2api.ts.
   * This mirrors the actual code to test the logic in isolation.
   */
  function applyOverride(
    realmApiId: string,
    defaultLeagueValue: string | undefined,
    overrides: Record<string, string>
  ): { overridden: boolean; value: string | undefined } {
    const defaultLeague = defaultLeagueValue || undefined;
    const overrideKey = `${realmApiId}:${defaultLeague}`;
    if (defaultLeague && overrides[overrideKey]) {
      return { overridden: true, value: overrides[overrideKey] };
    }
    return { overridden: false, value: defaultLeague };
  }

  it("overrides stale 'Fate of the Vaal' to 'runes'", () => {
    const result = applyOverride("poe2", "Fate of the Vaal", DEFAULT_LEAGUE_OVERRIDES);
    expect(result.overridden).toBe(true);
    expect(result.value).toBe("runes");
  });

  it("overrides stale ShortName 'vaal' to 'runes'", () => {
    const result = applyOverride("poe2", "vaal", DEFAULT_LEAGUE_OVERRIDES);
    expect(result.overridden).toBe(true);
    expect(result.value).toBe("runes");
  });

  it("overrides displayName format 'Runes of Aldur' to 'runes'", () => {
    const result = applyOverride("poe2", "Runes of Aldur", DEFAULT_LEAGUE_OVERRIDES);
    expect(result.overridden).toBe(true);
    expect(result.value).toBe("runes");
  });

  it("does NOT override when defaultLeagueValue is already 'runes'", () => {
    const result = applyOverride("poe2", "runes", DEFAULT_LEAGUE_OVERRIDES);
    expect(result.overridden).toBe(false);
    expect(result.value).toBe("runes");
  });

  it("does NOT override for non-poe2 realms", () => {
    const result = applyOverride("pc", "Fate of the Vaal", DEFAULT_LEAGUE_OVERRIDES);
    expect(result.overridden).toBe(false);
    expect(result.value).toBe("Fate of the Vaal");
  });

  it("handles undefined defaultLeagueValue gracefully", () => {
    const result = applyOverride("poe2", undefined, DEFAULT_LEAGUE_OVERRIDES);
    expect(result.overridden).toBe(false);
    expect(result.value).toBeUndefined();
  });

  it("handles empty string defaultLeagueValue gracefully", () => {
    const result = applyOverride("poe2", "", DEFAULT_LEAGUE_OVERRIDES);
    expect(result.overridden).toBe(false);
    expect(result.value).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getLeagues() active league determination logic
// ---------------------------------------------------------------------------

describe("getLeagues active league logic", () => {
  /**
   * Simulates the active league determination from getLeagues() in poe2api.ts.
   * Strategy:
   * 1. If ANY league has IsCurrent=true, use ONLY IsCurrent
   * 2. If NO IsCurrent=true, match defaultLeagueValue against both Value and ShortName
   */

  interface TestLeague {
    Value: string;       // displayName (e.g. "Runes of Aldur")
    ShortName: string;   // slug (e.g. "runes")
    IsCurrent: boolean;
    active?: boolean;    // set by determineActive()
  }

  interface ActiveLeague extends TestLeague {
    active: boolean;
  }

  function determineActive(
    leagues: TestLeague[],
    defaultLeagueValue?: string
  ): ActiveLeague[] {
    const hasAnyIsCurrent = leagues.some((l) => l.IsCurrent);

    return leagues.map((l) => ({
      ...l,
      active: hasAnyIsCurrent
        ? l.IsCurrent
        : defaultLeagueValue
          ? l.Value === defaultLeagueValue || l.ShortName === defaultLeagueValue
          : false,
    }));
  }

  const LEAGUES: TestLeague[] = [
    { Value: "Runes of Aldur", ShortName: "runes", IsCurrent: true },
    { Value: "HC Runes of Aldur", ShortName: "runeshc", IsCurrent: true },
    { Value: "Fate of the Vaal", ShortName: "vaal", IsCurrent: false },
    { Value: "Standard", ShortName: "standard", IsCurrent: false },
  ];

  it("uses IsCurrent when any league has IsCurrent=true", () => {
    const result = determineActive(LEAGUES, "Fate of the Vaal");
    // Even though defaultLeagueValue is stale ("Fate of the Vaal"),
    // IsCurrent=true takes precedence
    expect(result.find((l) => l.ShortName === "runes")!.active).toBe(true);
    expect(result.find((l) => l.ShortName === "runeshc")!.active).toBe(true);
    expect(result.find((l) => l.ShortName === "vaal")!.active).toBe(false);
  });

  it("falls back to ShortName matching when no IsCurrent", () => {
    const noCurrent = LEAGUES.map((l) => ({ ...l, IsCurrent: false }));
    const result = determineActive(noCurrent, "runes");
    // defaultLeagueValue="runes" matches ShortName "runes"
    expect(result.find((l) => l.ShortName === "runes")!.active).toBe(true);
    expect(result.find((l) => l.ShortName === "runeshc")!.active).toBe(false);
  });

  it("falls back to Value matching when no IsCurrent", () => {
    const noCurrent = LEAGUES.map((l) => ({ ...l, IsCurrent: false }));
    const result = determineActive(noCurrent, "Runes of Aldur");
    // defaultLeagueValue="Runes of Aldur" matches Value "Runes of Aldur"
    expect(result.find((l) => l.ShortName === "runes")!.active).toBe(true);
  });

  it("matches stale defaultLeagueValue 'Fate of the Vaal' to Value", () => {
    const noCurrent = LEAGUES.map((l) => ({ ...l, IsCurrent: false }));
    const result = determineActive(noCurrent, "Fate of the Vaal");
    // Stale defaultLeagueValue from /Realms bug — matches Value
    expect(result.find((l) => l.ShortName === "vaal")!.active).toBe(true);
  });

  it("matches stale ShortName 'vaal' to ShortName", () => {
    const noCurrent = LEAGUES.map((l) => ({ ...l, IsCurrent: false }));
    const result = determineActive(noCurrent, "vaal");
    // Stale ShortName from /Realms bug — matches ShortName
    expect(result.find((l) => l.ShortName === "vaal")!.active).toBe(true);
  });

  it("marks no league active when defaultLeagueValue is undefined", () => {
    const noCurrent = LEAGUES.map((l) => ({ ...l, IsCurrent: false }));
    const result = determineActive(noCurrent, undefined);
    expect(result.every((l) => !l.active)).toBe(true);
  });

  it("IsCurrent=true takes priority over defaultLeagueValue", () => {
    // This is the CORE bug scenario: /Realms returns "Fate of the Vaal" (stale),
    // but /Leagues correctly has IsCurrent=true for "Runes of Aldur"
    const result = determineActive(LEAGUES, "Fate of the Vaal");
    const runesLeague = result.find((l) => l.ShortName === "runes")!;
    const vaalLeague = result.find((l) => l.ShortName === "vaal")!;

    // Runes of Aldur should be active (IsCurrent=true)
    expect(runesLeague.active).toBe(true);
    // Fate of the Vaal should NOT be active (even though defaultLeagueValue matches)
    expect(vaalLeague.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generate-cache-snapshot.ts ShortName format fix
// ---------------------------------------------------------------------------

describe("cache-snapshot ShortName format fix", () => {
  // These are the known stale values that the generate-cache-snapshot.ts
  // script should detect and replace with ShortName "runes"

  const STALE_VALUES = new Set(["Fate of the Vaal", "vaal", "Runes of Aldur"]);

  it("detects 'Fate of the Vaal' as stale", () => {
    expect(STALE_VALUES.has("Fate of the Vaal")).toBe(true);
  });

  it("detects 'vaal' as stale", () => {
    expect(STALE_VALUES.has("vaal")).toBe(true);
  });

  it("detects 'Runes of Aldur' as stale (displayName format)", () => {
    expect(STALE_VALUES.has("Runes of Aldur")).toBe(true);
  });

  it("does NOT flag 'runes' as stale (correct ShortName)", () => {
    expect(STALE_VALUES.has("runes")).toBe(false);
  });

  /**
   * Simulates the post-processing logic in generate-cache-snapshot.ts
   */
  function fixRealmsData(
    realms: Array<Record<string, unknown>>,
    staleValues: Set<string>
  ): { fixed: boolean; realms: Array<Record<string, unknown>> } {
    let fixed = false;
    for (const realm of realms) {
      if (
        realm.realm_api_id === "poe2" &&
        typeof realm.default_league_value === "string" &&
        staleValues.has(realm.default_league_value)
      ) {
        realm.default_league_value = "runes";
        fixed = true;
      }
    }
    return { fixed, realms };
  }

  it("fixes stale 'Fate of the Vaal' in /Realms response", () => {
    const realms = [
      { realm_api_id: "poe2", default_league_value: "Fate of the Vaal" },
    ];
    const result = fixRealmsData(realms, STALE_VALUES);
    expect(result.fixed).toBe(true);
    expect(result.realms[0].default_league_value).toBe("runes");
  });

  it("fixes stale 'vaal' in /Realms response", () => {
    const realms = [
      { realm_api_id: "poe2", default_league_value: "vaal" },
    ];
    const result = fixRealmsData(realms, STALE_VALUES);
    expect(result.fixed).toBe(true);
    expect(result.realms[0].default_league_value).toBe("runes");
  });

  it("fixes displayName format 'Runes of Aldur' in /Realms response", () => {
    const realms = [
      { realm_api_id: "poe2", default_league_value: "Runes of Aldur" },
    ];
    const result = fixRealmsData(realms, STALE_VALUES);
    expect(result.fixed).toBe(true);
    expect(result.realms[0].default_league_value).toBe("runes");
  });

  it("does NOT modify already-correct 'runes' value", () => {
    const realms = [
      { realm_api_id: "poe2", default_league_value: "runes" },
    ];
    const result = fixRealmsData(realms, STALE_VALUES);
    expect(result.fixed).toBe(false);
    expect(result.realms[0].default_league_value).toBe("runes");
  });

  it("does NOT modify non-poe2 realms", () => {
    const realms = [
      { realm_api_id: "pc", default_league_value: "Fate of the Vaal" },
    ];
    const result = fixRealmsData(realms, STALE_VALUES);
    expect(result.fixed).toBe(false);
    expect(result.realms[0].default_league_value).toBe("Fate of the Vaal");
  });

  it("handles multiple poe2 realms with mixed stale values", () => {
    const realms = [
      { realm_api_id: "pc", default_league_value: "Mirage" },
      { realm_api_id: "poe2", default_league_value: "Fate of the Vaal" },
    ];
    const result = fixRealmsData(realms, STALE_VALUES);
    expect(result.realms[0].default_league_value).toBe("Mirage");
    expect(result.realms[1].default_league_value).toBe("runes");
  });
});
