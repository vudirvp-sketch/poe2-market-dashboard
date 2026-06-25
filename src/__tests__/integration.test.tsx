// ============================================================================
// Integration tests — FlipperApiError classification + error-type routing.
//
// iter 87: The CurrencyGraphTab tests that previously lived in this file were
// removed when the Currency Graph tab was deleted (the user said
// "вкладку 'граф валют' можно вообще вырезать"). What remains are the pure
// FlipperApiError classification tests — they exercise the error-routing
// logic that other tabs (FlipsTab, LiquidChainTab, etc.) rely on.
// ============================================================================

import {
  FlipperApiError,
  getFlipperErrorType,
  type FlipperErrorType,
} from "@/lib/types";

describe("FlipperApiError classification", () => {
  it("handles FlipperApiError from fetchApi correctly", () => {
    const error = new FlipperApiError(503, JSON.stringify({
      error: "Backend unavailable",
      error_type: "backend_offline",
      hint: "Start the FastAPI backend",
    }));

    expect(error.status).toBe(503);
    expect(error.errorType).toBe("backend_offline");
    expect(getFlipperErrorType(error)).toBe("backend_offline");
  });

  it("distinguishes backend_offline from backend_insufficient_data errors", () => {
    const offlineError = new FlipperApiError(503, JSON.stringify({
      error_type: "backend_offline",
    }));
    const insufficientError = new FlipperApiError(503, JSON.stringify({
      error_type: "backend_insufficient_data",
    }));

    expect(getFlipperErrorType(offlineError)).toBe("backend_offline");
    expect(getFlipperErrorType(insufficientError)).toBe("backend_insufficient_data");
    expect(getFlipperErrorType(offlineError)).not.toBe(getFlipperErrorType(insufficientError));
  });

  it("FlipperApiError classification matches all expected error types", () => {
    const testCases: Array<{ status: number; body: string; expected: FlipperErrorType }> = [
      { status: 503, body: JSON.stringify({ error_type: "backend_offline" }), expected: "backend_offline" },
      { status: 503, body: JSON.stringify({ error_type: "backend_insufficient_data" }), expected: "backend_insufficient_data" },
      { status: 503, body: JSON.stringify({ error_type: "backend_timeout" }), expected: "backend_timeout" },
      { status: 422, body: JSON.stringify({ detail: "Not enough data" }), expected: "insufficient_data" },
      { status: 502, body: "Bad Gateway", expected: "upstream_error" },
      { status: 500, body: "Internal Server Error", expected: "server_error" },
    ];

    for (const tc of testCases) {
      const err = new FlipperApiError(tc.status, tc.body);
      expect(err.errorType).toBe(tc.expected);
    }
  });
});
