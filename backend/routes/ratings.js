const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/ratings/averages
// Returns average star rating and count for every drink
router.get('/averages', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        drink_id,
        ROUND(AVG(star_rating)::numeric, 2) as avg_rating,
        COUNT(*) as rating_count
      FROM ratings
      GROUP BY drink_id
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching averages:', error);
    res.status(500).json({ error: 'Failed to fetch averages' });
  }
});

// POST /api/ratings
// Save or update a user's rating for a drink
router.post('/', async (req, res) => {
  const { user_id, drink_id, star_rating, mood, time_of_day, weather } = req.body;

  if (!user_id || !drink_id || !star_rating) {
    return res.status(400).json({ error: 'user_id, drink_id and star_rating are required' });
  }
  if (star_rating < 1 || star_rating > 5) {
    return res.status(400).json({ error: 'star_rating must be between 1 and 5' });
  }

  try {
    const result = await pool.query(`
      INSERT INTO ratings (user_id, drink_id, star_rating, mood, time_of_day, weather, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (user_id, drink_id)
      DO UPDATE SET
        star_rating = EXCLUDED.star_rating,
        mood        = EXCLUDED.mood,
        time_of_day = EXCLUDED.time_of_day,
        weather     = EXCLUDED.weather,
        timestamp   = NOW()
      RETURNING *`,
      [user_id, drink_id, star_rating, mood || null, time_of_day || null, weather || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error saving rating:', error);
    res.status(500).json({ error: 'Failed to save rating' });
  }
});

// GET /api/ratings/:user_id
// Get all ratings by a specific user
router.get('/:user_id', async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(`
      SELECT r.*, d.name as drink_name, d.category
      FROM ratings r
      JOIN drinks d ON r.drink_id = d.drink_id
      WHERE r.user_id = $1
      ORDER BY r.timestamp DESC`,
      [user_id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching ratings:', error);
    res.status(500).json({ error: 'Failed to fetch ratings' });
  }
});

// DELETE /api/ratings/:rating_id
router.delete('/:rating_id', async (req, res) => {
  try {
    await pool.query('DELETE FROM ratings WHERE rating_id = $1', [req.params.rating_id]);
    res.json({ message: 'Rating deleted' });
  } catch (error) {
    console.error('Error deleting rating:', error);
    res.status(500).json({ error: 'Failed to delete rating' });
  }
});

module.exports = router;