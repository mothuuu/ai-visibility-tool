/**
 * SUBFACTOR TO PLAYBOOK MAPPING
 * File: backend/recommendations/subfactorPlaybookMap.js
 *
 * Single source of truth for mapping V5 subfactors to playbook recommendations.
 * Supports V5 → V5.1 alias mapping and key normalization.
 *
 * Phase 4A.1: Content-Aware Recommendation Engine Core
 */

// ========================================
// PILLAR DISPLAY NAMES (8 pillars)
// ========================================

const PILLAR_DISPLAY_NAMES = {
  aiReadability: 'AI Readability',
  aiSearchReadiness: 'AI Search Readiness',
  contentFreshness: 'Content Freshness',
  contentStructure: 'Content Structure',
  speedUX: 'Speed & UX',
  technicalSetup: 'Technical Setup',
  trustAuthority: 'Trust & Authority',
  voiceOptimization: 'Voice Optimization'
};

// Marketing headlines from pillar-display-map.json
const PILLAR_MARKETING_HEADLINES = {
  aiReadability: 'Content AI Can Use',
  aiSearchReadiness: 'Be Found',
  contentFreshness: 'Stay Current',
  contentStructure: 'Content AI Can Use',
  speedUX: 'Be Fast & Frictionless',
  technicalSetup: 'Solid Foundation',
  trustAuthority: 'Be Trusted',
  voiceOptimization: 'Own the Conversation'
};

// ========================================
// V5 → V5.1 ALIAS MAPPING
// ========================================

/**
 * Maps legacy V5 keys to current V5.1 canonical keys.
 * Format: 'v5_key' → 'v51_key'
 */
const V5_TO_V51_ALIASES = {
  // AI Search Readiness aliases
  'ai_search_readiness.q_based_headings': 'ai_search_readiness.query_intent_alignment',
  'ai_search_readiness.snippet_eligible_answers': 'ai_search_readiness.evidence_proof_points',
  'ai_search_readiness.faq_score': 'ai_search_readiness.icp_faqs',
  'ai_search_readiness.question_headings_score': 'ai_search_readiness.query_intent_alignment',

  // Technical Setup aliases
  'technical_setup.structured_data_score': 'technical_setup.structured_data_coverage',
  'technical_setup.sitemap_score': 'technical_setup.sitemap_indexing',
  'technical_setup.open_graph_score': 'technical_setup.social_meta_tags',

  // Trust & Authority aliases
  'trust_authority.author_bios_score': 'trust_authority.author_bios',
  'trust_authority.certifications_score': 'trust_authority.professional_certifications',

  // Content Structure aliases
  'content_structure.heading_hierarchy_score': 'content_structure.semantic_heading_structure',
  'content_structure.navigation_score': 'content_structure.navigation_clarity',

  // AI Readability aliases
  'ai_readability.alt_text_score': 'ai_readability.alt_text_coverage',
  'ai_readability.captions_transcripts_score': 'ai_readability.media_accessibility'
};

// ========================================
// KEY NORMALIZATION UTILITIES
// ========================================

/**
 * Normalize subfactor key to canonical format.
 * Handles: camelCase, snake_case, dashes, mixed separators.
 *
 * @param {string} key - Input key in any format
 * @returns {string} - Canonical format: category.subfactor (snake_case)
 */
function normalizeKey(key) {
  if (!key || typeof key !== 'string') return '';

  // Already in canonical format with dot separator
  if (key.includes('.')) {
    const [category, ...rest] = key.split('.');
    const subfactor = rest.join('.');
    return `${toSnakeCase(category)}.${toSnakeCase(subfactor)}`;
  }

  // camelCase key (e.g., 'altTextScore')
  // Convert to snake_case and attempt to infer category
  const snakeKey = toSnakeCase(key);

  // Remove 'Score' suffix if present
  const cleanKey = snakeKey.replace(/_score$/, '');

  return cleanKey;
}

/**
 * Convert camelCase or PascalCase to snake_case
 */
function toSnakeCase(str) {
  if (!str) return '';
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '')
    .replace(/-/g, '_')
    .replace(/__+/g, '_');
}

/**
 * Convert snake_case to camelCase
 */
