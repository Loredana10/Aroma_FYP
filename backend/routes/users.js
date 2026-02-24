const express = require('express');
const router = express.Router();
const pool = require('../db');

// POST /api/users
router.post('/', async (req, res) => {
  const { user_id, email, display_name } = req.body;

  if (!user_id || !email) {
    return res.status(400).json({ error: 'user_id and email are required' });
  }

  try {
    const existing = await pool.query(
      'SELECT * FROM users WHERE user_id = $1',
      [user_id]
    );

    if (existing.rows.length > 0) {
      return res.status(200).json(existing.rows[0]);
    }

    const result = await pool.query(
      `INSERT INTO users (user_id, email, display_name, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [user_id, email, display_name || null]
    );

    return res.status(201).json(result.rows[0]);

  } catch (error) {
    console.error('Error saving user:', error);
    res.status(500).json({ error: 'Failed to save user' });
  }
});

// GET /api/users/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE user_id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// PATCH /api/users/:id
// Updates age_range, coffee_frequency and gender from complete-profile screen
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { age_range, coffee_frequency, gender } = req.body;

  try {
    const result = await pool.query(
      `UPDATE users 
       SET age_range        = COALESCE($1, age_range),
           coffee_frequency = COALESCE($2, coffee_frequency),
           gender           = COALESCE($3, gender)
       WHERE user_id = $4
       RETURNING *`,
      [age_range || null, coffee_frequency || null, gender || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

module.exports = router;