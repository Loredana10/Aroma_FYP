// app/backend/routes/recommendations.js
/**
 * Routes for handling recommendation-related API endpoints.
 * This module defines the routes for getting drink recommendations based on user input and saving the chosen recommendation to the database.
 * The routes interact with the PostgreSQL database using the connection pool defined in db.js, and also proxy requests to the Python recommendation engine.
**/
const express = require('express');
const router  = express.Router();
const pool    = require('../db');

const PYTHON_REC_URL = process.env.PYTHON_REC_URL || 'http://localhost:5001';

// Run migrations on startup — adds mood/time_of_day/weather columns if missing
async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS mood        VARCHAR(50)`);
    await client.query(`ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS time_of_day VARCHAR(20)`);
    await client.query(`ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS weather     VARCHAR(20)`);
    console.log('[recommendations] Schema OK');
  } catch (err) {
    console.warn('[recommendations] Migration note:', err.message);
  } finally {
    client.release();
  }
}
runMigrations();

// POST /api/recommendations
// Proxies the request to the Python engine and returns the 3 recommendations
// to the app WITHOUT saving anything to the DB yet.
// The DB insert only happens when the user taps "That's my drink".
router.post('/', async (req, res) => {
  const { user_id, mood, time_of_day, weather, dietary_restrictions, explore_new } = req.body;

  if (!user_id) return res.status(400).json({ error: 'user_id is required' });

  const exploreNewBool = explore_new === true || explore_new === 'true';

  console.log('[Recommendations] user:', user_id, '| explore_new:', exploreNewBool,
    '| mood:', mood, '| time:', time_of_day, '| weather:', weather);

  try {
    const response = await fetch(`${PYTHON_REC_URL}/recommend`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id,
        mood:                 mood        || '',
        time_of_day:          time_of_day || '',
        weather:              weather     || '',
        dietary_restrictions: dietary_restrictions || [],
        explore_new:          exploreNewBool,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[Recommendations] Python error:', errText);
      return res.status(502).json({ error: 'Recommendation engine unavailable' });
    }

    const data = await response.json();

    //    The DB insert only happens in POST /api/recommendations/chosen
    //    when the user explicitly selects "That's my drink".
    console.log(`[Recommendations] Returned ${data.recommendations?.length ?? 0} recs to app — NOT saved to DB yet`);

    return res.json(data);

  } catch (err) {
    console.error('[Recommendations] Fetch error:', err.message);
    return res.status(503).json({ error: 'Could not reach recommendation engine' });
  }
});

// POST /api/recommendations/chosen
// Called when the user taps "That's my drink" on one of the 3 recommendations.
// Only this single chosen drink is saved to the recommendations table.
router.post('/chosen', async (req, res) => {
  const { user_id, drink_id, match_percentage, mood, time_of_day, weather } = req.body;

  if (!user_id || !drink_id) {
    return res.status(400).json({ error: 'user_id and drink_id are required' });
  }

  try {
    const result = await pool.query(`
      INSERT INTO recommendations
        (user_id, drink_id, match_percentage, mood, time_of_day, weather, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING recommendation_id
    `, [
      user_id,
      drink_id,
      match_percentage ?? null,
      mood        || null,
      time_of_day || null,
      weather     || null,
    ]);

    console.log(`[Recommendations] Saved chosen drink ${drink_id} for user ${user_id} → rec_id ${result.rows[0].recommendation_id}`);
    return res.status(201).json({ recommendation_id: result.rows[0].recommendation_id });

  } catch (err) {
    console.error('[Recommendations] Failed to save chosen drink:', err.message);
    return res.status(500).json({ error: 'Failed to save recommendation' });
  }
});

// POST /api/recommendations/click
router.post('/click', async (req, res) => {
  const { user_id, drink_id } = req.body;
  if (!user_id || !drink_id) return res.status(400).json({ error: 'user_id and drink_id required' });
  try {
    const response = await fetch(`${PYTHON_REC_URL}/track_click`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id, drink_id }),
    });
    const data = await response.json();
    return res.json(data);
  } catch (err) {
    console.error('[Recommendations] Click tracking error:', err.message);
    return res.status(503).json({ error: 'Could not track click' });
  }
});

module.exports = router;