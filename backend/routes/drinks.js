//app/backend/routes/drinks.js
/**
 * Routes for handling drink-related API endpoints.
 * This module defines the routes for fetching all drinks and fetching a single drink by ID.
 *
 * The routes interact with the PostgreSQL database using the connection pool defined in db.js.
 */

const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/drinks
// Returns all drinks from the database
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM drinks ORDER BY drink_id ASC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching drinks:', error);
    res.status(500).json({ error: 'Failed to fetch drinks' });
  }
});

// GET /api/drinks/:id
// Returns a single drink by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM drinks WHERE drink_id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Drink not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching drink:', error);
    res.status(500).json({ error: 'Failed to fetch drink' });
  }
});

module.exports = router;
