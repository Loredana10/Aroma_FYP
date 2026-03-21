/**
 * Aroma — Node.js API Unit Tests
 * ================================
 * No real database or running server needed.
 *
 * Setup required (one-time):
 *   Create backend/__mocks__/db.js  (provided alongside this file)
 *
 * Run:  npx jest --verbose --forceExit
 *
 * How the mock works:
 *   Jest's manual mock system automatically replaces require('./db') and
 *   require('../db') with backend/__mocks__/db.js before any test runs.
 *   This means even route files that call db.query() at the top level
 *   (like logs.js migration) get the mock pool, not a real pg connection.
 */

'use strict';

const express = require('express');
const request = require('supertest');

// Get the mock pool (populated by __mocks__/db.js)
const db = require('./db');

// ─── HELPER ───────────────────────────────────────────────────────────────────

function buildApp(routerPath) {
  // Clear route from require cache so each describe gets a fresh module load
  Object.keys(require.cache).forEach(key => {
    if (key.includes('routes/') || key.includes('routes\\')) {
      delete require.cache[key];
    }
  });
  db.query.mockReset();
  db.connect.mockResolvedValue({
    query:   jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
  });
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
  beforeEach(() => { db.query.mockReset(); });

  test('returns 201 and log_id on success', async () => {
    db.query.mockResolvedValue({ rows: [{ log_id: 42 }] });
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
    db.query.mockRejectedValue(new Error('DB connection failed'));
    const res = await request(app)
      .post('/api/logs')
      .send({ user_id: 'user1', drink_id: 3, caffeine_amount: 200 });
    expect(res.status).toBe(500);
  });
});

describe('GET /api/logs/:user_id — fetch logs for a user', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/logs'); });
  beforeEach(() => { db.query.mockReset(); });

  test('returns logs array on success', async () => {
    db.query.mockResolvedValue({
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
    db.query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/logs/new_user');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns 500 on database error', async () => {
    db.query.mockRejectedValue(new Error('Timeout'));
    const res = await request(app).get('/api/logs/user1');
    expect(res.status).toBe(500);
  });
});

describe('DELETE /api/logs/:log_id — delete a log entry', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/logs'); });
  beforeEach(() => { db.query.mockReset(); });

  test('returns 200 on successful delete', async () => {
    db.query.mockResolvedValue({ rowCount: 1 });
    const res = await request(app).delete('/api/logs/5');
    expect(res.status).toBe(200);
  });

  test('returns 404 when log_id does not exist', async () => {
    db.query.mockResolvedValue({ rowCount: 0 });
    const res = await request(app).delete('/api/logs/999');
    expect(res.status).toBe(404);
  });
});

// ─── RATINGS ──────────────────────────────────────────────────────────────────

describe('POST /api/ratings — save or update a rating', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/ratings'); });
  beforeEach(() => { db.query.mockReset(); });

  test('returns 200 on successful upsert', async () => {
    db.query
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
  beforeEach(() => { db.query.mockReset(); });

  test('returns ratings array', async () => {
    db.query.mockResolvedValue({
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
    db.query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/ratings/user/new_user');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ─── STATISTICS ───────────────────────────────────────────────────────────────

describe('GET /api/statistics/user/:user_id — personal stats', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/statistics'); });
  beforeEach(() => { db.query.mockReset(); });

  test('returns stats object with required fields', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/api/statistics/user/u1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('caffeine_by_day');
    expect(res.body).toHaveProperty('total_drinks_this_week');
    expect(res.body).toHaveProperty('most_logged_drink');
  });

  test('returns 500 on database error', async () => {
    db.query.mockRejectedValue(new Error('DB error'));
    const res = await request(app).get('/api/statistics/user/u1');
    expect(res.status).toBe(500);
  });
});

describe('GET /api/statistics/community — community stats', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/statistics'); });
  beforeEach(() => { db.query.mockReset(); });

  test('returns community stats with required fields', async () => {
    db.query.mockResolvedValue({ rows: [] });
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
  beforeEach(() => { db.query.mockReset(); });

  test('returns 400 when user_id is missing', async () => {
    const res = await request(app)
      .post('/api/recommendations')
      .send({ mood: 'Morning' });
    expect(res.status).toBe(400);
  });
});