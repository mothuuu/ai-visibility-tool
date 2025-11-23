// V2 Recommendation Engine (initially mirrors V1)
// Provides a separate entrypoint to evolve recommendations without altering V1.
const { generateCompleteRecommendations } = require('./recommendation-generator');

async function generateCompleteRecommendationsV2(...args) {
  return generateCompleteRecommendations(...args);
}

module.exports = { generateCompleteRecommendationsV2 };
