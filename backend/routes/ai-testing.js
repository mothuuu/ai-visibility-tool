const express = require('express');
const router = express.Router();

// Simple test route
router.get('/test', (req, res) => {
    res.json({ 
        message: 'AI Testing routes are working!',
        timestamp: new Date().toISOString()
    });
});

// Simplified analyze endpoint
router.post('/analyze-website', async (req, res) => {
    try {
        console.log('🌐 Analyze website request received');
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        // Simple mock analysis for now
        const mockAnalysis = {
            url: url,
            industry: { name: 'Test Industry', key: 'test' },
            scores: {
                aiSearchReadiness: 7.5,
                contentStructure: 6.2,
                voiceOptimization: 4.8,
                technicalSetup: 8.1,
                trustAuthority: 5.9,
                aiReadability: 6.7,
                speedUX: 7.3,
                total: 46.5
            },
            recommendations: [
                {
                    title: 'Test Recommendation',
                    description: 'This is a test recommendation',
                    impact: 'Medium',
                    category: 'AI Search Readiness'
                }
            ],
            analyzedAt: new Date().toISOString()
        };

        console.log('✅ Sending mock analysis response');
        res.json({
            success: true,
            data: mockAnalysis
        });

    } catch (error) {
        console.error('❌ Analysis failed:', error);
        res.status(500).json({
            error: 'Website analysis failed',
            message: error.message
        });
    }
});

// Health check
router.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        service: 'AI Testing API',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;
