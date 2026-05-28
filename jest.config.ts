import type { Config } from "jest";

const config: Config = {
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    // CSS / image / static imports — return empty stubs
    "^.+\\.(css|less|scss|sass)$": "<rootDir>/src/__mocks__/style.js",
    "^.+\\.(png|jpg|jpeg|gif|svg|ico|webp)$": "<rootDir>/src/__mocks__/file.js",
  },
  testPathIgnorePatterns: [
    "<rootDir>/node_modules/",
    "<rootDir>/.next/",
    "<rootDir>/src/__tests__/test-utils.tsx",
    "<rootDir>/src/__mocks__/",
    "<rootDir>/e2e/",
  ],
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest",
  },
  transformIgnorePatterns: [
    "/node_modules/(?!(lucide-react)/)",
  ],
};

export default config;
