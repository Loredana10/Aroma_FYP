// backend/__mocks__/db.js
// Jest auto-mock for the db module.
// Place this file at:  backend/__mocks__/db.js
//
// Jest automatically uses this file instead of the real db.js whenever
// any module does require('../db') or require('./db') during tests.
// No jest.mock() call needed in the test file.

const mockClient = {
  query:   jest.fn().mockResolvedValue({ rows: [] }),
  release: jest.fn(),
};

const mockPool = {
  query:   jest.fn().mockResolvedValue({ rows: [] }),
  connect: jest.fn().mockResolvedValue(mockClient),
  end:     jest.fn(),
};

module.exports = mockPool;