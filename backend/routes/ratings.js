// app/backend/routes/ratings.js
/**
 * Routes for handling rating-related API endpoints.
 * This module defines the routes for creating/updating a rating, fetching ratings for a user, and fetching average ratings for drinks.
 *
 * The routes interact with the PostgreSQL database using the connection pool defined in db.js.
 */

const express = require('express');
const router = require('express').Router();
const pool = require('../db');

// POST /api/ratings
// Always inserts a NEW rating row tied to a specific log_id.
// Each log entry has its own unique rating — users can rate the same drink
// differently across multiple logs (different cafés, different preparations).
router.post('/', async (req, res) => {
  const { user_id, drink_id, log_id, star_rating, mood, time_of_day, weather } = req.body;

  if (!user_id || !drink_id || !star_rating) {
    return res.status(400).json({ error: 'user_id, drink_id, and star_rating are required' });
  }

  try {
    if (log_id) {
      // Check if this specific log entry already has a rating.
      // If it does, update it (user changed their mind on THIS specific drink instance).
      // If not, insert a brand new rating row.
      const existing = await pool.query(
        `SELECT rating_id FROM ratings WHERE log_id = $1`,
        [log_id]
      );

      let result;
      if (existing.rows.length > 0) {
        // Update the rating for this specific log entry only
        result = await pool.query(
          `UPDATE ratings
           SET star_rating = $1,
               mood        = COALESCE($2, mood),
               time_of_day = COALESCE($3, time_of_day),
               weather     = COALESCE($4, weather),
               timestamp   = NOW()
           WHERE log_id = $5
           RETURNING *`,
          [star_rating, mood || null, time_of_day || null, weather || null, log_id]
        );
      } else {
        // New rating for this log entry
        result = await pool.query(
          `INSERT INTO ratings (user_id, drink_id, log_id, star_rating, mood, time_of_day, weather, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           RETURNING *`,
          [user_id, drink_id, log_id, star_rating,
           mood || null, time_of_day || null, weather || null]
        );
      }
      return res.status(201).json(result.rows[0]);

    } else {
      // FALLBACK PATH: no log_id provided
      // Insert a new rating without a log link.
      const result = await pool.query(
        `INSERT INTO ratings (user_id, drink_id, log_id, star_rating, mood, time_of_day, weather, timestamp)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, NOW())
         RETURNING *`,
        [user_id, drink_id, star_rating,
         mood || null, time_of_day || null, weather || null]
      );
      return res.status(201).json(result.rows[0]);
    }

  } catch (error) {
    console.error('Error saving rating:', error);
    res.status(500).json({ error: 'Failed to save rating' });
  }
});

// GET /api/ratings/user/:user_id
// Fetch all ratings submitted by a specific user, including log_id.
// The app uses log_id to match each rating to its specific log entry.
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
// Returns average star rating and count for every drink (community-wide).
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