// backend/routes/statistics.js
const express = require('express');
const router = express.Router();
const pool = require('../db');

// Helper: get Monday of the current week at midnight
const getWeekStart = () => {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = 0
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString();
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/statistics/user/:user_id
// Personal weekly stats:
//   - caffeine per day Mon–Sun (for the bar chart)
//   - total drinks logged this week
//   - most logged drink this week
//   - days over limit (requires caffeineLimit passed as query param)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/user/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const caffeineLimit = req.query.limit ? parseInt(req.query.limit) : null;
  const weekStart = getWeekStart();

  try {
    // Daily caffeine totals Mon–Sun
    const dailyResult = await pool.query(
      `SELECT
         DATE(timestamp) AS day,
         SUM(caffeine_amount) AS total_mg,
         COUNT(*) AS drink_count
       FROM logs
       WHERE user_id = $1
         AND timestamp >= $2
       GROUP BY DATE(timestamp)
       ORDER BY day ASC`,
      [user_id, weekStart]
    );

    // Most logged drink this week
    const topDrinkResult = await pool.query(
      `SELECT d.name, COUNT(*) AS log_count
       FROM logs l
       JOIN drinks d ON l.drink_id = d.drink_id
       WHERE l.user_id = $1
         AND l.timestamp >= $2
       GROUP BY d.name
       ORDER BY log_count DESC
       LIMIT 1`,
      [user_id, weekStart]
    );

    // Total logs this week
    const totalResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM logs
       WHERE user_id = $1 AND timestamp >= $2`,
      [user_id, weekStart]
    );

    // Build Mon–Sun array (fill missing days with 0)
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const now = new Date();
    const currentDay = now.getDay() === 0 ? 6 : now.getDay() - 1; // 0=Mon

    const dailyMap = {};
    dailyResult.rows.forEach(row => {
      const d = new Date(row.day);
      const dayIdx = d.getDay() === 0 ? 6 : d.getDay() - 1;
      dailyMap[dayIdx] = {
        mg: Math.round(parseFloat(row.total_mg) || 0),
        count: parseInt(row.drink_count)
      };
    });

    const caffeine_by_day = days.map((label, i) => ({
      day: label,
      mg: dailyMap[i]?.mg || 0,
      count: dailyMap[i]?.count || 0,
      over_limit: caffeineLimit ? (dailyMap[i]?.mg || 0) > caffeineLimit : false,
      is_future: i > currentDay,
    }));

    const days_over_limit = caffeineLimit
      ? caffeine_by_day.filter(d => !d.is_future && d.over_limit).length
      : 0;

    res.json({
      week_start: weekStart,
      caffeine_by_day,
      total_drinks_this_week: parseInt(totalResult.rows[0]?.total || 0),
      most_logged_drink: topDrinkResult.rows[0] || null,
      days_over_limit,
    });
  } catch (error) {
    console.error('Error fetching user statistics:', error);
    res.status(500).json({ error: 'Failed to fetch user statistics' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/statistics/community
// Community weekly stats:
//   - total drinks logged this week across all users
//   - most logged drink this week (community-wide)
//   - top 3 highest rated drinks this week (by avg star_rating, min 3 ratings)
// Also useful for implicit ratings / matrix factorisation:
//   - log_count per drink can serve as implicit preference signal
// ─────────────────────────────────────────────────────────────────────────────
router.get('/community', async (req, res) => {
  const weekStart = getWeekStart();

  try {
    // Total community logs this week
    const totalResult = await pool.query(
      `SELECT COUNT(*) AS total FROM logs WHERE timestamp >= $1`,
      [weekStart]
    );

    // Most logged drink this week (community) — useful as implicit rating signal
    const popularResult = await pool.query(
      `SELECT d.name, d.category, COUNT(*) AS log_count
       FROM logs l
       JOIN drinks d ON l.drink_id = d.drink_id
       WHERE l.timestamp >= $1
       GROUP BY d.name, d.category
       ORDER BY log_count DESC
       LIMIT 1`,
      [weekStart]
    );

    // Top 3 rated drinks this week (min 2 ratings to qualify)
    const topRatedResult = await pool.query(
      `SELECT
         d.name,
         d.category,
         ROUND(AVG(r.star_rating)::numeric, 1) AS avg_rating,
         COUNT(*) AS rating_count
       FROM ratings r
       JOIN drinks d ON r.drink_id = d.drink_id
       WHERE r.timestamp >= $1
       GROUP BY d.name, d.category
       HAVING COUNT(*) >= 2
       ORDER BY avg_rating DESC, rating_count DESC
       LIMIT 3`,
      [weekStart]
    );

    // Implicit signal data: top 10 most logged drinks ever (for recommender use)
    // log frequency as implicit preference
    const implicitResult = await pool.query(
      `SELECT
         d.drink_id,
         d.name,
         COUNT(*) AS total_logs,
         COUNT(DISTINCT l.user_id) AS unique_users
       FROM logs l
       JOIN drinks d ON l.drink_id = d.drink_id
       GROUP BY d.drink_id, d.name
       ORDER BY total_logs DESC
       LIMIT 10`
    );

    res.json({
      week_start: weekStart,
      total_community_logs: parseInt(totalResult.rows[0]?.total || 0),
      most_popular_drink: popularResult.rows[0] || null,
      top_rated_drinks: topRatedResult.rows,
      implicit_signals: implicitResult.rows, // for future recommender use
    });
  } catch (error) {
    console.error('Error fetching community statistics:', error);
    res.status(500).json({ error: 'Failed to fetch community statistics' });
  }
});

module.exports = router;