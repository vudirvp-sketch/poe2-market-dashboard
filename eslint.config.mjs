// ESLint v9 flat config — fixes KI-22.
//
// Uses the native flat-config exports shipped by `eslint-config-next` v16
// (`eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`).
// No FlatCompat / @eslint/eslintrc wrapper needed — these exports are already
// flat-config arrays.
//
// History: the repo was bootstrapped with an older Next.js that emitted
// `.eslintrc.json`; that file was later deleted, leaving `npm run lint`
// broken under ESLint v9 (which dropped legacy `.eslintrc.*` support).
// This file restores lint without changing source code.
//
// See STATUS.md → KI-22 (closed), KI-23, KI-24 for background.

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  // --- Next.js recommended presets (core-web-vitals + TypeScript) ---
  // These already include:
  //   - @next/eslint-plugin-next (core-web-vitals rules)
  //   - eslint-plugin-react, eslint-plugin-react-hooks, eslint-plugin-jsx-a11y
  //   - eslint-plugin-import + resolver-typescript
  //   - typescript-eslint parser + recommended rules
  //   - Global ignores: .next/**, out/**, build/**, next-env.d.ts
  ...nextCoreWebVitals,
  ...nextTypescript,

  // --- Project-specific global ignores ---
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "next-env.d.ts",
      // KI-19 defense-in-depth: placeholder files that broke `next build`.
      "**/DELETE_*.ts",
      // Cloudflare Worker is a separate deployment artifact with its own
      // package.json — lint it independently if needed, not as part of the
      // Next.js app.
      "cloudflare-worker/**",
      // Playwright E2E specs use Playwright globals (test, expect, describe).
      // They are type-checked by `tsc --noEmit` separately. Linting them with
      // the Next.js preset triggers no-undef on Playwright globals — skip.
      "e2e/**",
      // Python scripts and backend — not ESLint's jurisdiction.
      "backend/**",
      "tests/**",
      "scripts/**/*.py",
      // Build artifacts / generated files.
      "src/data/cache-snapshot.json",
      "openapi_schema.json",
      "package-lock.json",
    ],
  },

  // --- Rule overrides for ALL files ---
  {
    rules: {
      // KI-24: the four new React Compiler rules (shipped with
      // eslint-plugin-react-hooks v7 / eslint-config-next v16) are set to
      // "error" by default. They flag legitimate patterns that predate the
      // React Compiler (setState in effects, inline component defs, ref
      // syncing, manual memoization). Downgrade to "warn" so lint passes
      // while keeping the call sites visible for incremental refactoring.
      // See STATUS.md → KI-24 for the full backlog (25 sites).
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/refs": "warn",

      // Allow short variable names like `e` (event / error) and `_`-prefixed
      // unused args — common in this codebase.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_|^e$",
        },
      ],
    },
  },

  // --- Rule overrides for plain .js files (Node.js scripts) ---
  // CommonJS `require()` is the correct module system for .js files in this
  // repo (no "type": "module" in package.json). The typescript-eslint preset
  // flags `require()` via no-require-imports — disable it for .js only.
  {
    files: ["**/*.js", "*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default config;
