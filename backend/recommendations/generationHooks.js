/**
 * GENERATION HOOKS
 * File: backend/recommendations/generationHooks.js
 *
 * Deterministic generation hooks for creating copy/paste-ready deliverables.
 * NO external API calls - all generation is template + evidence-driven.
 *
 * Phase 4A.1: Content-Aware Recommendation Engine Core
 */

const path = require('path');
const fs = require('fs');

// FAQ library loader (if available)
let loadLibrary, hasLibrary;
try {
  const faqLoader = require('../analyzers/recommendation-engine/faq-library-loader');
  loadLibrary = faqLoader.loadLibrary;
  hasLibrary = faqLoader.hasLibrary;
} catch (e) {
  // Fallback if FAQ loader not available
  loadLibrary = () => null;
  hasLibrary = () => false;
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Extract domain from URL
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'example.com';
  }
}

/**
 * Extract origin (protocol + domain) from URL
 */
function extractOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return 'https://example.com';
  }
}

/**
 * Infer company name from evidence
 */
function inferCompanyName(scanEvidence, context) {
  // Ensure context is an object
  const ctx = context || {};

  // Priority order for company name
  if (ctx.company_name) return ctx.company_name;

  const evidence = scanEvidence || {};

  // Check Organization schema
  const orgSchema = evidence.technical?.structuredData?.find(
    s => s.type === 'Organization' || s['@type'] === 'Organization'
  );
  if (orgSchema?.raw?.name || orgSchema?.name) {
    return orgSchema.raw?.name || orgSchema.name;
  }

  // Check metadata
  if (evidence.metadata?.ogTitle) {
    // Often format: "Page Title | Company Name" or "Company Name - Tagline"
    const parts = evidence.metadata.ogTitle.split(/\s*[|\-–—]\s*/);
    if (parts.length > 1) {
      return parts[parts.length - 1].trim();
    }
  }

  // Check H1
  if (evidence.content?.headings?.h1?.[0]) {
    return evidence.content.headings.h1[0];
  }

  // Fallback to domain
  const url = evidence.url || ctx.site_url || '';
  const domain = extractDomain(url);
  // Capitalize first letter of domain (without TLD)
  const domainName = domain.split('.')[0];
  return domainName.charAt(0).toUpperCase() + domainName.slice(1);
}

/**
 * Infer logo URL from evidence
 */
function inferLogoUrl(scanEvidence, context) {
  const ctx = context || {};
  const evidence = scanEvidence || {};

  // Check Organization schema for logo
  const orgSchema = evidence.technical?.structuredData?.find(
    s => s.type === 'Organization' || s['@type'] === 'Organization'
  );
  if (orgSchema?.raw?.logo) {
    const logo = orgSchema.raw.logo;
    return typeof logo === 'object' ? logo.url : logo;
  }

  // Check OG image as fallback (often the logo or key brand image)
  if (evidence.metadata?.ogImage) {
    return evidence.metadata.ogImage;
  }

  return null;
}

/**
 * Infer description from evidence
 */
function inferDescription(scanEvidence, context) {
  const ctx = context || {};
  const evidence = scanEvidence || {};

  if (evidence.metadata?.ogDescription) {
    return evidence.metadata.ogDescription;
  }
  if (evidence.metadata?.description) {
    return evidence.metadata.description;
  }

  // First paragraph as fallback
  if (evidence.content?.paragraphs?.[0]) {
    const firstPara = evidence.content.paragraphs[0];
    return firstPara.length > 160
      ? firstPara.substring(0, 157) + '...'
      : firstPara;
  }

  return `Welcome to ${inferCompanyName(scanEvidence, context)}`;
}

/**
 * Format current date as ISO string
 */
function getCurrentISODate() {
  return new Date().toISOString().split('T')[0];
}

// ========================================
// BUILT-IN FAQ LIBRARY (Fallback)
// ========================================

