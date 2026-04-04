'use strict';

/**
 * Aroma — Node.js API Unit Tests
 * ================================
 * Tests individual route handlers in isolation using a mocked database.
 * No real database or running server needed.
 *
 * Following the Arrange-Act-Assert (AAA) pattern.
 * Tests cover: happy path, edge cases, boundary conditions,
 *              missing fields, invalid input, type errors, null input,
 *              and database errors — following slide 12 guidance on
 *              what AI-generated tests frequently miss.
 *
 * Run:  npx jest --verbose --forceExit
 */

// ─── MOCK THE DATABASE ────────────────────────────────────────────────────────
// Must be called before any require() that loads a route file.
// For local modules, Jest does NOT automatically use __mocks__ — you must
// call jest.mock() explicitly even if __mocks__/db.js exists.
jest.mock('./db');

const express = require('express');
const request = require('supertest');
const db      = require('./db');

// ─── HELPER ──────────────────────────────────────────────────────────────────

/**
 * Builds a minimal Express app mounting a route file at /api.
 *
 * Key points:
 *  - Sets a default resolved value BEFORE clearing the require cache.
 *    This is critical for logs.js which calls pool.query() at the top level
 *    (the ALTER TABLE migration). If the mock has no return value at that
 *    moment, it returns undefined and .catch() crashes.
 *  - Clears the route module from require cache so each describe block
 *    gets a fresh module load.
 */
function buildApp(routerPath) {
  // Set default BEFORE clearing cache so top-level pool.query() in logs.js
  // always gets a valid Promise and never throws on .catch().
  db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  db.connect.mockResolvedValue({
    query:   jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
  });

  Object.keys(require.cache).forEach(key => {
    if (key.includes('routes/') || key.includes('routes\\')) {
      delete require.cache[key];
    }
  });

  const router = require(routerPath);
  const app    = express();
  app.use(express.json());
  // Derive mount path from filename so routes match the real server layout.
  // e.g. './routes/logs' → '/api/logs', matching how server.js mounts them.
  const routeName = routerPath.replace('./routes/', '').replace(/.js$/, '');
  app.use('/api/' + routeName, router);
  return app;
}


