const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const EntityAnalyzer = require('./entity-analyzer');
const VOCABULARY = require('../config/detection-vocabulary');
const { safeHead, safeGet } = require('../utils/safe-http');
const {
  CONFIDENCE_LEVELS,
  EVIDENCE_SOURCES,
  EVIDENCE_SCHEMAS,
  createEvidence
} = require('../config/diagnostic-types');

// RULEBOOK v1.2 Step C7: Headless rendering for JS-rendered sites
// Using puppeteer-core (requires Chrome/Chromium installed separately)
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch (e) {
  console.warn('[Headless] puppeteer-core not available, headless rendering disabled');
  puppeteer = null;
}

/**
 * Content Extractor for V5 Rubric Analysis
 * Fetches and parses website content for scoring
 */

class ContentExtractor {
  constructor(url, options = {}) {
    this.url = url;
    this.timeout = options.timeout || 30000; // Increased to 30s for slower sites
    // Use Googlebot user-agent to ensure WordPress serves full HTML with schema markup
    this.userAgent = options.userAgent || 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
    this.maxContentLength = options.maxContentLength || 5000000; // 5MB
  }

  /**
   * Main extraction method - orchestrates all content gathering
   *
   * RULEBOOK v1.2 Section 1.5.2: Clone DOM Approach
   * Creates two DOM copies - one for structure/navigation, one for content cleanup
   */
  async extract() {
    try {
      console.log('=== EXTRACTION START (Rulebook v1.2) ===');
      console.log('URL:', this.url);

      const fetchResult = await this.fetchHTML();
      const html = fetchResult.html;

      // RULEBOOK v1.2: Clone DOM Approach - two separate DOM instances
      // Clone 1: Full DOM for structure, navigation, structured data (never modified)
      const $full = cheerio.load(html);
      // Clone 2: For content extraction after cleanup (nav/header/footer removed)
      const $content = cheerio.load(html);

      // PHASE A: Extract from FULL DOM (before any removal)
      console.log('[Rulebook v1.2] PHASE A: Extracting from full DOM...');
      const technical = await this.extractTechnical($full, fetchResult);
      const structure = this.extractStructure($full);
      const navigation = this.extractNavigation($full);
      const metadata = this.extractMetadata($full);
      const media = this.extractMedia($full);
      const accessibility = this.extractAccessibility($full);

      // Extract FAQs from FULL DOM (before footer removal!)
      const faqs = this.extractFAQs($full, technical.structuredData);

      // RULEBOOK v1.2 Section 9.5: Extract third-party profiles (sameAs + footer)
      const thirdPartyProfiles = this.extractThirdPartyProfiles($full, technical.structuredData);

      console.log('[Detection] Navigation links extracted:', navigation.links.length);
      console.log('[Detection] Structure extracted - hasNav:', structure.hasNav, 'hasHeader:', structure.hasHeader, 'hasFooter:', structure.hasFooter);
      console.log('[Detection] FAQs extracted from full DOM:', faqs.length);
      console.log('[Detection] Third-party profiles found:', thirdPartyProfiles.profiles.length);

      // PHASE B: Extract from CLEANED DOM (after removal)
      console.log('[Rulebook v1.2] PHASE B: Extracting content from cleaned DOM...');
      $content('script, style, nav, header, footer, aside').remove();
      const content = this.extractContentFromCleanedDOM($content, faqs);

      // PHASE C: Assemble complete evidence object
      console.log('[Rulebook v1.2] PHASE C: Assembling evidence...');
      const evidence = {
        url: this.url,
        html: html,
        metadata: metadata,
        technical: technical,
        structure: structure,
        navigation: navigation,
        content: content,
        media: media,
        performance: await this.checkPerformance(),
        accessibility: accessibility,
        thirdPartyProfiles: thirdPartyProfiles, // RULEBOOK v1.2 Section 9.5
        timestamp: new Date().toISOString()
      };

      // Run entity analysis
      const entityAnalyzer = new EntityAnalyzer(evidence);
      evidence.entities = entityAnalyzer.analyze();

      // Generate diagnostic evidence summaries
      evidence.diagnosticEvidence = this.generateDiagnosticEvidence(evidence);

      // DEBUG: Log extracted data before returning
      console.log('EXTRACTED navigation:', JSON.stringify(evidence.navigation?.keyPages || 'NO NAVIGATION'));
      console.log('EXTRACTED faqs count:', evidence.content?.faqs?.length || 0);
      console.log('EXTRACTED hasNav:', evidence.structure?.hasNav);
      console.log('=== EXTRACTION END ===');

      return evidence;
    } catch (error) {
      throw new Error(`Content extraction failed: ${error.message}`);
    }
  }

  /**
   * Fetch HTML content from URL with multiple fallback strategies
   */
  async fetchHTML() {
    // Try multiple user agents if blocked
    const userAgents = [
      // Real browser user agent (most likely to work)
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      // Googlebot (good for SEO-friendly sites)
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      // Another popular browser
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];

    let lastError = null;

    // Try each user agent
    for (let i = 0; i < userAgents.length; i++) {
      try {
        const startTime = Date.now();

        // Add cache-busting query parameter to force fresh content
        // This bypasses CDN/proxy caches that might serve stale content
        const cacheBustUrl = this.url.includes('?')
          ? `${this.url}&_cb=${Date.now()}`
          : `${this.url}?_cb=${Date.now()}`;

        const response = await axios.get(cacheBustUrl, {
          timeout: this.timeout,
          maxContentLength: this.maxContentLength,
          maxRedirects: 5, // Follow up to 5 redirects
          headers: {
            'User-Agent': userAgents[i],
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0'
          },
          validateStatus: (status) => status >= 200 && status < 400 // Accept 2xx and 3xx
        });

        const responseTime = Date.now() - startTime;

        // Check if we got HTML content
        if (!response.data || typeof response.data !== 'string') {
          throw new Error('Invalid response: expected HTML content');
        }

        // Success! Log and return
        console.log(`[ContentExtractor] Successfully fetched with User-Agent #${i + 1}`);
        console.log(`[ContentExtractor] Response time: ${responseTime}ms`);
        console.log(`[ContentExtractor] HTML length: ${response.data.length} characters`);

        // Debug: Log first 1000 chars of HTML
        const htmlPreview = response.data.substring(0, 1000);
        console.log('[ContentExtractor] HTML preview (first 1000 chars):');
        console.log(htmlPreview);
        console.log('[ContentExtractor] ... (HTML continues)');

        return {
          html: response.data,
          responseTime,
          headers: response.headers,
          status: response.status
        };

      } catch (error) {
        lastError = error;
        console.log(`[ContentExtractor] Attempt ${i + 1}/${userAgents.length} failed:`, error.message);

        // If it's a 403 and we have more user agents to try, continue
        if (error.response && error.response.status === 403 && i < userAgents.length - 1) {
          console.log(`[ContentExtractor] Trying next user agent...`);
          continue;
        }

        // If it's not a 403, or we're on the last attempt, break and throw
        if (i === userAgents.length - 1) {
          // This was our last attempt
          break;
        }

        // For non-403 errors, stop trying and throw immediately
        if (!error.response || error.response.status !== 403) {
          break;
        }
      }
    }

    // All attempts failed, throw the last error with improved message
    if (lastError) {
      if (lastError.code === 'ECONNABORTED') {
        throw new Error(`Request timeout - ${this.url} took longer than ${this.timeout/1000}s to respond`);
      }
      if (lastError.code === 'ENOTFOUND') {
        throw new Error(`Domain not found - ${this.url} does not exist`);
      }
      if (lastError.code === 'ECONNREFUSED') {
        throw new Error(`Connection refused - ${this.url} is not accepting connections`);
      }
      if (lastError.code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
        throw new Error(`SSL certificate error - ${this.url} has an invalid certificate`);
      }
      if (lastError.response) {
        const status = lastError.response.status;
        if (status === 403) {
          throw new Error(`Access denied - This website is blocking automated scanners. Try scanning a different page on this domain, or contact the site owner to whitelist our scanner.`);
        }
        if (status === 429) {
          throw new Error(`Rate limited - Too many requests. Please wait a few minutes and try again.`);
        }
        if (status === 503) {
          throw new Error(`Service unavailable - The website is temporarily down. Please try again later.`);
        }
        throw new Error(`HTTP ${status}: ${lastError.response.statusText || 'Request failed'}`);
      }
      throw new Error(`Failed to fetch ${this.url}: ${lastError.message}`);
    }

    throw new Error(`Failed to fetch ${this.url}: Unknown error`);
  }

  /**
   * Extract metadata (title, description, Open Graph, etc.)
   */
  extractMetadata($) {
    return {
      title: $('title').text().trim() || '',
      description: $('meta[name="description"]').attr('content') || '',
      keywords: $('meta[name="keywords"]').attr('content') || '',
      author: $('meta[name="author"]').attr('content') || '',
      canonical: $('link[rel="canonical"]').attr('href') || '',
      robots: $('meta[name="robots"]').attr('content') || '',
      
      // Open Graph
      ogTitle: $('meta[property="og:title"]').attr('content') || '',
      ogDescription: $('meta[property="og:description"]').attr('content') || '',
      ogImage: $('meta[property="og:image"]').attr('content') || '',
      ogType: $('meta[property="og:type"]').attr('content') || '',
      ogUrl: $('meta[property="og:url"]').attr('content') || '',
      
      // Twitter Cards
      twitterCard: $('meta[name="twitter:card"]').attr('content') || '',
      twitterTitle: $('meta[name="twitter:title"]').attr('content') || '',
      twitterDescription: $('meta[name="twitter:description"]').attr('content') || '',
      
      // Dates
      lastModified: $('meta[name="last-modified"]').attr('content') || 
                    $('meta[property="article:modified_time"]').attr('content') || '',
      publishedTime: $('meta[property="article:published_time"]').attr('content') || '',
      
      // Language & Location
      language: $('html').attr('lang') || $('meta[http-equiv="content-language"]').attr('content') || '',
      geoRegion: $('meta[name="geo.region"]').attr('content') || '',
      geoPlacename: $('meta[name="geo.placename"]').attr('content') || '',
    };
  }

  /**
   * RULEBOOK v1.2 Section 7.3.4: Adaptive Content Limits by Page Type
   */
  getContentLimits(pageType = 'default') {
    const CONTENT_LIMITS = {
      default: { maxParagraphs: 100, maxCharsTotal: 25000 },
      homepage: { maxParagraphs: 150, maxCharsTotal: 30000 },
      blog: { maxParagraphs: 200, maxCharsTotal: 50000 },
      faq: { maxParagraphs: 300, maxCharsTotal: 40000 }
    };
    return CONTENT_LIMITS[pageType] || CONTENT_LIMITS.default;
  }

  /**
   * RULEBOOK v1.2 Section 7.3.3: Smart Content Filtering
   * No blind <20 char discard - keep meaningful short content
   */
  filterContent(text) {
    const trimmed = text.trim();

    // Keep if meaningful short content
    if (trimmed.length < 20) {
      if (/\?$/.test(trimmed)) return true;              // Questions
      if (/^[A-Z][^.!?]*$/.test(trimmed)) return true;   // Heading-like
      if (/price|cost|free|contact/i.test(trimmed)) return true;  // Key terms
      return false;
    }

    // Discard boilerplate
    if (/^(copyright|©|all rights reserved|loading|please wait)/i.test(trimmed)) return false;

    return true;
  }

