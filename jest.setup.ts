// ============================================================================
// Jest Setup — runs before each test suite
// ============================================================================
import "@testing-library/jest-dom";

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