// ═══════════════════════════════════════════════════════════════════════════════
// LOGS
// Actual route behaviour (logs.js):
//   POST /           → 201 on success | 400 if user_id or drink_id missing | 500 on DB error
//   GET  /:user_id   → 200 + array (empty array if no logs) | 500 on DB error
//   DELETE /:log_id  → 200 always (route does not check rowCount — no 404)
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/logs — save a new log entry', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/logs'); });
  beforeEach(() => {
    // Restore default after each test so the mock always returns a Promise
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  test('returns 201 and the saved log row when all required fields are provided', async () => {
    // Arrange
    db.query.mockResolvedValue({ rows: [{ log_id: 42, drink_id: 3, user_id: 'user1' }] });

    // Act
    const res = await request(app)
      .post('/api/logs')
      .send({ user_id: 'user1', drink_id: 3, caffeine_amount: 200 });

    // Assert
    expect(res.status).toBe(201);
    expect(res.body.log_id).toBe(42);
  });

  test('returns 201 when optional context fields are included (mood, time_of_day, weather)', async () => {
    // Arrange
    db.query.mockResolvedValue({ rows: [{ log_id: 99 }] });

    // Act
    const res = await request(app)
      .post('/api/logs')
      .send({
        user_id:         'user1',
        drink_id:        3,
        caffeine_amount: 150,
        mood:            'Happy',
        time_of_day:     'Morning',
        weather:         'Cold',
      });

    // Assert
    expect(res.status).toBe(201);
    expect(res.body.log_id).toBe(99);
  });

  // ── Missing required fields (invalid input) ───────────────────────────────

  test('returns 400 when user_id is missing', async () => {
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

  test('returns 400 when the request body is completely empty', async () => {
    const res = await request(app)
      .post('/api/logs')
      .send({});
    expect(res.status).toBe(400);
  });

  // ── Type errors (slide 12: what AI frequently misses) ─────────────────────

  test('returns 201 when drink_id is a string — falsy check passes, pg coerces it', async () => {
    // Arrange — !drink_id only checks falsy, so the string '3' passes validation
    db.query.mockResolvedValue({ rows: [{ log_id: 55 }] });
    // Act
    const res = await request(app)
      .post('/api/logs')
      .send({ user_id: 'user1', drink_id: '3', caffeine_amount: 200 });
    // Assert — documents that string coercion succeeds end-to-end
    expect(res.status).toBe(201);
  });

  test('returns 400 when user_id is numeric zero (falsy — treated as missing)', async () => {
    // Arrange — !0 is true, so the route rejects numeric zero the same as undefined
    const res = await request(app)
      .post('/api/logs')
      .send({ user_id: 0, drink_id: 3, caffeine_amount: 200 });
    // Assert
    expect(res.status).toBe(400);
  });

  // ── Null input (slide 12: what AI frequently misses) ─────────────────────

  test('returns 400 when user_id is explicitly null', async () => {
    // Arrange — null is falsy so !null is true — treated the same as missing
    const res = await request(app)
      .post('/api/logs')
      .send({ user_id: null, drink_id: 3, caffeine_amount: 200 });
    // Assert
    expect(res.status).toBe(400);
  });

  test('returns 400 when drink_id is explicitly null', async () => {
    // Arrange — null is falsy — validation rejects it
    const res = await request(app)
      .post('/api/logs')
      .send({ user_id: 'user1', drink_id: null, caffeine_amount: 200 });
    // Assert
    expect(res.status).toBe(400);
  });

  // ── Database error ────────────────────────────────────────────────────────

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


describe('GET /api/logs/:user_id — fetch logs for a user', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/logs'); });
  beforeEach(() => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  test('returns 200 and an array of logs for a user who has logs', async () => {
    // Arrange
    db.query.mockResolvedValue({
      rows: [
        { log_id: 1, drink_name: 'Latte',     caffeine_amount: 200, timestamp: '2025-01-01' },
        { log_id: 2, drink_name: 'Cappuccino', caffeine_amount: 200, timestamp: '2025-01-02' },
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

  // ── Edge case: exactly one log ────────────────────────────────────────────

  test('returns 200 and a single-item array when user has exactly one log', async () => {
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

  test('returns 500 when the database throws an error', async () => {
    // Arrange
    db.query.mockRejectedValue(new Error('Timeout'));

    // Act
    const res = await request(app).get('/api/logs/user1');

    // Assert
    expect(res.status).toBe(500);
  });
});


describe('DELETE /api/logs/:log_id — delete a log entry', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/logs'); });
  beforeEach(() => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  test('returns 200 when a log is successfully deleted', async () => {
    // Arrange
    db.query.mockResolvedValue({ rowCount: 1 });

    // Act
    const res = await request(app).delete('/api/logs/5');

    // Assert
    expect(res.status).toBe(200);
  });

  // ── Known limitation: non-existent log_id ────────────────────────────────
  // The DELETE route in logs.js does not check rowCount after the query,
  // so it returns 200 whether or not the log_id existed in the database.
  // This is a known gap in the route — ideally it should return 404 when
  // rowCount is 0. This test documents the CURRENT behaviour accurately
  // so that if the route is later improved, this test will catch the change.

  test('returns 200 even when log_id does not exist in the database (known route limitation — does not check rowCount)', async () => {
    // Arrange — DB reports zero rows deleted, but route ignores this
    db.query.mockResolvedValue({ rowCount: 0 });

    // Act
    const res = await request(app).delete('/api/logs/999');

    // Assert — documents current behaviour; ideally this should be 404
    expect(res.status).toBe(200);
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
// Actual route behaviour (ratings.js):
//   POST /              → 201 on success (both insert paths and update path)
//                         400 if user_id, drink_id, or star_rating is missing/falsy
//                         500 on DB error
//   GET  /user/:user_id → 200 + array | 500 on DB error
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/ratings — save or update a rating', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/ratings'); });
  beforeEach(() => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  test('returns 201 when a new rating is inserted (no existing rating for this log)', async () => {
    // Arrange — first query finds no existing rating, second inserts
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ rating_id: 7, star_rating: 4 }] });

    // Act
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2, star_rating: 4, log_id: 10 });

    // Assert
    expect(res.status).toBe(201);
  });

  test('returns 201 when an existing rating for this log is updated', async () => {
    // Arrange — first query finds an existing rating, second updates it
    db.query
      .mockResolvedValueOnce({ rows: [{ rating_id: 5 }] })
      .mockResolvedValueOnce({ rows: [{ rating_id: 5, star_rating: 3 }] });

    // Act
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2, star_rating: 3, log_id: 10 });

    // Assert
    expect(res.status).toBe(201);
  });

  test('returns 201 via the fallback path when no log_id is provided', async () => {
    // Arrange — no log_id means route skips the lookup and inserts directly
    db.query.mockResolvedValueOnce({ rows: [{ rating_id: 8, star_rating: 5 }] });

    // Act
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2, star_rating: 5 });

    // Assert
    expect(res.status).toBe(201);
  });

  // ── Boundary: valid star_rating extremes ──────────────────────────────────

  test('returns 201 when star_rating is 1 (minimum valid value)', async () => {
    // Arrange — boundary: 1 is the lowest rating a user can give
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ rating_id: 9, star_rating: 1 }] });

    // Act
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2, star_rating: 1, log_id: 11 });

    // Assert
    expect(res.status).toBe(201);
  });

  test('returns 201 when star_rating is 5 (maximum valid value)', async () => {
    // Arrange — boundary: 5 is the highest rating a user can give
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ rating_id: 10, star_rating: 5 }] });

    // Act
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2, star_rating: 5, log_id: 12 });

    // Assert
    expect(res.status).toBe(201);
  });

  // ── Missing / falsy required fields ──────────────────────────────────────

  test('returns 400 when star_rating is missing', async () => {
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when user_id is missing', async () => {
    const res = await request(app)
      .post('/api/ratings')
      .send({ drink_id: 2, star_rating: 4 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when drink_id is missing', async () => {
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', star_rating: 4 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when star_rating is 0 (falsy — treated as missing by the route)', async () => {
    // Boundary note: !0 is true in JS, so the route treats 0 the same as missing
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2, star_rating: 0 });
    expect(res.status).toBe(400);
  });

  // ── Type errors (slide 12: what AI frequently misses) ─────────────────────

  test('returns 201 when star_rating is sent as the string "4" instead of a number', async () => {
    // Arrange — !'4' is false so validation passes; pg coerces '4' to integer
    db.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ rating_id: 20, star_rating: 4 }] });
    // Act
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2, star_rating: '4', log_id: 13 });
    // Assert — documents that string coercion passes validation and succeeds
    expect(res.status).toBe(201);
  });

  test('returns 400 when drink_id is sent as numeric zero (falsy — treated as missing)', async () => {
    // Arrange — !0 is true so the route treats drink_id: 0 as missing
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 0, star_rating: 4 });
    // Assert
    expect(res.status).toBe(400);
  });

  // ── Null input (slide 12: what AI frequently misses) ─────────────────────

  test('returns 400 when star_rating is explicitly null', async () => {
    // Arrange — null is falsy so !null is true — treated the same as missing
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: 'u1', drink_id: 2, star_rating: null });
    // Assert
    expect(res.status).toBe(400);
  });

  test('returns 400 when user_id is explicitly null', async () => {
    // Arrange — null is falsy — validation rejects it
    const res = await request(app)
      .post('/api/ratings')
      .send({ user_id: null, drink_id: 2, star_rating: 4 });
    // Assert
    expect(res.status).toBe(400);
  });

  // ── Database error ────────────────────────────────────────────────────────

  test('returns 500 when the database throws an error', async () => {
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


describe('GET /api/ratings/user/:user_id — fetch all ratings for a user', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/ratings'); });
  beforeEach(() => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

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
// Actual route behaviour (statistics.js):
//   GET /user/:user_id → 200 + stats object | 500 on DB error
//   GET /community     → 200 + stats object | 500 on DB error
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/statistics/user/:user_id — personal stats', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/statistics'); });
  beforeEach(() => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  test('returns 200 and a stats object with all required fields', async () => {
    // Arrange — statistics route runs 3 sequential queries; all return empty rows
    db.query.mockResolvedValue({ rows: [] });

    // Act
    const res = await request(app).get('/api/statistics/user/u1');

    // Assert
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('caffeine_by_day');
    expect(res.body).toHaveProperty('total_drinks_this_week');
    expect(res.body).toHaveProperty('most_logged_drink');
  });

  // ── Edge case: brand new user with no data ────────────────────────────────

  test('returns 200 with zeroed stats when user has no logs at all', async () => {
    // Arrange
    db.query.mockResolvedValue({ rows: [] });

    // Act
    const res = await request(app).get('/api/statistics/user/brand_new_user');

    // Assert — route handles empty rows gracefully, total defaults to 0
    expect(res.status).toBe(200);
    expect(res.body.total_drinks_this_week).toBe(0);
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


describe('GET /api/statistics/community — community stats', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/statistics'); });
  beforeEach(() => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

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
// Actual route behaviour (recommendations.js):
//   POST /        → 400 if user_id missing | 503 if Python engine unreachable
//   POST /chosen  → 400 if user_id or drink_id missing | 201 on success | 500 on DB error
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/recommendations — input validation', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/recommendations'); });
  beforeEach(() => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  // ── Missing required fields — validated BEFORE the Python fetch call ───────

  test('returns 400 when user_id is missing from the request body', async () => {
    // Act
    const res = await request(app)
      .post('/api/recommendations')
      .send({ mood: 'Morning' });

    // Assert — guard clause fires before any DB or fetch call
    expect(res.status).toBe(400);
  });

  test('returns 400 when the request body is completely empty', async () => {
    const res = await request(app)
      .post('/api/recommendations')
      .send({});
    expect(res.status).toBe(400);
  });

  test('returns 400 when user_id is an empty string (falsy)', async () => {
    // Boundary — !'' is true, so empty string treated as missing
    const res = await request(app)
      .post('/api/recommendations')
      .send({ user_id: '' });
    expect(res.status).toBe(400);
  });
});


describe('POST /api/recommendations/chosen — save the chosen drink', () => {
  let app;
  beforeAll(() => { app = buildApp('./routes/recommendations'); });
  beforeEach(() => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  test('returns 201 and recommendation_id when chosen drink is saved successfully', async () => {
    // Arrange
    db.query.mockResolvedValue({ rows: [{ recommendation_id: 55 }] });

    // Act
    const res = await request(app)
      .post('/api/recommendations/chosen')
      .send({ user_id: 'u1', drink_id: 3, match_percentage: 87 });

    // Assert
    expect(res.status).toBe(201);
    expect(res.body.recommendation_id).toBe(55);
  });

  // ── Missing required fields ───────────────────────────────────────────────

  test('returns 400 when user_id is missing', async () => {
    const res = await request(app)
      .post('/api/recommendations/chosen')
      .send({ drink_id: 3 });
    expect(res.status).toBe(400);
  });

  test('returns 400 when drink_id is missing', async () => {
    const res = await request(app)
      .post('/api/recommendations/chosen')
      .send({ user_id: 'u1' });
    expect(res.status).toBe(400);
  });

  // ── Null input (slide 12: what AI frequently misses) ─────────────────────

  test('returns 400 when user_id is explicitly null', async () => {
    // Arrange — null is falsy so !null triggers the guard clause
    const res = await request(app)
      .post('/api/recommendations/chosen')
      .send({ user_id: null, drink_id: 3 });
    // Assert
    expect(res.status).toBe(400);
  });

  test('returns 400 when drink_id is explicitly null', async () => {
    // Arrange — null is falsy — validation rejects it
    const res = await request(app)
      .post('/api/recommendations/chosen')
      .send({ user_id: 'u1', drink_id: null });
    // Assert
    expect(res.status).toBe(400);
  });

  // ── Type error (slide 12: what AI frequently misses) ─────────────────────

  test('returns 201 when drink_id is sent as a string — pg coerces it to integer', async () => {
    // Arrange — !'3' is false so validation passes; pg coerces string to integer
    db.query.mockResolvedValue({ rows: [{ recommendation_id: 66 }] });
    // Act
    const res = await request(app)
      .post('/api/recommendations/chosen')
      .send({ user_id: 'u1', drink_id: '3', match_percentage: 80 });
    // Assert — documents that string coercion succeeds end-to-end
    expect(res.status).toBe(201);
  });

  // ── Database error ────────────────────────────────────────────────────────

  test('returns 500 when the database throws an error saving the chosen drink', async () => {
    // Arrange
    db.query.mockRejectedValue(new Error('DB error'));

    // Act
    const res = await request(app)
      .post('/api/recommendations/chosen')
      .send({ user_id: 'u1', drink_id: 3, match_percentage: 87 });

    // Assert
    expect(res.status).toBe(500);
  });
});