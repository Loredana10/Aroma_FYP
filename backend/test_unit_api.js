/**
 * Aroma — Node.js API Unit Tests
 * ================================
 * Tests Express route handlers in isolation with a fully mocked DB.
 * No real database or running server needed.
 *
 * Run:  npx jest --verbose --forceExit
 *
 * The core challenge: logs.js and recommendations.js run DB calls at the
 * top level when first require()d (schema migration queries). We solve this
 * by intercepting require() via Module._resolveFilename so that any require
 * for './db' or '../db' inside a route file gets our mock object instead of
 * the real pg pool — before a single line of the route file executes.
 */

'use strict';

const express = require('express');
const request = require('supertest');
const Module  = require('module');

// ─── SHARED MOCK DB ───────────────────────────────────────────────────────────

const mockClient = {
  query:   jest.fn().mockResolvedValue({ rows: [] }),
  release: jest.fn(),
};

const mockDb = {
  query:   jest.fn(),
  connect: jest.fn().mockResolvedValue(mockClient),
};

// ─── REQUIRE INTERCEPTOR ──────────────────────────────────────────────────────
// Patch Node's module loader so that any file that does require('./db') or
// require('../db') gets mockDb instead of the real pg pool.
// This runs BEFORE the route file's top-level code, so the migration
// query at line 12 of logs.js gets mockDb.query (a jest.fn) not undefined.

const _origLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === './db' || request === '../db') {
    return mockDb;
  }
  return _origLoad.apply(this, arguments);
};

// ─── HELPER ───────────────────────────────────────────────────────────────────

function buildApp(routerPath) {
  // Clear require cache so each describe block gets a fresh route load
  Object.keys(require.cache).forEach(key => {
    if (key.includes('routes/') || key.includes('routes\\')) {
      delete require.cache[key];
    }
  });
  mockDb.query.mockReset();
  mockDb.connect.mockResolvedValue(mockClient);
  mockClient.query.mockResolvedValue({ rows: [] });

  const router = require(routerPath);
  const app    = express();
  app.use(express.json());
  app.use('/api', router);
  return app;
}

// ─── LOGS ─────────────────────────────────────────────────────────────────────

describe('POST /api/logs — save a new log entry', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/logs'); });
  beforeEach(() => { mockDb.query.mockReset(); });

  test('returns 201 and log_id on success', async () => {
    mockDb.query.mockResolvedValue({ rows: [{ log_id: 42 }] });
    const res = await request(app)
      .post('/api/logs')
      .send({ user_id: 'user1', drink_id: 3, caffeine_amount: 200 });
    expect(res.status).toBe(201);
    expect(res.body.log_id).toBe(42);
  });

  test('returns 400 when user_id is missing', async () => {
    const res = await request(app)
      .post('/api/logs')
      .send({ drink_id: 3, caffeine_amount: 200 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when drink_id is missing', async () => {
    const res = await request(app)
      .post('/api/logs')
      .send({ user_id: 'user1', caffeine_amount: 200 });
    expect(res.status).toBe(400);
  });

  test('returns 500 on database error', async () => {
    mockDb.query.mockRejectedValue(new Error('DB connection failed'));
    const res = await request(app)
      .post('/api/logs')
      .send({ user_id: 'user1', drink_id: 3, caffeine_amount: 200 });
    expect(res.status).toBe(500);
  });
});

describe('GET /api/logs/:user_id — fetch logs for a user', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/logs'); });
  beforeEach(() => { mockDb.query.mockReset(); });

  test('returns logs array on success', async () => {
    mockDb.query.mockResolvedValue({
      rows: [
        { log_id: 1, drink_name: 'Latte',     caffeine_amount: 200, timestamp: '2025-01-01' },
        { log_id: 2, drink_name: 'Cappuccino', caffeine_amount: 200, timestamp: '2025-01-02' },
      ]
    });
    const res = await request(app).get('/api/logs/user1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
  });

  test('returns empty array when user has no logs', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/logs/new_user');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns 500 on database error', async () => {
    mockDb.query.mockRejectedValue(new Error('Timeout'));
    const res = await request(app).get('/api/logs/user1');
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/logs/:log_id — delete a log entry', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/logs'); });
  beforeEach(() => { mockDb.query.mockReset(); });

  test('returns 200 on successful delete', async () => {
    mockDb.query.mockResolvedValue({ rowCount: 1 });
    const res = await request(app).delete('/api/logs/5');
    expect(res.status).toBe(200);
  });

  test('returns 404 when log_id does not exist', async () => {
    mockDb.query.mockResolvedValue({ rowCount: 0 });
    const res = await request(app).delete('/api/logs/999');
    expect(res.status).toBe(404);
  });
});

// ─── RATINGS ──────────────────────────────────────────────────────────────────

describe('POST /api/ratings — save or update a rating', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/ratings'); });
  beforeEach(() => { mockDb.query.mockReset(); });

  test('returns 200 on successful upsert', async () => {
    mockDb.query
      .mockResolvedValueOnce({ rows: [] })              // check existing → none
      .mockResolvedValueOnce({ rows: [{ rating_id: 7 }] }); // INSERT
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2, star_rating: 4, log_id: 10 });
    expect(res.status).toBe(200);
  });

  test('returns 400 when star_rating is missing', async () => {
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when star_rating is out of range (6)', async () => {
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2, star_rating: 6 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when star_rating is zero', async () => {
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2, star_rating: 0 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/ratings/user/:user_id — fetch all ratings for a user', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/ratings'); });
  beforeEach(() => { mockDb.query.mockReset(); });

  test('returns ratings array', async () => {
    mockDb.query.mockResolvedValue({
      rows: [
        { drink_id: 1, star_rating: 5, log_id: 10 },
        { drink_id: 2, star_rating: 3, log_id: null },
      ]
    });
    const res = await request(app).get('/api/ratings/user/u1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  test('returns empty array for user with no ratings', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/ratings/user/new_user');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ─── STATISTICS ───────────────────────────────────────────────────────────────

describe('GET /api/statistics/user/:user_id — personal stats', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/statistics'); });
  beforeEach(() => { mockDb.query.mockReset(); });

  test('returns stats object with required fields', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/statistics/user/u1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('caffeine_by_day');
    expect(res.body).toHaveProperty('total_drinks_this_week');
    expect(res.body).toHaveProperty('most_logged_drink');
  });

  test('returns 500 on database error', async () => {
    mockDb.query.mockRejectedValue(new Error('DB error'));
    const res = await request(app).get('/api/statistics/user/u1');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/statistics/community — community stats', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/statistics'); });
  beforeEach(() => { mockDb.query.mockReset(); });

  test('returns community stats with required fields', async () => {
    mockDb.query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/statistics/community');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total_community_logs');
    expect(res.body).toHaveProperty('most_popular_drink');
    expect(res.body).toHaveProperty('top_rated_drinks');
  });
});

// ─── RECOMMENDATIONS ──────────────────────────────────────────────────────────

describe('POST /api/recommendations — missing user_id returns 400', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/recommendations'); });
  beforeEach(() => { mockDb.query.mockReset(); });

  test('returns 400 when user_id is missing', async () => {
    const res = await request(app)
      .post('/api/recommendations')
      .send({ mood: 'Morning' });
    expect(res.status).toBe(400);
  });
});