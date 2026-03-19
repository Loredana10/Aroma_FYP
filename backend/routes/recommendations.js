// backend/routes/recommendations.js
const express = require('express');
const router  = express.Router();
const pool    = require('../db');

const PYTHON_REC_URL = process.env.PYTHON_REC_URL || 'http://localhost:5001';

// Run migrations on startup — adds mood/time_of_day/weather to recommendations table
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

    // Save each recommended drink to the recommendations table with context
    if (data.recommendations && data.recommendations.length > 0) {
      for (const rec of data.recommendations) {
        try {
          await pool.query(`
            INSERT INTO recommendations
              (user_id, drink_id, match_percentage, mood, time_of_day, weather, timestamp)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
          `, [
            user_id,
            rec.drink_id,
            rec.match_percent ?? rec.score ?? null,
            mood        || null,
            time_of_day || null,
            weather     || null,
          ]);
        } catch (dbErr) {
          console.error('[Recommendations] DB insert error for drink', rec.drink_id, ':', dbErr.message);
        }
      }
      console.log(`[Recommendations] Saved ${data.recommendations.length} recs to DB`);
    }

    return res.json(data);

  } catch (err) {
    console.error('[Recommendations] Fetch error:', err.message);
    return res.status(503).json({ error: 'Could not reach recommendation engine' });
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