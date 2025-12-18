// backend/analyzers/detection-lifecycle.js
/**
 * DETECTION STATE LIFECYCLE
 *
 * Per rulebook "Detection State Lifecycle":
 * Manages the lifecycle of detection states to track changes over time.
 *
 * Supports:
 * - 5-day improvement cycle tracking
 * - State transitions (new → in-progress → resolved)
 * - Change detection between scans
 * - Historical comparison
 * - Progress metrics
 */

/**
 * Detection states
 */
const DETECTION_STATE = {
  NEW: 'new',               // First time detected
  RECURRING: 'recurring',   // Detected again (not fixed)
  IN_PROGRESS: 'in-progress', // Partially addressed
  RESOLVED: 'resolved',     // No longer detected
  REGRESSED: 'regressed'    // Was resolved, now detected again
};

/**
 * State transition rules
 */
const STATE_TRANSITIONS = {
  [DETECTION_STATE.NEW]: [DETECTION_STATE.IN_PROGRESS, DETECTION_STATE.RESOLVED],
  [DETECTION_STATE.RECURRING]: [DETECTION_STATE.IN_PROGRESS, DETECTION_STATE.RESOLVED],
  [DETECTION_STATE.IN_PROGRESS]: [DETECTION_STATE.RESOLVED, DETECTION_STATE.RECURRING],
  [DETECTION_STATE.RESOLVED]: [DETECTION_STATE.REGRESSED],
  [DETECTION_STATE.REGRESSED]: [DETECTION_STATE.IN_PROGRESS, DETECTION_STATE.RESOLVED]
};

/**
 * Detection lifecycle manager
 */
class DetectionLifecycle {
  constructor(historyStore = null) {
    // historyStore would be a database adapter in production
    this.historyStore = historyStore;
    this.currentState = new Map(); // issueId -> state
    this.history = [];
  }

  /**
   * Load historical state for a URL
   * @param {string} url - The URL being scanned
   * @returns {Object} - Previous detection state
   */
  async loadHistory(url) {
    if (this.historyStore) {
      try {
        const history = await this.historyStore.getHistory(url);
        return history || { scans: [], issues: {} };
      } catch (err) {
        console.error('[DetectionLifecycle] Error loading history:', err.message);
      }
    }
    return { scans: [], issues: {} };
  }

  /**
   * Compare current detection with previous state
   * @param {Object} currentResults - Current anti-pattern detection results
   * @param {Object} previousState - Previous detection state
   * @returns {Object} - Comparison results
   */
  compareWithPrevious(currentResults, previousState) {
    const comparison = {
      newIssues: [],        // Issues detected for first time
      recurringIssues: [],  // Issues still present
      resolvedIssues: [],   // Issues no longer detected
      regressedIssues: [],  // Issues that returned
      progressMade: false,
      regressionFound: false,
      summary: {}
    };

    const currentIssueIds = new Set((currentResults.detected || []).map(i => i.id));
    const previousIssueIds = new Set(Object.keys(previousState.issues || {}));

    // Find new issues
    for (const issue of (currentResults.detected || [])) {
      if (!previousIssueIds.has(issue.id)) {
        comparison.newIssues.push({
          ...issue,
          state: DETECTION_STATE.NEW,
          firstDetected: new Date().toISOString()
        });
      } else {
        // Check if it was resolved before
        const prevIssue = previousState.issues[issue.id];
        if (prevIssue?.state === DETECTION_STATE.RESOLVED) {
          comparison.regressedIssues.push({
            ...issue,
            state: DETECTION_STATE.REGRESSED,
            previouslyResolvedAt: prevIssue.resolvedAt,
            regressedAt: new Date().toISOString()
          });
          comparison.regressionFound = true;
        } else {
          comparison.recurringIssues.push({
            ...issue,
            state: DETECTION_STATE.RECURRING,
            firstDetected: prevIssue?.firstDetected || new Date().toISOString(),
            occurrenceCount: (prevIssue?.occurrenceCount || 1) + 1
          });
        }
      }
    }

    // Find resolved issues
    for (const [issueId, prevIssue] of Object.entries(previousState.issues || {})) {
      if (!currentIssueIds.has(issueId) && prevIssue.state !== DETECTION_STATE.RESOLVED) {
        comparison.resolvedIssues.push({
          id: issueId,
          name: prevIssue.name,
          state: DETECTION_STATE.RESOLVED,
          resolvedAt: new Date().toISOString(),
          firstDetected: prevIssue.firstDetected,
          daysToResolve: this.calculateDaysToResolve(prevIssue.firstDetected)
        });
        comparison.progressMade = true;
      }
    }

    // Summary
    comparison.summary = {
      totalCurrent: currentIssueIds.size,
      totalPrevious: previousIssueIds.size,
      newCount: comparison.newIssues.length,
      resolvedCount: comparison.resolvedIssues.length,
      recurringCount: comparison.recurringIssues.length,
      regressedCount: comparison.regressedIssues.length,
      netChange: currentIssueIds.size - previousIssueIds.size,
      trend: this.calculateTrend(currentIssueIds.size, previousIssueIds.size)
    };

    return comparison;
  }

