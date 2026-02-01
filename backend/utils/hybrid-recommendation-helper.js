// Helper functions for hybrid recommendation system
const db = require('../db/database');

// Minimum number of site-wide recs to persist per scan, regardless of plan cap.
// The plan cap controls what is SHOWN, not what is STORED.
// A larger pool allows GET-time refill when items resolve to implemented.
const PERSIST_POOL_LIMIT = 25;

// Site-wide recommendation categories (affect whole site)
const SITE_WIDE_CATEGORIES = [
  'indexNowScore',
  'sitemapScore',
  'robotsTxtScore',
  'httpsScore',
  'mobileScore',
  'speedScore',
  'coreWebVitalsScore',
  'organizationSchema',
  'brandSchema'
];

// Site-wide recommendation keywords (in title/text)
const SITE_WIDE_KEYWORDS = [
  'indexnow',
  'sitemap',
  'robots.txt',
  'https',
  'ssl',
  'site-wide',
  'entire site',
  'all pages',
  'organization schema',
  'brand schema'
];

/**
 * Classify recommendation as site-wide or page-specific
 */
function classifyRecommendation(rec) {
  const text = (rec.title || rec.recommendation_text || '').toLowerCase();
  const category = (rec.category || '').toLowerCase();
  
  // Check if category is site-wide
  if (SITE_WIDE_CATEGORIES.some(cat => category.includes(cat.toLowerCase()))) {
    return 'site-wide';
  }
  
  // Check if text contains site-wide keywords
  if (SITE_WIDE_KEYWORDS.some(keyword => text.includes(keyword))) {
    return 'site-wide';
  }
  
  // Default to page-specific
  return 'page-specific';
}

/**
 * Save recommendations with hybrid system
 * @param {number} scanId - Scan ID
 * @param {number} userId - User ID
 * @param {string} mainUrl - Main URL scanned
 * @param {array} selectedPages - Array of page URLs with priorities
 * @param {array} recommendations - All recommendations from scan
 * @param {string} userPlan - User's plan (free, diy, pro)
 * @param {number} scanScore - Current scan score (for score tracking)
 * @param {number} contextId - Context ID for 5-day window tracking (optional)
 */
