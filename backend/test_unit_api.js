'use strict';

/**
 * Aroma — Node.js API Unit Tests
 * ================================
 * Tests individual route handlers in isolation using a mocked database.
 * No real database or running server needed.
 *
 * Following the Arrange-Act-Assert (AAA) pattern.
 * Tests cover: happy path, edge cases, boundary conditions,
 *              missing fields, invalid input, and database errors.
 *
 * Setup required (one-time):
 *   backend/__mocks__/db.js  — already created (jest.fn() pool mock)
 *
 * IMPORTANT: jest.mock('./db') is required for local module mocks.
 *   Jest auto-mocks node_modules but NOT local modules — local __mocks__
 *   folders only activate when jest.mock() is called explicitly.
 *
 * Run:  npx jest --verbose --forceExit
 */

// ─── MOCK THE DATABASE ────────────────────────────────────────────────────────
// This MUST be called before any require() that loads a route file.
// For local modules, Jest does NOT automatically use __mocks__ — you must
// explicitly call jest.mock() even if __mocks__/db.js exists.
jest.mock('./db');

const express = require('express');
const request = require('supertest');
const db      = require('./db');

// ─── HELPER ──────────────────────────────────────────────────────────────────

/**
 * Builds a minimal Express app mounting a route file at /api.
 * Clears the require cache so each describe block gets a fresh module load,
 * and resets all mock state before building.
 */
