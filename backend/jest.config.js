// backend/jest.config.js
// Jest configuration for the backend tests.
// This file tells Jest how to run the tests, where to find them, and which files to ignore.
// It also specifies that we want to collect coverage information from our route handler files.
module.exports = {
  testEnvironment: 'node',
  testTimeout:     30000,
  verbose:         true,
  // Match any file starting with "test_" so Jest finds test_unit_api.js
  testMatch: [
    '**/test_*.js',
    '**/*.test.js',
    '**/*.spec.js',
  ],
  // Never look inside node_modules
  testPathIgnorePatterns: ['/node_modules/'],

  collectCoverageFrom: [
    'routes/logs.js',
    'routes/ratings.js',
    'routes/statistics.js',
    'routes/recommendations.js',
    'routes/drinks.js',
    'routes/users.js',
  ],
};