const BUILTIN_FAQ_LIBRARY = {
  technology: {
    industry: 'Technology',
    faqs: [
      {
        category: 'General',
        questions: [
          { q: 'What problems does your solution solve?', a_template: '{{company_name}} helps {{icp_roles}} overcome {{pain_points}} by providing {{value_prop}}.' },
          { q: 'How does your technology work?', a_template: 'Our technology uses {{tech_approach}} to deliver {{key_benefit}} for {{icp_roles}}.' },
          { q: 'What makes you different from competitors?', a_template: '{{company_name}} stands out through {{differentiators}}, giving customers {{unique_value}}.' }
        ]
      },
      {
        category: 'Implementation',
        questions: [
          { q: 'How long does implementation take?', a_template: 'Typical implementation takes {{implementation_time}}. Our team provides full onboarding support.' },
          { q: 'What integrations do you support?', a_template: '{{company_name}} integrates with popular tools including {{integrations}}. Custom integrations are also available.' },
          { q: 'Do you offer a free trial?', a_template: 'Yes, we offer a {{trial_period}} free trial with full access to our {{product_type}} features.' }
        ]
      },
      {
        category: 'Pricing',
        questions: [
          { q: 'How much does your solution cost?', a_template: '{{company_name}} offers flexible pricing starting at {{pricing_start}}. Contact us for a customized quote.' },
          { q: 'What is included in each pricing tier?', a_template: 'Each tier includes {{tier_features}}. Enterprise plans offer additional customization and support.' }
        ]
      }
    ]
  },
  cybersecurity: {
    industry: 'Cybersecurity',
    faqs: [
      {
        category: 'Security',
        questions: [
          { q: 'How do you protect customer data?', a_template: '{{company_name}} uses {{security_measures}} including encryption, access controls, and continuous monitoring.' },
          { q: 'What compliance certifications do you have?', a_template: 'We maintain {{certifications}} compliance and undergo regular third-party security audits.' },
          { q: 'How quickly do you respond to security incidents?', a_template: 'Our security team provides {{response_time}} incident response with 24/7 monitoring.' }
        ]
      },
      {
        category: 'Capabilities',
        questions: [
          { q: 'What types of threats do you detect?', a_template: '{{company_name}} detects {{threat_types}} using advanced threat intelligence and behavioral analysis.' },
          { q: 'Do you offer threat hunting services?', a_template: 'Yes, our threat hunting team proactively identifies {{threat_categories}} before they impact your business.' }
        ]
      }
    ]
  },
  telecom: {
    industry: 'Telecommunications',
    faqs: [
      {
        category: 'Services',
        questions: [
          { q: 'What network coverage do you provide?', a_template: '{{company_name}} provides {{coverage_type}} coverage across {{coverage_area}} with {{uptime}}% uptime.' },
          { q: 'Do you support 5G?', a_template: 'Yes, we offer 5G connectivity in {{5g_markets}} with speeds up to {{max_speed}}.' },
          { q: 'What is your service level agreement?', a_template: 'Our SLA guarantees {{uptime}}% uptime with {{support_response}} support response times.' }
        ]
      },
      {
        category: 'Enterprise',
        questions: [
          { q: 'Do you offer dedicated enterprise solutions?', a_template: '{{company_name}} provides dedicated {{enterprise_services}} for large organizations with custom SLAs.' },
          { q: 'Can you support global operations?', a_template: 'Yes, we support global connectivity across {{countries}} countries with local presence in key markets.' }
        ]
      }
    ]
  },
  cloud: {
    industry: 'Cloud Computing',
    faqs: [
      {
        category: 'Infrastructure',
        questions: [
          { q: 'Where are your data centers located?', a_template: '{{company_name}} operates data centers in {{regions}} with full redundancy and disaster recovery.' },
          { q: 'What is your uptime guarantee?', a_template: 'We guarantee {{uptime}}% uptime backed by service credits if we fall short.' },
          { q: 'Do you support hybrid cloud deployments?', a_template: 'Yes, {{company_name}} supports hybrid and multi-cloud deployments with seamless integration.' }
        ]
      },
      {
        category: 'Scalability',
        questions: [
          { q: 'How quickly can you scale resources?', a_template: 'Resources scale automatically within {{scale_time}} to handle demand spikes.' },
          { q: 'What is your pricing model?', a_template: 'We offer {{pricing_model}} pricing with transparent costs and no hidden fees.' }
        ]
      }
    ]
  },
  saas: {
    industry: 'SaaS / B2B Software',
    faqs: [
      {
        category: 'Product',
        questions: [
          { q: 'What is your product designed to do?', a_template: '{{company_name}} is a {{product_category}} platform that helps {{icp_roles}} {{key_benefit}}.' },
          { q: 'Who is your ideal customer?', a_template: 'We serve {{company_size}} companies in {{target_industries}} looking to {{icp_goal}}.' },
          { q: 'What results can I expect?', a_template: 'Customers typically see {{roi_metric}} within {{time_to_value}} of implementation.' }
        ]
      },
      {
        category: 'Getting Started',
        questions: [
          { q: 'How do I get started?', a_template: 'Start with a {{trial_type}} trial at {{signup_url}}. Our team will guide you through setup.' },
          { q: 'What onboarding support do you provide?', a_template: 'All plans include {{onboarding_type}} with dedicated success managers for enterprise accounts.' }
        ]
      }
    ]
  }
};