function buildApp(routerPath) {
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


// ═══════════════════════════════════════════════════════════════════════════════
// LOGS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /api/logs ───────────────────────────────────────────────────────────

describe('POST /api/logs — save a new log entry', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/logs'); });
  beforeEach(() => { db.query.mockReset(); });

  // ── Happy path ────────────────────────────────────────────────────────────

  test('returns 201 and log_id when all required fields are provided', async () => {
    // Arrange
    db.query.mockResolvedValue({ rows: [{ log_id: 42 }] });

    // Act
    const res = await request(app)
      .post('/api/logs')
      .send({ user_id: 'user1', drink_id: 3, caffeine_amount: 200 });

    // Assert
    expect(res.status).toBe(201);
    expect(res.body.log_id).toBe(42);
  });

  test('returns 201 with optional context fields (mood, time_of_day, weather)', async () => {
    // Arrange
    db.query.mockResolvedValue({ rows: [{ log_id: 99 }] });

    // Act
    const res = await request(app)
      .post('/api/logs')
      .send({
        user_id:      'user1',
        drink_id:     3,
        caffeine_amount: 150,
        mood:         'Happy',
        time_of_day:  'Morning',
        weather:      'Cold',
      });

    // Assert
    expect(res.status).toBe(201);
    expect(res.body.log_id).toBe(99);
  });

  // ── Missing required fields (invalid input) ───────────────────────────────

  test('returns 400 when user_id is missing', async () => {
    // Arrange — no mock needed (validation happens before DB call)
    // Act
    const res = await request(app)
      .post('/api/logs')
      .send({ drink_id: 3, caffeine_amount: 200 });

    // Assert
    expect(res.status).toBe(400);
  });

  test('returns 400 when drink_id is missing', async () => {
    const res = await request(app)
      .post('/api/logs')
      .send({ user_id: 'user1', caffeine_amount: 200 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when body is completely empty', async () => {
    const res = await request(app)
      .post('/api/logs')
      .send({});
    expect(res.status).toBe(400);
  });

  // ── Database errors ───────────────────────────────────────────────────────

  test('returns 500 when the database throws an error', async () => {
    // Arrange
    db.query.mockRejectedValue(new Error('DB connection failed'));

    // Act
    const res = await request(app)
      .post('/api/logs')
      .send({ user_id: 'user1', drink_id: 3, caffeine_amount: 200 });

    // Assert
    expect(res.status).toBe(500);
  });
});

// ─── GET /api/logs/:user_id ───────────────────────────────────────────────────

describe('GET /api/logs/:user_id — fetch logs for a user', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/logs'); });
  beforeEach(() => { db.query.mockReset(); });

  // ── Happy path ────────────────────────────────────────────────────────────

  test('returns 200 and an array of logs for a user who has logs', async () => {
    // Arrange
    db.query.mockResolvedValue({
      rows: [
        { log_id: 1, drink_name: 'Latte',      caffeine_amount: 200, timestamp: '2025-01-01' },
        { log_id: 2, drink_name: 'Cappuccino',  caffeine_amount: 200, timestamp: '2025-01-02' },
      ]
    });

    // Act
    const res = await request(app).get('/api/logs/user1');

    // Assert
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
  });

  // ── Edge case: user with no logs ──────────────────────────────────────────

  test('returns 200 and an empty array for a user who has no logs', async () => {
    // Arrange
    db.query.mockResolvedValue({ rows: [] });

    // Act
    const res = await request(app).get('/api/logs/new_user');

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // ── Edge case: single log ────────────────────────────────────────────────

  test('returns 200 and an array with one entry when user has exactly one log', async () => {
    // Arrange
    db.query.mockResolvedValue({
      rows: [{ log_id: 1, drink_name: 'Espresso', caffeine_amount: 100, timestamp: '2025-01-01' }]
    });

    // Act
    const res = await request(app).get('/api/logs/user_one_log');

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  // ── Database error ────────────────────────────────────────────────────────

  test('returns 500 when the database throws a timeout error', async () => {
    // Arrange
    db.query.mockRejectedValue(new Error('Timeout'));

    // Act
    const res = await request(app).get('/api/logs/user1');

    // Assert
    expect(res.status).toBe(500);
  });
});

// ─── DELETE /api/logs/:log_id ─────────────────────────────────────────────────

describe('DELETE /api/logs/:log_id — delete a log entry', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/logs'); });
  beforeEach(() => { db.query.mockReset(); });

  // ── Happy path ────────────────────────────────────────────────────────────

  test('returns 200 when the log exists and is successfully deleted', async () => {
    // Arrange
    db.query.mockResolvedValue({ rowCount: 1 });

    // Act
    const res = await request(app).delete('/api/logs/5');

    // Assert
    expect(res.status).toBe(200);
  });

  // ── Edge case: log does not exist ────────────────────────────────────────

  test('returns 404 when the log_id does not exist in the database', async () => {
    // Arrange
    db.query.mockResolvedValue({ rowCount: 0 });

    // Act
    const res = await request(app).delete('/api/logs/999');

    // Assert
    expect(res.status).toBe(404);
  });

  // ── Database error ────────────────────────────────────────────────────────

  test('returns 500 when the database throws an error during delete', async () => {
    // Arrange
    db.query.mockRejectedValue(new Error('DB error'));

    // Act
    const res = await request(app).delete('/api/logs/5');

    // Assert
    expect(res.status).toBe(500);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// RATINGS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /api/ratings ────────────────────────────────────────────────────────

describe('POST /api/ratings — save or update a rating', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/ratings'); });
  beforeEach(() => { db.query.mockReset(); });

  // ── Happy path ────────────────────────────────────────────────────────────

  test('returns 200 on a successful upsert with all required fields', async () => {
    // Arrange
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ rating_id: 7 }] });

    // Act
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2, star_rating: 4, log_id: 10 });

    // Assert
    expect(res.status).toBe(200);
  });

  test('returns 200 when star_rating is at the minimum valid value (1)', async () => {
    // Arrange — boundary: 1 star is the lowest valid rating
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ rating_id: 8 }] });

    // Act
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2, star_rating: 1, log_id: 11 });

    // Assert
    expect(res.status).toBe(200);
  });

  test('returns 200 when star_rating is at the maximum valid value (5)', async () => {
    // Arrange — boundary: 5 stars is the highest valid rating
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ rating_id: 9 }] });

    // Act
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2, star_rating: 5, log_id: 12 });

    // Assert
    expect(res.status).toBe(200);
  });

  // ── Missing required fields ───────────────────────────────────────────────

  test('returns 400 when star_rating is missing from the request body', async () => {
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when user_id is missing from the request body', async () => {
    const res = await request(app)
      .post('/api/ratings')
      .send({ drink_id: 2, star_rating: 4 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when drink_id is missing from the request body', async () => {
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', star_rating: 4 });
    expect(res.status).toBe(400);
  });

  // ── Boundary / invalid star_rating values ─────────────────────────────────

  test('returns 400 when star_rating is above the maximum (6)', async () => {
    // Arrange — boundary: 6 is one above the max valid value of 5
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2, star_rating: 6 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when star_rating is zero (below minimum of 1)', async () => {
    // Arrange — boundary: 0 is one below the min valid value of 1
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2, star_rating: 0 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when star_rating is a negative number', async () => {
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2, star_rating: -1 });
    expect(res.status).toBe(400);
  });

  // ── Database error ────────────────────────────────────────────────────────

  test('returns 500 when the database throws an error during upsert', async () => {
    // Arrange
    db.query.mockRejectedValue(new Error('DB error'));

    // Act
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2, star_rating: 4, log_id: 10 });

    // Assert
    expect(res.status).toBe(500);
  });
});

