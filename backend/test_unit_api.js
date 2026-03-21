/**
 * Aroma — Node.js API Unit Tests
 * ================================
 * Tests Express route handlers in isolation with a fully mocked DB.
 * No real database or running server needed.
 *
 * Run:  npx jest --verbose
 *
 * KEY FIX: route files that run top-level DB calls (migrations) at require()
 * time need the mock set up BEFORE the module is loaded.  We use
 * jest.isolateModules() so each describe block gets a fresh require with the
 * mock already in place, preventing the "Cannot read properties of undefined
 * (reading 'catch')" crash.
 */

'use strict';

const express  = require('express');
const request  = require('supertest');

// ─── DB MOCK ──────────────────────────────────────────────────────────────────
// Must be declared before any require() that touches db.js

jest.mock('./db', () => {
  const mockQuery = jest.fn();
  // pool.connect() is used by recommendations.js migration — return a mock client
  const mockClient = {
    query:   jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
  };
  return {
    query:   mockQuery,
    connect: jest.fn().mockResolvedValue(mockClient),
  };
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function buildApp(routerPath) {
  let router;
  // Use isolateModules so each route file gets a fresh load with mock already set
  jest.isolateModules(() => {
    router = require(routerPath);
  });
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  return app;
}

function getDb() {
  return require('./db');
}

// ─── LOGS ─────────────────────────────────────────────────────────────────────

describe('POST /api/logs — save a new log entry', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/logs'); });
  beforeEach(() => { getDb().query.mockReset(); });

  test('returns 201 and log_id on success', async () => {
    getDb().query.mockResolvedValue({ rows: [{ log_id: 42 }] });
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
    getDb().query.mockRejectedValue(new Error('DB connection failed'));
    const res = await request(app)
      .post('/api/logs')
      .send({ user_id: 'user1', drink_id: 3, caffeine_amount: 200 });
    expect(res.status).toBe(500);
  });
});

describe('GET /api/logs/:user_id — fetch logs for a user', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/logs'); });
  beforeEach(() => { getDb().query.mockReset(); });

  test('returns logs array on success', async () => {
    getDb().query.mockResolvedValue({
      rows: [
        { log_id: 1, drink_name: 'Latte',      caffeine_amount: 200, timestamp: '2025-01-01' },
        { log_id: 2, drink_name: 'Cappuccino',  caffeine_amount: 200, timestamp: '2025-01-02' },
      ]
    });
    const res = await request(app).get('/api/logs/user1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
  });

  test('returns empty array when user has no logs', async () => {
    getDb().query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/logs/new_user');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns 500 on database error', async () => {
    getDb().query.mockRejectedValue(new Error('Timeout'));
    const res = await request(app).get('/api/logs/user1');
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/logs/:log_id — delete a log entry', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/logs'); });
  beforeEach(() => { getDb().query.mockReset(); });

  test('returns 200 on successful delete', async () => {
    getDb().query.mockResolvedValue({ rowCount: 1 });
    const res = await request(app).delete('/api/logs/5');
    expect(res.status).toBe(200);
  });

  test('returns 404 when log_id does not exist', async () => {
    getDb().query.mockResolvedValue({ rowCount: 0 });
    const res = await request(app).delete('/api/logs/999');
    expect(res.status).toBe(404);
  });
});

// ─── RATINGS ──────────────────────────────────────────────────────────────────

describe('POST /api/ratings — save or update a rating', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/ratings'); });
  beforeEach(() => { getDb().query.mockReset(); });

  test('returns 200 on successful upsert (no existing rating)', async () => {
    // First call: check existing → none; second call: INSERT
    getDb().query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ rating_id: 7 }] });
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
  beforeEach(() => { getDb().query.mockReset(); });

  test('returns ratings array', async () => {
    getDb().query.mockResolvedValue({
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
    getDb().query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/ratings/user/new_user');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ─── STATISTICS ───────────────────────────────────────────────────────────────
// Field names match what your actual statistics.js route returns:
//   total_drinks_this_week  (not total_drinks)
//   total_community_logs    (not total_logs)

describe('GET /api/statistics/user/:user_id — personal stats', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/statistics'); });
  beforeEach(() => { getDb().query.mockReset(); });

  test('returns stats object with required fields', async () => {
    // statistics.js makes multiple queries — mock them all to succeed
    getDb().query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/statistics/user/u1');
    expect(res.status).toBe(200);
    // Check for the field names your route actually returns
    expect(res.body).toHaveProperty('caffeine_by_day');
    expect(res.body).toHaveProperty('total_drinks_this_week');
    expect(res.body).toHaveProperty('most_logged_drink');
  });

  test('returns 500 on database error', async () => {
    getDb().query.mockRejectedValue(new Error('DB error'));
    const res = await request(app).get('/api/statistics/user/u1');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/statistics/community — community stats', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/statistics'); });
  beforeEach(() => { getDb().query.mockReset(); });

  test('returns community stats object with required fields', async () => {
    getDb().query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/statistics/community');
    expect(res.status).toBe(200);
    // Check for the field names your route actually returns
    expect(res.body).toHaveProperty('total_community_logs');
    expect(res.body).toHaveProperty('most_popular_drink');
    expect(res.body).toHaveProperty('top_rated_drinks');
  });
});

// ─── RECOMMENDATIONS PROXY ────────────────────────────────────────────────────

describe('POST /api/recommendations — missing user_id returns 400', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/recommendations'); });
  beforeEach(() => { getDb().query.mockReset(); });

  test('returns 400 when user_id is missing', async () => {
    const res = await request(app)
      .post('/api/recommendations')
      .send({ mood: 'Morning' });
    expect(res.status).toBe(400);
  });
});