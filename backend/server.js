require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
// const rateLimit = require('express-rate-limit'); // DISABLED FOR NOW

const aiTestingRoutes = require('./routes/ai-testing');
console.log('✅ Routes file loaded successfully:', typeof aiTestingRoutes);

const app = express();
const PORT = process.env.PORT || 3001;

// Configure Express to trust Render's proxy
app.set('trust proxy', 1); // Trust first proxy (Render)

// Security middleware
app.use(helmet());
app.use(compression());

// CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// RATE LIMITING DISABLED TEMPORARILY
// app.use('/api/', limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Test route directly in server.js
app.get('/api/direct-test', (req, res) => {
    res.json({ 
        message: 'Direct route in server.js working!',
        timestamp: new Date().toISOString()
    });
});

// Routes from external file
app.use('/api', aiTestingRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler - MUST BE LAST!
app.use('*', (req, res) => {
  console.log('❌ 404 - Route not found:', req.method, req.originalUrl);
  res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
