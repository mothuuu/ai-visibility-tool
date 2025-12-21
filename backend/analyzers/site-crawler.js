const axios = require('axios');
const { ContentExtractor, extractWithFallback, resetRenderCounter } = require('./content-extractor');
const VOCABULARY = require('../config/detection-vocabulary');

/**
 * Site Crawler - Multi-Page Analysis
 *
 * Crawls multiple pages from a website to enable site-wide metrics
 * as required by the Enhanced AI Readiness Assessment Rubric v3.0
 *
 * Features:
 * - Fetches and parses sitemap.xml
 * - Crawls up to N pages (configurable, default 15)
 * - Aggregates evidence across all pages
 * - Calculates site-wide percentages
 */

class SiteCrawler {
  constructor(baseUrl, options = {}) {
    this.baseUrl = baseUrl;
    this.options = {
      maxPages: options.maxPages || 15,
      timeout: options.timeout || 10000,
      includeSitemap: options.includeSitemap !== false,
      includeInternalLinks: options.includeInternalLinks !== false,
      respectRobots: options.respectRobots !== false,
      userAgent: options.userAgent || 'AI-Visibility-Tool/1.0',
      // RULEBOOK v1.2 Step C7: Headless rendering options
      allowHeadless: options.allowHeadless !== false,
      tier: options.tier || 'diy'
    };
    this.visitedUrls = new Set();
    this.pageEvidences = [];
    // Fix for Issue #2 + #9: Track ALL discovered URLs, even ones not crawled
    // This enables blog/FAQ detection from sitemap/internal links
    this.allDiscoveredUrls = new Set();
    // RULEBOOK v1.2: Track sitemap-specific URLs for classification
    this.sitemapUrls = [];

    // RULEBOOK v1.2 Step C7: Reset render counter at start of crawl
    resetRenderCounter();
  }

  /**
   * Main crawl method - returns aggregated site-wide evidence
   */
  async crawl() {
    try {
      console.log(`[Crawler] Starting site crawl for: ${this.baseUrl}`);

      // Get URLs to crawl
      const urlsToCrawl = await this.getUrlsToCrawl();
      console.log(`[Crawler] Found ${urlsToCrawl.length} URLs to analyze`);
      console.log(`[Crawler] URLs discovered from sitemap/links:`);
      urlsToCrawl.forEach((url, idx) => {
        console.log(`[Crawler]   ${idx + 1}. ${url}`);
      });

      // Crawl each URL
      const urlsToActuallyCrawl = urlsToCrawl.slice(0, this.options.maxPages);
      console.log(`[Crawler] Will crawl ${urlsToActuallyCrawl.length} pages (maxPages: ${this.options.maxPages})`);

      for (const url of urlsToActuallyCrawl) {
        try {
          await this.crawlPage(url);
        } catch (error) {
          console.warn(`[Crawler] Failed to crawl ${url}:`, error.message);
        }
      }

      console.log(`[Crawler] Successfully crawled ${this.pageEvidences.length} pages`);

      // Aggregate evidence from all pages (now async for robots.txt parsing)
      return await this.aggregateEvidence();

    } catch (error) {
      console.error('[Crawler] Crawl failed:', error);
      throw new Error(`Site crawl failed: ${error.message}`);
    }
  }

