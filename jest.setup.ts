// ============================================================================
// Jest Setup — runs before each test suite
// ============================================================================
import "@testing-library/jest-dom";

// iter 121 (RE-DO of iter 119, KI-25) — reset the module-level i18n store
// before each test so each test gets a fresh "first subscribe" behavior
// (hasMounted reset to false, currentLocale reset to DEFAULT_LOCALE, listeners
// cleared). Without this, the first test that mounts I18nProvider flips
// hasMounted to true, and subsequent tests would skip the localStorage read
// in subscribeLocale, breaking hydration assertions.
import { __resetI18nForTesting } from "@/lib/i18n";

// ---- fetch / Response / Request / Headers polyfill ----
// Node 18+ provides these natively on globalThis, but jsdom (used as the
// jest testEnvironment) does NOT expose them in its sandbox. Tests that
// exercise `proxyWithFallback` (P2-8, iter 69) need a real `Response` to
// inspect status codes and headers, and need `fetch` to be mockable.
//
// We try undici first (full-featured). If undici fails to load (e.g. due
// to missing TextDecoder in some jsdom configurations), we fall back to a
// minimal hand-rolled Response/Headers pair that supports the operations
// the tests actually use: status / ok / headers.get / .json() / .text().
// `fetch` is always jest-mocked per-test in the proxy test suite, so we
// only need a default placeholder here.
type FetchImpl = (input: unknown, init?: unknown) => Promise<unknown>;

let polyfillFetch: FetchImpl | undefined;
let polyfillResponse: (new (body?: unknown, init?: unknown) => unknown) | undefined;
let polyfillHeaders: (new (init?: unknown) => unknown) | undefined;
let polyfillRequest: (new (input: unknown, init?: unknown) => unknown) | undefined;

try {
  // Attempt to load undici — preferred because it's spec-compliant.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional CJS dynamic load in try/catch; ESM await import would need top-level await
  const undici = require("undici");
  polyfillFetch = undici.fetch as FetchImpl;
  polyfillResponse = undici.Response;
  polyfillHeaders = undici.Headers;
  polyfillRequest = undici.Request;
} catch {
  // undici not loadable in this env — fall back to minimal stubs.
  // (Used by flipper-proxy.test.ts only — the tests mock `global.fetch`
  // themselves, so the default fetch impl is never actually called.)
}

class MinimalHeaders {
  private map = new Map<string, string>();
  constructor(init?: Record<string, string> | Array<[string, string]>) {
    if (init) {
      if (Array.isArray(init)) {
        for (const [k, v] of init) this.map.set(k.toLowerCase(), String(v));
      } else {
        for (const [k, v] of Object.entries(init)) this.map.set(k.toLowerCase(), String(v));
      }
    }
  }
  get(name: string): string | null {
    return this.map.get(name.toLowerCase()) ?? null;
  }
  has(name: string): boolean {
    return this.map.has(name.toLowerCase());
  }
  set(name: string, value: string): void {
    this.map.set(name.toLowerCase(), String(value));
  }
}

class MinimalResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: MinimalHeaders;
  private bodyText: string;
  constructor(body?: unknown, init?: { status?: number; headers?: Record<string, string> }) {
    this.status = init?.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = new MinimalHeaders(init?.headers ?? {});
    if (body == null) {
      this.bodyText = "";
    } else if (typeof body === "string") {
      this.bodyText = body;
    } else if (body instanceof ArrayBuffer || (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(body))) {
      this.bodyText = new TextDecoder().decode(body as ArrayBuffer);
    } else {
      this.bodyText = JSON.stringify(body);
    }
  }
  async json(): Promise<unknown> {
    return JSON.parse(this.bodyText);
  }
  async text(): Promise<string> {
    return this.bodyText;
  }
  static json(data: unknown, init?: { status?: number; headers?: Record<string, string> }): MinimalResponse {
    return new MinimalResponse(JSON.stringify(data), {
      status: init?.status ?? 200,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  }
}

const g = globalThis as Record<string, unknown>;
if (typeof g.fetch === "undefined") {
  g.fetch = polyfillFetch ?? (jest.fn().mockRejectedValue(new Error("fetch not mocked")) as FetchImpl);
}
if (typeof g.Response === "undefined") {
  g.Response = polyfillResponse ?? MinimalResponse;
}
if (typeof g.Headers === "undefined") {
  g.Headers = polyfillHeaders ?? MinimalHeaders;
}
if (typeof g.Request === "undefined") {
  // Minimal Request stub — not used by flipper-proxy tests but exported
  // for completeness.
  g.Request = polyfillRequest ?? class MinimalRequest { constructor() {} };
}

// ---- AbortSignal.timeout polyfill ----
// `flipper-proxy.ts` uses `AbortSignal.timeout(ms)` to enforce request
// timeouts. Node 18+ provides this, but jsdom's sandbox doesn't expose it.
// We polyfill with a simple implementation that fires `abort` after `ms`.
if (typeof (AbortSignal as { timeout?: unknown }).timeout !== "function") {
  Object.defineProperty(AbortSignal, "timeout", {
    value: function timeout(ms: number): AbortSignal {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    },
    writable: true,
    configurable: true,
  });
}

// ---- localStorage mock ----
// jsdom provides a basic localStorage, but we reset it between tests
// to avoid state leaking across test cases.
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

// Reset localStorage before each test
beforeEach(() => {
  window.localStorage.clear();
  // Reset the i18n module-level store (iter 121, KI-25) — see import comment above.
  __resetI18nForTesting();
});

// ---- Mock next-themes (used by Header) ----
// next-themes relies on context + useEffect + localStorage, which doesn't
// work cleanly in jsdom. We provide a simple stub.
jest.mock("next-themes", () => ({
  useTheme: () => ({ theme: "dark", setTheme: jest.fn() }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ---- Mock matchMedia for useReducedMotion ----
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: jest.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});
