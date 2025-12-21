/**
 * EVIDENCE CONTRACT
 *
 * Single source of truth for what the content extractor returns.
 * All scoring functions depend ONLY on this contract.
 *
 * Rulebook Version: 2.1
 * Contract Version: 2.0.0
 *
 * Contract version changes:
 * - PATCH (2.0.x): Documentation, optional field additions
 * - MINOR (2.x.0): New optional namespaces, new fields
 * - MAJOR (x.0.0): Breaking changes to required fields
 */

const RULEBOOK_VERSION = '2.1';
const CONTRACT_VERSION = '2.0.0';

const REQUIRED_NAMESPACES = ['url', 'timestamp', 'navigation', 'structure', 'content', 'technical'];
const EXPECTED_NAMESPACES = ['crawler', 'siteMetrics'];

// RULEBOOK v1.2 Step C6: Required fields per namespace
// Missing these fields causes validation ERROR (not warning)
const REQUIRED_FIELDS = {
  navigation: ['keyPages', 'allNavLinks', 'hasSemanticNav', 'headerLinks', 'navLinks', 'footerLinks'],
  structure: ['hasNav', 'hasHeader', 'hasFooter', 'hasMain', 'headingCount', 'headingHierarchy'],
  content: ['paragraphs', 'headings', 'wordCount'],
  technical: ['structuredData', 'hasFAQSchema', 'hasArticleSchema', 'hasOrganizationSchema', 'isJSRendered']
};

const EvidenceContract = {
  metadata: {
    title: '', description: '', keywords: '', author: '', canonical: '', robots: '',
    ogTitle: '', ogDescription: '', ogImage: '', ogType: '', ogUrl: '',
    twitterCard: '', twitterTitle: '', twitterDescription: '',
    lastModified: '', publishedTime: '', language: '', geoRegion: '', geoPlacename: '',
  },
  content: {
    headings: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
    paragraphs: [], bodyText: '', wordCount: 0, textLength: 0,
    lists: [{ type: 'ul', items: [], itemCount: 0 }],
    tables: [{ rows: 0, cols: 0, hasHeaders: false }],
    faqs: [{ question: '', answer: '' }]
  },
  structure: {
    hasMain: false, hasArticle: false, hasSection: false, hasAside: false,
    hasNav: false, hasHeader: false, hasFooter: false, landmarks: 0,
    headingCount: { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 },
    internalLinks: 0, externalLinks: 0, elementsWithIds: 0, anchorLinks: 0,
    hasTOC: false, hasBreadcrumbs: false
  },
  media: {
    images: [{ src: '', alt: '', hasAlt: false, title: '', loading: '' }],
    imageCount: 0, imagesWithAlt: 0, imagesWithoutAlt: 0,
    videos: [{ type: 'native', src: '', hasControls: false, hasTranscript: false, hasCaptions: false }],
    videoCount: 0, audio: [{ src: '', hasControls: false, hasTranscript: false }], audioCount: 0
  },
  technical: {
    structuredData: [{ type: '', context: '', raw: {} }],
    hasOrganizationSchema: false, hasLocalBusinessSchema: false, hasFAQSchema: false,
    hasArticleSchema: false, hasBreadcrumbSchema: false, hreflangTags: 0, hreflangLanguages: [],
    hasCanonical: false, canonicalUrl: '', hasSitemapLink: false, hasRSSFeed: false,
    hasViewport: false, viewport: '', charset: '', robotsMeta: '', cacheControl: '', lastModified: '', etag: ''
  },
  performance: { ttfb: null, responseTime: null, serverTiming: '', contentLength: 0, contentType: '', error: null },
  accessibility: {
    ariaLabels: 0, ariaDescribed: 0, ariaLabelledBy: 0, ariaHidden: 0, ariaLive: 0,
    formsWithLabels: 0, imagesWithAlt: 0, imagesTotal: 0, hasLangAttribute: false,
    hasSkipLink: false, tabindex: 0, hasInlineStyles: 0, semanticButtons: 0, divClickHandlers: 0
  },
  entities: {
    entities: {
      people: [], organizations: [], places: [], products: [], events: [], professionalCredentials: [], relationships: []
    },
    metrics: {
      totalEntities: 0, entitiesByType: {}, relationships: 0, verifiedEntities: 0,
      knowledgeGraphConnections: 0, geoPrecision: 0, professionalVerification: false
    },
    knowledgeGraph: { nodes: [], edges: [] }
  },
  url: '', html: '', timestamp: ''
};

