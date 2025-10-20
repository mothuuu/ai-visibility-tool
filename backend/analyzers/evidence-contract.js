/**
 * EVIDENCE CONTRACT
 * 
 * Single source of truth for what the content extractor returns.
 * All scoring functions depend ONLY on this contract.
 */

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
  url: '', html: '', timestamp: ''
};

function validateEvidence(evidence) {
  const errors = [];
  const requiredKeys = ['metadata', 'content', 'structure', 'media', 'technical', 'performance', 'accessibility', 'url', 'timestamp'];
  
  for (const key of requiredKeys) {
    if (!(key in evidence)) errors.push(`Missing required key: ${key}`);
  }
  
  if (evidence.metadata && typeof evidence.metadata !== 'object') errors.push('metadata must be an object');
  if (evidence.content) {
    if (!Array.isArray(evidence.content.paragraphs)) errors.push('content.paragraphs must be an array');
    if (!evidence.content.headings || typeof evidence.content.headings !== 'object') errors.push('content.headings must be an object');
  }
  if (evidence.structure && typeof evidence.structure.headingCount !== 'object') errors.push('structure.headingCount must be an object');
  if (evidence.media && !Array.isArray(evidence.media.images)) errors.push('media.images must be an array');
  
  return { valid: errors.length === 0, errors };
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
      internalLinks: 12, externalLinks: 5, elementsWithIds: 8, anchorLinks: 3, hasTOC: true, hasBreadcrumbs: true
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

module.exports = { EvidenceContract, validateEvidence, createMockEvidence, getEvidenceField };