// ─── GET /api/ratings/user/:user_id ──────────────────────────────────────────

describe('GET /api/ratings/user/:user_id — fetch all ratings for a user', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/ratings'); });
  beforeEach(() => { db.query.mockReset(); });

  // ── Happy path ────────────────────────────────────────────────────────────

  test('returns 200 and a ratings array for a user who has ratings', async () => {
    // Arrange
    db.query.mockResolvedValue({
      rows: [
        { drink_id: 1, star_rating: 5, log_id: 10 },
        { drink_id: 2, star_rating: 3, log_id: null },
      ]
    });

    // Act
    const res = await request(app).get('/api/ratings/user/u1');

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  // ── Edge case: user with no ratings ──────────────────────────────────────

  test('returns 200 and an empty array for a user with no ratings', async () => {
    // Arrange
    db.query.mockResolvedValue({ rows: [] });

    // Act
    const res = await request(app).get('/api/ratings/user/new_user');

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // ── Database error ────────────────────────────────────────────────────────

  test('returns 500 when the database throws an error', async () => {
    // Arrange
    db.query.mockRejectedValue(new Error('DB error'));

    // Act
    const res = await request(app).get('/api/ratings/user/u1');

    // Assert
    expect(res.status).toBe(500);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/statistics/user/:user_id ───────────────────────────────────────

describe('GET /api/statistics/user/:user_id — personal stats', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/statistics'); });
  beforeEach(() => { db.query.mockReset(); });

  // ── Happy path ────────────────────────────────────────────────────────────

  test('returns 200 and a stats object with all required fields', async () => {
    // Arrange
    db.query.mockResolvedValue({ rows: [] });

    // Act
    const res = await request(app).get('/api/statistics/user/u1');

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('caffeine_by_day');
    expect(res.body).toHaveProperty('total_drinks_this_week');
    expect(res.body).toHaveProperty('most_logged_drink');
  });

  // ── Edge case: user with no data ─────────────────────────────────────────

  test('returns 200 with zeroed/empty stats for a user who has no logs', async () => {
    // Arrange — all queries return empty rows
    db.query.mockResolvedValue({ rows: [] });

    // Act
    const res = await request(app).get('/api/statistics/user/brand_new_user');

    // Assert — should still return the shape, not an error
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('caffeine_by_day');
    expect(res.body).toHaveProperty('total_drinks_this_week');
  });

  // ── Database error ────────────────────────────────────────────────────────

  test('returns 500 when the database throws an error', async () => {
    // Arrange
    db.query.mockRejectedValue(new Error('DB error'));

    // Act
    const res = await request(app).get('/api/statistics/user/u1');

    // Assert
    expect(res.status).toBe(500);
  });
});

// ─── GET /api/statistics/community ───────────────────────────────────────────

describe('GET /api/statistics/community — community stats', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/statistics'); });
  beforeEach(() => { db.query.mockReset(); });

  // ── Happy path ────────────────────────────────────────────────────────────

  test('returns 200 and community stats with all required fields', async () => {
    // Arrange
    db.query.mockResolvedValue({ rows: [] });

    // Act
    const res = await request(app).get('/api/statistics/community');

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total_community_logs');
    expect(res.body).toHaveProperty('most_popular_drink');
    expect(res.body).toHaveProperty('top_rated_drinks');
  });

  // ── Database error ────────────────────────────────────────────────────────

  test('returns 500 when the database throws an error', async () => {
    // Arrange
    db.query.mockRejectedValue(new Error('DB error'));

    // Act
    const res = await request(app).get('/api/statistics/community');

    // Assert
    expect(res.status).toBe(500);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// RECOMMENDATIONS
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/recommendations — input validation', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/recommendations'); });
  beforeEach(() => { db.query.mockReset(); });

  // ── Missing required fields (invalid input) ───────────────────────────────

  test('returns 400 when user_id is missing from the request body', async () => {
    // Arrange — user_id is the only required field for the Node.js route
    // Act
    const res = await request(app)
      .post('/api/recommendations')
      .send({ mood: 'Morning' });

    // Assert
    expect(res.status).toBe(400);
  });

  test('returns 400 when the request body is completely empty', async () => {
    const res = await request(app)
      .post('/api/recommendations')
      .send({});
    expect(res.status).toBe(400);
  });

  test('returns 400 when user_id is an empty string', async () => {
    // Arrange — boundary: empty string is not a valid user_id
    const res = await request(app)
      .post('/api/recommendations')
      .send({ user_id: '' });
    expect(res.status).toBe(400);
  });
});