function validateEvidence(evidence, options = {}) {
  const errors = [];
  const warnings = [];

  if (!evidence.contractVersion) {
    warnings.push('Missing contractVersion');
  }

  // Validate required namespaces
  for (const ns of REQUIRED_NAMESPACES) {
    if (!evidence[ns]) errors.push(`Missing required: ${ns}`);
  }

  // Validate expected namespaces (warnings only)
  for (const ns of EXPECTED_NAMESPACES) {
    if (!evidence[ns]) warnings.push(`Missing expected: ${ns}`);
  }

  // RULEBOOK v1.2 Step C6: Validate required fields per namespace
  // These are ERRORS, not warnings
  if (evidence.navigation) {
    if (!evidence.navigation.footerLinks) {
      errors.push('navigation.footerLinks required');
    }
    if (!evidence.navigation.headerLinks) {
      errors.push('navigation.headerLinks required');
    }
    if (!evidence.navigation.navLinks) {
      errors.push('navigation.navLinks required');
    }
    if (!evidence.navigation.keyPages) {
      errors.push('navigation.keyPages required');
    }
  }

  if (evidence.structure) {
    if (!Array.isArray(evidence.structure.headingHierarchy)) {
      errors.push('structure.headingHierarchy required (array)');
    }
  }

  if (evidence.technical) {
    if (evidence.technical.isJSRendered === undefined) {
      warnings.push('technical.isJSRendered recommended');
    }
  }

  // Legacy validation (backward compatibility)
  if (evidence.metadata && typeof evidence.metadata !== 'object') errors.push('metadata must be an object');
  if (evidence.content) {
    if (!Array.isArray(evidence.content.paragraphs)) errors.push('content.paragraphs must be an array');
    if (!evidence.content.headings || typeof evidence.content.headings !== 'object') errors.push('content.headings must be an object');
  }

  const valid = errors.length === 0;
  if (!valid || warnings.length > 0) {
    console.log('[EvidenceContract] Validation:', { valid, errors, warnings, rulebookVersion: RULEBOOK_VERSION });
  }

  return { valid, errors, warnings, contractVersion: evidence.contractVersion || 'unknown', rulebookVersion: RULEBOOK_VERSION };
}

