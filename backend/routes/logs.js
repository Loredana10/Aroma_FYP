// backend/routes/logs.js
const express = require('express');
const router = express.Router();
const pool = require('../db');

// Ensure context columns exist on logs table
pool.query(`
  ALTER TABLE logs ADD COLUMN IF NOT EXISTS mood         VARCHAR(50);
  ALTER TABLE logs ADD COLUMN IF NOT EXISTS time_of_day  VARCHAR(20);
  ALTER TABLE logs ADD COLUMN IF NOT EXISTS weather      VARCHAR(20);
  ALTER TABLE logs ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN DEFAULT FALSE;
`).catch(() => {});

// POST /api/logs
// Now accepts mood, time_of_day, weather, is_recommended
router.post('/', async (req, res) => {
  const { user_id, drink_id, caffeine_amount, mood, time_of_day, weather, is_recommended } = req.body;

  if (!user_id || !drink_id) {
    return res.status(400).json({ error: 'user_id and drink_id are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO logs (user_id, drink_id, caffeine_amount, mood, time_of_day, weather, is_recommended, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [user_id, drink_id, caffeine_amount || null,
       mood || null, time_of_day || null, weather || null,
       is_recommended || false]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error saving log:', error);
    res.status(500).json({ error: 'Failed to save log' });
  }
});

// GET /api/logs/:user_id
router.get('/:user_id', async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT l.*, d.name as drink_name, d.category
       FROM logs l
       JOIN drinks d ON l.drink_id = d.drink_id
       WHERE l.user_id = $1
       ORDER BY l.timestamp DESC`,
      [user_id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// GET /api/logs/:user_id/today
router.get('/:user_id/today', async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT l.*, d.name as drink_name, d.caffeine_mg
       FROM logs l
       JOIN drinks d ON l.drink_id = d.drink_id
       WHERE l.user_id = $1
         AND l.timestamp >= CURRENT_DATE
         AND l.timestamp < CURRENT_DATE + INTERVAL '1 day'
       ORDER BY l.timestamp DESC`,
      [user_id]
    );
    const totalCaffeine = result.rows.reduce((sum, row) => sum + (row.caffeine_amount || 0), 0);
    res.json({ logs: result.rows, total_caffeine_mg: totalCaffeine });
  } catch (error) {
    console.error('Error fetching today logs:', error);
    res.status(500).json({ error: 'Failed to fetch today logs' });
  }
});

// DELETE /api/logs/:log_id
router.delete('/:log_id', async (req, res) => {
  const { log_id } = req.params;
  try {
    await pool.query('DELETE FROM logs WHERE log_id = $1', [log_id]);
    res.json({ message: 'Log deleted' });
  } catch (error) {
    console.error('Error deleting log:', error);
    res.status(500).json({ error: 'Failed to delete log' });
  }
});

module.exports = router;