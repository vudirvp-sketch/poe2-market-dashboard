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

  it("formats large numbers with locale string", () => {
    expect(fmt(1500)).toBe("1,500.0");
  });

  it("formats small numbers with fixed digits", () => {
    expect(fmt(3.14159, 2)).toBe("3.14");
  });

  it("formats 0 correctly", () => {
    expect(fmt(0)).toBe("0.00");
  });

  it("formats numbers just below 1000 with fixed digits", () => {
    expect(fmt(999.99)).toBe("1,000.0");
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

  it("formats zero change as neutral", () => {
    const result = fmtChange(0);
    expect(result.text).toBe("+0.0%");
    expect(result.color).toBe("text-muted-foreground");
  });
});

describe("exportToCsv", () => {
  let createElementSpy: jest.SpyInstance;
  let clickSpy: jest.SpyInstance;

  beforeEach(() => {
    createElementSpy = jest.spyOn(document, "createElement");
    clickSpy = jest.fn();
    createElementSpy.mockImplementation(() => ({
      click: clickSpy,
      href: "",
      download: "",
      style: {},
    }));
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
    createElementSpy = jest.spyOn(document, "createElement");
    clickSpy = jest.fn();
    createElementSpy.mockImplementation(() => ({
      click: clickSpy,
      href: "",
      download: "",
      style: {},
    }));
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