/**
 * Get FAQ library for an industry (with fallback)
 */
function getFAQLibrary(industry) {
  const normalizedIndustry = (industry || '').toLowerCase().trim();

  // Try loading from external library first
  if (hasLibrary(normalizedIndustry)) {
    const library = loadLibrary(normalizedIndustry);
    if (library) {
      return library;
    }
  }

  // Check built-in library
  for (const [key, lib] of Object.entries(BUILTIN_FAQ_LIBRARY)) {
    if (normalizedIndustry.includes(key) || key.includes(normalizedIndustry)) {
      return lib;
    }
  }

  // Default to technology
  return BUILTIN_FAQ_LIBRARY.technology;
}

// ========================================
// GENERATION HOOKS
// ========================================

/**
 * Hook A: Generate Organization Schema JSON-LD
 *
 * @param {Object} scanEvidence - Scan evidence object
 * @param {Object} context - Context with company info, industry, etc.
 * @returns {Object} - Generated asset with content and implementation notes
 */
async function generateOrganizationSchema(scanEvidence, context) {
  const ctx = context || {};
  const evidence = scanEvidence || {};
  const url = evidence.url || ctx.site_url || 'https://example.com';
  const origin = extractOrigin(url);

  const companyName = inferCompanyName(evidence, context);
  const logoUrl = inferLogoUrl(evidence, context);
  const description = inferDescription(evidence, context);

  // Build sameAs links from evidence or placeholders
  const sameAsLinks = [];

  // Check for social links in evidence
  if (evidence.entities?.entities?.organizations?.[0]?.sameAs) {
    sameAsLinks.push(...evidence.entities.entities.organizations[0].sameAs);
  }

  // Placeholder if none found
  if (sameAsLinks.length === 0) {
    sameAsLinks.push(
      `https://linkedin.com/company/${extractDomain(url).split('.')[0]}`,
      `https://twitter.com/${extractDomain(url).split('.')[0]}`
    );
  }

  // Build the Organization JSON-LD
  const organizationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${origin}/#organization`,
    name: companyName,
    url: origin,
    description: description
  };

  // Add logo if available
  if (logoUrl) {
    organizationJsonLd.logo = {
      '@type': 'ImageObject',
      url: logoUrl.startsWith('http') ? logoUrl : `${origin}${logoUrl}`
    };
  }

  // Add sameAs links
  if (sameAsLinks.length > 0) {
    organizationJsonLd.sameAs = sameAsLinks;
  }

  // Add contact point placeholder
  organizationJsonLd.contactPoint = {
    '@type': 'ContactPoint',
    contactType: 'customer service',
    url: `${origin}/contact`
  };

  return {
    asset_type: 'jsonld.organization',
    content: organizationJsonLd,
    implementation_notes: [
      'Add this JSON-LD script to your website\'s <head> section',
      'Place it on every page, or at minimum the homepage and about page',
      'Replace placeholder social links with your actual profile URLs',
      'Validate using Google Rich Results Test: https://search.google.com/test/rich-results',
      'Update the logo URL to your actual logo file location',
      'Consider adding "foundingDate", "founders", and "numberOfEmployees" for richer data'
    ]
  };
}