  /**
   * Get list of URLs to crawl from sitemap and/or internal links
   */
  async getUrlsToCrawl() {
    const urls = new Set();

    // Always crawl the base URL
    urls.add(this.baseUrl);
    this.allDiscoveredUrls.add(this.baseUrl); // Track discovered URLs

    // Try to get URLs from sitemap
    let sitemapDetected = false;
    if (this.options.includeSitemap) {
      const sitemapUrls = await this.fetchSitemapUrls();
      if (sitemapUrls.length > 0) {
        sitemapDetected = true;
        sitemapUrls.forEach(url => {
          urls.add(url);
          this.allDiscoveredUrls.add(url); // Track ALL discovered URLs
        });
        console.log(`[Crawler] ✓ Sitemap detected with ${sitemapUrls.length} URLs`);
      } else {
        console.log(`[Crawler] ✗ No sitemap found, will use internal link crawling`);
      }
    }

    // Store sitemap status for reporting
    this.sitemapDetected = sitemapDetected;

    // If we don't have enough URLs, crawl the base page for internal links
    if (urls.size < this.options.maxPages && this.options.includeInternalLinks) {
      console.log(`[Crawler] Supplementing with internal links (current: ${urls.size}, target: ${this.options.maxPages})`);
      const internalLinks = await this.fetchInternalLinks(this.baseUrl);
      internalLinks.forEach(url => {
        urls.add(url);
        this.allDiscoveredUrls.add(url); // Track ALL discovered URLs
      });
    }

    // Filter out XML files (belt and suspenders - should already be filtered above)
    const filteredUrls = Array.from(urls).filter(url => !url.endsWith('.xml'));

    if (filteredUrls.length < urls.size) {
      console.log(`[Crawler] Filtered out ${urls.size - filteredUrls.length} XML files from crawl list`);
    }

    // CRITICAL FIX: Prioritize and sort URLs deterministically
    // This ensures consistent page selection across scans
    const prioritizedUrls = this.prioritizeUrls(filteredUrls);

    console.log(`[Crawler] Final URL list (top ${Math.min(this.options.maxPages, prioritizedUrls.length)} of ${prioritizedUrls.length}):`);
    prioritizedUrls.slice(0, this.options.maxPages).forEach((url, idx) => {
      console.log(`  ${idx + 1}. ${url}`);
    });

    // Log all discovered URLs for debugging
    console.log(`[Crawler] Total discovered URLs (including non-crawled): ${this.allDiscoveredUrls.size}`);

    return prioritizedUrls;
  }

