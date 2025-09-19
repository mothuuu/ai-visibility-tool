// Replace the final scoring calculation in performDetailedAnalysis function
function performDetailedAnalysis(websiteData) {
  console.log('\n🚀 Starting detailed analysis with fixed aggregation...');
  console.log('🌐 URL:', websiteData.url);
  
  const { html, url } = websiteData;
  const content = extractTextContent(html);
  const industry = detectIndustry(websiteData);
  
  console.log('🏭 Detected industry:', industry.name);
  
  const metrics = analyzePageMetrics(html, content, industry, url);
  
  // Get analysis results with totals
  const analysisResults = {
    aiSearchReadiness: analyzeAISearchReadiness(metrics),
    contentStructure: analyzeContentStructure(metrics),
    voiceOptimization: analyzeVoiceOptimization(metrics),
    technicalSetup: analyzeTechnicalSetup(metrics),
    trustAuthority: analyzeTrustAuthority(metrics),
    aiReadability: analyzeAIReadability(metrics),
    speedUX: analyzeSpeedUX(metrics)
  };
  
  // Calculate final scores using the totals with percentage conversion
  console.log('\n🧮 Calculating final scores with percentage conversion...');
  const categoryScores = {};
  let totalWeightedScore = 0;
  
  // Define maximum possible scores for each category (based on factor max points)
  const maxScores = {
    aiSearchReadiness: 13.0,  // 2.5+2.5+2.5+2.5+2.0+1.5
    contentStructure: 7.5,    // 3.0+2.5+2.0
    voiceOptimization: 5.5,   // 3.0+2.5
    technicalSetup: 5.0,      // 5.0
    trustAuthority: 4.0,      // 4.0
    aiReadability: 3.0,       // 3.0
    speedUX: 3.0             // 3.0
  };
  
  // Calculate maximum possible weighted score
  let maxWeightedScore = 0;
  for (const [category, maxScore] of Object.entries(maxScores)) {
    const weight = CATEGORY_WEIGHTS[category];
    maxWeightedScore += maxScore * weight;
  }
  
  console.log('📊 Maximum possible weighted score:', maxWeightedScore);
  
  for (const [category, result] of Object.entries(analysisResults)) {
    const categoryScore = result.total;
    categoryScores[category] = Math.round(categoryScore * 10) / 10;
    
    const weight = CATEGORY_WEIGHTS[category];
    const weightedScore = categoryScore * weight;
    totalWeightedScore += weightedScore;
    
    console.log(`📊 ${category}: ${categoryScore} points (weighted: ${weightedScore.toFixed(2)})`);
  }
  
  // Convert to percentage (0-100 scale)
  const percentageScore = Math.round((totalWeightedScore / maxWeightedScore) * 100);
  categoryScores.total = Math.max(0, Math.min(100, percentageScore)); // Ensure it's between 0-100
  
  console.log('\n✅ Final category scores:', categoryScores);
  console.log('🎯 Total weighted score:', totalWeightedScore.toFixed(2));
  console.log('🎯 Percentage score:', categoryScores.total);
  
  // Generate recommendations
  const recommendations = generateRecommendations(analysisResults, categoryScores, industry);
  
  return {
    url,
    industry,
    scores: categoryScores,
    analysis: analysisResults,
    recommendations,
    metrics,
    analyzedAt: new Date().toISOString()
  };
}