/**
 * Hook B: Generate ICP-Specific FAQs + FAQPage Schema
 *
 * @param {Object} scanEvidence - Scan evidence object
 * @param {Object} context - Context with industry, ICP roles, etc.
 * @returns {Object} - Generated asset with FAQs and implementation notes
 */
async function generateICPFaqs(scanEvidence, context) {
  const ctx = context || {};
  const evidence = scanEvidence || {};
  const url = evidence.url || ctx.site_url || 'https://example.com';
  const origin = extractOrigin(url);

  const companyName = inferCompanyName(evidence, ctx);
  const industry = ctx.detected_industry || ctx.industry || 'technology';
  const icpRoles = ctx.icp_roles || ['decision-makers', 'IT leaders'];

  // Get FAQ library for this industry
  const faqLibrary = getFAQLibrary(industry);

  // Build FAQ Q/A pairs
  const faqPairs = [];
  const categories = faqLibrary.faqs || faqLibrary.categories || [];

  // Detect topics from evidence to customize FAQs
  const detectedTopics = [];
  if (evidence.content?.headings?.h2) {
    detectedTopics.push(...evidence.content.headings.h2.slice(0, 3));
  }

  // Collect existing FAQs to avoid duplicates
  const existingQuestions = (evidence.content?.faqs || []).map(f =>
    (f.question || f.q || '').toLowerCase()
  );

  // Template replacements
  const replacements = {
    '{{company_name}}': companyName,
    '{{icp_roles}}': icpRoles.join(' and '),
    '{{pain_points}}': ctx.pain_points || 'common industry challenges',
    '{{value_prop}}': ctx.value_prop || 'innovative solutions',
    '{{tech_approach}}': ctx.tech_approach || 'advanced technology',
    '{{key_benefit}}': ctx.key_benefit || 'improved efficiency and results',
    '{{differentiators}}': ctx.differentiators || 'our unique approach and expertise',
    '{{unique_value}}': ctx.unique_value || 'unmatched value',
    '{{implementation_time}}': ctx.implementation_time || '2-4 weeks',
    '{{integrations}}': ctx.integrations || 'popular enterprise tools',
    '{{trial_period}}': ctx.trial_period || '14-day',
    '{{product_type}}': ctx.product_type || 'platform',
    '{{pricing_start}}': ctx.pricing_start || '$X/month',
    '{{tier_features}}': ctx.tier_features || 'core features and support',
    '{{security_measures}}': ctx.security_measures || 'industry-standard security practices',
    '{{certifications}}': ctx.certifications || 'SOC 2 and ISO 27001',
    '{{response_time}}': ctx.response_time || '24-hour',
    '{{threat_types}}': ctx.threat_types || 'malware, phishing, and insider threats',
    '{{threat_categories}}': ctx.threat_categories || 'emerging threats',
    '{{coverage_type}}': ctx.coverage_type || 'nationwide',
    '{{coverage_area}}': ctx.coverage_area || 'major markets',
    '{{uptime}}': ctx.uptime || '99.9',
    '{{5g_markets}}': ctx.markets_5g || 'select cities',
    '{{max_speed}}': ctx.max_speed || '1 Gbps',
    '{{support_response}}': ctx.support_response || '4-hour',
    '{{enterprise_services}}': ctx.enterprise_services || 'network and communication solutions',
    '{{countries}}': ctx.countries || '50+',
    '{{regions}}': ctx.regions || 'North America, Europe, and Asia',
    '{{scale_time}}': ctx.scale_time || 'minutes',
    '{{pricing_model}}': ctx.pricing_model || 'pay-as-you-go',
    '{{product_category}}': ctx.product_category || 'software',
    '{{icp_goal}}': ctx.icp_goal || 'achieve their business objectives',
    '{{company_size}}': ctx.company_size || 'mid-market to enterprise',
    '{{target_industries}}': ctx.target_industries || 'technology and professional services',
    '{{roi_metric}}': ctx.roi_metric || '20% improvement in efficiency',
    '{{time_to_value}}': ctx.time_to_value || '30 days',
    '{{trial_type}}': ctx.trial_type || 'free',
    '{{signup_url}}': ctx.signup_url || `${origin}/signup`,
    '{{onboarding_type}}': ctx.onboarding_type || 'self-service and guided onboarding'
  };

  function applyReplacements(text) {
    let result = text;
    for (const [key, value] of Object.entries(replacements)) {
      result = result.split(key).join(value);
    }
    return result;
  }

  // Extract FAQs from library
  let faqCount = 0;
  for (const category of categories) {
    const questions = category.questions || [];
    for (const q of questions) {
      // Skip if we already have 10 FAQs
      if (faqCount >= 10) break;

      // Skip if similar question exists
      const questionText = q.q || q.question;
      if (existingQuestions.some(eq => eq.includes(questionText.toLowerCase().slice(0, 30)))) {
        continue;
      }

      const answerTemplate = q.a_template || q.a || q.answer || '';
      const answer = applyReplacements(answerTemplate);

      faqPairs.push({
        question: applyReplacements(questionText),
        answer: answer,
        category: category.category || 'General'
      });
      faqCount++;
    }
    if (faqCount >= 10) break;
  }

  // Ensure we have at least 6 FAQs
  if (faqPairs.length < 6) {
    const defaultFaqs = [
      { question: `What does ${companyName} do?`, answer: `${companyName} provides solutions designed to help ${icpRoles.join(' and ')} achieve their goals.`, category: 'General' },
      { question: `Who is ${companyName} for?`, answer: `We serve businesses looking for reliable ${industry} solutions.`, category: 'General' },
      { question: `How do I get started with ${companyName}?`, answer: `Visit our website to learn more or contact our team for a demo.`, category: 'Getting Started' },
      { question: `What support does ${companyName} offer?`, answer: `We provide comprehensive support including documentation, email, and dedicated account management for enterprise customers.`, category: 'Support' },
      { question: `Is ${companyName} secure?`, answer: `Security is our priority. We implement industry-standard security practices and maintain relevant compliance certifications.`, category: 'Security' },
      { question: `What is the pricing for ${companyName}?`, answer: `We offer flexible pricing to meet different needs. Contact us for a customized quote.`, category: 'Pricing' }
    ];

    for (const faq of defaultFaqs) {
      if (faqPairs.length >= 10) break;
      if (!faqPairs.some(f => f.question.toLowerCase().includes(faq.question.toLowerCase().slice(0, 20)))) {
        faqPairs.push(faq);
      }
    }
  }

  // Build FAQPage JSON-LD
  const faqPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${origin}/faq#faqpage`,
    mainEntity: faqPairs.map(faq => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer
      }
    }))
  };

  return {
    asset_type: 'jsonld.faqpage',
    content: {
      faqs: faqPairs,
      jsonLd: faqPageJsonLd
    },
    implementation_notes: [
      'Create a dedicated FAQ page or add an FAQ section to relevant pages',
      'Add the FAQPage JSON-LD to the page containing these FAQs',
      'Customize the answers with your specific details and value propositions',
      'Avoid duplicating existing FAQ content on your site',
      'Group FAQs by category for better user experience',
      'Validate using Google Rich Results Test before publishing',
      'Update FAQs regularly based on actual customer questions'
    ]
  };
}