  /**
   * Fetch URLs from sitemap.xml (tries multiple common sitemap locations)
   */
  async fetchSitemapUrls() {
    const sitemapUrls = [];
    const urlObj = new URL(this.baseUrl);

    // Try multiple common sitemap locations (WordPress, Yoast, RankMath, etc.)
    const sitemapLocations = [
      'sitemap.xml',
      'sitemap_index.xml',
      'sitemap-index.xml',
      'wp-sitemap.xml',
      'sitemap1.xml'
    ];

    let foundSitemap = null;
    let lastError = null;

    // Try each location until we find one
    for (const location of sitemapLocations) {
      const sitemapUrl = `${urlObj.protocol}//${urlObj.host}/${location}`;

      try {
        console.log(`[Crawler] Trying sitemap: ${sitemapUrl}`);

        // Add cache-busting query parameter to get fresh sitemap
        const cacheBustUrl = sitemapUrl.includes('?')
          ? `${sitemapUrl}&_cb=${Date.now()}`
          : `${sitemapUrl}?_cb=${Date.now()}`;

        const response = await axios.get(cacheBustUrl, {
          timeout: this.options.timeout,
          headers: {
            'User-Agent': this.options.userAgent,
            'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        });

        // Success! Found a sitemap
        foundSitemap = { url: sitemapUrl, location: location, data: response.data };
        console.log(`[Crawler] ✓ Found sitemap at: ${location}`);
        this.detectedSitemapLocation = location;  // Store for reporting
        break;

      } catch (error) {
        lastError = error;
        if (error.response && error.response.status === 404) {
          console.log(`[Crawler]   Not found: ${location}`);
        } else {
          console.log(`[Crawler]   Error: ${error.message}`);
        }
        // Continue to next location
      }
    }

    // If no sitemap found at any location
    if (!foundSitemap) {
      if (lastError && lastError.response && lastError.response.status === 404) {
        console.warn(`[Crawler] ✗ No sitemap found at any common location`);
        console.warn(`[Crawler]   Tried: ${sitemapLocations.join(', ')}`);
        console.warn(`[Crawler]   Tip: Create a sitemap.xml file at your domain root to improve crawl coverage`);
      } else {
        console.warn(`[Crawler] ✗ Could not fetch sitemap: ${lastError?.message || 'Unknown error'}`);
      }
      return [];
    }

    try {
      const xml = foundSitemap.data;

      // Check if this is a sitemap index (WordPress style with nested sitemaps)
      if (xml.includes('<sitemapindex')) {
        console.log(`[Crawler] Detected sitemap index, fetching nested sitemaps...`);

        // Extract nested sitemap URLs
        const sitemapMatches = xml.matchAll(/<loc>(.*?)<\/loc>/g);
        const nestedSitemaps = [];

        for (const match of sitemapMatches) {
          const url = match[1].trim();
          // Only include XML sitemaps, not regular pages
          if (url.endsWith('.xml') && url.startsWith(urlObj.origin)) {
            nestedSitemaps.push(url);
          }
        }

        console.log(`[Crawler] Found ${nestedSitemaps.length} nested sitemaps`);

        // Fetch URLs from each nested sitemap
        for (const nestedSitemapUrl of nestedSitemaps) {
          try {
            const nestedUrls = await this.fetchNestedSitemap(nestedSitemapUrl);
            sitemapUrls.push(...nestedUrls);
          } catch (error) {
            console.warn(`[Crawler] Failed to fetch nested sitemap ${nestedSitemapUrl}:`, error.message);
          }
        }
      } else {
        // Regular sitemap - extract URLs directly
        const urlMatches = xml.matchAll(/<loc>(.*?)<\/loc>/g);
        for (const match of urlMatches) {
          const url = match[1].trim();
          // Only include URLs from the same domain, exclude XML files
          if (url.startsWith(urlObj.origin) && !url.endsWith('.xml')) {
            sitemapUrls.push(url);
          }
        }
      }

      console.log(`[Crawler] Found ${sitemapUrls.length} page URLs in sitemap`);

      // RULEBOOK v1.2: Store sitemap URLs for classification
      this.sitemapUrls = [...sitemapUrls];

      // Prioritize diverse content types
      return this.prioritizeUrls(sitemapUrls);

    } catch (error) {
      console.warn(`[Crawler] ✗ Error parsing sitemap: ${error.message}`);
      return [];
    }
  }

  /**
   * Fetch URLs from a nested sitemap (e.g., WordPress wp-sitemap-posts-page-1.xml)
   */
  async fetchNestedSitemap(sitemapUrl) {
    const urls = [];

    try {
      // Add cache-busting query parameter to get fresh sitemap
      const cacheBustUrl = sitemapUrl.includes('?')
        ? `${sitemapUrl}&_cb=${Date.now()}`
        : `${sitemapUrl}?_cb=${Date.now()}`;

      const response = await axios.get(cacheBustUrl, {
        timeout: this.options.timeout,
        headers: {
          'User-Agent': this.options.userAgent,
          'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });

      const xml = response.data;
      const urlMatches = xml.matchAll(/<loc>(.*?)<\/loc>/g);

      const urlObj = new URL(this.baseUrl);
      for (const match of urlMatches) {
        const url = match[1].trim();
        // Only include actual page URLs, not more XML files
        if (url.startsWith(urlObj.origin) && !url.endsWith('.xml')) {
          urls.push(url);
        }
      }

      console.log(`[Crawler] Extracted ${urls.length} URLs from ${sitemapUrl}`);
      return urls;

    } catch (error) {
      console.warn(`[Crawler] Failed to parse nested sitemap:`, error.message);
      return [];
    }
  }

  /**
   * Fetch internal links from a page
   */
  async fetchInternalLinks(url) {
    try {
      const extractor = new ContentExtractor(url, this.options);
      const evidence = await extractor.extract();

      const urlObj = new URL(url);
      const internalLinks = [];

      // Extract internal links from the HTML
      const linkRegex = /<a[^>]+href=["']([^"']+)["']/g;
      const matches = evidence.html.matchAll(linkRegex);

      for (const match of matches) {
        let href = match[1];

        // Skip anchors and external links
        if (href.startsWith('#')) continue;
        if (href.startsWith('mailto:')) continue;
        if (href.startsWith('tel:')) continue;

        // Convert relative URLs to absolute
        try {
          const absoluteUrl = new URL(href, url);
          if (absoluteUrl.origin === urlObj.origin) {
            internalLinks.push(absoluteUrl.href);
          }
        } catch (e) {
          // Skip invalid URLs
        }
      }

      return [...new Set(internalLinks)]; // Remove duplicates

    } catch (error) {
      console.warn(`[Crawler] Could not fetch internal links from ${url}:`, error.message);
      return [];
    }
  }

  /**
   * Prioritize URLs to get diverse content
   * Uses deterministic sorting to ensure consistent page selection
   */
  prioritizeUrls(urls) {
    // Prioritize different types of pages
    const priorities = {
      home: 10,      // Homepage
      about: 9,      // About pages
      blog: 8,       // Blog posts
      services: 7,   // Service/product pages
      contact: 6,    // Contact pages
      faq: 5,        // FAQ pages
      pricing: 4,    // Pricing pages
      team: 3,       // Team pages
      other: 1       // Everything else
    };

    const scored = urls.map(url => {
      let score = priorities.other;

      // Use centralized VOCABULARY patterns for consistent detection
      if (url.toLowerCase() === this.baseUrl.toLowerCase() || VOCABULARY.URL_PATTERNS.home.test(url)) {
        score = priorities.home;
      } else if (VOCABULARY.URL_PATTERNS.about.test(url)) {
        score = priorities.about;
      } else if (VOCABULARY.URL_PATTERNS.blog.test(url)) {
        score = priorities.blog;
      } else if (VOCABULARY.URL_PATTERNS.services.test(url)) {
        score = priorities.services;
      } else if (VOCABULARY.URL_PATTERNS.contact.test(url)) {
        score = priorities.contact;
      } else if (VOCABULARY.URL_PATTERNS.faq.test(url)) {
        score = priorities.faq;
      } else if (VOCABULARY.URL_PATTERNS.pricing.test(url)) {
        score = priorities.pricing;
      } else if (VOCABULARY.URL_PATTERNS.team.test(url)) {
        score = priorities.team;
      }

      return { url, score };
    });

    // Sort by priority DESC, then alphabetically ASC for deterministic ordering
    // This ensures same site always produces same page order
    return scored
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;  // Higher priority first
        }
        return a.url.localeCompare(b.url);  // Alphabetical tiebreaker
      })
      .map(item => item.url);
  }

  /**
   * Crawl a single page and extract evidence
   * RULEBOOK v1.2 Step C7: Uses extractWithFallback for headless rendering when needed
   */
  async crawlPage(url) {
    if (this.visitedUrls.has(url)) {
      return; // Already visited
    }

    console.log(`[Crawler] Crawling page: ${url}`);
    this.visitedUrls.add(url);

    try {
      // RULEBOOK v1.2 Step C7: Use extractWithFallback for JS-rendered sites
      const evidence = await extractWithFallback(url, {
        ...this.options,
        tier: this.options.tier,
        allowHeadless: this.options.allowHeadless
      });

      // Log rendering info if headless was attempted
      if (evidence.technical?.rendered) {
        console.log(`[Crawler] ✓ Headless rendered ${url} (improvement: +${evidence.technical.contentImprovement} words)`);
      } else if (evidence.technical?.renderAttempted) {
        console.log(`[Crawler] ✗ Headless render failed for ${url}: ${evidence.technical.renderError}`);
      }

      // Log FAQ extraction results for this page
      const faqCount = evidence.content?.faqs?.length || 0;
      if (faqCount > 0) {
        console.log(`[Crawler] ✓ Found ${faqCount} FAQs on ${url}`);
        evidence.content.faqs.forEach((faq, idx) => {
          console.log(`[Crawler]     FAQ ${idx + 1}: ${faq.question.substring(0, 80)}...`);
        });
      } else {
        console.log(`[Crawler] ✗ No FAQs found on ${url}`);
      }

      this.pageEvidences.push({
        url,
        evidence,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      throw new Error(`Failed to extract evidence from ${url}: ${error.message}`);
    }
  }

  /**
   * Get all discovered URLs (including non-crawled ones)
   * Fix for Issue #2 + #9: Enables blog/FAQ detection from sitemap/internal links
   */
  getAllDiscoveredUrls() {
    return Array.from(this.allDiscoveredUrls);
  }

  /**
   * Analyze discovered URLs for key sections
   * Fix for Issue #2 + #9: This data is passed to detection functions
   * Per rulebook "Cross-Cutting Rules" → Rule 4
   */
  analyzeDiscoveredSections() {
    const allUrls = this.getAllDiscoveredUrls();

    // Use centralized VOCABULARY patterns for consistent detection
    const discoveredSections = {
      // Key section detection using VOCABULARY URL patterns
      hasBlogUrl: allUrls.some(url => VOCABULARY.URL_PATTERNS.blog.test(url)),
      hasFaqUrl: allUrls.some(url => VOCABULARY.URL_PATTERNS.faq.test(url)),
      hasAboutUrl: allUrls.some(url => VOCABULARY.URL_PATTERNS.about.test(url)),
      hasContactUrl: allUrls.some(url => VOCABULARY.URL_PATTERNS.contact.test(url)),
      hasServicesUrl: allUrls.some(url => VOCABULARY.URL_PATTERNS.services.test(url)),
      hasPricingUrl: allUrls.some(url => VOCABULARY.URL_PATTERNS.pricing.test(url)),
      hasTeamUrl: allUrls.some(url => VOCABULARY.URL_PATTERNS.team.test(url)),
      hasCareersUrl: allUrls.some(url => VOCABULARY.URL_PATTERNS.careers.test(url)),
      hasPortfolioUrl: allUrls.some(url => VOCABULARY.URL_PATTERNS.portfolio.test(url)),
      hasLegalUrl: allUrls.some(url => VOCABULARY.URL_PATTERNS.legal.test(url)),

      // Specific URL lists for debugging
      blogUrls: allUrls.filter(url => VOCABULARY.URL_PATTERNS.blog.test(url)),
      faqUrls: allUrls.filter(url => VOCABULARY.URL_PATTERNS.faq.test(url)),

      // Total count
      totalDiscoveredUrls: allUrls.length
    };

    console.log('[Detection] Crawler discovered sections:', {
      hasBlogUrl: discoveredSections.hasBlogUrl,
      hasFaqUrl: discoveredSections.hasFaqUrl,
      hasAboutUrl: discoveredSections.hasAboutUrl,
      hasContactUrl: discoveredSections.hasContactUrl,
      hasServicesUrl: discoveredSections.hasServicesUrl,
      hasPricingUrl: discoveredSections.hasPricingUrl,
      hasTeamUrl: discoveredSections.hasTeamUrl,
      hasCareersUrl: discoveredSections.hasCareersUrl,
      hasPortfolioUrl: discoveredSections.hasPortfolioUrl,
      hasLegalUrl: discoveredSections.hasLegalUrl,
      totalDiscoveredUrls: discoveredSections.totalDiscoveredUrls,
      blogUrlCount: discoveredSections.blogUrls.length,
      faqUrlCount: discoveredSections.faqUrls.length
    });

    return discoveredSections;
  }

  /**
   * RULEBOOK v1.2 Section 11.4.5: Robots.txt AI Crawler Parsing
   * Checks if site blocks specific AI crawlers
   */
  async parseRobotsTxt() {
    const AI_CRAWLERS = [
      'GPTBot', 'ChatGPT-User', 'Claude-Web', 'Anthropic-AI', 'ClaudeBot',
      'PerplexityBot', 'Google-Extended', 'CCBot', 'Bytespider', 'Amazonbot', 'Cohere-ai'
    ];

    try {
      const urlObj = new URL(this.baseUrl);
      const robotsUrl = `${urlObj.origin}/robots.txt`;

      console.log(`[Crawler] RULEBOOK v1.2: Fetching robots.txt from ${robotsUrl}`);

      const response = await axios.get(robotsUrl, {
        timeout: 5000,
        headers: { 'User-Agent': this.options.userAgent }
      });

      const lines = response.data.split('\n');
      const result = {
        found: true,
        allowsAllAI: true,
        blockedAICrawlers: [],
        hasAISpecificRules: false,
        rawContent: response.data.substring(0, 2000) // Store first 2K chars for debugging
      };

      let currentUA = null;

      for (const line of lines) {
        const trimmedLine = line.trim();

        if (trimmedLine.toLowerCase().startsWith('user-agent:')) {
          currentUA = trimmedLine.substring(11).trim();
        } else if (trimmedLine.toLowerCase().startsWith('disallow:') && currentUA) {
          const path = trimmedLine.substring(9).trim();

          // Check if this is an AI crawler being blocked
          for (const crawler of AI_CRAWLERS) {
            if (currentUA.toLowerCase() === crawler.toLowerCase() ||
                currentUA === '*' && AI_CRAWLERS.some(c => c.toLowerCase() === crawler.toLowerCase())) {
              if (path === '/' || path === '/*') {
                result.hasAISpecificRules = true;
                if (!result.blockedAICrawlers.includes(crawler) && currentUA !== '*') {
                  result.blockedAICrawlers.push(crawler);
                  result.allowsAllAI = false;
                }
              }
            }
          }

          // Check for specific AI crawler blocks
          if (currentUA !== '*') {
            const matchingCrawler = AI_CRAWLERS.find(c =>
              currentUA.toLowerCase() === c.toLowerCase()
            );
            if (matchingCrawler && (path === '/' || path === '/*')) {
              result.hasAISpecificRules = true;
              if (!result.blockedAICrawlers.includes(matchingCrawler)) {
                result.blockedAICrawlers.push(matchingCrawler);
                result.allowsAllAI = false;
              }
            }
          }
        }
      }

      console.log(`[Crawler] RULEBOOK v1.2: Robots.txt analysis:`, {
        found: result.found,
        allowsAllAI: result.allowsAllAI,
        blockedAICrawlers: result.blockedAICrawlers,
        hasAISpecificRules: result.hasAISpecificRules
      });

      return result;

    } catch (error) {
      console.log(`[Crawler] RULEBOOK v1.2: Could not fetch robots.txt: ${error.message}`);
      return {
        found: false,
        allowsAllAI: true, // Assume allowed if no robots.txt
        blockedAICrawlers: [],
        hasAISpecificRules: false,
        error: error.message
      };
    }
  }

  /**
   * Aggregate evidence from all crawled pages into site-wide metrics
   */
  async aggregateEvidence() {
    if (this.pageEvidences.length === 0) {
      throw new Error('No pages successfully crawled');
    }

    console.log(`[Crawler] Aggregating evidence from ${this.pageEvidences.length} pages`);

    // Fix for Issue #2 + #9: Analyze discovered URLs for key sections
    const discoveredSections = this.analyzeDiscoveredSections();

    // RULEBOOK v1.2 Section 11.4.5: Parse robots.txt for AI crawler rules
    const robotsTxt = await this.parseRobotsTxt();

    // RULEBOOK v1.2: Classify sitemap URLs by content type
    const sitemapClassification = this.classifySitemapUrls(this.sitemapUrls);

    // DEBUG: Sitemap classification result
    console.log('[SiteCrawler] DEBUG - Sitemap result:', {
      detected: this.sitemapDetected,
      urlCount: this.sitemapUrls?.length || 0,
      blogUrls: sitemapClassification?.blogUrls?.length || 0,
      faqUrls: sitemapClassification?.faqUrls?.length || 0,
      sampleBlogUrl: sitemapClassification?.blogUrls?.[0],
      sampleFaqUrl: sitemapClassification?.faqUrls?.[0]
    });

    const aggregated = {
      siteUrl: this.baseUrl,
      pageCount: this.pageEvidences.length,
      pages: this.pageEvidences,
      sitemapDetected: this.sitemapDetected || false,
      sitemapLocation: this.detectedSitemapLocation || null,  // Which sitemap file was found
      // RULEBOOK v1.2: Robots.txt AI crawler analysis
      robotsTxt,
      // RULEBOOK v1.2: Sitemap with classified URLs
      sitemap: {
        detected: this.sitemapDetected || false,
        location: this.detectedSitemapLocation || null,
        totalUrls: this.sitemapUrls.length,
        ...sitemapClassification
      },

      // Site-wide metrics for scoring
      siteMetrics: {
        // Fix for Issue #2 + #9: Include discovered sections from sitemap/internal links
        discoveredSections,
        // Question-based content density (% of pages)
        pagesWithQuestionHeadings: this.calculatePageMetric(e => this.hasQuestionHeadings(e)),
        pagesWithFAQs: this.calculatePageMetric(e => e.content.faqs.length > 0),
        pagesWithFAQSchema: this.calculatePageMetric(e => e.technical.hasFAQSchema),

        // Scannability (% of pages)
        pagesWithLists: this.calculatePageMetric(e => e.content.lists.length >= 2),
        pagesWithTables: this.calculatePageMetric(e => e.content.tables.length > 0),

        // Readability (site average)
        avgFleschScore: this.calculateAverageFleschScore(),
        avgSentenceLength: this.calculateAvgSentenceLength(),

        // Heading hierarchy (% of pages)
        pagesWithProperH1: this.calculatePageMetric(e => e.structure.headingCount.h1 === 1),
        pagesWithSemanticHTML: this.calculatePageMetric(e => e.structure.hasMain || e.structure.hasArticle),

        // Alt text coverage (% of pages)
        pagesWithGoodAltText: this.calculatePageMetric(e => this.hasGoodAltText(e)),

        // Schema markup (% of pages)
        pagesWithSchema: this.calculatePageMetric(e => e.technical.structuredData.length > 0),
        pagesWithOrganizationSchema: this.calculatePageMetric(e => e.technical.hasOrganizationSchema),

        // Freshness (% of pages)
        pagesWithLastModified: this.calculatePageMetric(e => e.metadata.lastModified || e.metadata.publishedTime),
        pagesWithCurrentYear: this.calculatePageMetric(e => this.hasCurrentYear(e)),

        // Voice optimization (% of pages)
        pagesWithLongTailKeywords: this.calculatePageMetric(e => this.hasLongTailKeywords(e)),
        pagesWithConversationalContent: this.calculatePageMetric(e => this.hasConversationalContent(e)),

        // Pillar pages
        pillarPageCount: this.countPillarPages(),

        // Topic cluster coverage
        topicClusterCoverage: this.calculateTopicClusterCoverage(),

        // Average content depth
        avgWordCount: this.calculateAverage(e => e.content.wordCount),
        avgImageCount: this.calculateAverage(e => e.media.imageCount),

        // Entity recognition
        avgEntitiesPerPage: this.calculateAverage(e => this.countEntities(e)),
        pagesWithLocationData: this.calculatePageMetric(e => e.metadata.geoRegion || e.metadata.geoPlacename),
      },

      timestamp: new Date().toISOString()
    };

    console.log('[Crawler] Aggregation complete:', {
      pageCount: aggregated.pageCount,
      questionHeadingsPercent: Math.round(aggregated.siteMetrics.pagesWithQuestionHeadings * 100),
      schemaPercent: Math.round(aggregated.siteMetrics.pagesWithSchema * 100)
    });

    return aggregated;
  }

  // ===== HELPER METHODS FOR METRIC CALCULATION =====

  /**
   * Calculate what % of pages meet a condition
   */
  calculatePageMetric(conditionFn) {
    const count = this.pageEvidences.filter(p => conditionFn(p.evidence)).length;
    return count / this.pageEvidences.length;
  }

  /**
   * Calculate average of a numeric value across pages
   */
  calculateAverage(extractFn) {
    const sum = this.pageEvidences.reduce((total, p) => total + extractFn(p.evidence), 0);
    return sum / this.pageEvidences.length;
  }

  hasQuestionHeadings(evidence) {
    const allHeadings = [
      ...evidence.content.headings.h1,
      ...evidence.content.headings.h2,
      ...evidence.content.headings.h3
    ];

    const questionWords = ['what', 'why', 'how', 'when', 'where', 'who', 'which', 'can', 'should', 'does'];
    return allHeadings.some(h => {
      const lower = h.toLowerCase();
      return questionWords.some(q => lower.startsWith(q)) || lower.includes('?');
    });
  }

  hasGoodAltText(evidence) {
    if (evidence.media.imageCount === 0) return true;
    const coverage = evidence.media.imagesWithAlt / evidence.media.imageCount;
    return coverage >= 0.9; // 90% coverage = good
  }

  hasCurrentYear(evidence) {
    const currentYear = new Date().getFullYear().toString();
    return evidence.content.bodyText.includes(currentYear);
  }

  hasLongTailKeywords(evidence) {
    const fourWordPhrases = evidence.content.bodyText.match(/\b\w+\s+\w+\s+\w+\s+\w+\b/g) || [];
    return fourWordPhrases.length >= 20;
  }

  hasConversationalContent(evidence) {
    const conversationalKeywords = ['how to', 'what is', 'why', 'best way', 'guide'];
    const text = evidence.content.bodyText.toLowerCase();
    return conversationalKeywords.some(k => text.includes(k));
  }

  countPillarPages() {
    return this.pageEvidences.filter(p => {
      const e = p.evidence;
      return e.content.wordCount >= 1500 &&
             e.content.headings.h2.length >= 5 &&
             e.structure.internalLinks >= 5;
    }).length;
  }

  calculateTopicClusterCoverage() {
    // Analyze internal linking between pages
    const internalLinkCounts = this.pageEvidences.map(p => p.evidence.structure.internalLinks);
    const avgInternalLinks = internalLinkCounts.reduce((a, b) => a + b, 0) / internalLinkCounts.length;

    // If pages have 5+ internal links on average, cluster coverage is good
    if (avgInternalLinks >= 5) return 0.8;
    if (avgInternalLinks >= 3) return 0.6;
    if (avgInternalLinks >= 1) return 0.4;
    return 0.2;
  }

  calculateAverageFleschScore() {
    // Simple estimation based on word count and sentence count
    const scores = this.pageEvidences.map(p => {
      const text = p.evidence.content.bodyText;
      const words = text.split(/\s+/).length;
      const sentences = text.split(/[.!?]+/).length;
      if (words === 0 || sentences === 0) return 60;

      const avgWordsPerSentence = words / sentences;
      // Simplified: shorter sentences = higher score
      if (avgWordsPerSentence < 15) return 70;
      if (avgWordsPerSentence < 20) return 60;
      if (avgWordsPerSentence < 25) return 50;
      return 40;
    });

    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  calculateAvgSentenceLength() {
    const lengths = this.pageEvidences.map(p => {
      const text = p.evidence.content.bodyText;
      const words = text.split(/\s+/).length;
      const sentences = text.split(/[.!?]+/).length;
      return sentences > 0 ? words / sentences : 20;
    });

    return lengths.reduce((a, b) => a + b, 0) / lengths.length;
  }

  countEntities(evidence) {
    // Count proper nouns (capitalized words)
    const properNouns = evidence.content.bodyText.match(/\b[A-Z][a-z]+\b/g) || [];
    return [...new Set(properNouns)].length;
  }

  /**
   * RULEBOOK v1.2: Classify sitemap URLs by content type
   * Uses centralized VOCABULARY patterns for consistent detection
   * Enables detection of blog/FAQ/pricing pages from sitemap without crawling each page
   */
  classifySitemapUrls(urls) {
    // Use centralized vocabulary patterns (same as analyzeDiscoveredSections)
    const result = {
      blogUrls: [],
      faqUrls: [],
      aboutUrls: [],
      pricingUrls: [],
      contactUrls: [],
      hasBlogUrls: false,
      hasFaqUrls: false,
      hasAboutUrls: false,
      hasPricingUrls: false,
      hasContactUrls: false,
      totalClassified: 0
    };

    for (const url of urls) {
      // Use VOCABULARY.URL_PATTERNS for consistent detection
      if (VOCABULARY.URL_PATTERNS.blog.test(url)) {
        result.blogUrls.push(url);
      }
      if (VOCABULARY.URL_PATTERNS.faq.test(url)) {
        result.faqUrls.push(url);
      }
      if (VOCABULARY.URL_PATTERNS.about.test(url)) {
        result.aboutUrls.push(url);
      }
      if (VOCABULARY.URL_PATTERNS.pricing.test(url)) {
        result.pricingUrls.push(url);
      }
      if (VOCABULARY.URL_PATTERNS.contact.test(url)) {
        result.contactUrls.push(url);
      }
    }

    result.hasBlogUrls = result.blogUrls.length > 0;
    result.hasFaqUrls = result.faqUrls.length > 0;
    result.hasAboutUrls = result.aboutUrls.length > 0;
    result.hasPricingUrls = result.pricingUrls.length > 0;
    result.hasContactUrls = result.contactUrls.length > 0;
    result.totalClassified = result.blogUrls.length + result.faqUrls.length +
                             result.aboutUrls.length + result.pricingUrls.length +
                             result.contactUrls.length;

    console.log('[Crawler] RULEBOOK v1.2: Sitemap URL classification:', {
      blogUrls: result.blogUrls.length,
      faqUrls: result.faqUrls.length,
      aboutUrls: result.aboutUrls.length,
      pricingUrls: result.pricingUrls.length,
      contactUrls: result.contactUrls.length,
      totalClassified: result.totalClassified,
      sampleBlog: result.blogUrls[0],
      sampleFaq: result.faqUrls[0]
    });

    return result;
  }
}

module.exports = SiteCrawler;
