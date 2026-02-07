/**
 * Scan Completion Hook
 *
 * Triggered when a scan completes. Handles:
 * 1. Auto-detection of implemented recommendations
 * 2. Mode transitions (Optimization ↔ Elite Maintenance)
 * 3. Impact score calculation for recommendations
 * 4. Refresh cycle initialization
 * 5. Score history tracking
 */

const { Pool } = require('pg');
const AutoDetectionService = require('./auto-detection-service');
const ModeTransitionService = require('./mode-transition-service');
const RefreshCycleService = require('./refresh-cycle-service');
const ImpactScoreCalculator = require('./impact-score-calculator');
const EliteRecommendationGenerator = require('./elite-recommendation-generator');
const RecommendationContextService = require('./recommendation-context-service');
const { generateAndPersistRecommendations } = require('./recommendation-orchestrator');

class ScanCompletionHook {
  constructor(pool) {
    this.pool = pool || new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
  }

  /**
   * Main hook - called when scan completes
   *
   * @param {Number} userId - User ID
   * @param {Number} scanId - Completed scan ID
   * @param {Object} scanResults - Scan results object
   * @param {Object} scanMeta - Optional metadata { domain, pages, isCompetitorScan }
   */
  async onScanComplete(userId, scanId, scanResults, scanMeta = {}) {
    console.log(`\n🔗 Running scan completion hook for scan ${scanId}...`);

    const { domain, pages = [], isCompetitorScan = false } = scanMeta;

    try {
      // 1. Record score history (ALWAYS runs - score should update on every scan)
      await this.recordScoreHistory(userId, scanId, scanResults);

      // 2. Check for mode transition (ALWAYS runs)
      await this.checkModeTransition(userId, scanId, scanResults);

      // 3. Run auto-detection (ALWAYS runs - checks for implementations)
      await this.runAutoDetection(userId, scanId);

      // 4. CHECK FOR ACTIVE RECOMMENDATION CONTEXT
      // If user has scanned this same domain/pages within 5 days,
      // reuse existing recommendations instead of generating new ones
      const contextService = new RecommendationContextService(this.pool);
      const contextCheck = await contextService.shouldSkipRecommendationGeneration(
        userId,
        domain || scanResults.domain || scanResults.url,
        pages,
        isCompetitorScan
      );

      if (contextCheck.shouldSkip && contextCheck.activeContext) {
        // REUSE EXISTING RECOMMENDATIONS
        console.log('  📎 Active recommendation context found - reusing existing recommendations');
        console.log(`     Context expires: ${contextCheck.activeContext.expiresAt}`);
        console.log(`     Primary scan: ${contextCheck.activeContext.primaryScanId}`);

        // Link this scan to the existing context
        await contextService.linkScanToContext(
          contextCheck.activeContext.contextId,
          scanId
        );

        // Copy recommendation references to this scan (so queries work)
        await contextService.copyRecommendationReferences(
          contextCheck.activeContext.primaryScanId,
          scanId
        );

        console.log('     ✓ Scan linked to existing recommendation set');
        console.log('     ✓ Skipping recommendation generation (within 5-day window)');

      } else {
        // GENERATE NEW RECOMMENDATIONS
        console.log('  📎 No active context - generating new recommendations');

        // 4.5. Generate base recommendations via orchestrator
        console.log('  🎯 Generating recommendations...');
        try {
          const recResult = await generateAndPersistRecommendations(scanId);
          console.log(`     ✓ Generated ${recResult.recommendations_count || 0} recommendations`);
        } catch (recError) {
          console.error('     ✗ Recommendation generation failed:', recError.message);
          // Continue with hook - don't fail the entire completion
        }

        // 5. Calculate impact scores for recommendations
        await this.calculateImpactScores(userId, scanId, scanResults);

        // 6. Generate Elite mode recommendations if needed
        await this.generateEliteRecommendations(userId, scanId, scanResults);

        // 7. Initialize refresh cycle for paid users only (Free users don't need refresh cycles)
        const userResult = await this.pool.query('SELECT plan FROM users WHERE id = $1', [userId]);
        const userPlan = userResult.rows[0]?.plan || 'free';

        if (userPlan !== 'free') {
          await this.initializeRefreshCycle(userId, scanId);
        } else {
          console.log(`  ⏭️ Skipping refresh cycle for Free user ${userId}`);
        }

        // 8. Create new recommendation context
        if (domain && !isCompetitorScan) {
          await contextService.createContext(userId, scanId, domain, pages, null, userPlan);
        }
      }

      console.log(`✅ Scan completion hook finished successfully\n`);

      return {
        success: true,
        reusedContext: contextCheck.shouldSkip,
        contextInfo: contextCheck.activeContext || null
      };

    } catch (error) {
      console.error('❌ Scan completion hook failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Record score history for tracking and plateau detection
   */
  async recordScoreHistory(userId, scanId, scanResults) {
    console.log('  📊 Recording score history...');

    try {
      // Get previous scan for delta calculation
      const previousScan = await this.pool.query(`
        SELECT total_score
        FROM scans
        WHERE
          user_id = $1
          AND id < $2
          AND status = 'completed'
        ORDER BY created_at DESC
        LIMIT 1
      `, [userId, scanId]);

      const previousScore = previousScan.rows.length > 0 ? previousScan.rows[0].total_score : 0;
      const scoreDelta = scanResults.total_score - previousScore;

      // Insert score history
      await this.pool.query(`
        INSERT INTO score_history (
          user_id,
          scan_id,
          total_score,
          ai_readability_score,
          ai_search_readiness_score,
          content_freshness_score,
          content_structure_score,
          speed_ux_score,
          technical_setup_score,
          trust_authority_score,
          voice_optimization_score,
          score_delta,
          scan_date
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
      `, [
        userId,
        scanId,
        scanResults.total_score,
        scanResults.ai_readability_score || 0,
        scanResults.ai_search_readiness_score || 0,
        scanResults.content_freshness_score || 0,
        scanResults.content_structure_score || 0,
        scanResults.speed_ux_score || 0,
        scanResults.technical_setup_score || 0,
        scanResults.trust_authority_score || 0,
        scanResults.voice_optimization_score || 0,
        scoreDelta
      ]);

      console.log(`     ✓ Score history recorded (score: ${scanResults.total_score}, delta: ${scoreDelta})`);
    } catch (error) {
      console.error('     ✗ Failed to record score history:', error);
      throw error;
    }
  }

  /**
   * Check and process mode transition
   */
  async checkModeTransition(userId, scanId, scanResults) {
    console.log('  🔄 Checking mode transition...');

    try {
      const modeService = new ModeTransitionService(this.pool);
      const transition = await modeService.checkAndTransition(
        userId,
        scanId,
        scanResults.total_score
      );

      if (transition.transitioned) {
        console.log(`     ✓ Mode transition: ${transition.fromMode} → ${transition.toMode}`);
      } else {
        console.log(`     ✓ Mode unchanged: ${transition.currentMode}`);
      }

      return transition;
    } catch (error) {
      console.error('     ✗ Mode transition check failed:', error);
      throw error;
    }
  }

  /**
   * Run auto-detection for implementations
   */
  async runAutoDetection(userId, scanId) {
    console.log('  🔍 Running auto-detection...');

    try {
      const autoDetectionService = new AutoDetectionService(this.pool);
      const detections = await autoDetectionService.detectImplementations(userId, scanId);

      if (detections.length > 0) {
        console.log(`     ✓ Detected ${detections.length} implementation(s)`);
      } else {
        console.log(`     ✓ No implementations detected`);
      }

      // Also check for skipped implementations
      const skippedImplementations = await autoDetectionService.checkSkippedImplementations(userId, scanId);

      if (skippedImplementations.length > 0) {
        console.log(`     ✓ Detected ${skippedImplementations.length} previously skipped item(s) now implemented`);
      }

      return { detections, skippedImplementations };
    } catch (error) {
      console.error('     ✗ Auto-detection failed:', error);
      // Don't throw - auto-detection failure shouldn't break the hook
      return { detections: [], skippedImplementations: [] };
    }
  }

  /**
   * Calculate impact scores for all recommendations
   */
  async calculateImpactScores(userId, scanId, scanResults) {
    console.log('  📈 Calculating impact scores...');

    try {
      // Get user's industry and current mode
      const userInfo = await this.pool.query(`
        SELECT u.industry, um.current_mode
        FROM users u
        LEFT JOIN user_modes um ON u.id = um.user_id
        WHERE u.id = $1
      `, [userId]);

      if (userInfo.rows.length === 0) {
        console.log('     ✗ User not found');
        return;
      }

      const industry = userInfo.rows[0].industry;
      const currentMode = userInfo.rows[0].current_mode || 'optimization';

      // Get all recommendations for this scan
      const recommendations = await this.pool.query(`
        SELECT *
        FROM scan_recommendations
        WHERE scan_id = $1 AND impact_score IS NULL
      `, [scanId]);

      if (recommendations.rows.length === 0) {
        console.log('     ✓ No recommendations need impact score calculation');
        return;
      }

      // Prepare pillar scores
      const pillarScores = {
        aiReadability: scanResults.ai_readability_score || 0,
        aiSearchReadiness: scanResults.ai_search_readiness_score || 0,
        contentFreshness: scanResults.content_freshness_score || 0,
        contentStructure: scanResults.content_structure_score || 0,
        speedUX: scanResults.speed_ux_score || 0,
        technicalSetup: scanResults.technical_setup_score || 0,
        trustAuthority: scanResults.trust_authority_score || 0,
        voiceOptimization: scanResults.voice_optimization_score || 0
      };

      // Calculate impact scores
      let updated = 0;
      for (const rec of recommendations.rows) {
        const impactScore = ImpactScoreCalculator.calculateImpactScore(
          rec,
          pillarScores,
          industry,
          currentMode
        );

        await this.pool.query(`
          UPDATE scan_recommendations
          SET
            impact_score = $1,
            compounding_effect_score = $2,
            industry_relevance_score = $3
          WHERE id = $4
        `, [
          impactScore,
          ImpactScoreCalculator.calculateCompoundingScore(rec, pillarScores),
          ImpactScoreCalculator.calculateIndustryScore(rec, industry),
          rec.id
        ]);

        updated++;
      }

      console.log(`     ✓ Calculated impact scores for ${updated} recommendations`);
    } catch (error) {
      console.error('     ✗ Impact score calculation failed:', error);
      // Don't throw - this shouldn't break the hook
    }
  }

  /**
   * Generate Elite mode recommendations if user is in Elite mode
   */
  async generateEliteRecommendations(userId, scanId, scanResults) {
    console.log('  🌟 Checking Elite mode recommendations...');

    try {
      // Get user's current mode
      const modeInfo = await this.pool.query(`
        SELECT current_mode FROM user_modes WHERE user_id = $1
      `, [userId]);

      if (modeInfo.rows.length === 0 || modeInfo.rows[0].current_mode !== 'elite_maintenance') {
        console.log('     ✓ User not in Elite mode, skipping');
        return;
      }

      // Get user's industry and tracked competitors
      const userInfo = await this.pool.query(`
        SELECT u.industry, ct.competitor_name, ct.recent_improvements, ct.latest_score
        FROM users u
        LEFT JOIN competitive_tracking ct ON u.id = ct.user_id AND ct.is_active = true
        WHERE u.id = $1
      `, [userId]);

      const industry = userInfo.rows[0]?.industry;
      const competitors = userInfo.rows.map(row => ({
        competitor_name: row.competitor_name,
        recent_improvements: row.recent_improvements || [],
        latest_score: row.latest_score
      })).filter(c => c.competitor_name);

      // Generate Elite recommendations
      const eliteGenerator = new EliteRecommendationGenerator(this.pool);
      const eliteRecs = await eliteGenerator.generateEliteRecommendations(
        scanResults,
        industry,
        competitors
      );

      // Save Elite recommendations
      for (const rec of eliteRecs) {
        await this.pool.query(`
          INSERT INTO scan_recommendations (
            scan_id,
            category,
            elite_category,
            title,
            recommendation_text,
            findings,
            priority,
            estimated_impact,
            implementation_difficulty,
            customized_implementation,
            code_snippet,
            implementation_notes,
            status,
            recommendation_mode,
            unlock_state
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', 'elite_maintenance', 'active')
        `, [
          scanId,
          rec.category,
          rec.elite_category,
          rec.title,
          rec.recommendation_text,
          rec.findings,
          rec.priority,
          rec.estimated_impact,
          rec.implementation_difficulty,
          rec.customized_implementation,
          rec.code_snippet,
          JSON.stringify(rec.implementation_notes)
        ]);
      }

      console.log(`     ✓ Generated ${eliteRecs.length} Elite mode recommendations`);
    } catch (error) {
      console.error('     ✗ Elite recommendation generation failed:', error);
      // Don't throw
    }
  }

  /**
   * Initialize or check refresh cycle
   */
  async initializeRefreshCycle(userId, scanId) {
    console.log('  🔄 Checking refresh cycle...');

    try {
      const refreshService = new RefreshCycleService(this.pool);

      // Check if refresh cycle already exists
      const existingCycle = await this.pool.query(`
        SELECT id FROM recommendation_refresh_cycles
        WHERE user_id = $1 AND scan_id = $2
      `, [userId, scanId]);

      if (existingCycle.rows.length === 0) {
        // Initialize new refresh cycle
        await refreshService.initializeRefreshCycle(userId, scanId);
        console.log(`     ✓ Refresh cycle initialized`);
      } else {
        console.log(`     ✓ Refresh cycle already exists`);
      }
    } catch (error) {
      console.error('     ✗ Refresh cycle initialization failed:', error);
      // Don't throw
    }
  }

  /**
   * Manual trigger (for testing/debugging)
   */
  async manualTrigger(scanId) {
    const scan = await this.pool.query(
      'SELECT * FROM scans WHERE id = $1',
      [scanId]
    );

    if (scan.rows.length === 0) {
      throw new Error('Scan not found');
    }

    const scanData = scan.rows[0];

    return await this.onScanComplete(
      scanData.user_id,
      scanData.id,
      {
        total_score: scanData.total_score,
        ai_readability_score: scanData.ai_readability_score,
        ai_search_readiness_score: scanData.ai_search_readiness_score,
        content_freshness_score: scanData.content_freshness_score,
        content_structure_score: scanData.content_structure_score,
        speed_ux_score: scanData.speed_ux_score,
        technical_setup_score: scanData.technical_setup_score,
        trust_authority_score: scanData.trust_authority_score,
        voice_optimization_score: scanData.voice_optimization_score,
        detailed_analysis: scanData.detailed_analysis
      }
    );
  }
}

module.exports = ScanCompletionHook;
