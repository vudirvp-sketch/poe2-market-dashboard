// ============================================================================
// Unit tests for lib/types.ts — format helpers and export utilities
// ============================================================================
import { fmt, fmtChange, exportToCsv, exportToJson } from "@/lib/types";

describe("fmt", () => {
  it("formats null as dash", () => {
    expect(fmt(null)).toBe("—");
  });

  it("formats undefined as dash", () => {
    expect(fmt(undefined)).toBe("—");
  });

  it("formats large numbers with locale string (max 1 decimal)", () => {
    // fmt(1500) uses toLocaleString with maximumFractionDigits: 1
    // 1500 has no decimals, so result is "1,500" (not "1,500.0")
    expect(fmt(1500)).toBe("1,500");
  });

  it("formats large numbers with one decimal digit", () => {
    expect(fmt(1500.5)).toBe("1,500.5");
  });

  it("formats small numbers with fixed digits", () => {
    expect(fmt(3.14159, 2)).toBe("3.14");
  });

  it("formats 0 correctly", () => {
    // fmt(0) returns "0" by design (special case for zero to avoid "0.00")
    expect(fmt(0)).toBe("0");
  });

  it("formats numbers below 1000 without rounding up", () => {
    // 999.99 is below 1000, so toFixed(2) is used → "999.99"
    expect(fmt(999.99)).toBe("999.99");
  });
});

describe("fmtChange", () => {
  it("returns dash for null", () => {
    const result = fmtChange(null);
    expect(result.text).toBe("—");
    expect(result.color).toBe("text-muted-foreground");
  });

  it("returns dash for undefined", () => {
    const result = fmtChange(undefined);
    expect(result.text).toBe("—");
  });

  it("formats positive change with plus sign", () => {
    const result = fmtChange(5.5);
    expect(result.text).toBe("+5.5%");
    expect(result.color).toBe("text-emerald-400");
  });

  it("formats negative change without plus sign", () => {
    const result = fmtChange(-3.2);
    expect(result.text).toBe("-3.2%");
    expect(result.color).toBe("text-red-400");
  });

  it("formats zero change without plus sign", () => {
    // fmtChange(0): sign is "" because pct > 0 is false
    const result = fmtChange(0);
    expect(result.text).toBe("0.0%");
    expect(result.color).toBe("text-muted-foreground");
  });
});

// Mock URL.createObjectURL for jsdom (not available by default)
beforeAll(() => {
  if (!URL.createObjectURL) {
    URL.createObjectURL = jest.fn(() => "blob:test");
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = jest.fn();
  }
});

describe("exportToCsv", () => {
  let createElementSpy: jest.SpyInstance;
  let clickSpy: jest.SpyInstance;

  beforeEach(() => {
    clickSpy = jest.fn();
    createElementSpy = jest.spyOn(document, "createElement").mockImplementation(
      () =>
        ({
          click: clickSpy,
          href: "",
          download: "",
          style: {},
        }) as unknown as HTMLAnchorElement
    );
  });

  afterEach(() => {
    createElementSpy.mockRestore();
  });

  it("handles empty data gracefully", () => {
    expect(() => exportToCsv([], "test")).not.toThrow();
  });

  it("creates CSV with headers and rows", () => {
    const data = [
      { name: "Chaos Orb", price: 1 },
      { name: "Divine Orb", price: 187 },
    ];
    exportToCsv(data, "test-export");
    expect(clickSpy).toHaveBeenCalled();
  });
});

describe("exportToJson", () => {
  let createElementSpy: jest.SpyInstance;
  let clickSpy: jest.SpyInstance;

  beforeEach(() => {
    clickSpy = jest.fn();
    createElementSpy = jest.spyOn(document, "createElement").mockImplementation(
      () =>
        ({
          click: clickSpy,
          href: "",
          download: "",
          style: {},
        }) as unknown as HTMLAnchorElement
    );
  });

  afterEach(() => {
    createElementSpy.mockRestore();
  });

  it("exports data as JSON", () => {
    const data = { key: "value" };
    exportToJson(data, "test-export");
    expect(clickSpy).toHaveBeenCalled();
  });
});
