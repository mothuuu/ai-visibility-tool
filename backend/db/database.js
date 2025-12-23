require('dotenv').config(); // Load .env file
const { Pool } = require('pg');

// Configure database connection with SSL based on environment
// Render databases require SSL with rejectUnauthorized: false
const connectionString = process.env.DATABASE_URL;
const isLocalDB = connectionString?.includes('localhost') || connectionString?.includes('127.0.0.1');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Local databases don't need SSL, cloud databases (Render, etc) do
  ssl: isLocalDB ? false : {
    rejectUnauthorized: false
  },
  // Connection pool settings for production
  max: 20, // Maximum connections in pool
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 10000, // Timeout if can't connect in 10s
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  // Get a client for transaction support
  getClient: () => pool.connect()
};