  /**
   * Calculate days to resolve an issue
   */
  calculateDaysToResolve(firstDetected) {
    if (!firstDetected) return 0;
    const start = new Date(firstDetected);
    const end = new Date();
    return Math.floor((end - start) / (1000 * 60 * 60 * 24));
  }

  /**
   * Calculate trend direction
   */
  calculateTrend(current, previous) {
    if (current < previous) return 'improving';
    if (current > previous) return 'declining';
    return 'stable';
  }

  /**
   * Generate 5-day improvement cycle report
   * @param {Array} scanHistory - Array of past scan results
   * @returns {Object} - Cycle report
   */
  generate5DayCycleReport(scanHistory) {
    if (!scanHistory || scanHistory.length === 0) {
      return {
        hasCycleData: false,
        message: 'No historical data available for cycle analysis'
      };
    }

    // Get scans from last 5 days
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const recentScans = scanHistory.filter(scan =>
      new Date(scan.timestamp) >= fiveDaysAgo
    ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    if (recentScans.length < 2) {
      return {
        hasCycleData: false,
        scansInPeriod: recentScans.length,
        message: 'Need at least 2 scans in 5-day period for cycle analysis'
      };
    }

    const firstScan = recentScans[0];
    const lastScan = recentScans[recentScans.length - 1];

    // Calculate metrics
    const startIssues = new Set(firstScan.issues || []);
    const endIssues = new Set(lastScan.issues || []);

    const resolvedDuringCycle = [...startIssues].filter(i => !endIssues.has(i));
    const newDuringCycle = [...endIssues].filter(i => !startIssues.has(i));
    const persistentIssues = [...startIssues].filter(i => endIssues.has(i));

    // Calculate scores
    const scoreChange = (lastScan.score || 0) - (firstScan.score || 0);
    const improvementRate = startIssues.size > 0
      ? Math.round((resolvedDuringCycle.length / startIssues.size) * 100)
      : 0;

    return {
      hasCycleData: true,
      cyclePeriod: {
        start: firstScan.timestamp,
        end: lastScan.timestamp,
        daysSpanned: Math.ceil((new Date(lastScan.timestamp) - new Date(firstScan.timestamp)) / (1000 * 60 * 60 * 24))
      },
      scansInPeriod: recentScans.length,
      metrics: {
        startIssueCount: startIssues.size,
        endIssueCount: endIssues.size,
        issuesResolved: resolvedDuringCycle.length,
        newIssuesFound: newDuringCycle.length,
        persistentIssues: persistentIssues.length,
        netChange: endIssues.size - startIssues.size
      },
      scoreProgress: {
        startScore: firstScan.score || 0,
        endScore: lastScan.score || 0,
        change: scoreChange,
        percentChange: firstScan.score > 0
          ? Math.round((scoreChange / firstScan.score) * 100)
          : 0
      },
      improvementRate,
      status: this.determineCycleStatus(improvementRate, scoreChange),
      recommendations: this.generateCycleRecommendations(persistentIssues, newDuringCycle, improvementRate)
    };
  }

  /**
   * Determine cycle status
   */
  determineCycleStatus(improvementRate, scoreChange) {
    if (improvementRate >= 50 && scoreChange > 0) {
      return {
        level: 'excellent',
        message: 'Great progress! Over half of issues resolved.'
      };
    }
    if (improvementRate >= 25 || scoreChange > 0) {
      return {
        level: 'good',
        message: 'Making progress. Continue addressing issues.'
      };
    }
    if (improvementRate > 0) {
      return {
        level: 'moderate',
        message: 'Some improvement. Focus on critical issues.'
      };
    }
    if (scoreChange < 0) {
      return {
        level: 'declining',
        message: 'Score decreased. Review recent changes.'
      };
    }
    return {
      level: 'stagnant',
      message: 'No change detected. Prioritize actionable items.'
    };
  }

  /**
   * Generate recommendations for the cycle
   */
  generateCycleRecommendations(persistentIssues, newIssues, improvementRate) {
    const recommendations = [];

    if (persistentIssues.length > 0) {
      recommendations.push({
        priority: 1,
        type: 'persistent',
        message: `${persistentIssues.length} issues remain unresolved. Focus on these first.`,
        issues: persistentIssues.slice(0, 3)
      });
    }

    if (newIssues.length > 0) {
      recommendations.push({
        priority: 2,
        type: 'new',
        message: `${newIssues.length} new issues appeared. Check recent changes.`,
        issues: newIssues.slice(0, 3)
      });
    }

    if (improvementRate < 25) {
      recommendations.push({
        priority: 3,
        type: 'strategy',
        message: 'Consider breaking down large issues into smaller tasks.'
      });
    }

    return recommendations;
  }

  /**
   * Create a snapshot for storage
   * @param {string} url - URL being scanned
   * @param {Object} currentResults - Current detection results
   * @param {number} score - Current score
   * @returns {Object} - Snapshot for storage
   */
  createSnapshot(url, currentResults, score) {
    const issueStates = {};

    for (const issue of (currentResults.detected || [])) {
      const existingState = this.currentState.get(issue.id);

      issueStates[issue.id] = {
        id: issue.id,
        name: issue.name,
        severity: issue.severity,
        category: issue.category,
        state: existingState?.state || DETECTION_STATE.NEW,
        firstDetected: existingState?.firstDetected || new Date().toISOString(),
        lastDetected: new Date().toISOString(),
        occurrenceCount: (existingState?.occurrenceCount || 0) + 1
      };
    }

    return {
      url,
      timestamp: new Date().toISOString(),
      score,
      issueCount: currentResults.summary?.total || 0,
      issues: Object.keys(issueStates),
      issueStates,
      summary: currentResults.summary
    };
  }

  /**
   * Save snapshot (if store available)
   * @param {Object} snapshot - Snapshot to save
   */
  async saveSnapshot(snapshot) {
    if (this.historyStore) {
      try {
        await this.historyStore.saveSnapshot(snapshot);
        console.log('[DetectionLifecycle] Snapshot saved for', snapshot.url);
      } catch (err) {
        console.error('[DetectionLifecycle] Error saving snapshot:', err.message);
      }
    }

    // Update in-memory state
    for (const [issueId, issueData] of Object.entries(snapshot.issueStates)) {
      this.currentState.set(issueId, issueData);
    }

    this.history.push(snapshot);
  }

  /**
   * Get improvement suggestions based on lifecycle
   * @param {Object} comparison - Comparison results
   * @returns {Array} - Prioritized suggestions
   */
  getImprovementSuggestions(comparison) {
    const suggestions = [];

    // Prioritize regressed issues
    if (comparison.regressedIssues.length > 0) {
      suggestions.push({
        priority: 'critical',
        type: 'regression',
        message: `${comparison.regressedIssues.length} previously fixed issue(s) have returned`,
        action: 'Review recent changes that may have caused regression',
        issues: comparison.regressedIssues.slice(0, 3).map(i => i.name)
      });
    }

    // Address long-standing issues
    const oldIssues = comparison.recurringIssues.filter(i => i.occurrenceCount >= 3);
    if (oldIssues.length > 0) {
      suggestions.push({
        priority: 'high',
        type: 'persistent',
        message: `${oldIssues.length} issue(s) have persisted through 3+ scans`,
        action: 'These need dedicated attention',
        issues: oldIssues.slice(0, 3).map(i => i.name)
      });
    }

    // Celebrate progress
    if (comparison.resolvedIssues.length > 0) {
      suggestions.push({
        priority: 'info',
        type: 'progress',
        message: `${comparison.resolvedIssues.length} issue(s) resolved since last scan`,
        action: 'Great progress! Keep it up.',
        issues: comparison.resolvedIssues.slice(0, 3).map(i => i.name)
      });
    }

    // New issues warning
    if (comparison.newIssues.length > 0) {
      suggestions.push({
        priority: 'medium',
        type: 'new',
        message: `${comparison.newIssues.length} new issue(s) detected`,
        action: 'Review these to prevent them from becoming persistent',
        issues: comparison.newIssues.slice(0, 3).map(i => i.name)
      });
    }

    return suggestions.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, info: 3 };
      return (order[a.priority] || 4) - (order[b.priority] || 4);
    });
  }
}

/**
 * In-memory history store for development/testing
 */
class InMemoryHistoryStore {
  constructor() {
    this.data = new Map(); // url -> { scans: [], issues: {} }
  }

  async getHistory(url) {
    return this.data.get(url) || { scans: [], issues: {} };
  }

  async saveSnapshot(snapshot) {
    const existing = this.data.get(snapshot.url) || { scans: [], issues: {} };

    existing.scans.push({
      timestamp: snapshot.timestamp,
      score: snapshot.score,
      issueCount: snapshot.issueCount,
      issues: snapshot.issues
    });

    // Keep last 30 scans
    if (existing.scans.length > 30) {
      existing.scans = existing.scans.slice(-30);
    }

    // Update issue states
    for (const [issueId, issueData] of Object.entries(snapshot.issueStates)) {
      existing.issues[issueId] = issueData;
    }

    this.data.set(snapshot.url, existing);
  }
}

module.exports = {
  DetectionLifecycle,
  InMemoryHistoryStore,
  DETECTION_STATE,
  STATE_TRANSITIONS
};