/**
 * Hook C: Generate Open Graph & Twitter Card Meta Tags
 *
 * @param {Object} scanEvidence - Scan evidence object
 * @param {Object} context - Context with page info
 * @returns {Object} - Generated asset with meta tags and implementation notes
 */
async function generateOpenGraphTags(scanEvidence, context) {
  const ctx = context || {};
  const evidence = scanEvidence || {};
  const url = evidence.url || ctx.site_url || 'https://example.com';
  const origin = extractOrigin(url);

  const companyName = inferCompanyName(evidence, ctx);
  const description = inferDescription(evidence, ctx);
  const logoUrl = inferLogoUrl(evidence, ctx);

  // Infer page title
  let pageTitle = evidence.metadata?.title || evidence.content?.headings?.h1?.[0] || companyName;
  // Clean up title if it has separators
  if (pageTitle.includes('|')) {
    pageTitle = pageTitle.split('|')[0].trim();
  }

  // Infer image URL (prefer og:image, then logo)
  let imageUrl = evidence.metadata?.ogImage || logoUrl;
  if (imageUrl && !imageUrl.startsWith('http')) {
    imageUrl = `${origin}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
  }
  if (!imageUrl) {
    imageUrl = `${origin}/og-image.jpg`; // Placeholder
  }

  // Build meta tags object
  const metaTags = {
    openGraph: {
      'og:title': pageTitle,
      'og:description': description,
      'og:url': url,
      'og:type': 'website',
      'og:image': imageUrl,
      'og:image:width': '1200',
      'og:image:height': '630',
      'og:site_name': companyName
    },
    twitter: {
      'twitter:card': 'summary_large_image',
      'twitter:title': pageTitle,
      'twitter:description': description,
      'twitter:image': imageUrl
    }
  };

  // Generate HTML snippet
  const htmlSnippet = `<!-- Open Graph Meta Tags -->
<meta property="og:title" content="${pageTitle}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">
<meta property="og:image" content="${imageUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="${companyName}">

<!-- Twitter Card Meta Tags -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${pageTitle}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${imageUrl}">`;

  return {
    asset_type: 'meta.opengraph',
    content: {
      metaTags,
      htmlSnippet
    },
    implementation_notes: [
      'Add these meta tags to the <head> section of your page',
      'Create a high-quality og:image (recommended: 1200x630px)',
      'Each page should have unique og:title and og:description',
      'Test with Facebook Sharing Debugger: https://developers.facebook.com/tools/debug/',
      'Test with Twitter Card Validator: https://cards-dev.twitter.com/validator',
      'If using a CMS, check for built-in OG tag support or plugins',
      'Consider adding og:locale for multi-language sites'
    ]
  };
}

// ========================================
// GENERATION HOOKS REGISTRY
// ========================================

/**
 * Registry of all generation hooks.
 * Each hook is an async function that takes (scanEvidence, context)
 * and returns { asset_type, content, implementation_notes }
 */
const GENERATION_HOOKS = {
  'technical_setup.organization_schema': generateOrganizationSchema,
  'ai_search_readiness.icp_faqs': generateICPFaqs,
  'technical_setup.open_graph_tags': generateOpenGraphTags
};

/**
 * Execute a generation hook safely.
 * Returns null if hook doesn't exist or fails.
 *
 * @param {string} hookKey - The hook key to execute
 * @param {Object} scanEvidence - Scan evidence object
 * @param {Object} context - Context object
 * @returns {Object|null} - Generated asset or null
 */
async function executeHook(hookKey, scanEvidence, context = {}) {
  const hook = GENERATION_HOOKS[hookKey];

  if (!hook) {
    console.warn(`[GenerationHooks] Hook not found: ${hookKey}`);
    return null;
  }

  try {
    const result = await hook(scanEvidence, context);
    return result;
  } catch (error) {
    console.error(`[GenerationHooks] Error executing hook ${hookKey}:`, error.message);
    return null;
  }
}

/**
 * Check if a hook exists
 *
 * @param {string} hookKey - The hook key to check
 * @returns {boolean}
 */
function hasHook(hookKey) {
  return !!GENERATION_HOOKS[hookKey];
}

/**
 * Get list of available hook keys
 *
 * @returns {string[]}
 */
function getAvailableHooks() {
  return Object.keys(GENERATION_HOOKS);
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  // Hook registry
  GENERATION_HOOKS,

  // Individual hooks (for direct use)
  generateOrganizationSchema,
  generateICPFaqs,
  generateOpenGraphTags,

  // Execution utilities
  executeHook,
  hasHook,
  getAvailableHooks,

  // Helper utilities (exported for testing)
  inferCompanyName,
  inferLogoUrl,
  inferDescription,
  extractDomain,
  extractOrigin,
  getFAQLibrary
};
