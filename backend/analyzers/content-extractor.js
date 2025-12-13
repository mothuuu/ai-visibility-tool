const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const EntityAnalyzer = require('./entity-analyzer');

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
   */
  async extract() {
    try {
      const fetchResult = await this.fetchHTML();
const html = fetchResult.html; // Extract the HTML string from the object
const $ = cheerio.load(html);

      // Extract technical data first (includes JSON-LD parsing)
      const technical = this.extractTechnical($, html);

      // CRITICAL: Extract structure and navigation BEFORE extractContent() removes nav/header/footer
      // Fix for Issue #5: Navigation scoring was always returning false because
      // extractStructure() was called AFTER extractContent() removed the elements
      const structure = this.extractStructure($);
      const navigation = this.extractNavigation($);

      console.log('[Detection] Navigation links extracted:', navigation.links.length);
      console.log('[Detection] Structure extracted - hasNav:', structure.hasNav, 'hasHeader:', structure.hasHeader, 'hasFooter:', structure.hasFooter);

      const evidence = {
        url: this.url,
        html: html, // Store HTML for analysis
        metadata: this.extractMetadata($),
        technical: technical, // Already extracted
        structure: structure, // Extracted BEFORE content removal
        navigation: navigation, // Extracted BEFORE content removal
        content: this.extractContent($, technical.structuredData), // Pass structuredData to extractContent - this removes nav/header/footer
        media: this.extractMedia($),
        performance: await this.checkPerformance(),
        accessibility: this.extractAccessibility($),
        timestamp: new Date().toISOString()
      };

      // Run entity analysis
      const entityAnalyzer = new EntityAnalyzer(evidence);
      evidence.entities = entityAnalyzer.analyze();

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
   * Extract main content - text, headings, paragraphs
   */
  extractContent($, structuredData = []) {
    // IMPORTANT: Extract FAQs BEFORE removing footer (FAQs are often in footer!)
    const faqs = this.extractFAQs($, structuredData);

    // Remove script, style, and navigation elements
    $('script, style, nav, header, footer, aside').remove();

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

    // Extract paragraphs with intelligent prioritization
    const allParagraphs = [];
    $('p').each((idx, el) => {
      const $el = $(el);
      const text = $el.text().trim();

      // Skip very short paragraphs or common boilerplate patterns
      if (text.length < 20) return;
      if (text.match(/^(copyright|©|all rights reserved|privacy policy|terms of service)/i)) return;

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
      paragraphs: paragraphs.slice(0, 50), // First 50 paragraphs
      lists,
      tables,
      faqs: faqs, // FAQs extracted before footer removal
      wordCount,
      textLength: bodyText.length,
      bodyText: bodyText.substring(0, 10000) // First 10K chars for analysis
    };
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

    // Method 2: Detect FAQ sections by class/id (common patterns)
    const faqSelectors = [
      '[class*="faq" i], [id*="faq" i]',
      '[class*="question" i], [id*="question" i]',
      '[class*="accordion" i]',
      '[class*="collapse" i]',
      '[class*="toggle" i]',
      '[class*="expandable" i]',
      '[class*="q-and-a" i], [class*="qa-" i]',
      '[data-accordion]',
      '[data-toggle="collapse"]',
      '[data-bs-toggle="collapse"]',
      'details'
    ].join(', ');

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
    const faqHeadingRegex = /\b(faq|frequently\s*asked|q\s*&\s*a|q&a|common\s*questions|questions?\s*and\s*answers?)\b/i;

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

      // Heading hierarchy
      headingCount: {
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
   * Extract navigation links for section detection
   * IMPORTANT: Call this BEFORE extractContent() which removes nav/header/footer
   * Fix for Issue #2 + #9: Blog/FAQ detection now uses navigation links
   */
  extractNavigation($) {
    const links = [];

    // Extract links from nav and header elements
    $('nav a, header a').each((i, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim();
      if (href && text && href !== '#') {
        links.push({ href, text });
      }
    });

    // Detect section links
    const hasBlogLink = links.some(l => /\/blog|\/news|\/articles/i.test(l.href) || /blog|news/i.test(l.text));
    const hasFAQLink = links.some(l => /\/faq|\/frequently-asked/i.test(l.href) || /faq|frequently asked/i.test(l.text));
    const hasAboutLink = links.some(l => /\/about/i.test(l.href) || /about/i.test(l.text));
    const hasContactLink = links.some(l => /\/contact/i.test(l.href) || /contact/i.test(l.text));
    const hasServicesLink = links.some(l => /\/services/i.test(l.href) || /services/i.test(l.text));
    const hasPricingLink = links.some(l => /\/pricing/i.test(l.href) || /pricing/i.test(l.text));

    console.log('[Detection] Navigation analysis:', {
      totalLinks: links.length,
      hasBlogLink,
      hasFAQLink,
      hasAboutLink,
      hasContactLink,
      hasServicesLink,
      hasPricingLink
    });

    return {
      links,
      hasBlogLink,
      hasFAQLink,
      hasAboutLink,
      hasContactLink,
      hasServicesLink,
      hasPricingLink
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

  extractTechnical($, htmlData) {
    const html = typeof htmlData === 'string' ? htmlData : htmlData.html;

    // Structured data detection (JSON-LD)
    const structuredData = [];
    const allSchemaTypes = new Set(); // Track all schema types including nested ones
    const jsonLdScripts = $('script[type="application/ld+json"]');
    console.log(`[ContentExtractor] Found ${jsonLdScripts.length} JSON-LD script tags`);

    jsonLdScripts.each((idx, el) => {
      try {
        const scriptContent = $(el).html();
        console.log(`[ContentExtractor] Parsing JSON-LD #${idx + 1}, length: ${scriptContent?.length || 0} chars`);
        const data = JSON.parse(scriptContent);

        // Extract top-level type (can be string or array)
        let topLevelType = data['@type'] || 'Unknown';
        if (Array.isArray(topLevelType)) {
          topLevelType = topLevelType[0]; // Use first type as primary
        }
        console.log(`[ContentExtractor] Successfully parsed: ${topLevelType}`);

        structuredData.push({
          type: topLevelType,
          context: data['@context'] || '',
          raw: data
        });

        // Extract all types including nested ones
        const typesInThisSchema = this.extractAllSchemaTypes(data);
        typesInThisSchema.forEach(type => allSchemaTypes.add(type));

      } catch (e) {
        console.log(`[ContentExtractor] Failed to parse JSON-LD #${idx + 1}:`, e.message);
      }
    });

    console.log(`[ContentExtractor] Total structured data found: ${structuredData.length}`);
    console.log(`[ContentExtractor] All schema types (including nested): ${Array.from(allSchemaTypes).join(', ')}`);
    console.log(`[ContentExtractor] Has Organization: ${allSchemaTypes.has('Organization')}`);
    console.log(`[ContentExtractor] Has FAQPage: ${allSchemaTypes.has('FAQPage')}`);
    console.log(`[ContentExtractor] Has LocalBusiness: ${allSchemaTypes.has('LocalBusiness')}`);
    console.log(`[ContentExtractor] Has Place: ${allSchemaTypes.has('Place')}`);
    console.log(`[ContentExtractor] Has GeoCoordinates: ${allSchemaTypes.has('GeoCoordinates')}`);

    return {
      // Structured Data
      structuredData,
      hasOrganizationSchema: allSchemaTypes.has('Organization'),
      hasLocalBusinessSchema: allSchemaTypes.has('LocalBusiness'),
      hasFAQSchema: allSchemaTypes.has('FAQPage'),
      hasArticleSchema: allSchemaTypes.has('Article') || allSchemaTypes.has('BlogPosting'),
      hasBreadcrumbSchema: allSchemaTypes.has('BreadcrumbList'),
      
      // Hreflang
      hreflangTags: $('link[rel="alternate"][hreflang]').length,
      hreflangLanguages: $('link[rel="alternate"][hreflang]').map((i, el) => $(el).attr('hreflang')).get(),
      
      // Canonical
      hasCanonical: $('link[rel="canonical"]').length > 0,
      canonicalUrl: $('link[rel="canonical"]').attr('href') || '',
      
      // Sitemap
      hasSitemapLink: $('link[rel="sitemap"]').length > 0 || 
                      html.toLowerCase().includes('sitemap.xml'),
      
      // RSS/Atom
      hasRSSFeed: $('link[type="application/rss+xml"], link[type="application/atom+xml"]').length > 0,
      
      // Viewport
      hasViewport: $('meta[name="viewport"]').length > 0,
      viewport: $('meta[name="viewport"]').attr('content') || '',
      
      // Character encoding
      charset: $('meta[charset]').attr('charset') || 
               $('meta[http-equiv="Content-Type"]').attr('content')?.match(/charset=([^;]+)/)?.[1] || '',
      
      // Robots meta
      robotsMeta: $('meta[name="robots"]').attr('content') || '',
      
      // Cache control (from headers if available)
      cacheControl: htmlData.headers?.['cache-control'] || '',
      lastModified: htmlData.headers?.['last-modified'] || '',
      etag: htmlData.headers?.['etag'] || ''
    };
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

module.exports = ContentExtractor;