function toCamelCase(str) {
  if (!str) return '';
  return str
    .split('_')
    .map((word, i) => i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * Build full canonical key from category and subfactor
 */
function buildCanonicalKey(category, subfactor) {
  return `${toSnakeCase(category)}.${toSnakeCase(subfactor)}`;
}

// ========================================
// SUBFACTOR TO PLAYBOOK MAPPING
// ========================================

/**
 * PlaybookEntry Schema:
 * {
 *   playbook_category: string,        // One of 8 pillar display names
 *   playbook_gap: string,             // Human-readable gap/subfactor name
 *   priority: 'P0' | 'P1' | 'P2',
 *   effort: 'S' | 'S-M' | 'M' | 'M-L' | 'L',
 *   impact: 'High' | 'Med-High' | 'Med' | 'Low-Med',
 *   automation_level: 'generate' | 'draft' | 'guide' | 'manual',
 *   generator_hook_key?: string,       // Required when automation_level='generate'
 *   why_it_matters_template: string,
 *   action_items_template: string[],
 *   examples_template: string[],
 *   evidence_selectors: string[]
 * }
 */

const SUBFACTOR_TO_PLAYBOOK = {
  // ========================================
  // TECHNICAL SETUP (18% weight)
  // ========================================

  'technical_setup.organization_schema': {
    playbook_category: 'Technical Setup',
    playbook_gap: 'Missing Organization Schema',
    priority: 'P0',
    effort: 'S',
    impact: 'High',
    automation_level: 'generate',
    generator_hook_key: 'technical_setup.organization_schema',
    why_it_matters_template: 'Without Organization schema, AI assistants cannot confidently identify {{company_name}} as a verified business entity. This reduces your chances of being recommended when users ask about companies in your space.',
    action_items_template: [
      'Add the Organization JSON-LD schema to your website <head> section',
      'Include your company name, logo URL, and official website',
      'Add sameAs links to your official social media profiles',
      'Validate the schema using Google Rich Results Test'
    ],
    examples_template: [
      '```json\n{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "name": "{{company_name}}",\n  "url": "{{site_url}}",\n  "logo": "{{logo_url}}",\n  "sameAs": [\n    "{{linkedin_url}}",\n    "{{twitter_url}}"\n  ]\n}\n```'
    ],
    evidence_selectors: [
      'technical.structuredData',
      'technical.hasOrganizationSchema',
      'metadata.ogImage',
      'content.headings.h1'
    ]
  },

  'technical_setup.structured_data_coverage': {
    playbook_category: 'Technical Setup',
    playbook_gap: 'Limited Structured Data Coverage',
    priority: 'P0',
    effort: 'M',
    impact: 'High',
    automation_level: 'guide',
    why_it_matters_template: 'Your site has {{schema_count}} schema types, but AI assistants look for comprehensive structured data. Missing schemas mean AI cannot fully understand what {{company_name}} offers.',
    action_items_template: [
      'Audit existing schema markup using Google Rich Results Test',
      'Add Organization schema (if missing)',
      'Add WebSite and WebPage schema for core pages',
      'Consider adding Product, Service, or LocalBusiness schemas based on your business type',
      'Implement BreadcrumbList for navigation clarity'
    ],
    examples_template: [
      'Priority schemas for {{industry}} businesses:\n1. Organization - Company identity\n2. WebSite - Site-level info + search box\n3. FAQPage - Common questions\n4. {{industry_specific_schema}} - Industry-specific visibility'
    ],
    evidence_selectors: [
      'technical.structuredData',
      'technical.hasOrganizationSchema',
      'technical.hasFAQSchema',
      'technical.hasArticleSchema',
      'technical.hasBreadcrumbSchema'
    ]
  },

  'technical_setup.sitemap_indexing': {
    playbook_category: 'Technical Setup',
    playbook_gap: 'Missing or Incomplete Sitemap',
    priority: 'P0',
    effort: 'S',
    impact: 'High',
    automation_level: 'guide',
    why_it_matters_template: 'No sitemap detected at {{site_url}}/sitemap.xml. Without a sitemap, AI crawlers may miss important pages on your site, reducing your overall AI visibility.',
    action_items_template: [
      'Generate an XML sitemap including all important pages',
      'Submit sitemap to Google Search Console and Bing Webmaster Tools',
      'Add sitemap reference to robots.txt: Sitemap: {{site_url}}/sitemap.xml',
      'Ensure sitemap updates automatically when content changes'
    ],
    examples_template: [
      'Add to robots.txt:\n```\nSitemap: {{site_url}}/sitemap.xml\n```',
      'Sitemap structure:\n```xml\n<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>{{site_url}}/</loc>\n    <lastmod>{{current_date}}</lastmod>\n  </url>\n</urlset>\n```'
    ],
    evidence_selectors: [
      'technical.hasSitemapLink',
      'crawler.sitemap.detected',
      'crawler.sitemap.urls'
    ]
  },

  'technical_setup.social_meta_tags': {
    playbook_category: 'Technical Setup',
    playbook_gap: 'Missing Open Graph & Social Meta Tags',
    priority: 'P1',
    effort: 'S',
    impact: 'Med-High',
    automation_level: 'generate',
    generator_hook_key: 'technical_setup.open_graph_tags',
    why_it_matters_template: 'When {{company_name}} links are shared on social media or messaging apps, they appear as plain URLs without rich previews. This reduces click-through rates and brand recognition.',
    action_items_template: [
      'Add og:title, og:description, og:image, og:url to page <head>',
      'Add Twitter Card meta tags (twitter:card, twitter:title, etc.)',
      'Use high-quality images (1200x630px recommended for og:image)',
      'Test with Facebook Sharing Debugger and Twitter Card Validator'
    ],
    examples_template: [
      '```html\n<meta property="og:title" content="{{page_title}}">\n<meta property="og:description" content="{{page_description}}">\n<meta property="og:image" content="{{og_image_url}}">\n<meta property="og:url" content="{{page_url}}">\n<meta name="twitter:card" content="summary_large_image">\n```'
    ],
    evidence_selectors: [
      'metadata.ogTitle',
      'metadata.ogDescription',
      'metadata.ogImage',
      'metadata.twitterCard'
    ]
  },

  'technical_setup.canonical_hreflang': {
    playbook_category: 'Technical Setup',
    playbook_gap: 'Missing Canonical or Hreflang Tags',
    priority: 'P1',
    effort: 'S',
    impact: 'Med',
    automation_level: 'guide',
    why_it_matters_template: 'Missing canonical tags can cause duplicate content issues. AI systems may get confused about which version of your content is authoritative.',
    action_items_template: [
      'Add self-referencing canonical tags to all pages',
      'For multi-language sites, implement hreflang tags',
      'Ensure canonical URLs match actual page URLs',
      'Audit for conflicting canonicals using SEO tools'
    ],
    examples_template: [
      '```html\n<link rel="canonical" href="{{page_url}}">\n```',
      'For multi-language:\n```html\n<link rel="alternate" hreflang="en" href="{{site_url}}/en/">\n<link rel="alternate" hreflang="es" href="{{site_url}}/es/">\n```'
    ],
    evidence_selectors: [
      'technical.hasCanonical',
      'technical.canonicalUrl',
      'technical.hreflangTags'
    ]
  },

  'technical_setup.crawler_access': {
    playbook_category: 'Technical Setup',
    playbook_gap: 'Crawler Access Issues',
    priority: 'P0',
    effort: 'S-M',
    impact: 'High',
    automation_level: 'manual',
    why_it_matters_template: 'AI crawlers may be blocked from accessing your content. If crawlers cannot reach your pages, your content will not appear in AI recommendations.',
    action_items_template: [
      'Review robots.txt for overly restrictive rules',
      'Ensure GPTBot, CCBot, and other AI crawlers are not blocked',
      'Check server response times (should be under 500ms)',
      'Verify no authentication or geo-blocking issues'
    ],
    examples_template: [
      'Recommended robots.txt:\n```\nUser-agent: *\nAllow: /\n\nUser-agent: GPTBot\nAllow: /\n\nSitemap: {{site_url}}/sitemap.xml\n```'
    ],
    evidence_selectors: [
      'crawler.robotsTxt',
      'performance.ttfb',
      'performance.responseTime'
    ]
  },

  // ========================================
  // AI SEARCH READINESS (20% weight)
  // ========================================

  'ai_search_readiness.icp_faqs': {
    playbook_category: 'AI Search Readiness',
    playbook_gap: 'Missing ICP-Specific FAQs',
    priority: 'P0',
    effort: 'M',
    impact: 'High',
    automation_level: 'generate',
    generator_hook_key: 'ai_search_readiness.icp_faqs',
    why_it_matters_template: 'Your site lacks FAQ content tailored to {{icp_roles}} decision-makers. When these buyers ask AI assistants about {{industry}} solutions, your competitors with comprehensive FAQs get recommended instead.',
    action_items_template: [
      'Create an FAQ section addressing common {{icp_roles}} questions',
      'Add FAQPage schema markup to your FAQ content',
      'Include questions that match how your ICP searches (natural language)',
      'Update FAQs regularly based on customer inquiries'
    ],
    examples_template: [
      'FAQ questions for {{industry}} {{icp_roles}}:\n- "What is the typical ROI of {{product_type}}?"\n- "How long does {{product_type}} implementation take?"\n- "What integrations does {{company_name}} support?"'
    ],
    evidence_selectors: [
      'content.faqs',
      'technical.hasFAQSchema',
      'navigation.keyPages.faq',
      'crawler.discoveredSections.hasFaqUrl'
    ]
  },

  'ai_search_readiness.query_intent_alignment': {
    playbook_category: 'AI Search Readiness',
    playbook_gap: 'Missing Question-Based Headings',
    priority: 'P1',
    effort: 'S-M',
    impact: 'High',
    automation_level: 'draft',
    why_it_matters_template: 'AI assistants match user questions to content headings. Your pages use {{heading_count}} headings, but few are phrased as questions. This reduces your match rate for conversational AI queries.',
    action_items_template: [
      'Rewrite key H2/H3 headings as questions (How, What, Why, When)',
      'Research common questions using AlsoAsked or AnswerThePublic',
      'Ensure answers appear immediately after question headings',
      'Structure content to provide direct, quotable answers'
    ],
    examples_template: [
      'Transform headings:\n- Before: "Our Pricing"\n- After: "How Much Does {{product_name}} Cost?"\n\n- Before: "Features"\n- After: "What Can You Do With {{product_name}}?"'
    ],
    evidence_selectors: [
      'content.headings',
      'structure.headingCount',
      'content.faqs'
    ]
  },

  'ai_search_readiness.evidence_proof_points': {
    playbook_category: 'AI Search Readiness',
    playbook_gap: 'Weak Evidence & Proof Points',
    priority: 'P1',
    effort: 'M',
    impact: 'Med-High',
    automation_level: 'guide',
    why_it_matters_template: 'AI assistants prefer to cite content with clear evidence and proof points. Your content lacks specific numbers, case studies, or verifiable claims that make it citation-worthy.',
    action_items_template: [
      'Add specific statistics and metrics (e.g., "95% uptime", "2x faster")',
      'Include customer testimonials with names and companies',
      'Reference third-party studies or industry benchmarks',
      'Create case studies with measurable outcomes'
    ],
    examples_template: [
      'Add proof points:\n- "Trusted by 500+ {{industry}} companies"\n- "Reduces {{pain_point}} by 40% on average"\n- "Named a Leader in Gartner Magic Quadrant 2024"'
    ],
    evidence_selectors: [
      'content.paragraphs',
      'content.bodyText',
      'entities.metrics'
    ]
  },

  'ai_search_readiness.pillar_pages': {
    playbook_category: 'AI Search Readiness',
    playbook_gap: 'No Pillar/Cluster Content Structure',
    priority: 'P1',
    effort: 'L',
    impact: 'High',
    automation_level: 'guide',
    why_it_matters_template: 'Your site lacks comprehensive pillar pages that establish topical authority. AI assistants look for sites that thoroughly cover topics, not just individual keywords.',
    action_items_template: [
      'Identify 3-5 core topics relevant to your business',
      'Create comprehensive pillar pages (2000+ words) for each topic',
      'Build cluster content linking back to pillar pages',
      'Interlink related content to show topical depth'
    ],
    examples_template: [
      'Pillar page structure for {{company_name}}:\n- Pillar: "Complete Guide to {{topic}}"\n  - Cluster: "{{topic}} Best Practices"\n  - Cluster: "{{topic}} vs Alternatives"\n  - Cluster: "{{topic}} Implementation Guide"'
    ],
    evidence_selectors: [
      'structure.internalLinks',
      'crawler.totalDiscoveredUrls',
      'content.wordCount'
    ]
  },

  'ai_search_readiness.scannability': {
    playbook_category: 'AI Search Readiness',
    playbook_gap: 'Poor Content Scannability',
    priority: 'P2',
    effort: 'S',
    impact: 'Med',
    automation_level: 'guide',
    why_it_matters_template: 'Your content has long paragraphs and limited formatting. AI assistants prefer scannable content with clear structure—bullet points, short paragraphs, and visual breaks.',
    action_items_template: [
      'Break paragraphs into 2-3 sentences max',
      'Use bullet points and numbered lists for key information',
      'Add subheadings every 200-300 words',
      'Use bold text for key terms and phrases'
    ],
    examples_template: [
      'Formatting tips:\n- Use lists for 3+ related items\n- Bold key terms on first use\n- Add a TL;DR summary for long articles'
    ],
    evidence_selectors: [
      'content.paragraphs',
      'content.lists',
      'structure.headingCount'
    ]
  },

  // ========================================
  // TRUST & AUTHORITY (12% weight)
  // ========================================

  'trust_authority.author_bios': {
    playbook_category: 'Trust & Authority',
    playbook_gap: 'Missing Author & Team Credentials',
    priority: 'P1',
    effort: 'S-M',
    impact: 'Med-High',
    automation_level: 'guide',
    why_it_matters_template: 'AI assistants evaluate E-E-A-T (Experience, Expertise, Authority, Trust) signals. {{company_name}} content lacks visible author credentials, reducing AI confidence in your expertise.',
    action_items_template: [
      'Add author bylines to blog posts and articles',
      'Create detailed team/about page with credentials',
      'Include LinkedIn links for team members',
      'Add Person schema for key authors'
    ],
    examples_template: [
      'Author bio template:\n"{{author_name}} is the {{author_title}} at {{company_name}} with {{years}} years of experience in {{industry}}. Connect on [LinkedIn]({{linkedin_url}})."'
    ],
    evidence_selectors: [
      'metadata.author',
      'content.paragraphs',
      'navigation.keyPages.about',
      'entities.entities.people'
    ]
  },

  'trust_authority.professional_certifications': {
    playbook_category: 'Trust & Authority',
    playbook_gap: 'Missing Industry Certifications',
    priority: 'P1',
    effort: 'M',
    impact: 'Med-High',
    automation_level: 'manual',
    why_it_matters_template: 'Your site does not prominently display industry certifications. For {{industry}} businesses, certifications like {{relevant_certs}} signal credibility to both AI and human evaluators.',
    action_items_template: [
      'Display relevant industry certifications on homepage',
      'Add certification badges to footer or trust bar',
      'Include certifications in About page and schema markup',
      'Pursue additional certifications relevant to your industry'
    ],
    examples_template: [
      'Common {{industry}} certifications:\n- SOC 2 Type II (security)\n- ISO 27001 (information security)\n- GDPR/CCPA compliance\n- {{industry_specific_cert}}'
    ],
    evidence_selectors: [
      'content.bodyText',
      'entities.entities.professionalCredentials'
    ]
  },

  'trust_authority.third_party_profiles': {
    playbook_category: 'Trust & Authority',
    playbook_gap: 'Missing Third-Party Verification',
    priority: 'P2',
    effort: 'M',
    impact: 'Med',
    automation_level: 'guide',
    why_it_matters_template: 'AI cross-references your claims with third-party sources. {{company_name}} lacks visible presence on review sites, directories, and industry publications that validate your business.',
    action_items_template: [
      'Claim profiles on G2, Capterra, and industry directories',
      'Request customer reviews on third-party platforms',
      'Add sameAs links in Organization schema to verified profiles',
      'Seek mentions in industry publications and analyst reports'
    ],
    examples_template: [
      'Priority platforms for {{industry}}:\n1. G2 / Capterra (software reviews)\n2. LinkedIn Company Page\n3. Google Business Profile\n4. Industry-specific directories'
    ],
    evidence_selectors: [
      'technical.structuredData',
      'entities.entities.organizations'
    ]
  },

  'trust_authority.thought_leadership': {
    playbook_category: 'Trust & Authority',
    playbook_gap: 'Limited Thought Leadership Content',
    priority: 'P2',
    effort: 'L',
    impact: 'Med-High',
    automation_level: 'guide',
    why_it_matters_template: 'AI assistants favor sources that demonstrate original thinking and expertise. {{company_name}} lacks blog, research, or insights content that establishes thought leadership.',
    action_items_template: [
      'Start a regular blog covering industry trends',
      'Publish original research or data studies',
      'Create in-depth guides on complex topics',
      'Share expert perspectives on industry news'
    ],
    examples_template: [
      'Content ideas for {{company_name}}:\n- "{{year}} {{industry}} Trends Report"\n- "How {{company_name}} Solves {{pain_point}}"\n- "Expert Guide to {{topic}}"'
    ],
    evidence_selectors: [
      'crawler.discoveredSections.hasBlogUrl',
      'navigation.keyPages.blog',
      'content.wordCount'
    ]
  },

  // ========================================
  // AI READABILITY (10% weight)
  // ========================================

  'ai_readability.alt_text_coverage': {
    playbook_category: 'AI Readability',
    playbook_gap: 'Incomplete Image Alt Text',
    priority: 'P1',
    effort: 'S',
    impact: 'Med-High',
    automation_level: 'guide',
    why_it_matters_template: '{{images_without_alt}} of {{total_images}} images on your site lack alt text. Multimodal AI assistants now analyze images, and missing alt text means lost opportunities for visual search citations.',
    action_items_template: [
      'Audit all images for missing or generic alt text',
      'Write descriptive alt text (5-125 characters)',
      'Avoid generic text like "image" or "photo"',
      'Include relevant keywords naturally'
    ],
    examples_template: [
      'Alt text examples:\n- Bad: "image.jpg"\n- Bad: "photo of team"\n- Good: "{{company_name}} engineering team collaborating on product development"\n- Good: "Dashboard showing {{product_name}} analytics interface"'
    ],
    evidence_selectors: [
      'media.images',
      'media.imagesWithAlt',
      'media.imagesWithoutAlt'
    ]
  },

  'ai_readability.media_accessibility': {
    playbook_category: 'AI Readability',
    playbook_gap: 'Missing Video Captions/Transcripts',
    priority: 'P2',
    effort: 'M',
    impact: 'Med',
    automation_level: 'guide',
    why_it_matters_template: 'Your videos lack captions and transcripts. AI assistants cannot analyze video content without text alternatives, missing valuable content that could boost your visibility.',
    action_items_template: [
      'Add closed captions to all videos',
      'Provide text transcripts for audio/video content',
      'Use auto-captioning tools as a starting point',
      'Include VideoObject schema with transcript property'
    ],
    examples_template: [
      'Transcript placement:\n```html\n<details>\n  <summary>Video Transcript</summary>\n  <p>{{transcript_content}}</p>\n</details>\n```'
    ],
    evidence_selectors: [
      'media.videos',
      'media.videoCount'
    ]
  },

  // ========================================
  // CONTENT STRUCTURE (15% weight)
  // ========================================

  'content_structure.semantic_heading_structure': {
    playbook_category: 'Content Structure',
    playbook_gap: 'Poor Heading Hierarchy',
    priority: 'P1',
    effort: 'S',
    impact: 'Med-High',
    automation_level: 'guide',
    why_it_matters_template: 'Your page has heading structure issues: {{heading_issues}}. AI assistants use headings to understand content organization. Broken hierarchy reduces comprehension.',
    action_items_template: [
      'Use single H1 per page for main title',
      'Follow logical H2 → H3 → H4 nesting',
      'Do not skip heading levels (e.g., H1 to H3)',
      'Make headings descriptive of section content'
    ],
    examples_template: [
      'Proper hierarchy:\n```\nH1: {{page_title}}\n  H2: Feature Overview\n    H3: Feature 1\n    H3: Feature 2\n  H2: Pricing\n  H2: FAQ\n    H3: Question 1\n```'
    ],
    evidence_selectors: [
      'structure.headingHierarchy',
      'structure.headingCount',
      'content.headings'
    ]
  },

  'content_structure.navigation_clarity': {
    playbook_category: 'Content Structure',
    playbook_gap: 'Poor Navigation Structure',
    priority: 'P2',
    effort: 'M',
    impact: 'Med',
    automation_level: 'guide',
    why_it_matters_template: 'AI crawlers use navigation to understand site structure. Your site lacks clear navigation elements that help both users and AI find content efficiently.',
    action_items_template: [
      'Implement consistent main navigation across pages',
      'Add breadcrumb navigation for multi-level pages',
      'Include footer navigation with key links',
      'Use semantic <nav> elements'
    ],
    examples_template: [
      'Navigation best practices:\n- Use <nav> for main menu\n- Add BreadcrumbList schema\n- Include search functionality\n- Limit main nav to 7 items'
    ],
    evidence_selectors: [
      'navigation.allNavLinks',
      'structure.hasNav',
      'structure.hasBreadcrumbs'
    ]
  },

  'content_structure.entity_cues': {
    playbook_category: 'Content Structure',
    playbook_gap: 'Weak Entity Recognition Signals',
    priority: 'P2',
    effort: 'S-M',
    impact: 'Med',
    automation_level: 'guide',
    why_it_matters_template: 'AI relies on entity recognition to understand your content. Your pages lack clear entity signals (proper nouns, defined terms) that help AI identify key topics.',
    action_items_template: [
      'Use consistent naming for products and services',
      'Capitalize proper nouns consistently',
      'Define acronyms and technical terms on first use',
      'Add structured data for key entities'
    ],
    examples_template: [
      'Entity best practices:\n- First mention: "{{company_name}} (formerly {{old_name}})"\n- Consistent: Always "{{product_name}}", not "the product"'
    ],
    evidence_selectors: [
      'entities.entities',
      'entities.metrics',
      'content.bodyText'
    ]
  },

  // ========================================
  // VOICE OPTIMIZATION (12% weight)
  // ========================================

  'voice_optimization.conversational_content': {
    playbook_category: 'Voice Optimization',
    playbook_gap: 'Non-Conversational Content Style',
    priority: 'P2',
    effort: 'M',
    impact: 'Med',
    automation_level: 'guide',
    why_it_matters_template: 'Your content uses formal language that does not match how people ask questions verbally. Voice assistants favor conversational content that mirrors natural speech.',
    action_items_template: [
      'Write in a conversational, second-person style',
      'Include natural language question phrases',
      'Use "you" and "your" to address readers directly',
      'Avoid jargon and overly technical language'
    ],
    examples_template: [
      'Conversational rewrites:\n- Before: "Enterprises leverage our solution..."\n- After: "Your team can use {{product_name}} to..."\n\n- Before: "The implementation process..."\n- After: "How do you get started?"'
    ],
    evidence_selectors: [
      'content.bodyText',
      'content.faqs'
    ]
  },

  'voice_optimization.local_intent': {
    playbook_category: 'Voice Optimization',
    playbook_gap: 'Missing Local/Geographic Content',
    priority: 'P2',
    effort: 'S-M',
    impact: 'Med',
    automation_level: 'guide',
    why_it_matters_template: '"Near me" and location-based voice queries are growing. Your content lacks geographic signals that help AI recommend you for local searches.',
    action_items_template: [
      'Add location information to key pages',
      'Create city/region-specific landing pages if relevant',
      'Include service area in structured data',
      'Use LocalBusiness schema for physical locations'
    ],
    examples_template: [
      'Local content additions:\n- "Serving {{city}}, {{state}} and surrounding areas"\n- LocalBusiness schema with address\n- Service area definitions'
    ],
    evidence_selectors: [
      'metadata.geoRegion',
      'metadata.geoPlacename',
      'technical.hasLocalBusinessSchema'
    ]
  },

  // ========================================
  // CONTENT FRESHNESS (8% weight)
  // ========================================

  'content_freshness.last_updated': {
    playbook_category: 'Content Freshness',
    playbook_gap: 'Outdated or Undated Content',
    priority: 'P2',
    effort: 'S',
    impact: 'Med',
    automation_level: 'guide',
    why_it_matters_template: 'AI assistants consider content freshness when making recommendations. Your content lacks visible update dates, making it appear potentially stale.',
    action_items_template: [
      'Add "Last Updated" dates to all major content',
      'Include dateModified in Article schema',
      'Set appropriate HTTP cache headers',
      'Establish content review schedule'
    ],
    examples_template: [
      'Date display pattern:\n"Last updated: {{last_updated_date}}"\n\nSchema addition:\n```json\n"dateModified": "{{iso_date}}"\n```'
    ],
    evidence_selectors: [
      'metadata.lastModified',
      'technical.lastModified',
      'metadata.publishedTime'
    ]
  },

  // ========================================
  // SPEED & UX (5% weight)
  // ========================================

  'speed_ux.performance': {
    playbook_category: 'Speed & UX',
    playbook_gap: 'Slow Page Performance',
    priority: 'P2',
    effort: 'M-L',
    impact: 'Med',
    automation_level: 'manual',
    why_it_matters_template: 'Slow pages (TTFB: {{ttfb}}ms) reduce crawler efficiency and may signal poor quality to AI systems. Fast sites get crawled more completely.',
    action_items_template: [
      'Optimize server response time (target <200ms TTFB)',
      'Implement browser caching for static assets',
      'Use a CDN for global content delivery',
      'Optimize images and enable lazy loading'
    ],
    examples_template: [
      'Performance targets:\n- TTFB: <200ms\n- LCP: <2.5s\n- CLS: <0.1'
    ],
    evidence_selectors: [
      'performance.ttfb',
      'performance.responseTime'
    ]
  }
};

// ========================================
// LOOKUP FUNCTIONS
// ========================================

/**
 * Get playbook entry for a subfactor key.
 * Handles key normalization and V5 → V5.1 alias mapping.
 *
 * @param {string} subfactorKey - Subfactor key in any format
 * @param {string} [category] - Optional category for disambiguation
 * @returns {Object|null} - PlaybookEntry or null if not found
 */
function getPlaybookEntry(subfactorKey, category = null) {
  if (!subfactorKey) return null;

  // Step 1: Normalize the key
  let normalizedKey = normalizeKey(subfactorKey);

  // Step 2: If category provided, build full canonical key
  if (category && !normalizedKey.includes('.')) {
    normalizedKey = buildCanonicalKey(category, normalizedKey);
  }

  // Step 3: Check V5 → V5.1 alias mapping
  if (V5_TO_V51_ALIASES[normalizedKey]) {
    normalizedKey = V5_TO_V51_ALIASES[normalizedKey];
  }

  // Step 4: Direct lookup
  if (SUBFACTOR_TO_PLAYBOOK[normalizedKey]) {
    return {
      ...SUBFACTOR_TO_PLAYBOOK[normalizedKey],
      canonical_key: normalizedKey
    };
  }

  // Step 5: Try without category prefix (for camelCase keys like 'altTextScore')
  const shortKey = normalizedKey.includes('.')
    ? normalizedKey.split('.').pop()
    : normalizedKey;

  // Step 6: Search across all entries with fuzzy matching
  // This handles cases like 'structured_data' matching 'structured_data_coverage'
  const categoryPrefix = normalizedKey.includes('.')
    ? normalizedKey.split('.')[0]
    : (category ? toSnakeCase(category) : null);

  for (const [key, entry] of Object.entries(SUBFACTOR_TO_PLAYBOOK)) {
    const [entryCategory, entrySubfactor] = key.split('.');

    // If category matches (or no category filter), check subfactor
    if (!categoryPrefix || entryCategory === categoryPrefix) {
      // Exact match
      if (entrySubfactor === shortKey) {
        return { ...entry, canonical_key: key };
      }

      // Prefix match (e.g., 'structured_data' matches 'structured_data_coverage')
      if (entrySubfactor.startsWith(shortKey + '_') || entrySubfactor.startsWith(shortKey)) {
        return { ...entry, canonical_key: key };
      }

      // Reverse prefix (e.g., 'alt_text_coverage' matches 'alt_text')
      if (shortKey.startsWith(entrySubfactor + '_') || shortKey.startsWith(entrySubfactor)) {
        return { ...entry, canonical_key: key };
      }
    }
  }

  // Step 7: Global search without category constraint
  for (const [key, entry] of Object.entries(SUBFACTOR_TO_PLAYBOOK)) {
    const entryShortKey = key.split('.').pop();
    if (entryShortKey === shortKey || toSnakeCase(entryShortKey) === toSnakeCase(shortKey)) {
      return {
        ...entry,
        canonical_key: key
      };
    }
  }

  return null;
}

/**
 * Get all playbook entries for a specific pillar/category.
 *
 * @param {string} pillar - Pillar name (display name or internal key)
 * @returns {Object[]} - Array of PlaybookEntries
 */
function getPlaybookEntriesByPillar(pillar) {
  const normalizedPillar = toSnakeCase(pillar);

  return Object.entries(SUBFACTOR_TO_PLAYBOOK)
    .filter(([key]) => {
      const keyPillar = key.split('.')[0];
      return keyPillar === normalizedPillar ||
             toSnakeCase(PILLAR_DISPLAY_NAMES[toCamelCase(keyPillar)] || '') === normalizedPillar;
    })
    .map(([key, entry]) => ({
      ...entry,
      canonical_key: key
    }));
}

/**
 * Get all subfactor keys that have playbook entries.
 *
 * @returns {string[]} - Array of canonical subfactor keys
 */
function getAllPlaybookKeys() {
  return Object.keys(SUBFACTOR_TO_PLAYBOOK);
}

/**
 * Check if a subfactor has a playbook entry.
 *
 * @param {string} subfactorKey - Subfactor key
 * @returns {boolean}
 */
function hasPlaybookEntry(subfactorKey) {
  return getPlaybookEntry(subfactorKey) !== null;
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  // Core data
  SUBFACTOR_TO_PLAYBOOK,
  V5_TO_V51_ALIASES,
  PILLAR_DISPLAY_NAMES,
  PILLAR_MARKETING_HEADLINES,

  // Lookup functions
  getPlaybookEntry,
  getPlaybookEntriesByPillar,
  getAllPlaybookKeys,
  hasPlaybookEntry,

  // Utility functions
  normalizeKey,
  toSnakeCase,
  toCamelCase,
  buildCanonicalKey
};
