// backend/routes/ratings.js
const express = require('express');
const router  = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5434'),
  database: process.env.DB_NAME     || 'aroma_db',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '12345',
});

// Run migrations on startup
async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE ratings ADD COLUMN IF NOT EXISTS log_id      INTEGER REFERENCES logs(log_id)`);
    await client.query(`ALTER TABLE ratings ADD COLUMN IF NOT EXISTS mood        VARCHAR(50)`);
    await client.query(`ALTER TABLE ratings ADD COLUMN IF NOT EXISTS time_of_day VARCHAR(20)`);
    await client.query(`ALTER TABLE ratings ADD COLUMN IF NOT EXISTS weather     VARCHAR(20)`);
    // Unique index for per-entry ratings (required for ON CONFLICT on log_id)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ratings_user_log_idx
      ON ratings (user_id, log_id)
      WHERE log_id IS NOT NULL
    `);
    console.log('[ratings] Schema OK');
  } catch (err) {
    console.warn('[ratings] Migration note:', err.message);
  } finally {
    client.release();
  }
}
runMigrations();

// GET /api/ratings/averages
router.get('/averages', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT drink_id,
             AVG(star_rating)::float AS avg_rating,
             COUNT(*)::int           AS rating_count
      FROM ratings
      WHERE star_rating IS NOT NULL
      GROUP BY drink_id
    `);
    res.json(result.rows.map((r) => ({
      drink_id:     parseInt(r.drink_id),
      avg_rating:   parseFloat(r.avg_rating),
      rating_count: parseInt(r.rating_count),
    })));
  } catch (err) {
    console.error('GET /api/ratings/averages error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ratings/:userId
router.get('/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await pool.query(`
      SELECT drink_id, star_rating, log_id, mood, time_of_day, weather
      FROM ratings
      WHERE user_id = $1 AND star_rating IS NOT NULL
      ORDER BY timestamp DESC
    `, [userId]);
    res.json(result.rows.map((r) => ({
      drink_id:    parseInt(r.drink_id),
      star_rating: parseInt(r.star_rating),
      log_id:      r.log_id      != null ? parseInt(r.log_id)  : null,
      mood:        r.mood        || null,
      time_of_day: r.time_of_day || null,
      weather:     r.weather     || null,
    })));
  } catch (err) {
    console.error('GET /api/ratings/:userId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ratings
// Saves star rating + mood/time_of_day/weather context.
// Per-entry (log_id present): upserts on (user_id, log_id)
// Legacy (no log_id): upserts on (user_id, drink_id) WHERE log_id IS NULL
router.post('/', async (req, res) => {
  const { user_id, drink_id, star_rating, log_id, mood, time_of_day, weather } = req.body;

  console.log('[Ratings] POST:', { user_id, drink_id, star_rating, log_id, mood, time_of_day, weather });

  if (!user_id || !drink_id || !star_rating) {
    return res.status(400).json({ error: 'user_id, drink_id, star_rating required' });
  }

  try {
    let result;

    if (log_id != null) {
      // Per-entry: each log entry gets its own independent rating
      result = await pool.query(`
        INSERT INTO ratings (user_id, drink_id, star_rating, log_id, mood, time_of_day, weather, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (user_id, log_id)
        WHERE log_id IS NOT NULL
        DO UPDATE SET
          star_rating  = EXCLUDED.star_rating,
          mood         = COALESCE(EXCLUDED.mood,        ratings.mood),
          time_of_day  = COALESCE(EXCLUDED.time_of_day, ratings.time_of_day),
          weather      = COALESCE(EXCLUDED.weather,     ratings.weather),
          timestamp    = NOW()
        RETURNING *
      `, [user_id, drink_id, star_rating, log_id,
          mood || null, time_of_day || null, weather || null]);

      console.log('[Ratings] Saved per-log rating, log_id:', log_id,
        '| mood:', mood, '| time:', time_of_day, '| weather:', weather);
    } else {
      // Legacy fallback: one rating per (user, drink)
      result = await pool.query(`
        INSERT INTO ratings (user_id, drink_id, star_rating, mood, time_of_day, weather, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (user_id, drink_id)
        WHERE log_id IS NULL
        DO UPDATE SET
          star_rating  = EXCLUDED.star_rating,
          mood         = COALESCE(EXCLUDED.mood,        ratings.mood),
          time_of_day  = COALESCE(EXCLUDED.time_of_day, ratings.time_of_day),
          weather      = COALESCE(EXCLUDED.weather,     ratings.weather),
          timestamp    = NOW()
        RETURNING *
      `, [user_id, drink_id, star_rating,
          mood || null, time_of_day || null, weather || null]);

      console.log('[Ratings] Saved legacy rating, drink_id:', drink_id,
        '| mood:', mood, '| time:', time_of_day, '| weather:', weather);
    }

    res.json({ ok: true, rating: result.rows[0] });
  } catch (err) {
    console.error('[Ratings] POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;