async function saveHybridRecommendations(scanId, userId, mainUrl, selectedPages, recommendations, userPlan, scanScore = null, contextId = null) {
  console.log(`💾 Saving hybrid recommendations for scan ${scanId}...`);
  
  // Separate site-wide and page-specific recommendations
  const siteWideRecs = [];
  const pageSpecificRecs = [];
  
  recommendations.forEach(rec => {
    const type = classifyRecommendation(rec);
    if (type === 'site-wide') {
      siteWideRecs.push(rec);
    } else {
      pageSpecificRecs.push(rec);
    }
  });
  
  console.log(`   🌐 ${siteWideRecs.length} site-wide recommendations`);
  console.log(`   📄 ${pageSpecificRecs.length} page-specific recommendations`);
  
  // Persist a larger pool so GET-time refill works when items resolve to implemented
  const limitedSiteWide = siteWideRecs.slice(0, PERSIST_POOL_LIMIT);
  
  // FIXED: Save ALL page-specific recommendations (no 5-per-page limit for single page)
  const pagesWithRecs = selectedPages || [{ url: mainUrl, priority: 1 }];
  
  // If single page, save ALL page-specific recs
  // If multiple pages, distribute evenly
  const recsPerPage = pagesWithRecs.length === 1 
    ? pageSpecificRecs.length 
    : Math.ceil(pageSpecificRecs.length / pagesWithRecs.length);
  
  console.log(`   📄 Will save ${recsPerPage} recommendations per page (${pagesWithRecs.length} page(s))`);

  // Determine initial active count based on plan (case-insensitive comparison)
  const planLower = (userPlan || '').toLowerCase();
  let initialActive;
  if (planLower === 'free') {
    initialActive = 3;  // Free: Top 3 recommendations
  } else if (planLower === 'diy') {
    initialActive = 5;  // DIY: First 5, then progressive unlock
  } else if (planLower === 'pro' || planLower === 'enterprise' || planLower === 'agency') {
    initialActive = 999; // Pro/Enterprise/Agency: All recommendations active immediately
  } else {
    initialActive = 0;   // Guest: No recommendations
    console.warn(`⚠️ Unknown plan "${userPlan}" - defaulting to 0 active recommendations`);
  }

  console.log(`   🔓 Initial active recommendations for ${userPlan} tier: ${initialActive}`);

  // Save site-wide recommendations
  let siteWideActive = 0;
  let siteWideLocked = 0;

  for (let i = 0; i < limitedSiteWide.length; i++) {
    const rec = limitedSiteWide[i];
    const batchNumber = Math.floor(i / 5) + 1;
    const unlockState = i < initialActive ? 'active' : 'locked';
    const unlockedAt = i < initialActive ? new Date() : null;
    const skipEnabledAt = i < initialActive ? new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) : null; // 5 days

    // DEBUG: Log ALL recommendations to diagnose structured fields
    console.log('📦 Recommendation being saved:', {
      title: rec.title?.substring(0, 50),
      category: rec.category,
      subfactor: rec.subfactor,
      hasCustomizedImplementation: !!rec.customizedImplementation,
      hasReadyToUseContent: !!rec.readyToUseContent,
      hasImplementationNotes: !!rec.implementationNotes,
      hasQuickWins: !!rec.quickWins,
      hasValidationChecklist: !!rec.validationChecklist,
      customizedImplLength: rec.customizedImplementation?.length || 0,
      readyToUseLength: rec.readyToUseContent?.length || 0,
      implementationNotesLength: Array.isArray(rec.implementationNotes) ? rec.implementationNotes.length : 0,
      quickWinsLength: Array.isArray(rec.quickWins) ? rec.quickWins.length : 0,
      validationChecklistLength: Array.isArray(rec.validationChecklist) ? rec.validationChecklist.length : 0
    });

    if (unlockState === 'active') siteWideActive++;
    if (unlockState === 'locked') siteWideLocked++;

    // Get recommendation text with proper fallback chain
    const recText = rec.title || rec.recommendation_text || rec.recommendation || 'Recommendation';

    try {
      await db.query(
        `INSERT INTO scan_recommendations (
          scan_id, category, recommendation_text, priority,
          estimated_impact, estimated_effort, action_steps, findings, code_snippet,
          unlock_state, batch_number, unlocked_at,
          recommendation_type, page_url, skip_enabled_at, impact_description,
          customized_implementation, ready_to_use_content, implementation_notes, quick_wins, validation_checklist,
          score_at_creation, source_scan_id, context_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
        [
          scanId,
          rec.category || 'General',
          recText,  // Save recommendation text with fallback
          rec.priority || rec.priorityScore || 50,
          rec.estimatedScoreGain || rec.estimated_impact || 0,
          rec.difficulty || rec.estimated_effort || 'medium',
          rec.actionSteps || rec.action_steps ? JSON.stringify(rec.actionSteps || rec.action_steps) : null,
          rec.finding || rec.findings || null,
          rec.codeSnippet || rec.code_snippet || null,
          unlockState,
          batchNumber,
          unlockedAt,
          'site-wide',
          null, // No specific page URL
          skipEnabledAt,
          rec.impact || rec.impact_description || null,
          rec.customizedImplementation || rec.customized_implementation || null,
          rec.readyToUseContent || rec.ready_to_use_content || null,
          rec.implementationNotes || rec.implementation_notes ? JSON.stringify(rec.implementationNotes || rec.implementation_notes) : null,
          rec.quickWins || rec.quick_wins ? JSON.stringify(rec.quickWins || rec.quick_wins) : null,
          rec.validationChecklist || rec.validation_checklist ? JSON.stringify(rec.validationChecklist || rec.validation_checklist) : null,
          scanScore,
          scanId,
          contextId
        ]
      );
    } catch (insertError) {
      console.error(`❌ Failed to insert site-wide recommendation ${i}:`, insertError.message);
      // Continue with other recommendations even if one fails
    }
  }

  console.log(`   ✅ Saved ${siteWideActive} active, ${siteWideLocked} locked site-wide`);
  
  // Save page-specific recommendations
  let pageSpecificTotal = 0;
  let pageSpecificActive = 0;
  let pageSpecificLocked = 0;

  for (const page of pagesWithRecs) {
    const pageRecs = pageSpecificRecs.slice(
      pageSpecificTotal,
      pageSpecificTotal + recsPerPage
    );

    for (const rec of pageRecs) {
      // Calculate global index (site-wide + page-specific saved so far)
      const globalIndex = limitedSiteWide.length + pageSpecificTotal;
      const batchNumber = Math.floor(globalIndex / 5) + 1;
      const unlockState = globalIndex < initialActive ? 'active' : 'locked';
      const unlockedAt = globalIndex < initialActive ? new Date() : null;
      const skipEnabledAt = globalIndex < initialActive ? new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) : null; // 5 days

      if (unlockState === 'active') pageSpecificActive++;
      if (unlockState === 'locked') pageSpecificLocked++;

      // Get recommendation text with proper fallback chain (handles both fresh and DB row formats)
      const recText = rec.title || rec.recommendation_text || rec.recommendation || 'Recommendation';

      // DEBUG: Log page-specific recommendations
      console.log('📦 PAGE-SPECIFIC Recommendation being saved:', {
        title: recText?.substring(0, 50),
        category: rec.category,
        globalIndex,
        batchNumber,
        unlockState
      });

      try {
        await db.query(
          `INSERT INTO scan_recommendations (
            scan_id, category, recommendation_text, priority,
            estimated_impact, estimated_effort, action_steps, findings, code_snippet,
            unlock_state, batch_number, unlocked_at, skip_enabled_at,
            recommendation_type, page_url, page_priority, impact_description,
            customized_implementation, ready_to_use_content, implementation_notes, quick_wins, validation_checklist,
            score_at_creation, source_scan_id, context_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`,
          [
            scanId,
            rec.category || 'General',
            recText,  // Save recommendation text with fallback
            rec.priority || rec.priorityScore || 50,
            rec.estimatedScoreGain || rec.estimated_impact || 0,
            rec.difficulty || rec.estimated_effort || 'medium',
            rec.actionSteps || rec.action_steps ? JSON.stringify(rec.actionSteps || rec.action_steps) : null,
            rec.finding || rec.findings || null,
            rec.codeSnippet || rec.code_snippet || null,
            unlockState,
            batchNumber,
            unlockedAt,
            skipEnabledAt,
            'page-specific',
            page.url,
            page.priority || 1,
            rec.impact || rec.impact_description || null,
            rec.customizedImplementation || rec.customized_implementation || null,
            rec.readyToUseContent || rec.ready_to_use_content || null,
            rec.implementationNotes || rec.implementation_notes ? JSON.stringify(rec.implementationNotes || rec.implementation_notes) : null,
            rec.quickWins || rec.quick_wins ? JSON.stringify(rec.quickWins || rec.quick_wins) : null,
            rec.validationChecklist || rec.validation_checklist ? JSON.stringify(rec.validationChecklist || rec.validation_checklist) : null,
            scanScore,
            scanId,
            contextId
          ]
        );
        pageSpecificTotal++;
      } catch (insertError) {
        console.error(`❌ Failed to insert page-specific recommendation:`, insertError.message);
        // Continue with other recommendations even if one fails
      }
    }
    
    // Create page_priorities entry
    await db.query(
      `INSERT INTO page_priorities (
        scan_id, page_url, priority_rank, 
        total_recommendations, completed_recommendations, unlocked
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (scan_id, page_url) DO NOTHING`,
      [scanId, page.url, page.priority || 1, pageRecs.length, 0, false]
    );
  }

  console.log(`   ✅ Saved ${pageSpecificActive} active, ${pageSpecificLocked} locked page-specific`);

  // Calculate batch unlock dates (every 5 days)
  const now = new Date();
  const batch1Date = now; // Immediate
  const batch2Date = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000); // +5 days
  const batch3Date = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000); // +10 days
  const batch4Date = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000); // +15 days

  const totalRecs = limitedSiteWide.length + pageSpecificTotal;
  const totalBatches = Math.ceil(totalRecs / 5);

  console.log(`   📅 Batch unlock schedule:`);
  console.log(`      Batch 1: ${batch1Date.toLocaleDateString()} (now)`);
  console.log(`      Batch 2: ${batch2Date.toLocaleDateString()} (+5 days)`);
  if (totalBatches >= 3) console.log(`      Batch 3: ${batch3Date.toLocaleDateString()} (+10 days)`);
  if (totalBatches >= 4) console.log(`      Batch 4: ${batch4Date.toLocaleDateString()} (+15 days)`);

  // Create user_progress record with batch unlock dates
  const totalActiveRecs = siteWideActive + pageSpecificActive;

  // Set next replacement date (5 days from now)
  const nextReplacementDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

  // Try to insert with new columns, fall back to old schema if migration not run
  try {
    await db.query(
      `INSERT INTO user_progress (
        user_id, scan_id,
        total_recommendations, active_recommendations,
        completed_recommendations, verified_recommendations,
        current_batch, last_unlock_date, unlocks_today,
        site_wide_total, site_wide_completed, site_wide_active,
        page_specific_total, page_specific_completed,
        site_wide_complete,
        batch_1_unlock_date, batch_2_unlock_date,
        batch_3_unlock_date, batch_4_unlock_date,
        total_batches,
        next_replacement_date, target_active_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, 1, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [
        userId,
        scanId,
        totalRecs, // Total
        totalActiveRecs, // Active (site-wide + page-specific)
        0, // Completed
        0, // Verified
        1, // Current batch
        limitedSiteWide.length, // Site-wide total
        0, // Site-wide completed
        siteWideActive, // Site-wide active
        pageSpecificTotal, // Page-specific total
        0, // Page-specific completed
        false, // Site-wide not complete yet
        batch1Date, // Batch 1 unlock date (now)
        totalBatches >= 2 ? batch2Date : null, // Batch 2 unlock date
        totalBatches >= 3 ? batch3Date : null, // Batch 3 unlock date
        totalBatches >= 4 ? batch4Date : null, // Batch 4 unlock date
        totalBatches, // Total number of batches
        nextReplacementDate, // Next replacement date (+5 days)
        5 // Target active count (always 5 for DIY)
      ]
    );
  } catch (insertError) {
    // If new columns don't exist (migration not run), use old schema
    if (insertError.code === '42703') { // Column does not exist
      console.log('   ⚠️  Using legacy user_progress schema (migration not run)');
      await db.query(
        `INSERT INTO user_progress (
          user_id, scan_id,
          total_recommendations, active_recommendations,
          completed_recommendations, verified_recommendations,
          current_batch, last_unlock_date, unlocks_today,
          site_wide_total, site_wide_completed, site_wide_active,
          page_specific_total, page_specific_completed,
          site_wide_complete,
          batch_1_unlock_date, batch_2_unlock_date,
          batch_3_unlock_date, batch_4_unlock_date,
          total_batches
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, 1, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [
          userId,
          scanId,
          totalRecs,
          totalActiveRecs,
          0, // Completed
          0, // Verified
          1, // Current batch
          limitedSiteWide.length,
          0, // Site-wide completed
          siteWideActive,
          pageSpecificTotal,
          0, // Page-specific completed
          false,
          batch1Date,
          totalBatches >= 2 ? batch2Date : null,
          totalBatches >= 3 ? batch3Date : null,
          totalBatches >= 4 ? batch4Date : null,
          totalBatches
        ]
      );
    } else {
      throw insertError; // Re-throw other errors
    }
  }

  console.log(`   ✅ Progress tracking initialized with ${totalBatches} batch${totalBatches > 1 ? 'es' : ''}`);
  console.log(`   📊 Recommendations saved:`);
  console.log(`      Site-wide: ${limitedSiteWide.length} (${siteWideActive} active)`);
  console.log(`      Page-specific: ${pageSpecificTotal} (${pageSpecificActive} active)`);
  console.log(`      Total: ${totalRecs} (${totalActiveRecs} active in batch 1)`);

  return {
    siteWideTotal: limitedSiteWide.length,
    siteWideActive,
    pageSpecificTotal,
    pageSpecificActive,
    totalRecommendations: totalRecs,
    totalActive: totalActiveRecs
  };
}

module.exports = {
  classifyRecommendation,
  saveHybridRecommendations
};