  /**
   * RULEBOOK v1.2: Extract content from already-cleaned DOM
   * This method is called AFTER nav/header/footer have been removed
   * FAQs are passed in (already extracted from full DOM)
   *
   * Includes:
   * - Section 7.3.1: List item extraction as content units
   * - Section 7.3.2: Accordion/details/tab extraction
   * - Section 7.3.3: Smart content filtering
   * - Section 7.3.4: Adaptive content limits by page type
   */
  extractContentFromCleanedDOM($, faqs = [], pageType = 'default') {
    const limits = this.getContentLimits(pageType);

    const headings = {
      h1: [],
      h2: [],
      h3: [],
      h4: [],
      h5: [],
      h6: []
    };

    // Extract all headings
    for (let i = 1; i <= 6; i++) {
      $(`h${i}`).each((idx, el) => {
        headings[`h${i}`].push($(el).text().trim());
      });
    }

    // RULEBOOK v1.2 Section 7.3.1: Extract list items as content units
    const listItems = [];
    $('ul li, ol li').each((i, el) => {
      const text = $(el).text().trim();
      if (text.length >= 10) {
        listItems.push({
          text,
          type: $(el).parent().is('ol') ? 'ordered' : 'unordered'
        });
      }
    });

    // RULEBOOK v1.2 Section 7.3.2: Extract accordion/tab content
    const accordions = [];

    // details/summary elements
    $('details').each((i, el) => {
      const summary = $(el).find('summary').text().trim();
      const answer = $(el).clone().find('summary').remove().end().text().trim();
      if (summary && answer) {
        accordions.push({ question: summary, answer, source: 'details' });
      }
    });

    // aria-expanded patterns
    $('[aria-expanded]').each((i, el) => {
      const controlsId = $(el).attr('aria-controls');
      const question = $(el).text().trim();
      if (controlsId) {
        const answer = $(`#${controlsId}`).text().trim();
        if (question && answer && answer.length > 10) {
          accordions.push({ question, answer, source: 'aria-expanded' });
        }
      }
    });

    // CSS accordion patterns
    $('.accordion-item, .faq-item, [class*="accordion"]').each((i, el) => {
      const header = $(el).find('[class*="header"], [class*="title"]').first().text().trim();
      const body = $(el).find('[class*="body"], [class*="content"]').first().text().trim();
      if (header && body) {
        accordions.push({ question: header, answer: body, source: 'css' });
      }
    });

    // Extract tab content (evidence contract v2.0)
    const tabs = [];
    $('[role="tablist"]').each((i, tablist) => {
      $(tablist).find('[role="tab"]').each((j, tab) => {
        const tabId = $(tab).attr('aria-controls');
        const tabTitle = $(tab).text().trim();
        if (tabId) {
          const content = $(`#${tabId}`).text().trim();
          if (tabTitle && content) {
            tabs.push({ title: tabTitle, content, source: 'aria-tab' });
          }
        }
      });
    });

    // Extract paragraphs with intelligent prioritization and smart filtering
    const allParagraphs = [];
    $('p').each((idx, el) => {
      const $el = $(el);
      const text = $el.text().trim();

      // RULEBOOK v1.2 Section 7.3.3: Smart content filtering
      if (!this.filterContent(text)) return;

      // Check if paragraph is likely hidden
      const style = $el.attr('style') || '';
      const classAttr = $el.attr('class') || '';
      const isHidden = style.includes('display:none') ||
                       style.includes('display: none') ||
                       style.includes('visibility:hidden') ||
                       style.includes('visibility: hidden') ||
                       classAttr.includes('hidden') ||
                       $el.css('display') === 'none';

      if (isHidden) return;

      // Calculate relevance score for this paragraph
      let score = 0;

      // Higher score for paragraphs in main content areas
      const inMain = $el.closest('main, article, [role="main"], .content, .post-content, .entry-content').length > 0;
      const inModal = $el.closest('.modal, .popup, [role="dialog"], .overlay').length > 0;
      const inSidebar = $el.closest('aside, .sidebar, .widget').length > 0;

      if (inMain) score += 10;
      if (inModal) score -= 5;  // Deprioritize modal content
      if (inSidebar) score -= 3; // Deprioritize sidebar content

      // Longer paragraphs are generally more substantial
      if (text.length > 100) score += 2;
      if (text.length > 200) score += 3;
      if (text.length > 400) score += 2;

      // Paragraphs with proper sentence structure are more valuable
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
      if (sentences.length >= 2) score += 2;
      if (sentences.length >= 4) score += 2;

      // Avoid common template/boilerplate text
      const boilerplatePatterns = [
        /click here/i,
        /read more/i,
        /learn more/i,
        /^(yes|no|ok|cancel|submit|continue)/i,
        /cookie/i,
        /subscribe to (our|the) newsletter/i
      ];

      const hasBoilerplate = boilerplatePatterns.some(pattern => pattern.test(text));
      if (hasBoilerplate) score -= 2;

      allParagraphs.push({ text, score });
    });

    // Sort by score (highest first), then by length for tie-breaking
    allParagraphs.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.text.length - a.text.length;
    });

    // Extract just the text, prioritizing highest-scored paragraphs
    const paragraphs = allParagraphs.map(p => p.text);

    // Debug: Log extracted paragraphs for quality analysis
    console.log(`[ContentExtractor] 📋 Extracted ${paragraphs.length} total paragraphs (scored and prioritized)`);
    if (paragraphs.length > 0) {
      console.log('[ContentExtractor] Top 3 highest-priority paragraphs:');
      allParagraphs.slice(0, 3).forEach((p, idx) => {
        const preview = p.text.length > 150 ? p.text.substring(0, 150) + '...' : p.text;
        console.log(`  ${idx + 1}. Score: ${p.score}, Length: ${p.text.length} chars`);
        console.log(`     "${preview}"`);
      });

      // Show longest paragraphs (these are what the scannability generator uses)
      const longParagraphs = allParagraphs.filter(p => p.text.length > 150);
      if (longParagraphs.length > 0) {
        console.log(`[ContentExtractor] 📊 Found ${longParagraphs.length} long paragraphs (>150 chars)`);
        console.log('[ContentExtractor] Top 3 longest high-quality paragraphs:');
        longParagraphs.slice(0, 3).forEach((p, idx) => {
          const preview = p.text.substring(0, 100) + '...';
          console.log(`  ${idx + 1}. Score: ${p.score}, Length: ${p.text.length} chars`);
          console.log(`     "${preview}"`);
        });
      }
    }

    // Extract lists
    const lists = [];
    $('ul, ol').each((idx, el) => {
      const items = [];
      $(el).find('li').each((i, li) => {
        items.push($(li).text().trim());
      });
      lists.push({
        type: el.name,
        items,
        itemCount: items.length
      });
    });

    // Extract tables
    const tables = [];
    $('table').each((idx, el) => {
      const rows = $(el).find('tr').length;
      const cols = $(el).find('tr').first().find('th, td').length;
      tables.push({ rows, cols, hasHeaders: $(el).find('th').length > 0 });
    });

    // Get all text content
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    const wordCount = bodyText.split(/\s+/).length;

    return {
      headings,
      paragraphs: paragraphs.slice(0, limits.maxParagraphs), // RULEBOOK v1.2: Adaptive limits
      lists,
      listItems, // RULEBOOK v1.2 Section 7.3.1
      tables,
      faqs: faqs, // FAQs extracted before footer removal
      accordions, // RULEBOOK v1.2 Section 7.3.2
      tabs, // Evidence contract v2.0
      wordCount,
      textLength: bodyText.length,
      bodyText: bodyText.substring(0, limits.maxCharsTotal) // RULEBOOK v1.2: Adaptive limits
    };
  }

  /**
   * Legacy extractContent method for backward compatibility
   * DEPRECATED: Use extractContentFromCleanedDOM with clone DOM approach instead
   */
  extractContent($, structuredData = []) {
    console.warn('[ContentExtractor] WARNING: Using deprecated extractContent method. Consider using clone DOM approach.');
    const faqs = this.extractFAQs($, structuredData);
    $('script, style, nav, header, footer, aside').remove();
    return this.extractContentFromCleanedDOM($, faqs);
  }

  /**
   * Extract FAQs with enhanced multi-tier detection
   * IMPORTANT: Call this BEFORE removing footer/nav elements
   *
   * Detection methods:
   * 0. JSON-LD FAQPage schema
   * 1. Microdata schema markup
   * 2. FAQ sections by class/id patterns
   * 3. FAQ sections by heading text (e.g., "Frequently Asked Questions")
   * 4. Accordion/collapsible patterns (buttons with aria-expanded, collapse classes)
   * 5. Question-like headings (h2/h3/h4 ending with ?)
   */
  extractFAQs($, structuredData = []) {
    const faqs = [];

    // DEBUG: Log input data
    console.log('[ContentExtractor] extractFAQs INPUT:', {
      structuredDataCount: structuredData.length,
      structuredDataTypes: structuredData.map(sd => sd.type).join(', ')
    });

    // Method 0: Extract FAQs from JSON-LD FAQPage schema
    const faqSchemas = structuredData.filter(sd => sd.type === 'FAQPage');
    if (faqSchemas.length > 0) {
      console.log(`[ContentExtractor] Found ${faqSchemas.length} FAQPage schemas in JSON-LD`);
      faqSchemas.forEach((schema, schemaIdx) => {
        const mainEntity = schema.raw.mainEntity || [];
        if (Array.isArray(mainEntity)) {
          mainEntity.forEach((entity, idx) => {
            const question = entity.name || '';
            const answer = entity.acceptedAnswer?.text || entity.acceptedAnswer || '';
            if (question && answer) {
              faqs.push({ question, answer, source: 'schema' });
              console.log(`[ContentExtractor] Extracted FAQ from JSON-LD schema #${schemaIdx + 1}, question #${idx + 1}: ${question.substring(0, 60)}...`);
            }
          });
        }
      });
    }

    // Method 1: Detect FAQs with microdata schema markup
    $('[itemtype*="FAQPage"], [itemtype*="Question"]').each((idx, el) => {
      const question = $(el).find('[itemprop="name"]').text().trim() ||
                       $(el).find('h2, h3, h4, strong').first().text().trim();
      const answer = $(el).find('[itemprop="acceptedAnswer"]').text().trim() ||
                     $(el).find('p').first().text().trim();
      if (question && answer) {
        faqs.push({ question, answer, source: 'schema' });
      }
    });

    // Method 2: Detect FAQ sections by class/id using centralized VOCABULARY
    const faqSelectors = VOCABULARY.getSelectorString('faq', 'containers');

    $(faqSelectors).each((idx, el) => {
      const $el = $(el);

      // For details/summary elements
      if (el.name === 'details') {
        const question = $el.find('summary').text().trim();
        const answer = $el.contents().not('summary').text().trim();
        if (question && answer && question.length > 10) {
          faqs.push({ question, answer, source: 'details' });
        }
        return;
      }

      // For FAQ containers, look for Q&A patterns
      // Extended to include buttons, spans, and aria-expanded elements
      const questionElements = $el.find('h2, h3, h4, h5, h6, dt, button, [role="button"], [aria-expanded], [class*="question" i], [class*="title" i], [class*="header" i]');
      questionElements.each((i, questionEl) => {
        const $questionEl = $(questionEl);
        const question = $questionEl.text().trim();

        // Skip if question is too short or too long (likely a section header)
        if (question.length < 10 || question.length > 300) return;

        // Get the answer
        let answer = '';
        const tagName = questionEl.name || '';

        if (tagName === 'dt') {
          // Definition list pattern
          answer = $questionEl.next('dd').text().trim();
        } else if ($questionEl.attr('aria-expanded') !== undefined || $questionEl.attr('data-toggle') || $questionEl.attr('data-bs-toggle')) {
          // Accordion button pattern - look for associated panel
          const targetId = $questionEl.attr('aria-controls') || $questionEl.attr('data-target') || $questionEl.attr('data-bs-target');
          if (targetId) {
            const $target = $(`#${targetId.replace('#', '')}, ${targetId}`);
            answer = $target.text().trim();
          }
          // Also check next sibling for collapse/panel
          if (!answer) {
            const $next = $questionEl.next();
            if ($next.is('[class*="collapse" i], [class*="panel" i], [class*="content" i], [class*="answer" i], [class*="body" i]')) {
              answer = $next.text().trim();
            }
          }
        } else {
          // Get content until next similar element
          let $next = $questionEl.next();
          const siblingChecks = 5; // Check up to 5 siblings
          let checks = 0;

          while ($next.length && checks < siblingChecks) {
            const nextClass = ($next.attr('class') || '').toLowerCase();
            const isNextQuestion = $next.is('h1, h2, h3, h4, h5, h6, dt, button, [aria-expanded]') ||
                                   nextClass.includes('question') || nextClass.includes('title') || nextClass.includes('header');

            if (isNextQuestion) break;

            const nextText = $next.text().trim();
            if (nextText.length > 0 && nextText.length < 2000) {
              answer += ' ' + nextText;
            }
            $next = $next.next();
            checks++;
          }
        }

        answer = answer.trim();

        // Only add if it looks like a Q&A
        if (question && answer &&
            (question.includes('?') || question.length > 15) &&
            answer.length > 20) {
          faqs.push({ question, answer: answer.substring(0, 1000), source: 'html' });
        }
      });
    });

    // Method 3: Detect FAQ sections by heading text containing "FAQ" or "Frequently Asked"
    // Find sections with FAQ-related headings, then extract Q&A within
    // Using centralized VOCABULARY pattern
    const faqHeadingRegex = VOCABULARY.TEXT_PATTERNS.questions.faqHeadings;

    $('h1, h2, h3, h4').each((idx, headingEl) => {
      const $heading = $(headingEl);
      const headingText = $heading.text().trim();

      if (faqHeadingRegex.test(headingText)) {
        console.log(`[ContentExtractor] Found FAQ section heading: "${headingText}"`);

        // Find the container (parent section, div, or article)
        let $container = $heading.parent();
        // Walk up to find a meaningful container
        for (let i = 0; i < 3; i++) {
          if ($container.is('section, article, main, [class*="faq" i], [class*="section" i]')) {
            break;
          }
          $container = $container.parent();
        }

        // Extract Q&A pairs from within this container
        // Look for question-answer pairs after the FAQ heading
        const $afterHeading = $heading.nextAll();
        let currentQuestion = null;
        let currentAnswer = '';

        $afterHeading.each((i, el) => {
          const $el = $(el);
          const tagName = el.name || '';
          const text = $el.text().trim();
          const elClass = ($el.attr('class') || '').toLowerCase();

          // Stop if we hit another major section heading
          if (tagName === 'h1' || (tagName === 'h2' && !text.includes('?'))) {
            // Save any pending Q&A
            if (currentQuestion && currentAnswer.length > 20) {
              faqs.push({ question: currentQuestion, answer: currentAnswer.substring(0, 1000), source: 'section' });
            }
            return false; // Stop iterating
          }

          // Check if this is a question element
          const isQuestionEl = (
            text.includes('?') ||
            elClass.includes('question') ||
            elClass.includes('title') ||
            elClass.includes('header') ||
            $el.is('button, [aria-expanded], [role="button"], dt, h3, h4, h5, h6, strong')
          );

          if (isQuestionEl && text.length > 10 && text.length < 300) {
            // Save previous Q&A if exists
            if (currentQuestion && currentAnswer.length > 20) {
              faqs.push({ question: currentQuestion, answer: currentAnswer.substring(0, 1000), source: 'section' });
            }
            currentQuestion = text;
            currentAnswer = '';
          } else if (currentQuestion) {
            // This is answer content
            if (text.length > 0 && text.length < 2000) {
              currentAnswer += ' ' + text;
            }
          }
        });

        // Don't forget the last Q&A pair
        if (currentQuestion && currentAnswer.length > 20) {
          faqs.push({ question: currentQuestion, answer: currentAnswer.substring(0, 1000), source: 'section' });
        }
      }
    });

    // Method 4: Detect accordion patterns by aria-expanded buttons/elements outside FAQ sections
    $('[aria-expanded]').each((idx, el) => {
      const $el = $(el);
      const question = $el.text().trim();

      // Skip if already processed or invalid
      if (question.length < 10 || question.length > 300) return;

      // Get the associated panel content
      let answer = '';
      const targetId = $el.attr('aria-controls');
      if (targetId) {
        const $target = $(`#${targetId}`);
        answer = $target.text().trim();
      }

      // Also try next sibling
      if (!answer || answer.length < 20) {
        const $next = $el.next();
        if ($next.is('[class*="collapse" i], [class*="panel" i], [class*="content" i], [class*="body" i], [class*="answer" i]')) {
          answer = $next.text().trim();
        }
      }

      if (question && answer && answer.length > 20 && (question.includes('?') || question.length > 15)) {
        faqs.push({ question, answer: answer.substring(0, 1000), source: 'aria' });
      }
    });

    // Method 5: Look for question-like headings followed by content (always run, not just as fallback)
    $('h2, h3, h4, h5').each((idx, heading) => {
      const $heading = $(heading);
      const question = $heading.text().trim();

      // Check if heading looks like a question
      if (question.includes('?') && question.length > 15 && question.length < 200) {
        // Get the next paragraph(s) as answer
        let answer = '';
        let $next = $heading.next();

        // If heading has no next sibling, check if parent's next sibling has content
        // This handles cases where headings are wrapped in divs (e.g., theme containers)
        if ($next.length === 0) {
          const $parent = $heading.parent();
          $next = $parent.next();
        }

        let checks = 0;
        while ($next.length && !$next.is('h1, h2, h3, h4, h5, h6') && answer.length < 800 && checks < 5) {
          const nextText = $next.text().trim();
          if (nextText.length > 0) {
            answer += ' ' + nextText;
          }
          $next = $next.next();
          checks++;
        }

        answer = answer.trim();
        if (answer.length > 30) {
          faqs.push({ question, answer: answer.substring(0, 1000), source: 'heading' });
        }
      }
    });

    // Deduplicate FAQs (keep first occurrence, prioritize schema sources)
    const uniqueFAQs = [];
    const seen = new Set();

    // Sort to prioritize schema > html > section > aria > heading
    const sourcePriority = { 'schema': 0, 'html': 1, 'details': 2, 'section': 3, 'aria': 4, 'heading': 5 };
    faqs.sort((a, b) => (sourcePriority[a.source] || 99) - (sourcePriority[b.source] || 99));

    for (const faq of faqs) {
      // Normalize question for deduplication
      const key = faq.question.toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove punctuation
        .replace(/\s+/g, ' ')    // Normalize whitespace
        .substring(0, 50);

      if (!seen.has(key) && key.length > 5) {
        seen.add(key);
        uniqueFAQs.push(faq);
      }
    }

    console.log(`[ContentExtractor] Found ${uniqueFAQs.length} FAQs (schema: ${uniqueFAQs.filter(f => f.source === 'schema').length}, html: ${uniqueFAQs.filter(f => f.source === 'html').length}, details: ${uniqueFAQs.filter(f => f.source === 'details').length}, section: ${uniqueFAQs.filter(f => f.source === 'section').length}, aria: ${uniqueFAQs.filter(f => f.source === 'aria').length}, heading: ${uniqueFAQs.filter(f => f.source === 'heading').length})`);

    return uniqueFAQs;
  }

  /**
   * Extract structural elements and semantic HTML
   * IMPORTANT: Call this BEFORE extractContent() which removes nav/header/footer
   */
  extractStructure($) {
    // Build heading hierarchy (evidence contract v2.0)
    const headingHierarchy = [];
    $('h1, h2, h3, h4, h5, h6').each((i, el) => {
      const tagName = el.tagName.toLowerCase();
      headingHierarchy.push({
        level: parseInt(tagName.substring(1)),
        text: $(el).text().trim(),
        id: $(el).attr('id') || null,
        index: i
      });
    });

    return {
      // Semantic HTML5 elements
      hasMain: $('main').length > 0,
      hasArticle: $('article').length > 0,
      hasSection: $('section').length > 0,
      hasAside: $('aside').length > 0,
      hasNav: $('nav').length > 0,
      hasHeader: $('header').length > 0,
      hasFooter: $('footer').length > 0,

      // ARIA landmarks
      landmarks: $('[role="main"], [role="navigation"], [role="complementary"], [role="contentinfo"]').length,

      // Heading hierarchy (evidence contract v2.0)
      headingHierarchy,
      headingCount: headingHierarchy.length,

      // Legacy heading counts for backwards compatibility
      headingCountByLevel: {
        h1: $('h1').length,
        h2: $('h2').length,
        h3: $('h3').length,
        h4: $('h4').length,
        h5: $('h5').length,
        h6: $('h6').length
      },

      // Links
      internalLinks: $('a[href^="/"], a[href^="' + this.url + '"]').length,
      externalLinks: $('a[href^="http"]').not('[href^="' + this.url + '"]').length,

      // IDs and anchors
      elementsWithIds: $('[id]').length,
      anchorLinks: $('a[href^="#"]').length,

      // Table of contents detection
      hasTOC: $('[id*="toc"], [class*="toc"], [class*="table-of-contents"]').length > 0,

      // Breadcrumbs
      hasBreadcrumbs: $('[itemtype*="BreadcrumbList"], nav[aria-label*="breadcrumb"]').length > 0
    };
  }

  /**
   * RULEBOOK v1.2 Section 9.5: Third-Party Profile Detection
   * Extracts social and third-party profile links from:
   * 1. JSON-LD sameAs property in Organization/Person schema
   * 2. Footer links to known social platforms
   */
  extractThirdPartyProfiles($, structuredData = []) {
    const SOCIAL_PLATFORMS = {
      linkedin: { pattern: /linkedin\.com\/(company|in)\//i, name: 'LinkedIn' },
      twitter: { pattern: /twitter\.com\/|x\.com\//i, name: 'Twitter/X' },
      facebook: { pattern: /facebook\.com\//i, name: 'Facebook' },
      instagram: { pattern: /instagram\.com\//i, name: 'Instagram' },
      youtube: { pattern: /youtube\.com\/(channel|c|user|@)/i, name: 'YouTube' },
      github: { pattern: /github\.com\//i, name: 'GitHub' },
      crunchbase: { pattern: /crunchbase\.com\/organization\//i, name: 'Crunchbase' },
      glassdoor: { pattern: /glassdoor\.com\/Overview\//i, name: 'Glassdoor' },
      trustpilot: { pattern: /trustpilot\.com\/review\//i, name: 'Trustpilot' },
      bbb: { pattern: /bbb\.org\/us\//i, name: 'BBB' },
      yelp: { pattern: /yelp\.com\/biz\//i, name: 'Yelp' },
      tiktok: { pattern: /tiktok\.com\/@/i, name: 'TikTok' },
      pinterest: { pattern: /pinterest\.com\//i, name: 'Pinterest' }
    };

    const profiles = [];
    const profileUrls = new Set();

    // Method 1: Extract from JSON-LD sameAs
    const orgSchemas = structuredData.filter(s =>
      ['Organization', 'LocalBusiness', 'Corporation', 'Person'].includes(s.type)
    );

    for (const schema of orgSchemas) {
      const sameAs = schema.raw?.sameAs || [];
      const sameAsArray = Array.isArray(sameAs) ? sameAs : [sameAs];

      for (const url of sameAsArray) {
        if (!url || profileUrls.has(url)) continue;
        profileUrls.add(url);

        // Identify platform
        let platform = 'other';
        let platformName = 'Other';
        for (const [key, config] of Object.entries(SOCIAL_PLATFORMS)) {
          if (config.pattern.test(url)) {
            platform = key;
            platformName = config.name;
            break;
          }
        }

        profiles.push({
          url,
          platform,
          platformName,
          source: 'sameAs',
          schemaType: schema.type
        });
      }
    }

    // Method 2: Extract from footer links
    $('footer a[href]').each((i, el) => {
      const href = $(el).attr('href') || '';
      if (!href || profileUrls.has(href)) return;

      for (const [key, config] of Object.entries(SOCIAL_PLATFORMS)) {
        if (config.pattern.test(href)) {
          profileUrls.add(href);
          profiles.push({
            url: href,
            platform: key,
            platformName: config.name,
            source: 'footer',
            linkText: $(el).text().trim() || null
          });
          break;
        }
      }
    });

    // Categorize profiles
    const socialProfiles = profiles.filter(p =>
      ['linkedin', 'twitter', 'facebook', 'instagram', 'youtube', 'tiktok', 'pinterest'].includes(p.platform)
    );
    const businessProfiles = profiles.filter(p =>
      ['crunchbase', 'glassdoor', 'bbb', 'yelp', 'trustpilot'].includes(p.platform)
    );
    const developerProfiles = profiles.filter(p => p.platform === 'github');

    return {
      detected: profiles.length > 0,
      profiles,
      count: profiles.length,
      socialProfiles,
      businessProfiles,
      developerProfiles,
      hasSameAs: profiles.some(p => p.source === 'sameAs'),
      hasFooterLinks: profiles.some(p => p.source === 'footer'),
      platforms: [...new Set(profiles.map(p => p.platform))]
    };
  }

  /**
   * Extract navigation links for section detection
   * IMPORTANT: Call this BEFORE extractContent() which removes nav/header/footer
   * Fix for Issue #2 + #9: Blog/FAQ detection now uses navigation links
   *
   * Per rulebook section "4.2 Navigation Structure":
   * - Extract links from nav, header, AND footer elements
   * - Track nav elements with metadata
   * - Detect key pages (home, about, services, blog, faq, contact, pricing, team)
   */
  extractNavigation($) {
    const navElements = [];
    const allNavLinks = [];

    // Extract navigation elements with metadata
    $('nav, [role="navigation"]').each((i, el) => {
      const links = [];
      $(el).find('a').each((j, link) => {
        const href = $(link).attr('href') || '';
        const text = $(link).text().trim();
        if (href && text && href !== '#') {
          links.push({
            href,
            text,
            inDropdown: $(link).closest('[class*="dropdown"], [class*="submenu"], [class*="menu-item-has-children"]').length > 0
          });
        }
      });
      navElements.push({
        hasAriaLabel: !!$(el).attr('aria-label'),
        ariaLabel: $(el).attr('aria-label') || null,
        linkCount: links.length,
        links: links
      });
      allNavLinks.push(...links);
    });

    // Also extract header/footer links (per rulebook)
    $('header a, footer a').each((i, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim();
      if (href && text && href !== '#' && !allNavLinks.find(l => l.href === href)) {
        allNavLinks.push({ href, text, inDropdown: false });
      }
    });

    // Extract header links separately for evidence contract compliance
    const headerLinks = [];
    $('header a').each((i, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim();
      if (href && text) {
        headerLinks.push({ href, text, source: 'header' });
      }
    });

    // Extract nav links as flat array for evidence contract compliance
    const navLinks = [];
    $('nav a, [role="navigation"] a').each((i, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim();
      if (href && text && href !== '#') {
        navLinks.push({ href, text, source: 'nav' });
      }
    });

    // Extract footer links separately for evidence contract compliance
    const footerLinks = [];
    $('footer a').each((i, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim();
      if (href && text) {
        footerLinks.push({ href, text, source: 'footer' });
      }
    });

    // Detect key pages from nav links using centralized VOCABULARY
    const keyPages = {
      home: allNavLinks.some(l =>
        l.href === '/' ||
        VOCABULARY.URL_PATTERNS.home.test(l.href) ||
        VOCABULARY.matchesNavKeyword(l.text, 'home')
      ),
      about: allNavLinks.some(l =>
        VOCABULARY.URL_PATTERNS.about.test(l.href) ||
        VOCABULARY.matchesNavKeyword(l.text, 'about')
      ),
      services: allNavLinks.some(l =>
        VOCABULARY.URL_PATTERNS.services.test(l.href) ||
        VOCABULARY.matchesNavKeyword(l.text, 'services')
      ),
      blog: allNavLinks.some(l =>
        VOCABULARY.URL_PATTERNS.blog.test(l.href) ||
        VOCABULARY.matchesNavKeyword(l.text, 'blog')
      ),
      faq: allNavLinks.some(l =>
        VOCABULARY.URL_PATTERNS.faq.test(l.href) ||
        VOCABULARY.matchesNavKeyword(l.text, 'faq')
      ),
      contact: allNavLinks.some(l =>
        VOCABULARY.URL_PATTERNS.contact.test(l.href) ||
        VOCABULARY.matchesNavKeyword(l.text, 'contact')
      ),
      pricing: allNavLinks.some(l =>
        VOCABULARY.URL_PATTERNS.pricing.test(l.href) ||
        VOCABULARY.matchesNavKeyword(l.text, 'pricing')
      ),
      team: allNavLinks.some(l =>
        VOCABULARY.URL_PATTERNS.team.test(l.href) ||
        VOCABULARY.matchesNavKeyword(l.text, 'team')
      ),
      careers: allNavLinks.some(l =>
        VOCABULARY.URL_PATTERNS.careers.test(l.href) ||
        VOCABULARY.matchesNavKeyword(l.text, 'careers')
      ),
      portfolio: allNavLinks.some(l =>
        VOCABULARY.URL_PATTERNS.portfolio.test(l.href) ||
        VOCABULARY.matchesNavKeyword(l.text, 'portfolio')
      )
    };

    const keyPageCount = Object.values(keyPages).filter(Boolean).length;

    // Legacy property names for backwards compatibility
    const hasBlogLink = keyPages.blog;
    const hasFAQLink = keyPages.faq;
    const hasAboutLink = keyPages.about;
    const hasContactLink = keyPages.contact;
    const hasServicesLink = keyPages.services;
    const hasPricingLink = keyPages.pricing;

    // Build unified allNavLinks from separated sources (evidence contract v2.0)
    const unifiedNavLinks = [...headerLinks, ...navLinks, ...footerLinks];

    console.log('[Detection] Navigation analysis:', {
      navElementCount: navElements.length,
      headerLinks: headerLinks.length,
      navLinks: navLinks.length,
      footerLinks: footerLinks.length,
      totalLinks: unifiedNavLinks.length,
      keyPageCount,
      keyPages
    });

    return {
      // New structure per rulebook
      detected: navElements.length > 0,
      navElements,
      totalNavLinks: unifiedNavLinks.length,
      allNavLinks: unifiedNavLinks,
      keyPages,
      keyPageCount,
      hasSemanticNav: $('nav').length > 0,
      hasHeader: $('header').length > 0,
      hasFooter: $('footer').length > 0,
      hasMain: $('main').length > 0,
      hasMobileMenu: $('[class*="mobile"], [class*="hamburger"], [class*="menu-toggle"]').length > 0,

      // Legacy properties for backwards compatibility
      links: allNavLinks,
      hasBlogLink,
      hasFAQLink,
      hasAboutLink,
      hasContactLink,
      hasServicesLink,
      hasPricingLink,

      // Evidence contract v2.0: Separated link sources
      headerLinks,
      headerLinkCount: headerLinks.length,
      navLinks,
      navLinkCount: navLinks.length,
      footerLinks,
      footerLinkCount: footerLinks.length
    };
  }

  /**
   * Extract media elements (images, videos, audio)
   */
  extractMedia($) {
    const images = [];
    $('img').each((idx, el) => {
      images.push({
        src: $(el).attr('src') || '',
        alt: $(el).attr('alt') || '',
        hasAlt: !!$(el).attr('alt'),
        title: $(el).attr('title') || '',
        loading: $(el).attr('loading') || ''
      });
    });

    const videos = [];
    $('video, iframe[src*="youtube"], iframe[src*="vimeo"]').each((idx, el) => {
      const tagName = el.name;
      videos.push({
        type: tagName === 'video' ? 'native' : 'embed',
        src: $(el).attr('src') || $(el).find('source').attr('src') || '',
        hasControls: tagName === 'video' ? $(el).attr('controls') !== undefined : false,
        hasTranscript: $(el).siblings('[class*="transcript"], [id*="transcript"]').length > 0,
        hasCaptions: tagName === 'video' ? $(el).find('track[kind="captions"]').length > 0 : false
      });
    });

    const audio = [];
    $('audio').each((idx, el) => {
      audio.push({
        src: $(el).attr('src') || $(el).find('source').attr('src') || '',
        hasControls: $(el).attr('controls') !== undefined,
        hasTranscript: $(el).siblings('[class*="transcript"], [id*="transcript"]').length > 0
      });
    });

    return {
      images: images.slice(0, 100), // First 100 images
      videos,
      audio,
      imageCount: images.length,
      imagesWithAlt: images.filter(img => img.hasAlt).length,
      imagesWithoutAlt: images.filter(img => !img.hasAlt).length,
      videoCount: videos.length,
      audioCount: audio.length
    };
  }

  /**
   * Extract technical SEO elements
   */
  /**
   * Recursively extract all @type values from a schema object, including nested ones
   */
  extractAllSchemaTypes(obj, types = new Set()) {
    if (!obj || typeof obj !== 'object') return types;

    // Handle @type field (can be string or array)
    if (obj['@type']) {
      const typeValue = obj['@type'];
      if (Array.isArray(typeValue)) {
        typeValue.forEach(t => types.add(t));
      } else {
        types.add(typeValue);
      }
    }

    // Recursively check all properties
    for (const key in obj) {
      if (key !== '@type' && obj[key] && typeof obj[key] === 'object') {
        if (Array.isArray(obj[key])) {
          obj[key].forEach(item => this.extractAllSchemaTypes(item, types));
        } else {
          this.extractAllSchemaTypes(obj[key], types);
        }
      }
    }

    return types;
  }

  async extractTechnical($, htmlData) {
    const html = typeof htmlData === 'string' ? htmlData : htmlData.html;
    const headers = htmlData?.headers || {};

    // Structured data detection (JSON-LD)
    // RULEBOOK v1.2 Section 3.1.4: JSON-LD @graph Processing with Source Tracking
    const structuredData = [];
    const allSchemaTypes = new Set(); // Track all schema types including nested ones
    const jsonLdScripts = $('script[type="application/ld+json"]');
    console.log(`[ContentExtractor] Found ${jsonLdScripts.length} JSON-LD script tags`);

    jsonLdScripts.each((scriptIndex, el) => {
      try {
        const scriptContent = $(el).html();
        console.log(`[ContentExtractor] Parsing JSON-LD #${scriptIndex + 1}, length: ${scriptContent?.length || 0} chars`);
        const data = JSON.parse(scriptContent);

        // RULEBOOK v1.2 Section 3.1.4: Handle @graph arrays with source path tracking
        if (data['@graph'] && Array.isArray(data['@graph'])) {
          data['@graph'].forEach((item, graphIndex) => {
            let itemType = item['@type'] || 'Unknown';
            if (Array.isArray(itemType)) {
              itemType = itemType[0];
            }

            structuredData.push({
              type: itemType,
              context: data['@context'] || '',
              raw: item,
              source: 'json-ld-graph',
              sourcePath: `script[${scriptIndex}].@graph[${graphIndex}]`, // RULEBOOK v1.2: Source path tracking
              scriptIndex,
              graphIndex
            });

            // Extract all types including nested ones
            const typesInThisSchema = this.extractAllSchemaTypes(item);
            typesInThisSchema.forEach(type => allSchemaTypes.add(type));
          });
        } else {
          // Single schema (not @graph)
          let topLevelType = data['@type'] || 'Unknown';
          if (Array.isArray(topLevelType)) {
            topLevelType = topLevelType[0]; // Use first type as primary
          }
          console.log(`[ContentExtractor] Successfully parsed: ${topLevelType}`);

          structuredData.push({
            type: topLevelType,
            context: data['@context'] || '',
            raw: data,
            source: 'json-ld',
            sourcePath: `script[${scriptIndex}]`, // RULEBOOK v1.2: Source path tracking
            scriptIndex
          });

          // Extract all types including nested ones
          const typesInThisSchema = this.extractAllSchemaTypes(data);
          typesInThisSchema.forEach(type => allSchemaTypes.add(type));
        }

      } catch (e) {
        console.log(`[ContentExtractor] Failed to parse JSON-LD #${scriptIndex + 1}:`, e.message);
      }
    });

    console.log(`[ContentExtractor] Total structured data found: ${structuredData.length}`);
    console.log(`[ContentExtractor] All schema types (including nested): ${Array.from(allSchemaTypes).join(', ')}`);
    console.log(`[ContentExtractor] Has Organization: ${allSchemaTypes.has('Organization')}`);
    console.log(`[ContentExtractor] Has FAQPage: ${allSchemaTypes.has('FAQPage')}`);
    console.log(`[ContentExtractor] Has LocalBusiness: ${allSchemaTypes.has('LocalBusiness')}`);
    console.log(`[ContentExtractor] Has Place: ${allSchemaTypes.has('Place')}`);
    console.log(`[ContentExtractor] Has GeoCoordinates: ${allSchemaTypes.has('GeoCoordinates')}`);

    // RULEBOOK v1.2 Section 11.4.1: Canonical Detection (Tag + Header)
    const canonicalTag = $('link[rel="canonical"]').attr('href') || null;
    const canonicalHeaderMatch = headers?.link?.match(/<([^>]+)>;\s*rel="canonical"/i);
    const canonicalHeader = canonicalHeaderMatch ? canonicalHeaderMatch[1] : null;
    const canonical = {
      detected: !!(canonicalTag || canonicalHeader),
      url: canonicalTag || canonicalHeader || null,
      source: canonicalTag ? 'tag' : (canonicalHeader ? 'header' : null),
      matchesUrl: (canonicalTag || canonicalHeader) === this.url
    };

    // RULEBOOK v1.2 Section 11.4.2: Open Graph Detection
    const openGraph = {
      title: $('meta[property="og:title"]').attr('content') || null,
      description: $('meta[property="og:description"]').attr('content') || null,
      image: $('meta[property="og:image"]').attr('content') || null,
      url: $('meta[property="og:url"]').attr('content') || null,
      type: $('meta[property="og:type"]').attr('content') || null
    };

    // RULEBOOK v1.2 Section 11.4.2: Twitter Card Detection
    const twitterCard = {
      card: $('meta[name="twitter:card"]').attr('content') || null,
      site: $('meta[name="twitter:site"]').attr('content') || null,
      title: $('meta[name="twitter:title"]').attr('content') || null,
      description: $('meta[name="twitter:description"]').attr('content') || null,
      image: $('meta[name="twitter:image"]').attr('content') || null
    };

    // RULEBOOK v1.2 Section 11.4.3: IndexNow Detection with Key Verification
    const indexNowKey = $('meta[name="indexnow-key"]').attr('content') || null;
    const indexNow = await this.verifyIndexNow($, indexNowKey);

    // RULEBOOK v1.2 Section 11.4.4: RSS/Atom Feed Detection
    const feeds = [];
    $('link[type="application/rss+xml"]').each((i, el) => {
      feeds.push({ url: $(el).attr('href'), type: 'rss', title: $(el).attr('title') || null });
    });
    $('link[type="application/atom+xml"]').each((i, el) => {
      feeds.push({ url: $(el).attr('href'), type: 'atom', title: $(el).attr('title') || null });
    });
    const feedsResult = {
      detected: feeds.length > 0,
      feeds,
      urls: feeds.map(f => f.url),
      types: [...new Set(feeds.map(f => f.type))]
    };

    // RULEBOOK v1.2 Section 8.4: JS-Rendered Site Detection
    const bodyText = $('body').text().trim();
    const jsRenderingIndicators = {
      emptyBody: bodyText.length < 500,
      hasReactRoot: $('#root, [data-reactroot]').length > 0,
      hasVueApp: $('[data-v-], [v-cloak]').length > 0,
      hasAngular: $('[ng-app], app-root').length > 0,
      hasLoadingState: /loading\.\.\.|please wait/i.test(bodyText),
      emptyMainContent: $('main, #content, article').text().trim().length < 100
    };
    const isJSRendered = jsRenderingIndicators.emptyBody ||
                         (jsRenderingIndicators.hasReactRoot && jsRenderingIndicators.emptyMainContent) ||
                         jsRenderingIndicators.hasLoadingState;
    const jsRendering = {
      isJSRendered,
      indicators: jsRenderingIndicators,
      recommendation: isJSRendered
        ? 'JS-rendered site; scan may be incomplete without headless rendering'
        : null
    };

    // RULEBOOK v1.2: Hreflang detection with language details
    const hreflangElements = $('link[rel="alternate"][hreflang]');
    const hreflang = {
      detected: hreflangElements.length > 0,
      languages: hreflangElements.map((i, el) => $(el).attr('hreflang')).get(),
      defaultLang: hreflangElements.filter('[hreflang="x-default"]').attr('href') || null,
      count: hreflangElements.length
    };

    return {
      // Structured Data
      structuredData,
      hasOrganizationSchema: allSchemaTypes.has('Organization'),
      hasLocalBusinessSchema: allSchemaTypes.has('LocalBusiness'),
      hasFAQSchema: allSchemaTypes.has('FAQPage'),
      hasArticleSchema: allSchemaTypes.has('Article') || allSchemaTypes.has('BlogPosting'),
      hasBreadcrumbSchema: allSchemaTypes.has('BreadcrumbList'),

      // RULEBOOK v1.2 Section 11.4.1: Canonical (tag + header)
      canonical,
      hasCanonical: canonical.detected,
      canonicalUrl: canonical.url || '',

      // RULEBOOK v1.2: Hreflang
      hreflang,
      hreflangTags: hreflang.count,
      hreflangLanguages: hreflang.languages,

      // RULEBOOK v1.2 Section 11.4.2: Open Graph + Twitter Card
      openGraph,
      twitterCard,

      // RULEBOOK v1.2 Section 11.4.3: IndexNow
      indexNow,

      // RULEBOOK v1.2 Section 11.4.4: RSS/Atom Feeds
      feeds: feedsResult,
      hasRSSFeed: feedsResult.detected,

      // RULEBOOK v1.2 Section 8.4: JS-Rendered Site Detection
      jsRendering,
      isJSRendered: jsRendering.isJSRendered,

      // Sitemap
      hasSitemapLink: $('link[rel="sitemap"]').length > 0 ||
                      html.toLowerCase().includes('sitemap.xml'),

      // Viewport
      hasViewport: $('meta[name="viewport"]').length > 0,
      viewport: $('meta[name="viewport"]').attr('content') || '',

      // Character encoding
      charset: $('meta[charset]').attr('charset') ||
               $('meta[http-equiv="Content-Type"]').attr('content')?.match(/charset=([^;]+)/)?.[1] || '',

      // Robots meta
      robotsMeta: $('meta[name="robots"]').attr('content') || '',

      // Cache control (from headers if available)
      cacheControl: headers?.['cache-control'] || '',
      lastModified: headers?.['last-modified'] || '',
      etag: headers?.['etag'] || ''
    };
  }

  /**
   * RULEBOOK v1.2 Step C2: IndexNow Key Verification
   * Verifies that the IndexNow key file exists at the expected location
   * Uses safe-http utility with SSRF protection and same-domain enforcement
   * Includes HEAD→GET fallback for servers that don't support HEAD
   */
  async verifyIndexNow($, key) {
    const result = {
      detected: false,
      keyLocation: null,
      key: null,
      keyValue: null,
      keyVerified: null,
      verificationStatus: null,
      verificationMethod: null,
      verificationError: null
    };

    if (!key) {
      return result;
    }

    result.detected = true;
    result.keyLocation = 'meta';
    result.key = key;
    result.keyValue = key;

    try {
      // Build the base URL from this.url
      const urlObj = new URL(this.url);
      const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
      const keyFileUrl = `${baseUrl}/${key}.txt`;

      console.log(`[IndexNow] Verifying key file at: ${keyFileUrl}`);

      // Use safe-http with SSRF protection and same-domain enforcement
      const headResult = await safeHead(keyFileUrl, {
        scanTargetUrl: this.url,
        requireSameDomain: true,
        timeout: 5000
      });

      result.verificationMethod = 'HEAD';

      if (headResult.success) {
        result.verificationStatus = headResult.status;

        if (headResult.status === 200) {
          result.keyVerified = true;
          console.log(`[IndexNow] Key verification: VERIFIED via HEAD (status: 200)`);
        } else if (headResult.status === 405) {
          // HEAD not allowed, try GET as fallback
          console.log(`[IndexNow] HEAD returned 405, trying GET fallback...`);

          const getResult = await safeGet(keyFileUrl, {
            scanTargetUrl: this.url,
            requireSameDomain: true,
            timeout: 5000
          });

          result.verificationMethod = 'GET';
          result.verificationStatus = getResult.status;

          if (getResult.success && getResult.status === 200) {
            // Verify the content matches the key
            const content = getResult.data?.toString().trim();
            result.keyVerified = content === key;
            console.log(`[IndexNow] Key verification via GET: ${result.keyVerified ? 'VERIFIED' : 'CONTENT MISMATCH'}`);
          } else {
            result.keyVerified = false;
            console.log(`[IndexNow] GET fallback failed (status: ${getResult.status})`);
          }
        } else {
          result.keyVerified = false;
          console.log(`[IndexNow] Key verification: NOT FOUND (status: ${headResult.status})`);
        }
      } else {
        result.keyVerified = false;
        result.verificationError = headResult.error;
        console.log(`[IndexNow] Key verification blocked: ${headResult.error}`);
      }

    } catch (error) {
      result.keyVerified = false;
      result.verificationError = error.message;
      console.log(`[IndexNow] Key verification failed: ${error.message}`);
    }

    console.log('[IndexNow] Verification:', {
      detected: result.detected,
      keyVerified: result.keyVerified,
      method: result.verificationMethod
    });

    return result;
  }

  /**
   * Check performance metrics (basic)
   */
  async checkPerformance() {
    try {
      const startTime = Date.now();

      // Add cache-busting query parameter to get fresh performance metrics
      const cacheBustUrl = this.url.includes('?')
        ? `${this.url}&_cb=${Date.now()}`
        : `${this.url}?_cb=${Date.now()}`;

      const response = await axios.head(cacheBustUrl, {
        timeout: 5000,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
      const ttfb = Date.now() - startTime; // Time to First Byte

      return {
        ttfb,
        responseTime: ttfb,
        serverTiming: response.headers['server-timing'] || '',
        contentLength: parseInt(response.headers['content-length']) || 0,
        contentType: response.headers['content-type'] || ''
      };
    } catch (error) {
      return {
        ttfb: null,
        responseTime: null,
        error: error.message
      };
    }
  }

  /**
   * Extract accessibility-related attributes
   */
  extractAccessibility($) {
    return {
      // ARIA attributes
      ariaLabels: $('[aria-label]').length,
      ariaDescribed: $('[aria-describedby]').length,
      ariaLabelledBy: $('[aria-labelledby]').length,
      ariaHidden: $('[aria-hidden="true"]').length,
      ariaLive: $('[aria-live]').length,
      
      // Form accessibility
      formsWithLabels: $('form').length > 0 ? 
        $('form label').length / Math.max($('form input, form select, form textarea').length, 1) : 0,
      
      // Image alt text (already in media section, but important for a11y)
      imagesWithAlt: $('img[alt]').length,
      imagesTotal: $('img').length,
      
      // Language
      hasLangAttribute: $('html[lang]').length > 0,
      
      // Skip links
      hasSkipLink: $('a[href="#main"], a[href="#content"]').length > 0,
      
      // Focus management
      tabindex: $('[tabindex]').length,
      
      // Color contrast (basic detection - would need actual color analysis)
      hasInlineStyles: $('[style*="color"]').length,
      
      // Semantic buttons vs divs with click handlers
      semanticButtons: $('button').length,
      divClickHandlers: $('div[onclick], div[role="button"]').length
    };
  }

  /**
   * Generate diagnostic evidence summaries using standardized schemas
   * Per rulebook "Data Storage Schema" and "Diagnostic Output Contract"
   * @param {Object} evidence - Raw extracted evidence
   * @returns {Object} - Standardized evidence object for each subfactor
   */
  generateDiagnosticEvidence(evidence) {
    const diagnosticEvidence = {};

    // ----------------------------------------
    // Organization Schema Evidence
    // ----------------------------------------
    const orgSchema = (evidence.technical?.structuredData || []).find(
      s => s.type === 'Organization' || s.type === 'Corporation' || s.type === 'LocalBusiness'
    );
    diagnosticEvidence.organizationSchema = EVIDENCE_SCHEMAS.organizationSchema.create({
      detected: !!orgSchema,
      source: orgSchema ? EVIDENCE_SOURCES.JSON_LD : EVIDENCE_SOURCES.HEURISTIC,
      confidence: orgSchema ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.LOW,
      name: orgSchema?.raw?.name || evidence.metadata?.ogTitle || null,
      description: orgSchema?.raw?.description || evidence.metadata?.description || null,
      url: orgSchema?.raw?.url || evidence.url || null,
      logo: orgSchema?.raw?.logo || evidence.metadata?.ogImage || null,
      sameAs: orgSchema?.raw?.sameAs || [],
      contactPoint: orgSchema?.raw?.contactPoint || null,
      address: orgSchema?.raw?.address || null,
      founders: orgSchema?.raw?.founder ? [orgSchema.raw.founder].flat() : [],
      foundingDate: orgSchema?.raw?.foundingDate || null,
      numberOfEmployees: orgSchema?.raw?.numberOfEmployees || null
    });

    // ----------------------------------------
    // FAQ Content Evidence
    // ----------------------------------------
    const faqs = evidence.content?.faqs || [];
    const avgAnswerLength = faqs.length > 0
      ? Math.round(faqs.reduce((sum, f) => sum + (f.answer?.length || 0), 0) / faqs.length)
      : 0;
    diagnosticEvidence.faqContent = EVIDENCE_SCHEMAS.faqContent.create({
      detected: faqs.length > 0 || evidence.technical?.hasFAQSchema,
      source: evidence.technical?.hasFAQSchema ? EVIDENCE_SOURCES.JSON_LD :
              faqs.length > 0 ? EVIDENCE_SOURCES.SEMANTIC_HTML : EVIDENCE_SOURCES.HEURISTIC,
      confidence: evidence.technical?.hasFAQSchema ? CONFIDENCE_LEVELS.HIGH :
                  faqs.length > 0 ? CONFIDENCE_LEVELS.MEDIUM : CONFIDENCE_LEVELS.LOW,
      faqs: faqs.slice(0, 10), // First 10 for diagnostic
      faqCount: faqs.length,
      hasSchema: evidence.technical?.hasFAQSchema || false,
      hasSectionHeading: faqs.some(f => f.source === 'section'),
      isAccordion: faqs.some(f => f.source === 'aria' || f.source === 'html'),
      averageAnswerLength: avgAnswerLength
    });

    // ----------------------------------------
    // Blog Presence Evidence
    // ----------------------------------------
    const hasBlogNav = evidence.navigation?.keyPages?.blog || evidence.navigation?.hasBlogLink;
    diagnosticEvidence.blogPresence = EVIDENCE_SCHEMAS.blogPresence.create({
      detected: hasBlogNav || evidence.technical?.hasArticleSchema,
      source: evidence.technical?.hasArticleSchema ? EVIDENCE_SOURCES.JSON_LD :
              hasBlogNav ? EVIDENCE_SOURCES.NAVIGATION_LINK : EVIDENCE_SOURCES.HEURISTIC,
      confidence: evidence.technical?.hasArticleSchema ? CONFIDENCE_LEVELS.HIGH :
                  hasBlogNav ? CONFIDENCE_LEVELS.MEDIUM : CONFIDENCE_LEVELS.LOW,
      hasBlogSection: hasBlogNav,
      blogUrl: null, // Would need crawler to find
      postCount: 0, // Would need crawler to count
      hasRssFeed: evidence.technical?.hasRSSFeed || false,
      hasArticleSchema: evidence.technical?.hasArticleSchema || false,
      categories: [],
      latestPostDate: evidence.metadata?.publishedTime || null
    });

    // ----------------------------------------
    // Navigation Structure Evidence
    // ----------------------------------------
    const nav = evidence.navigation || {};
    diagnosticEvidence.navigationStructure = EVIDENCE_SCHEMAS.navigationStructure.create({
      detected: nav.detected || nav.navElements?.length > 0,
      source: nav.hasSemanticNav ? EVIDENCE_SOURCES.SEMANTIC_HTML : EVIDENCE_SOURCES.CSS_CLASS,
      confidence: nav.hasSemanticNav ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.MEDIUM,
      hasSemanticNav: nav.hasSemanticNav || false,
      hasAriaLabel: nav.navElements?.some(n => n.hasAriaLabel) || false,
      navElementCount: nav.navElements?.length || 0,
      totalLinks: nav.totalNavLinks || nav.links?.length || 0,
      keyPages: nav.keyPages || {},
      keyPageCount: nav.keyPageCount || 0,
      hasDropdowns: nav.allNavLinks?.some(l => l.inDropdown) || false,
      hasMobileMenu: nav.hasMobileMenu || false,
      hasBreadcrumbs: evidence.structure?.hasBreadcrumbs || false
    });

    // ----------------------------------------
    // Heading Hierarchy Evidence
    // ----------------------------------------
    const headings = evidence.content?.headings || {};
    const h1Count = headings.h1?.length || 0;
    const skippedLevels = this.detectSkippedHeadingLevels(headings);
    diagnosticEvidence.headingHierarchy = EVIDENCE_SCHEMAS.headingHierarchy.create({
      detected: h1Count > 0,
      source: EVIDENCE_SOURCES.SEMANTIC_HTML,
      confidence: h1Count === 1 ? CONFIDENCE_LEVELS.HIGH :
                  h1Count > 0 ? CONFIDENCE_LEVELS.MEDIUM : CONFIDENCE_LEVELS.LOW,
      h1Count: h1Count,
      h1Text: headings.h1 || [],
      hasProperHierarchy: h1Count === 1 && skippedLevels.length === 0,
      skippedLevels: skippedLevels,
      headingCounts: {
        h1: headings.h1?.length || 0,
        h2: headings.h2?.length || 0,
        h3: headings.h3?.length || 0,
        h4: headings.h4?.length || 0,
        h5: headings.h5?.length || 0,
        h6: headings.h6?.length || 0
      },
      questionHeadings: [...(headings.h2 || []), ...(headings.h3 || []), ...(headings.h4 || [])]
        .filter(h => h.includes('?')).slice(0, 10)
    });

    // ----------------------------------------
    // Schema Markup Evidence
    // ----------------------------------------
    const structuredData = evidence.technical?.structuredData || [];
    diagnosticEvidence.schemaMarkup = EVIDENCE_SCHEMAS.schemaMarkup.create({
      detected: structuredData.length > 0,
      source: EVIDENCE_SOURCES.JSON_LD,
      confidence: structuredData.length > 0 ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.LOW,
      hasJsonLd: structuredData.length > 0,
      hasMicrodata: false, // Would need to check for itemtype/itemprop
      schemaTypes: structuredData.map(s => s.type),
      schemaCount: structuredData.length,
      isValid: true, // Would need validation
      errors: [],
      warnings: []
    });

    // ----------------------------------------
    // Meta Data Evidence
    // ----------------------------------------
    const meta = evidence.metadata || {};
    diagnosticEvidence.metaData = EVIDENCE_SCHEMAS.metaData.create({
      detected: !!(meta.title || meta.description),
      source: EVIDENCE_SOURCES.META_TAG,
      confidence: meta.title && meta.description ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.MEDIUM,
      title: meta.title || null,
      titleLength: meta.title?.length || 0,
      description: meta.description || null,
      descriptionLength: meta.description?.length || 0,
      hasOpenGraph: !!(meta.ogTitle || meta.ogDescription || meta.ogImage),
      hasTwitterCard: !!(meta.twitterCard || meta.twitterTitle),
      hasCanonical: evidence.technical?.hasCanonical || false,
      canonicalUrl: evidence.technical?.canonicalUrl || meta.canonical || null,
      robots: meta.robots || evidence.technical?.robotsMeta || null
    });

    // ----------------------------------------
    // Semantic HTML Evidence
    // ----------------------------------------
    const structure = evidence.structure || {};
    diagnosticEvidence.semanticHtml = EVIDENCE_SCHEMAS.semanticHtml.create({
      detected: structure.hasMain || structure.hasArticle || structure.hasSection,
      source: EVIDENCE_SOURCES.SEMANTIC_HTML,
      confidence: structure.hasMain ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.MEDIUM,
      hasMain: structure.hasMain || false,
      hasArticle: structure.hasArticle || false,
      hasSection: structure.hasSection || false,
      hasAside: structure.hasAside || false,
      hasNav: structure.hasNav || false,
      hasHeader: structure.hasHeader || false,
      hasFooter: structure.hasFooter || false,
      landmarkCount: structure.landmarks || 0,
      ariaLandmarks: []
    });

    // ----------------------------------------
    // Alt Text Evidence
    // ----------------------------------------
    const media = evidence.media || {};
    const altCoverage = media.imageCount > 0
      ? Math.round((media.imagesWithAlt / media.imageCount) * 100)
      : 100;
    diagnosticEvidence.altText = EVIDENCE_SCHEMAS.altText.create({
      detected: media.imageCount > 0,
      source: EVIDENCE_SOURCES.SEMANTIC_HTML,
      confidence: altCoverage >= 80 ? CONFIDENCE_LEVELS.HIGH :
                  altCoverage >= 50 ? CONFIDENCE_LEVELS.MEDIUM : CONFIDENCE_LEVELS.LOW,
      totalImages: media.imageCount || 0,
      imagesWithAlt: media.imagesWithAlt || 0,
      imagesWithoutAlt: media.imagesWithoutAlt || 0,
      altCoverage: altCoverage,
      decorativeImages: 0, // Would need analysis
      descriptiveAltCount: media.images?.filter(img => img.alt && img.alt.length > 10).length || 0
    });

    // ----------------------------------------
    // Content Depth Evidence
    // ----------------------------------------
    const content = evidence.content || {};
    diagnosticEvidence.contentDepth = EVIDENCE_SCHEMAS.contentDepth.create({
      detected: (content.wordCount || 0) > 100,
      source: EVIDENCE_SOURCES.BODY_TEXT,
      confidence: (content.wordCount || 0) > 500 ? CONFIDENCE_LEVELS.HIGH :
                  (content.wordCount || 0) > 200 ? CONFIDENCE_LEVELS.MEDIUM : CONFIDENCE_LEVELS.LOW,
      wordCount: content.wordCount || 0,
      paragraphCount: content.paragraphs?.length || 0,
      averageSentenceLength: 0, // Would need calculation
      hasLists: (content.lists?.length || 0) > 0,
      listCount: content.lists?.length || 0,
      hasTables: (content.tables?.length || 0) > 0,
      tableCount: content.tables?.length || 0,
      hasMedia: (media.imageCount || 0) + (media.videoCount || 0) > 0,
      mediaCount: (media.imageCount || 0) + (media.videoCount || 0) + (media.audioCount || 0)
    });

    // ----------------------------------------
    // Content Freshness Evidence
    // ----------------------------------------
    const currentYear = new Date().getFullYear();
    const containsCurrentYear = (content.bodyText || '').includes(String(currentYear));
    diagnosticEvidence.contentFreshness = EVIDENCE_SCHEMAS.contentFreshness.create({
      detected: !!(meta.lastModified || meta.publishedTime),
      source: meta.lastModified ? EVIDENCE_SOURCES.META_TAG : EVIDENCE_SOURCES.HEURISTIC,
      confidence: meta.lastModified || meta.publishedTime ? CONFIDENCE_LEVELS.MEDIUM : CONFIDENCE_LEVELS.LOW,
      lastModified: meta.lastModified || evidence.technical?.lastModified || null,
      publishedDate: meta.publishedTime || null,
      hasDateSchema: false, // Would need to check schemas
      containsCurrentYear: containsCurrentYear,
      dateReferences: [],
      estimatedAge: null
    });

    // ----------------------------------------
    // Local Business Evidence
    // ----------------------------------------
    const localSchema = structuredData.find(s => s.type === 'LocalBusiness');
    diagnosticEvidence.localBusiness = EVIDENCE_SCHEMAS.localBusiness.create({
      detected: !!localSchema || evidence.technical?.hasLocalBusinessSchema,
      source: localSchema ? EVIDENCE_SOURCES.JSON_LD : EVIDENCE_SOURCES.HEURISTIC,
      confidence: localSchema ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.LOW,
      hasLocalSchema: evidence.technical?.hasLocalBusinessSchema || false,
      businessName: localSchema?.raw?.name || null,
      address: localSchema?.raw?.address || null,
      phone: localSchema?.raw?.telephone || null,
      email: localSchema?.raw?.email || null,
      hours: localSchema?.raw?.openingHours || null,
      hasMap: false, // Would need to detect
      coordinates: localSchema?.raw?.geo || null,
      serviceArea: localSchema?.raw?.areaServed || null
    });

    console.log('[DiagnosticEvidence] Generated evidence for', Object.keys(diagnosticEvidence).length, 'subfactors');

    return diagnosticEvidence;
  }

  /**
   * Helper to detect skipped heading levels (e.g., H2 -> H4)
   */
  detectSkippedHeadingLevels(headings) {
    const skipped = [];
    const levels = [1, 2, 3, 4, 5, 6];
    let lastLevel = 0;

    for (const level of levels) {
      const count = headings[`h${level}`]?.length || 0;
      if (count > 0) {
        if (lastLevel > 0 && level > lastLevel + 1) {
          // Skipped one or more levels
          for (let i = lastLevel + 1; i < level; i++) {
            skipped.push(`H${lastLevel} -> H${level} (missing H${i})`);
          }
        }
        lastLevel = level;
      }
    }

    return skipped;
  }

  /**
   * Detect industry/vertical based on content
   */
  static detectIndustry(content, metadata) {
    const keywords = {
      // Specialized Tech Industries (matched to FAQ libraries)
      'UCaaS': ['ucaas', 'unified communications', 'voip', 'cloud communications', 'cloud phone', 'business phone'],
      'Cybersecurity': ['cybersecurity', 'cyber security', 'infosec', 'security solutions', 'threat detection', 'penetration testing', 'vulnerability'],
      'Fintech': ['fintech', 'financial technology', 'payment processing', 'digital payments', 'blockchain', 'cryptocurrency', 'neobank'],
      'AI Infrastructure': ['ai infrastructure', 'machine learning infrastructure', 'ml ops', 'gpu cloud', 'ai platform'],
      'AI Startups': ['ai startup', 'artificial intelligence', 'machine learning', 'deep learning', 'neural network'],
      'Data Center': ['data center', 'datacenter', 'colocation', 'colo', 'server hosting', 'infrastructure hosting'],
      'Digital Infrastructure': ['digital infrastructure', 'cloud infrastructure', 'edge computing', 'content delivery'],
      'ICT Hardware': ['ict hardware', 'networking equipment', 'routers', 'switches', 'hardware infrastructure', 'it hardware'],
      'Managed Service Provider': ['msp', 'managed services', 'managed service provider', 'it services', 'outsourced it'],
      'Telecom Service Provider': ['telecom', 'telecommunications', 'carrier', 'network operator', 'mobile network'],
      'Telecom Software': ['telecom software', 'telecommunications software', 'oss', 'bss', 'network management'],
      'Mobile Connectivity': ['esim', 'mobile connectivity', 'iot connectivity', 'cellular', 'mobile network'],

      // General Industries (existing)
      'SaaS': ['saas', 'software as a service', 'cloud software', 'subscription', 'platform', 'dashboard'],
      'Agency': ['marketing agency', 'digital agency', 'creative agency', 'advertising', 'seo agency'],
      'Healthcare': ['health', 'medical', 'doctor', 'patient', 'hospital', 'clinic', 'treatment'],
      'Legal': ['law', 'legal', 'attorney', 'lawyer', 'court', 'litigation', 'contract'],
      'Real Estate': ['real estate', 'property', 'homes', 'listing', 'realtor', 'mls', 'mortgage'],
      'E-commerce': ['shop', 'buy', 'cart', 'product', 'price', 'checkout', 'shipping', 'ecommerce'],
      'Financial': ['finance', 'investment', 'banking', 'insurance', 'loan', 'credit'],
      'Education': ['education', 'learning', 'course', 'student', 'training', 'university'],
      'Restaurant': ['restaurant', 'menu', 'food', 'dining', 'reservation', 'cuisine']
    };

    const text = `${metadata.title} ${metadata.description} ${content.bodyText}`.toLowerCase();
    const scores = {};

    for (const [industry, terms] of Object.entries(keywords)) {
      scores[industry] = terms.filter(term => text.includes(term)).length;
    }

    const detected = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .filter(([_, score]) => score > 0);

    return detected.length > 0 ? detected[0][0] : 'General';
  }
}

// ============================================
// RULEBOOK v1.2 Step C7: Headless Rendering Fallback
// For JS-rendered sites (React, Vue, Angular SPAs)
// H4: Per-scan render context for concurrency safety
// H5: Performance guardrails (timeouts, resource blocking, size limits)
// ============================================

const RENDER_CONFIG = {
  // Content thresholds (trigger render if below)
  wordCountThreshold: 50,
  charCountThreshold: 500,

  // H5: Timeouts
  navigationTimeout: 15000,   // Max time to load page
  renderTimeout: 20000,       // Max total time including wait
  waitAfterLoad: 2000,        // Wait for hydration

  // H5: Resource limits
  maxResponseSize: 5 * 1024 * 1024,  // 5MB max HTML

  // H5: Per-scan limits
  maxRenderTimePerScan: 60000,  // 60s total render time per scan

  // Tier budgets
  tierBudgets: {
    guest: 0,
    free: 0,
    freemium: 0,
    diy: 2,
    pro: 5,
    premium: 5,
    agency: 10
  },

  // H5: Resources to block (performance optimization)
  blockedResourceTypes: ['image', 'media', 'font', 'stylesheet'],

  // H5: Tracking/analytics domains to block
  blockedDomains: [
    'google-analytics.com',
    'googletagmanager.com',
    'facebook.net',
    'doubleclick.net',
    'hotjar.com',
    'intercom.io',
    'segment.io',
    'mixpanel.com',
    'amplitude.com',
    'fullstory.com'
  ],

  // Chrome executable paths to try
  chromePaths: [
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    process.env.CHROME_PATH
  ].filter(Boolean)
};

// DEPRECATED: Global counter - kept for backward compatibility only
// Use createRenderContext() for new code
let renderedPagesThisScan = 0;

/**
 * DEPRECATED: Use createRenderContext() instead
 * Reset render counter (call at start of each scan)
 */
function resetRenderCounter() {
  renderedPagesThisScan = 0;
}

/**
 * DEPRECATED: Use renderContext.rendered instead
 * Get current render count for this scan
 */
function getRenderCount() {
  return renderedPagesThisScan;
}

/**
 * H4: Create a render context for a scan (concurrency-safe)
 * Call once at the start of each scan and pass through the pipeline
 * @param {Object} options - Context options
 * @param {string} options.tier - User tier (guest, free, diy, pro, agency)
 * @param {string} options.scanId - Optional scan identifier for logging
 * @returns {Object} Render context to pass through the scan
 */
function createRenderContext(options = {}) {
  const tier = options.tier || 'diy';
  const budget = RENDER_CONFIG.tierBudgets[tier] || RENDER_CONFIG.tierBudgets.diy;

  return {
    tier,
    budget,
    rendered: 0,
    scanId: options.scanId || `scan_${Date.now()}`,
    startTime: Date.now(),
    pages: []  // Track which pages were rendered
  };
}

/**
 * Get render context summary for logging
 */
function getRenderContextSummary(renderContext) {
  if (!renderContext) return { rendered: renderedPagesThisScan, mode: 'global' };

  return {
    scanId: renderContext.scanId,
    rendered: renderContext.rendered,
    budget: renderContext.budget,
    tier: renderContext.tier,
    pages: renderContext.pages,
    duration: Date.now() - renderContext.startTime,
    mode: 'context'
  };
}

/**
 * H4: Check if headless rendering should be attempted (context-aware)
 * @param {Object} extractedContent - Content from static extraction
 * @param {Object} technical - Technical info including isJSRendered
 * @param {string|Object} tierOrContext - User tier string OR render context object
 * @returns {Object} Decision with shouldRender and reason
 */
function shouldAttemptRender(extractedContent, technical, tierOrContext = 'diy') {
  // Support both old API (tier string) and new API (render context)
  let budget, used, tier;

  if (typeof tierOrContext === 'object' && tierOrContext !== null) {
    // New API: render context object
    budget = tierOrContext.budget;
    used = tierOrContext.rendered;
    tier = tierOrContext.tier;
  } else {
    // Legacy API: tier string with global counter
    tier = tierOrContext;
    budget = RENDER_CONFIG.tierBudgets[tier] || 0;
    used = renderedPagesThisScan;
  }

  // Check if puppeteer available
  if (!puppeteer) {
    return { shouldRender: false, reason: 'puppeteer_unavailable' };
  }

  // Check budget
  if (used >= budget) {
    return { shouldRender: false, reason: 'budget_exhausted', budget, used };
  }

  // Check if JS-rendered
  if (!technical.isJSRendered) {
    return { shouldRender: false, reason: 'not_js_rendered' };
  }

  // Check content thresholds
  const wordCount = extractedContent.wordCount || 0;
  const paragraphs = extractedContent.paragraphs || [];
  const charCount = paragraphs.join(' ').length;

  if (wordCount >= RENDER_CONFIG.wordCountThreshold &&
      charCount >= RENDER_CONFIG.charCountThreshold) {
    return { shouldRender: false, reason: 'sufficient_content', wordCount, charCount };
  }

  return {
    shouldRender: true,
    reason: 'js_rendered_insufficient_content',
    metrics: { wordCount, charCount, threshold: RENDER_CONFIG.wordCountThreshold },
    budgetRemaining: budget - used
  };
}

/**
 * Find Chrome/Chromium executable
 * @returns {string|null} Path to Chrome executable or null
 */
function findChromePath() {
  const fs = require('fs');
  for (const path of RENDER_CONFIG.chromePaths) {
    try {
      if (fs.existsSync(path)) {
        console.log('[Headless] Found Chrome at:', path);
        return path;
      }
    } catch (e) {
      // Continue checking
    }
  }
  console.warn('[Headless] No Chrome executable found');
  return null;
}

/**
 * H4+H5: Render page with headless browser (context-aware, with guardrails)
 * @param {string} url - URL to render
 * @param {Object} renderContext - Optional render context for tracking
 * @returns {Object} Render result with success, html, duration
 */
async function renderWithHeadless(url, renderContext = null) {
  const scanId = renderContext?.scanId || 'global';
  const budgetInfo = renderContext
    ? `${renderContext.rendered}/${renderContext.budget}`
    : `${renderedPagesThisScan}/global`;

  console.log('[Headless] Starting render:', { url, scanId, budget: budgetInfo });

  if (!puppeteer) {
    return { success: false, error: 'puppeteer not available' };
  }

  const chromePath = findChromePath();
  if (!chromePath) {
    return { success: false, error: 'Chrome executable not found' };
  }

  // H5: Check scan-level time budget
  if (renderContext) {
    const scanElapsed = Date.now() - renderContext.startTime;
    if (scanElapsed > RENDER_CONFIG.maxRenderTimePerScan) {
      console.warn('[Headless] Scan render time budget exhausted:', {
        scanId,
        elapsed: scanElapsed,
        limit: RENDER_CONFIG.maxRenderTimePerScan
      });
      return {
        success: false,
        error: 'Scan render time budget exhausted',
        scanElapsed,
        scanId
      };
    }
  }

  let browser = null;
  const startTime = Date.now();

  try {
    // H5: Enhanced Chrome args for stability and memory limits
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-first-run',
        '--safebrowsing-disable-auto-update',
        // Memory limits
        '--js-flags=--max-old-space-size=256'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (compatible; AIVisibilityBot/1.0; +https://visible2ai.com/bot)');

    // H5: Block heavy resources for performance
    await page.setRequestInterception(true);
    let blockedCount = 0;

    page.on('request', (request) => {
      const resourceType = request.resourceType();
      const requestUrl = request.url();

      // Block by resource type
      if (RENDER_CONFIG.blockedResourceTypes.includes(resourceType)) {
        blockedCount++;
        request.abort();
        return;
      }

      // Block tracking/analytics domains
      if (RENDER_CONFIG.blockedDomains.some(domain => requestUrl.includes(domain))) {
        blockedCount++;
        request.abort();
        return;
      }

      request.continue();
    });

    // H5: Navigate with navigation timeout
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: RENDER_CONFIG.navigationTimeout
    });

    // H5: Wait for hydration (with overall timeout check)
    const elapsed = Date.now() - startTime;
    const remainingTime = RENDER_CONFIG.renderTimeout - elapsed;

    if (remainingTime > RENDER_CONFIG.waitAfterLoad) {
      await new Promise(resolve => setTimeout(resolve, RENDER_CONFIG.waitAfterLoad));
    }

    const renderedHtml = await page.content();

    // H5: Check response size
    if (renderedHtml.length > RENDER_CONFIG.maxResponseSize) {
      const sizeMB = (renderedHtml.length / 1024 / 1024).toFixed(2);
      console.warn('[Headless] Response too large:', { url, sizeMB, scanId });
      return {
        success: false,
        error: `Response too large: ${sizeMB}MB`,
        duration: Date.now() - startTime,
        scanId
      };
    }

    // Track in context (H4) or global (legacy)
    if (renderContext) {
      renderContext.rendered++;
      renderContext.pages.push({
        url,
        duration: Date.now() - startTime,
        htmlLength: renderedHtml.length
      });
    } else {
      renderedPagesThisScan++;
    }

    const currentCount = renderContext ? renderContext.rendered : renderedPagesThisScan;

    console.log('[Headless] Success:', {
      url,
      scanId,
      duration: Date.now() - startTime,
      htmlSize: `${(renderedHtml.length / 1024).toFixed(1)}KB`,
      rendered: currentCount,
      blockedRequests: blockedCount
    });

    return {
      success: true,
      html: renderedHtml,
      duration: Date.now() - startTime,
      scanId,
      blockedRequests: blockedCount
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    const timedOut = error.name === 'TimeoutError';

    console.error('[Headless] Failed:', {
      url,
      scanId,
      error: error.message,
      duration,
      timedOut
    });

    return {
      success: false,
      error: error.message,
      duration,
      scanId,
      timedOut
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.warn('[Headless] Browser close error:', e.message);
      }
    }
  }
}

/**
 * H4: Enhanced extraction with headless fallback (context-aware)
 * Creates extractor, runs static extraction, then attempts headless if needed
 * @param {string} url - URL to extract
 * @param {Object} options - Options including tier, allowHeadless, renderContext
 * @returns {Object} Extracted evidence with render metadata
 */
async function extractWithFallback(url, options = {}) {
  const {
    tier = 'diy',
    allowHeadless = true,
    renderContext = null  // H4: Pass render context for concurrency safety
  } = options;

  // Create extractor and run static extraction
  const extractor = new ContentExtractor(url, options);
  const staticResult = await extractor.extract();

  // Determine what to pass to shouldAttemptRender
  // If renderContext provided, use it; otherwise use tier string (legacy)
  const tierOrContext = renderContext || tier;

  // Check if rendering needed
  const renderDecision = shouldAttemptRender(
    staticResult.content,
    staticResult.technical,
    tierOrContext
  );

  const scanId = renderContext?.scanId || 'global';
  console.log('[Extract] Render decision:', { ...renderDecision, scanId });

  // Warn if headless is enabled but no render context provided
  if (allowHeadless && !renderContext) {
    console.warn('[Extract] No renderContext provided - using deprecated global counter');
  }

  if (!renderDecision.shouldRender || !allowHeadless) {
    return {
      ...staticResult,
      technical: {
        ...staticResult.technical,
        rendered: false,
        renderSource: 'static',
        renderDecision: renderDecision.reason,
        scanId
      }
    };
  }

  // Attempt headless render (pass context for tracking)
  console.log('[Extract] Attempting headless render:', { reason: renderDecision.reason, scanId });
  const renderResult = await renderWithHeadless(url, renderContext);

  if (!renderResult.success) {
    console.warn('[Extract] Headless render failed:', { error: renderResult.error, scanId });
    return {
      ...staticResult,
      technical: {
        ...staticResult.technical,
        rendered: false,
        renderSource: 'static',
        renderAttempted: true,
        renderError: renderResult.error,
        scanId
      }
    };
  }

  // Re-extract from rendered HTML
  console.log('[Extract] Re-extracting from rendered HTML...');
  const renderedExtractor = new ContentExtractor(url, options);

  // Override fetchHTML to return rendered content
  renderedExtractor.fetchHTML = async () => ({
    html: renderResult.html,
    headers: {},
    statusCode: 200,
    finalUrl: url
  });

  const renderedResult = await renderedExtractor.extract();

  // Calculate improvement
  const staticWordCount = staticResult.content.wordCount || 0;
  const renderedWordCount = renderedResult.content.wordCount || 0;
  const improvement = renderedWordCount - staticWordCount;

  // Build budget used string for metadata
  const budgetUsed = renderContext
    ? `${renderContext.rendered}/${renderContext.budget}`
    : `${renderedPagesThisScan}/global`;

  console.log('[Extract] Render improvement:', {
    staticWordCount,
    renderedWordCount,
    improvement,
    renderDuration: renderResult.duration,
    scanId,
    budgetUsed
  });

  // Return rendered result with metadata
  return {
    ...renderedResult,
    technical: {
      ...renderedResult.technical,
      rendered: true,
      renderSource: 'headless',
      renderDuration: renderResult.duration,
      staticWordCount,
      renderedWordCount,
      contentImprovement: improvement,
      budgetUsed,
      scanId
    }
  };
}

module.exports = {
  // Main class export (default behavior)
  ContentExtractor,

  // RULEBOOK v1.2 Step C7: Headless rendering exports
  extractWithFallback,
  shouldAttemptRender,
  renderWithHeadless,
  findChromePath,
  RENDER_CONFIG,

  // H4: Per-scan headless budget (concurrency-safe)
  createRenderContext,
  getRenderContextSummary,

  // Legacy (deprecated - use createRenderContext instead)
  resetRenderCounter,
  getRenderCount
};