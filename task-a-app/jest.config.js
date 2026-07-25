/**
 * The core sync layer has no React Native dependency, so it runs under plain
 * ts-jest in a Node environment. No jest-expo preset, no native module mocks,
 * no simulator - the tests that matter most are also the fastest to run, which
 * is the practical payoff of keeping src/core free of framework imports.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/core/**/*.ts'],
  coverageThreshold: {
    global: { branches: 80, functions: 85, lines: 85, statements: 85 },
  },
};
