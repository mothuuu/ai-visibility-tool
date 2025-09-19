// Temporary simple server.js for testing
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// Basic middleware
app.use(express.json());
app.use(cors({
  origin: ['http://localhost:3000', 'https://your-frontend-url.onrender.com'],
  credentials: true,
  optionsSuccessStatus: 200
}));

// Test route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Server is working!', 
    timestamp: new Date().toISOString() 
  });
});

app.get('/test', (req, res) => {
  res.json({ message: 'Test endpoint working' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  process.exit(1);
});
