const { Pool } = require('pg');

const pool = new Pool({
  host:     'localhost',
  port:     5434,          // your PostgreSQL port
  database: 'aroma_db',       // your database name
  user:     'postgres',    // your username
  password: '12345' // your password
});

module.exports = pool;