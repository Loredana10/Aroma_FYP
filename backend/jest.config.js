// backend/jest.config.js
// Place this file in your backend/ folder alongside test_unit_api.js
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
};