/**
 * Global Detection Vocabulary Registry
 *
 * Per rulebook "Global Detection Vocabulary Registry":
 * Centralized patterns for all detection logic to ensure consistency
 * across content-extractor.js, fact-extractor.js, site-crawler.js, and scorers.
 *
 * IMPORTANT: All detectors MUST import and use these patterns instead of hardcoding.
 */

const VOCABULARY = {
  // ============================================
  // URL PATTERNS
  // Used for detecting page types from URLs
  // ============================================
  // RULEBOOK v1.2 Section 2.4.4: Extended Vocabulary (Synonyms)
  // RULEBOOK v1.2 Section 2.2.6: Updated to match anchor links (#faq) for single-page sites
  URL_PATTERNS: {
    home: /^\/?(index\.html?)?$/i,
    about: /(\/|#)(about|about-us|who-we-are|our-story|company)(\.html?|\/|$)/i,
    services: /(\/|#)(services|solutions|what-we-do|offerings)(\.html?|\/|$)/i,
    // RULEBOOK v1.2: Extended blog vocabulary with all synonyms + anchor link support
    blog: /(\/|#)(blog|news|articles|insights|resources|updates|journal|posts|learn|knowledge-base|help-center|guides|library|content|stories|perspectives)(\.html?|\/|$)/i,
    faq: /(\/|#)(faq|faqs|frequently-asked|help|support|questions)(\.html?|\/|$)/i,
    contact: /(\/|#)(contact|contact-us|get-in-touch|reach-us)(\.html?|\/|$)/i,
    pricing: /(\/|#)(pricing|plans|packages|cost|rates)(\.html?|\/|$)/i,
    team: /(\/|#)(team|people|about-us\/team|our-team|staff|leadership)(\.html?|\/|$)/i,
    careers: /(\/|#)(careers|jobs|work-with-us|join-us|hiring)(\.html?|\/|$)/i,
    portfolio: /(\/|#)(portfolio|work|projects|case-studies|clients)(\.html?|\/|$)/i,
    testimonials: /(\/|#)(testimonials|reviews|clients|success-stories)(\.html?|\/|$)/i,
    legal: /(\/|#)(privacy|terms|legal|cookie-policy|gdpr|disclaimer)(\.html?|\/|$)/i
  },

  // ============================================
  // CSS SELECTORS
  // Used for DOM element detection
  // ============================================
  CSS_SELECTORS: {
    // FAQ detection selectors
    faq: {
      containers: [
        '[class*="faq" i]',
        '[id*="faq" i]',
        '[class*="question" i]',
        '[id*="question" i]',
        '[class*="accordion" i]',
        '[class*="collapse" i]',
        '[class*="toggle" i]',
        '[class*="expandable" i]',
        '[class*="q-and-a" i]',
        '[class*="qa-" i]',
        '[data-accordion]',
        '[data-toggle="collapse"]',
        '[data-bs-toggle="collapse"]',
        'details'
      ],
      questions: [
        'h2', 'h3', 'h4', 'h5', 'h6',
        'dt',
        'button',
        '[role="button"]',
        '[aria-expanded]',
        '[class*="question" i]',
        '[class*="title" i]',
        '[class*="header" i]'
      ],
      answers: [
        'dd',
        '[class*="collapse" i]',
        '[class*="panel" i]',
        '[class*="content" i]',
        '[class*="answer" i]',
        '[class*="body" i]'
      ]
    },

    // Author detection selectors
    author: {
      containers: [
        '[class*="author" i]',
        '[class*="byline" i]',
        '[class*="writer" i]',
        '[rel="author"]',
        '[itemprop="author"]'
      ],
      nameElements: [
        '[class*="author-name" i]',
        '[class*="author_name" i]',
        '[itemprop="name"]',
        'a[rel="author"]'
      ],
      imageElements: [
        '[class*="author-image" i]',
        '[class*="author-photo" i]',
        '[class*="author-avatar" i]',
        '[itemprop="image"]'
      ]
    },

    // Navigation detection selectors
    navigation: {
      primary: [
        'nav',
        '[role="navigation"]',
        '[class*="nav" i]',
        '[class*="menu" i]'
      ],
      mobile: [
        '[class*="mobile" i]',
        '[class*="hamburger" i]',
        '[class*="menu-toggle" i]',
        '[class*="burger" i]',
        '[class*="mobile-menu" i]'
      ],
      dropdown: [
        '[class*="dropdown" i]',
        '[class*="submenu" i]',
        '[class*="menu-item-has-children" i]',
        '[class*="sub-menu" i]'
      ]
    },

    // Blog detection selectors
    blog: {
      containers: [
        '[class*="blog" i]',
        '[class*="post" i]',
        '[class*="article" i]',
        '[class*="entry" i]',
        'article'
      ],
      meta: [
        '[class*="post-meta" i]',
        '[class*="article-meta" i]',
        '[class*="entry-meta" i]',
        '[class*="byline" i]'
      ],
      date: [
        '[class*="date" i]',
        '[class*="published" i]',
        '[class*="posted" i]',
        'time',
        '[datetime]'
      ]
    },

    // Semantic HTML selectors
    semantic: {
      landmarks: [
        'main',
        'article',
        'section',
        'aside',
        'nav',
        'header',
        'footer'
      ],
      ariaLandmarks: [
        '[role="main"]',
        '[role="navigation"]',
        '[role="complementary"]',
        '[role="contentinfo"]',
        '[role="banner"]'
      ],
      headings: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      structuredContent: [
        '[itemtype]',
        '[itemprop]',
        '[itemscope]'
      ]
    }
  },

  // ============================================
  // TEXT PATTERNS
  // Used for content analysis via regex
  // ============================================
  TEXT_PATTERNS: {
    // Question detection patterns
    questions: {
      // Question words at start of text
      questionWords: /^(what|why|how|when|where|who|which|can|should|does|do|is|are|will|would|could)\b/i,
      // Text ending with question mark
      endsWithQuestion: /\?$/,
      // FAQ section indicators in headings
      faqHeadings: /\b(faq|frequently\s*asked|q\s*&\s*a|q&a|common\s*questions|questions?\s*and\s*answers?)\b/i
    },

    // Author byline patterns
    authorByline: {
      // "By [Name]" pattern
      byPattern: /\bby\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
      // "Written by [Name]" pattern
      writtenByPattern: /\bwritten\s+by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
      // "Author: [Name]" pattern
      authorPattern: /\bauthor:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i
    },

    // Date patterns
    dates: {
      // ISO format: 2024-01-15
      isoFormat: /\b\d{4}-\d{2}-\d{2}\b/,
      // US format: January 15, 2024
      usFormat: /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i,
      // Short format: Jan 15, 2024
      shortFormat: /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}\b/i,
      // Relative dates
      relativeDate: /\b(today|yesterday|last\s+(week|month|year)|\d+\s+(days?|weeks?|months?)\s+ago)\b/i,
      // Year only
      yearOnly: /\b(20\d{2})\b/
    },

    // Problem-solution patterns (for content quality)
    problemSolution: {
      problemIndicators: /\b(problem|issue|challenge|pain\s*point|struggle|difficulty|obstacle)\b/i,
      solutionIndicators: /\b(solution|solve|fix|resolve|address|overcome|help)\b/i,
      benefitIndicators: /\b(benefit|advantage|result|outcome|improve|increase|reduce|save)\b/i
    },

    // Definition patterns
    definitions: {
      // "X is Y" pattern
      isDefinition: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+is\s+(a|an|the)\s+/i,
      // "X refers to" pattern
      refersTo: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+refers\s+to\b/i,
      // "defined as" pattern
      definedAs: /\bdefined\s+as\b/i
    },

    // Contact information patterns
    contact: {
      email: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/,
      phone: /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
      mailto: /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
      tel: /tel:([0-9+\-()\s]+)/i
    },

    // Address patterns
    address: {
      usStreet: /\d+\s+[A-Z][a-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct)/i,
      zipCode: /\b\d{5}(-\d{4})?\b/,
      stateAbbrev: /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/
    }
  },

  // ============================================
  // SCHEMA TYPES
  // JSON-LD @type values for structured data detection
  // ============================================
  SCHEMA_TYPES: {
    organization: [
      'Organization',
      'Corporation',
      'LocalBusiness',
      'ProfessionalService',
      'Store',
      'Restaurant',
      'MedicalBusiness',
      'LegalService',
      'FinancialService',
      'RealEstateAgent',
      'TravelAgency',
      'SoftwareApplication'
    ],

    article: [
      'Article',
      'BlogPosting',
      'NewsArticle',
      'TechArticle',
      'ScholarlyArticle',
      'Report',
      'WebPage'
    ],

    faq: [
      'FAQPage',
      'Question',
      'Answer'
    ],

    person: [
      'Person',
      'ProfilePage'
    ],

    location: [
      'Place',
      'LocalBusiness',
      'PostalAddress',
      'GeoCoordinates',
      'GeoShape'
    ],

    offering: [
      'Product',
      'Service',
      'Offer',
      'AggregateOffer',
      'SoftwareApplication'
    ],

    review: [
      'Review',
      'AggregateRating',
      'Rating'
    ],

    event: [
      'Event',
      'BusinessEvent',
      'SocialEvent',
      'EducationEvent'
    ],

    breadcrumb: [
      'BreadcrumbList',
      'ListItem'
    ],

    howTo: [
      'HowTo',
      'HowToStep',
      'HowToSection'
    ]
  },

  // ============================================
  // KEYWORDS
  // Various keyword lists for detection
  // ============================================
  KEYWORDS: {
    // Navigation link text patterns
    // RULEBOOK v1.2 Section 2.4.4: Extended navigation keywords
    navLinkText: {
      home: ['home', 'start', 'main'],
      about: ['about', 'about us', 'who we are', 'our story', 'company'],
      services: ['services', 'solutions', 'what we do', 'offerings', 'products'],
      // RULEBOOK v1.2: Extended blog vocabulary with all synonyms
      blog: ['blog', 'news', 'articles', 'insights', 'resources', 'updates', 'journal', 'learn', 'knowledge', 'guides', 'library', 'content', 'stories', 'perspectives'],
      faq: ['faq', 'frequently asked', 'questions', 'help', 'support'],
      contact: ['contact', 'contact us', 'get in touch', 'reach us'],
      pricing: ['pricing', 'plans', 'packages', 'cost', 'rates'],
      team: ['team', 'our team', 'people', 'leadership', 'staff'],
      careers: ['careers', 'jobs', 'hiring', 'work with us', 'join us'],
      portfolio: ['portfolio', 'work', 'projects', 'case studies', 'clients']
    },

    // AI crawler user agents (for robots.txt analysis)
    aiCrawlers: [
      'GPTBot',
      'ChatGPT-User',
      'Google-Extended',
      'CCBot',
      'anthropic-ai',
      'Claude-Web',
      'Perplexity',
      'cohere-ai',
      'Bytespider',
      'Amazonbot',
      'FacebookBot',
      'Applebot-Extended'
    ],

    // Authoritative domain patterns (for credibility signals)
    authoritativeDomains: {
      academic: ['.edu', '.ac.uk', '.edu.au'],
      government: ['.gov', '.gov.uk', '.gov.au'],
      publications: [
        'forbes.com', 'bloomberg.com', 'reuters.com', 'wsj.com',
        'nytimes.com', 'bbc.com', 'theguardian.com', 'techcrunch.com',
        'wired.com', 'arstechnica.com', 'hbr.org'
      ],
      research: [
        'nature.com', 'sciencedirect.com', 'springer.com',
        'ieee.org', 'acm.org', 'arxiv.org'
      ]
    },

    // Disambiguation sources (for entity recognition)
    disambiguationSources: [
      'wikipedia.org',
      'wikidata.org',
      'crunchbase.com',
      'linkedin.com',
      'bloomberg.com/profile',
      'reuters.com/companies'
    ],

    // Social media platforms
    socialPlatforms: {
      twitter: ['twitter.com', 'x.com'],
      linkedin: ['linkedin.com'],
      facebook: ['facebook.com'],
      instagram: ['instagram.com'],
      youtube: ['youtube.com'],
      tiktok: ['tiktok.com'],
      github: ['github.com']
    },

    // Industry-specific keywords (for vertical detection)
    industryKeywords: {
      saas: ['saas', 'software as a service', 'cloud software', 'subscription', 'platform', 'dashboard'],
      ecommerce: ['shop', 'buy', 'cart', 'product', 'price', 'checkout', 'shipping'],
      healthcare: ['health', 'medical', 'doctor', 'patient', 'hospital', 'clinic', 'treatment'],
      legal: ['law', 'legal', 'attorney', 'lawyer', 'court', 'litigation'],
      finance: ['finance', 'investment', 'banking', 'insurance', 'loan', 'credit'],
      realestate: ['real estate', 'property', 'homes', 'listing', 'realtor', 'mortgage'],
      education: ['education', 'learning', 'course', 'student', 'training', 'university'],
      agency: ['marketing agency', 'digital agency', 'creative agency', 'advertising', 'seo agency']
    },

    // Quality signals in content
    qualitySignals: {
      expertise: ['expert', 'specialist', 'professional', 'certified', 'licensed', 'experienced'],
      trust: ['trusted', 'reliable', 'secure', 'verified', 'accredited', 'award-winning'],
      authority: ['leading', 'industry leader', 'pioneer', 'established', 'recognized'],
      freshness: ['updated', 'latest', 'new', 'current', 'recent', '2024', '2025']
    }
  },

  // ============================================
  // HELPER FUNCTIONS
  // Utility functions for using vocabulary
  // ============================================

  /**
   * Test if a URL matches a specific page type
   * @param {string} url - URL to test
   * @param {string} pageType - Page type key (blog, faq, about, etc.)
   * @returns {boolean}
   */
  matchesUrlPattern(url, pageType) {
    const pattern = this.URL_PATTERNS[pageType];
    return pattern ? pattern.test(url) : false;
  },

  /**
   * Test if text matches a navigation keyword
   * @param {string} text - Text to test
   * @param {string} pageType - Page type key
   * @returns {boolean}
   */
  matchesNavKeyword(text, pageType) {
    const keywords = this.KEYWORDS.navLinkText[pageType];
    if (!keywords) return false;
    const lowerText = text.toLowerCase().trim();
    return keywords.some(kw => lowerText === kw || lowerText.includes(kw));
  },

  /**
   * Check if a schema type belongs to a category
   * @param {string} type - Schema @type value
   * @param {string} category - Category key (organization, article, etc.)
   * @returns {boolean}
   */
  isSchemaType(type, category) {
    const types = this.SCHEMA_TYPES[category];
    return types ? types.includes(type) : false;
  },

  /**
   * Build a combined CSS selector string
   * @param {string} category - Selector category (faq, author, etc.)
   * @param {string} subcategory - Subcategory (containers, questions, etc.)
   * @returns {string}
   */
  getSelectorString(category, subcategory) {
    const selectors = this.CSS_SELECTORS[category]?.[subcategory];
    return selectors ? selectors.join(', ') : '';
  },

  /**
   * Check if user agent is an AI crawler
   * @param {string} userAgent - User agent string
   * @returns {boolean}
   */
  isAiCrawler(userAgent) {
    return this.KEYWORDS.aiCrawlers.some(crawler =>
      userAgent.toLowerCase().includes(crawler.toLowerCase())
    );
  },

  /**
   * Check if a domain is authoritative
   * @param {string} domain - Domain to check
   * @returns {object} - { isAuthoritative, category }
   */
  checkAuthoritativeDomain(domain) {
    const lowerDomain = domain.toLowerCase();

    for (const [category, patterns] of Object.entries(this.KEYWORDS.authoritativeDomains)) {
      for (const pattern of patterns) {
        if (lowerDomain.endsWith(pattern) || lowerDomain.includes(pattern)) {
          return { isAuthoritative: true, category };
        }
      }
    }

    return { isAuthoritative: false, category: null };
  }
};

module.exports = VOCABULARY;
