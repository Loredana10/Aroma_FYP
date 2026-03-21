// backend/routes/ratings.js
const express = require('express');
const router = express.Router();
const pool = require('../db');

// POST /api/ratings
// Save or update a user's rating for a drink.
// Uses a manual check-then-update-or-insert because the ratings table
// does not have a UNIQUE constraint on (user_id, drink_id).
router.post('/', async (req, res) => {
  const { user_id, drink_id, log_id, star_rating, mood, time_of_day, weather } = req.body;

  if (!user_id || !drink_id || !star_rating) {
    return res.status(400).json({ error: 'user_id, drink_id, and star_rating are required' });
  }

  try {
    // Check if the user has already rated this drink
    const existing = await pool.query(
      `SELECT rating_id FROM ratings WHERE user_id = $1 AND drink_id = $2`,
      [user_id, drink_id]
    );

    let result;
    if (existing.rows.length > 0) {
      // Update existing rating
      result = await pool.query(
        `UPDATE ratings
         SET star_rating = $1,
             mood        = COALESCE($2, mood),
             time_of_day = COALESCE($3, time_of_day),
             weather     = COALESCE($4, weather),
             timestamp   = NOW()
         WHERE user_id = $5 AND drink_id = $6
         RETURNING *`,
        [star_rating, mood || null, time_of_day || null, weather || null, user_id, drink_id]
      );
    } else {
      // Insert new rating
      result = await pool.query(
        `INSERT INTO ratings (user_id, drink_id, log_id, star_rating, mood, time_of_day, weather, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         RETURNING *`,
        [user_id, drink_id, log_id || null, star_rating,
         mood || null, time_of_day || null, weather || null]
      );
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error saving rating:', error);
    res.status(500).json({ error: 'Failed to save rating' });
  }
});

// GET /api/ratings/user/:user_id
// Fetch all ratings submitted by a specific user.
// Used by the log screen to show a user's own star ratings on their log entries.
router.get('/user/:user_id', async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT r.rating_id, r.user_id, r.drink_id, r.log_id,
              r.star_rating, r.mood, r.time_of_day, r.weather,
              r.timestamp, d.name AS drink_name
       FROM ratings r
       JOIN drinks d ON r.drink_id = d.drink_id
       WHERE r.user_id = $1
       ORDER BY r.timestamp DESC`,
      [user_id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching user ratings:', error);
    res.status(500).json({ error: 'Failed to fetch user ratings' });
  }
});

// GET /api/ratings/averages
// Returns average star rating and count for every drink.
router.get('/averages', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT drink_id,
              ROUND(AVG(star_rating)::numeric, 2) AS avg_rating,
              COUNT(*) AS rating_count
       FROM ratings
       GROUP BY drink_id`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching averages:', error);
    res.status(500).json({ error: 'Failed to fetch averages' });
  }
});

// GET /api/ratings/:drink_id
// Average rating for a single drink.
router.get('/:drink_id', async (req, res) => {
  const { drink_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT drink_id,
              ROUND(AVG(star_rating)::numeric, 2) AS avg_rating,
              COUNT(*) AS rating_count
       FROM ratings
       WHERE drink_id = $1
       GROUP BY drink_id`,
      [drink_id]
    );
    if (result.rows.length === 0) {
      return res.json({ drink_id: parseInt(drink_id), avg_rating: 0, rating_count: 0 });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching rating:', error);
    res.status(500).json({ error: 'Failed to fetch rating' });
  }
});

module.exports = router;