function createMockEvidence(overrides = {}) {
  const mock = {
    metadata: {
      title: 'Test Page Title', description: 'Test page description', keywords: 'test, example', author: 'Test Author',
      canonical: 'https://example.com/test', robots: 'index, follow', ogTitle: 'Test OG Title', ogDescription: 'Test OG Description',
      ogImage: 'https://example.com/og.jpg', ogType: 'website', ogUrl: 'https://example.com/test',
      twitterCard: 'summary_large_image', twitterTitle: 'Test Twitter', twitterDescription: 'Test Twitter Description',
      lastModified: '2025-01-15T10:00:00Z', publishedTime: '2025-01-01T10:00:00Z', language: 'en', geoRegion: 'US-CA', geoPlacename: 'San Francisco',
    },
    content: {
      headings: {
        h1: ['Main Heading'], h2: ['Section One', 'Section Two', 'FAQs'], h3: ['Subsection 1.1', 'What is this?', 'How does it work?'],
        h4: [], h5: [], h6: []
      },
      paragraphs: ['First paragraph with content.', 'Second paragraph with details.', 'Third paragraph about benefits.'],
      bodyText: 'First paragraph with content. Second paragraph with details.',
      wordCount: 453, textLength: 2580,
      lists: [
        { type: 'ul', items: ['Item 1', 'Item 2', 'Item 3'], itemCount: 3 },
        { type: 'ol', items: ['Step 1', 'Step 2', 'Step 3'], itemCount: 3 }
      ],
      tables: [{ rows: 5, cols: 3, hasHeaders: true }],
      faqs: [
        { question: 'What is this?', answer: 'This is a test page.' },
        { question: 'How does it work?', answer: 'It works by analyzing content.' }
      ]
    },
    structure: {
      hasMain: true, hasArticle: true, hasSection: true, hasAside: false, hasNav: true, hasHeader: true, hasFooter: true,
      landmarks: 4, headingCount: { h1: 1, h2: 3, h3: 4, h4: 0, h5: 0, h6: 0 },
      headingHierarchy: [
        { level: 1, text: 'Main Heading', index: 0 },
        { level: 2, text: 'Section One', index: 1 },
        { level: 3, text: 'Subsection 1.1', index: 2 },
        { level: 2, text: 'Section Two', index: 3 },
        { level: 2, text: 'FAQs', index: 4 },
        { level: 3, text: 'What is this?', index: 5 },
        { level: 3, text: 'How does it work?', index: 6 }
      ],
      internalLinks: 12, externalLinks: 5, elementsWithIds: 8, anchorLinks: 3, hasTOC: true, hasBreadcrumbs: true
    },
    navigation: {
      keyPages: { about: '/about', contact: '/contact', services: '/services', faq: '/faq', blog: '/blog' },
      allNavLinks: ['/about', '/services', '/contact', '/faq', '/blog', '/pricing'],
      hasSemanticNav: true,
      headerLinks: [
        { text: 'Home', href: '/' },
        { text: 'About', href: '/about' },
        { text: 'Services', href: '/services' }
      ],
      navLinks: [
        { text: 'About', href: '/about' },
        { text: 'Services', href: '/services' },
        { text: 'Blog', href: '/blog' },
        { text: 'Contact', href: '/contact' }
      ],
      footerLinks: [
        { text: 'Privacy Policy', href: '/privacy' },
        { text: 'Terms', href: '/terms' },
        { text: 'Contact', href: '/contact' }
      ],
      hasBlogLink: true,
      hasFAQLink: true
    },
    media: {
      images: [
        { src: '/img1.jpg', alt: 'Descriptive alt text', hasAlt: true, title: '', loading: 'lazy' },
        { src: '/img2.jpg', alt: 'Another description', hasAlt: true, title: '', loading: 'lazy' },
        { src: '/img3.jpg', alt: '', hasAlt: false, title: '', loading: '' }
      ],
      imageCount: 3, imagesWithAlt: 2, imagesWithoutAlt: 1,
      videos: [{ type: 'native', src: '/video.mp4', hasControls: true, hasTranscript: true, hasCaptions: true }],
      videoCount: 1, audio: [], audioCount: 0
    },
    technical: {
      structuredData: [
        { type: 'Organization', context: 'https://schema.org', raw: { '@type': 'Organization', name: 'Test Org' } },
        { type: 'FAQPage', context: 'https://schema.org', raw: { '@type': 'FAQPage' } }
      ],
      hasOrganizationSchema: true, hasLocalBusinessSchema: false, hasFAQSchema: true, hasArticleSchema: false, hasBreadcrumbSchema: true,
      isJSRendered: false,
      hreflangTags: 2, hreflangLanguages: ['en', 'es'], hasCanonical: true, canonicalUrl: 'https://example.com/test',
      hasSitemapLink: true, hasRSSFeed: true, hasViewport: true, viewport: 'width=device-width, initial-scale=1',
      charset: 'UTF-8', robotsMeta: 'index, follow', cacheControl: 'public, max-age=3600',
      lastModified: 'Mon, 15 Jan 2025 10:00:00 GMT', etag: '"abc123"'
    },
    performance: { ttfb: 250, responseTime: 250, serverTiming: '', contentLength: 45000, contentType: 'text/html; charset=utf-8', error: null },
    accessibility: {
      ariaLabels: 5, ariaDescribed: 3, ariaLabelledBy: 2, ariaHidden: 1, ariaLive: 0, formsWithLabels: 0.9,
      imagesWithAlt: 2, imagesTotal: 3, hasLangAttribute: true, hasSkipLink: true, tabindex: 3,
      hasInlineStyles: 2, semanticButtons: 8, divClickHandlers: 1
    },
    url: 'https://example.com/test', html: '<html><head><title>Test</title></head><body><h1>Test</h1></body></html>',
    timestamp: '2025-01-15T12:00:00Z'
  };
  
  return deepMerge(mock, overrides);
}

function deepMerge(target, source) {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) Object.assign(output, { [key]: source[key] });
        else output[key] = deepMerge(target[key], source[key]);
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}

function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

function getEvidenceField(evidence, path) {
  return path.split('.').reduce((obj, key) => obj?.[key], evidence);
}

module.exports = {
  RULEBOOK_VERSION,
  CONTRACT_VERSION,
  REQUIRED_NAMESPACES,
  REQUIRED_FIELDS,
  EvidenceContract,
  validateEvidence,
  createMockEvidence,
  getEvidenceField
};