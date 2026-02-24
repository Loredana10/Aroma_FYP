const express = require('express');
const cors = require('cors');
const drinksRouter = require('./routes/drinks');
const usersRouter = require('./routes/users');
const ratingsRouter = require('./routes/ratings');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/drinks', drinksRouter);
app.use('/api/users', usersRouter);
app.use('/api/ratings', ratingsRouter);

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Aroma API is running' });
});

app.listen(PORT, () => {
  console.log(`Aroma API running on http://localhost:${PORT}`);
});