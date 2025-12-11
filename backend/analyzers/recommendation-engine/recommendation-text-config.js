/**
 * DYNAMIC RECOMMENDATION TEXT CONFIGURATION
 *
 * Defines both "implemented" and "not_implemented" text for every subfactor.
 * This enables recommendations to dynamically update when issues are detected as fixed.
 *
 * Pattern:
 * - notImplemented: Shows what's missing, action-oriented
 * - implemented: Shows ✅ confirmation, next steps for optimization
 */

const RECOMMENDATION_TEXT = {
  // ========================================
  // TECHNICAL SETUP CATEGORY (18%)
  // ========================================

  sitemapScore: {
    notImplemented: {
      title: 'XML Sitemap',
      finding: (score, threshold, evidence) =>
        `Status: Missing Sitemap\n\nYour site is missing an XML sitemap (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points). Without a sitemap, search engines and AI crawlers have difficulty discovering all your pages, reducing visibility in answer engines like ChatGPT, Perplexity, and Google AI Overviews.`,
      whyItMatters: `A sitemap is like a map of your website for search engines and AI. Without one, Google and AI assistants might miss some of your pages entirely. With a sitemap, you're telling them "Here's everything important on my site — please read it all!"`,
      priority: 'high'
    },
    implemented: {
      title: 'XML Sitemap',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nSitemap detected at **${evidence.sitemapLocation || 'sitemap.xml'}** with ${evidence.pageCount || 0} pages crawled. Your sitemap implementation is complete! Search engines and AI crawlers can efficiently discover and index your content.\n\nCurrent Score: ${score}/100 (Target: ${threshold}/100)`,
      whyItMatters: `Your sitemap is properly implemented. Sitemaps help search engines and AI systems discover and index your content efficiently. Better indexed pages → more likely to be AI training sources.`,
      nextSteps: 'Ensure all important pages are included in the sitemap. Submit to Google Search Console and Bing Webmaster Tools if not already done. Keep sitemap updated automatically when you add/remove pages.',
      priority: 'low'
    }
  },

  structuredDataScore: {
    notImplemented: {
      title: 'Structured Data (Schema Markup)',
      finding: (score, threshold, evidence) =>
        `Status: Limited Schema Detected\n\nLimited or missing structured data detected (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points). Only ${evidence.schemaTypes?.length || 0} schema types found.`,
      whyItMatters: `Structured data helps AI assistants understand your business entity, services, and content. Without comprehensive schema markup, AI cannot confidently recommend you or extract key facts about your business.`,
      priority: 'high'
    },
    implemented: {
      title: 'Structured Data (Schema Markup)',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nStructured Data Detected! Found ${evidence.schemaTypes?.length || 'multiple'} schema types including ${evidence.schemaTypes?.slice(0, 3).join(', ') || 'Organization, LocalBusiness'}. (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your structured data implementation helps AI assistants understand your business. This increases the likelihood of being recommended when users ask AI about services you provide.`,
      nextSteps: 'Ensure all schema types are valid using Google Rich Results Test. Consider adding more specific schemas (Product, Service, Event, Review) for additional content types.',
      priority: 'low'
    }
  },

  openGraphScore: {
    notImplemented: {
      title: 'Open Graph Meta Tags',
      finding: (score, threshold, evidence) =>
        `Status: Missing or Incomplete\n\nMissing or incomplete Open Graph meta tags (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points).`,
      whyItMatters: `Open Graph tags control how your content appears when shared on social media. AI assistants also use these tags for understanding content context and summaries. Without them, your content may be misrepresented or ignored.`,
      priority: 'medium'
    },
    implemented: {
      title: 'Open Graph Meta Tags',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nOpen Graph Tags Detected! Found og:title, og:description, og:image properly configured. (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your Open Graph implementation ensures content is properly represented when shared and helps AI understand content context and relevance.`,
      nextSteps: 'Ensure all pages have unique og:title and og:description. Use high-quality og:image (1200x630px recommended). Test with Facebook Sharing Debugger.',
      priority: 'low'
    }
  },

  crawlerAccessScore: {
    notImplemented: {
      title: 'AI Crawler Access & Availability',
      finding: (score, threshold, evidence) =>
        `Status: Access Issues Detected\n\nAI crawler access issues detected (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points). Your site may be blocking crawlers or experiencing availability issues.`,
      whyItMatters: `If AI crawlers can't access your site reliably, they can't train on your content or recommend you. Poor uptime or restrictive robots.txt = invisible to AI.`,
      priority: 'critical'
    },
    implemented: {
      title: 'AI Crawler Access & Availability',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nAI Crawler Access Confirmed! Your site is accessible, responsive, and not blocking AI crawlers. (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your site is properly configured for AI crawler access. This ensures your content can be indexed and used for training AI models.`,
      nextSteps: 'Monitor uptime and response times. Ensure robots.txt continues to allow AI crawlers (GPTBot, CCBot, etc.). Keep server response times under 500ms.',
      priority: 'low'
    }
  },

  canonicalHreflangScore: {
    notImplemented: {
      title: 'Canonical & Hreflang Tags',
      finding: (score, threshold, evidence) =>
        `Status: Missing or Improper\n\nMissing or improper canonical/hreflang tags (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points).`,
      whyItMatters: `Canonical tags prevent duplicate content issues. Hreflang tags help AI understand language/region targeting. Without these, AI may get confused about which version of your content to cite.`,
      priority: 'medium'
    },
    implemented: {
      title: 'Canonical & Hreflang Tags',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nCanonical and/or Hreflang tags properly implemented! (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your canonical/hreflang implementation helps search engines and AI understand your content structure and avoid duplicate content confusion.`,
      nextSteps: 'Ensure every page has a self-referencing canonical tag. For multi-language sites, verify hreflang tags are bidirectional.',
      priority: 'low'
    }
  },

  indexNowScore: {
    notImplemented: {
      title: 'IndexNow Protocol',
      finding: (score, threshold, evidence) =>
        `Status: Not Implemented\n\nIndexNow protocol not detected (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points).`,
      whyItMatters: `IndexNow instantly notifies search engines when you publish or update content. Without it, search engines may take days or weeks to discover new content.`,
      priority: 'low'
    },
    implemented: {
      title: 'IndexNow Protocol',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nIndexNow protocol detected and active! (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your IndexNow implementation ensures search engines are instantly notified of content changes, leading to faster indexing.`,
      nextSteps: 'Monitor IndexNow submission logs. Ensure it fires for all new/updated content. Verify integration with Bing and Yandex.',
      priority: 'low'
    }
  },

  rssFeedScore: {
    notImplemented: {
      title: 'RSS/Atom Feed',
      finding: (score, threshold, evidence) =>
        `Status: Not Detected\n\nNo RSS or Atom feed detected (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points).`,
      whyItMatters: `RSS feeds provide a machine-readable stream of your content. AI systems and aggregators use feeds to discover and track your latest content.`,
      priority: 'low'
    },
    implemented: {
      title: 'RSS/Atom Feed',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nRSS/Atom feed detected! (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your RSS feed helps AI systems and content aggregators discover and track your latest content automatically.`,
      nextSteps: 'Ensure feed includes full content (not just excerpts). Advertise feed URL in <head> with <link rel="alternate">. Submit to Feedly and other aggregators.',
      priority: 'low'
    }
  },

  // ========================================
  // AI SEARCH READINESS CATEGORY (20%)
  // ========================================

  questionHeadingsScore: {
    notImplemented: {
      title: 'Question-Based Headings',
      finding: (score, threshold, evidence) =>
        `Status: Few Question Headings\n\nFew or no question-based headings detected (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points).`,
      whyItMatters: `AI assistants match user questions to content. Question-based headings (H2s, H3s) signal "this content answers this question." Without them, your answers may be overlooked.`,
      priority: 'high'
    },
    implemented: {
      title: 'Question-Based Headings',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nQuestion Headings Detected! Found ${evidence.questionHeadings || 'multiple'} question-format headings that match common user queries. (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your question-based headings help AI assistants match your content to user queries, significantly increasing citation likelihood.`,
      nextSteps: 'Research common questions in your industry using AlsoAsked or AnswerThePublic. Add more Q&A content. Format headings as natural questions (How, What, Why, When).',
      priority: 'low'
    }
  },

  scannabilityScore: {
    notImplemented: {
      title: 'Content Scannability',
      finding: (score, threshold, evidence) =>
        `Status: Poor Scannability\n\nPoor content scannability detected (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points). Content has long paragraphs, few lists, or lacks formatting.`,
      whyItMatters: `AI assistants prefer scannable content with clear structure. Walls of text are harder to parse and extract. Good scannability = easier AI citation.`,
      priority: 'high'
    },
    implemented: {
      title: 'Content Scannability',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nContent Scannability Confirmed! Your content uses lists, short paragraphs, and clear formatting. (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your scannable content makes it easy for AI to extract key points and cite your content accurately.`,
      nextSteps: 'Continue using bullet points and numbered lists. Keep paragraphs under 3-4 sentences. Use bold for key terms. Add tables for comparisons.',
      priority: 'low'
    }
  },

  readabilityScore: {
    notImplemented: {
      title: 'Content Readability',
      finding: (score, threshold, evidence) =>
        `Status: Too Complex\n\nContent readability issues detected (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points). Flesch reading score: ${evidence.fleschScore || 'low'}.`,
      whyItMatters: `AI assistants prefer clear, concise language that's easy to parse. Complex sentences and jargon make your content harder for AI to understand and summarize.`,
      priority: 'medium'
    },
    implemented: {
      title: 'Content Readability',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nContent Readability Confirmed! Your content uses clear, concise language. Flesch reading score: ${evidence.fleschScore || 'good'}. (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your readable content is easy for AI to parse, understand, and cite accurately.`,
      nextSteps: 'Continue using short sentences (under 20 words). Avoid jargon unless necessary. Use active voice. Break complex topics into digestible chunks.',
      priority: 'low'
    }
  },

  snippetEligibleScore: {
    notImplemented: {
      title: 'Featured Snippet Optimization',
      finding: (score, threshold, evidence) =>
        `Status: Not Snippet-Ready\n\nContent not optimized for featured snippets (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points).`,
      whyItMatters: `Featured snippets are prime real estate in search results and AI responses. Snippet-optimized content is more likely to be cited by AI assistants.`,
      priority: 'medium'
    },
    implemented: {
      title: 'Featured Snippet Optimization',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nSnippet-Ready Content Detected! Your content uses concise answers, lists, and tables that are snippet-eligible. (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your snippet-optimized content is primed for featured snippets and AI citations.`,
      nextSteps: 'Target more snippet opportunities. Use "definition" format for "What is" questions. Use lists for "how-to" questions. Add comparison tables.',
      priority: 'low'
    }
  },

  pillarPagesScore: {
    notImplemented: {
      title: 'Pillar Pages / Topic Clusters',
      finding: (score, threshold, evidence) =>
        `Status: No Pillar Structure\n\nNo pillar page structure detected (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points).`,
      whyItMatters: `Pillar pages establish topical authority. AI assistants look for comprehensive, well-organized content when determining expertise. No pillar pages = weak authority signals.`,
      priority: 'high'
    },
    implemented: {
      title: 'Pillar Pages / Topic Clusters',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nPillar Page Structure Detected! Found ${evidence.pillarPages || 'organized'} topic cluster structure. (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your pillar page structure signals topical authority to AI assistants, making them more confident in recommending you as an expert.`,
      nextSteps: 'Continue building out topic clusters. Link related subtopic pages to pillar pages. Update pillar pages regularly with new insights. Add internal links between clusters.',
      priority: 'low'
    }
  },

  linkedSubpagesScore: {
    notImplemented: {
      title: 'Internal Linking / Subpage Structure',
      finding: (score, threshold, evidence) =>
        `Status: Weak Internal Linking\n\nWeak internal linking structure detected (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points).`,
      whyItMatters: `AI crawlers use internal links to discover and understand the relationship between your content. Poor linking = content gets missed. Good linking = better topic understanding.`,
      priority: 'high'
    },
    implemented: {
      title: 'Internal Linking / Subpage Structure',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nStrong Internal Linking Detected! Found ${evidence.internalLinks || 'well-connected'} pages with good linking structure. (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your internal linking helps AI crawlers discover all your content and understand how topics relate to each other, improving topical authority.`,
      nextSteps: 'Continue linking new content to relevant existing pages. Audit for orphan pages that have no internal links. Use descriptive anchor text.',
      priority: 'low'
    }
  },

  painPointsScore: {
    notImplemented: {
      title: 'Pain Point Addressing',
      finding: (score, threshold, evidence) =>
        `Status: Missing Pain Points\n\nContent doesn't clearly address customer pain points (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points).`,
      whyItMatters: `AI assistants look for content that solves real problems. When users ask "How do I solve X problem?", AI prioritizes content that explicitly addresses pain points.`,
      priority: 'high'
    },
    implemented: {
      title: 'Pain Point Addressing',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nPain Point Content Detected! Your content addresses specific customer problems and challenges. (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your pain point-focused content makes it easy for AI to recommend you when users describe problems you solve.`,
      nextSteps: 'Interview customers to discover new pain points. Create case studies showing problem → solution. Use customer language, not marketing jargon.',
      priority: 'low'
    }
  },

  geoContentScore: {
    notImplemented: {
      title: 'Geographic / Location Content',
      finding: (score, threshold, evidence) =>
        `Status: Missing Geographic Content\n\nLimited or missing geographic content (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points).`,
      whyItMatters: `Local search and "near me" queries are huge. AI assistants need location signals to recommend you for geography-relevant searches.`,
      priority: 'medium'
    },
    implemented: {
      title: 'Geographic / Location Content',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nGeographic Content Detected! Found location information and area-served schema. (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your geographic content helps AI recommend you for location-relevant queries like "best [service] near me" or "top [service] in [city]".`,
      nextSteps: 'Add city/region-specific content pages. Include maps and directions. Create location-based FAQs. Optimize for "near me" searches.',
      priority: 'low'
    }
  },

  // ========================================
  // CONTENT STRUCTURE CATEGORY (15%)
  // ========================================

  headingHierarchyScore: {
    notImplemented: {
      title: 'Heading Hierarchy (H1-H6)',
      finding: (score, threshold, evidence) =>
        `Status: Improper Hierarchy\n\nImproper heading hierarchy detected (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points). Issues: ${evidence.hierarchyIssues?.join(', ') || 'multiple H1s, skipped levels, or missing headings'}.`,
      whyItMatters: `AI assistants use heading structure to understand content organization. Proper hierarchy = better content comprehension. Broken hierarchy = confused AI.`,
      priority: 'high'
    },
    implemented: {
      title: 'Heading Hierarchy (H1-H6)',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nProper Heading Hierarchy Detected! Your pages use semantic heading structure correctly (single H1, logical H2-H6 nesting). (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your heading hierarchy helps AI assistants understand content structure and extract key topics accurately.`,
      nextSteps: 'Maintain this structure on new pages. Use headings that include relevant keywords naturally. Ensure every heading accurately describes the section below.',
      priority: 'low'
    }
  },

  navigationScore: {
    notImplemented: {
      title: 'Navigation Structure',
      finding: (score, threshold, evidence) =>
        `Status: Poor Navigation\n\nPoor navigation structure detected (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points).`,
      whyItMatters: `Clear navigation helps AI understand your site structure and find content efficiently. Poor navigation = harder for AI to map your content.`,
      priority: 'medium'
    },
    implemented: {
      title: 'Navigation Structure',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nClear Navigation Structure Detected! Your site has logical navigation with clear menu structure. (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your navigation structure helps AI crawlers understand your site architecture and content relationships.`,
      nextSteps: 'Add breadcrumb navigation. Include footer navigation. Use descriptive menu labels. Ensure mobile navigation is accessible.',
      priority: 'low'
    }
  },

  entityCuesScore: {
    notImplemented: {
      title: 'Entity Recognition Cues',
      finding: (score, threshold, evidence) =>
        `Status: Missing Entity Cues\n\nLimited entity recognition cues detected (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points).`,
      whyItMatters: `Entity cues (proper nouns, product names, locations) help AI identify key topics in your content. Clear entities = better topic extraction.`,
      priority: 'medium'
    },
    implemented: {
      title: 'Entity Recognition Cues',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nEntity Cues Detected! Found ${evidence.entities || 'multiple'} clearly marked entities (products, services, locations, people). (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your entity markup helps AI identify and extract key information about your business, products, and services.`,
      nextSteps: 'Add more specific entity markup. Use capitalization for proper nouns. Consider adding structured data for key entities (Product, Person, Organization).',
      priority: 'low'
    }
  },

  accessibilityScore: {
    notImplemented: {
      title: 'Accessibility (WCAG)',
      finding: (score, threshold, evidence) =>
        `Status: Accessibility Issues\n\nAccessibility issues detected (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points).`,
      whyItMatters: `Accessibility features (alt text, ARIA labels, semantic HTML) help both screen readers AND AI parse your content. Better accessibility = better AI comprehension.`,
      priority: 'high'
    },
    implemented: {
      title: 'Accessibility (WCAG)',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nAccessibility Features Confirmed! Your site uses proper alt text, ARIA labels, and semantic HTML. (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your accessibility implementation helps both users with disabilities and AI systems understand your content.`,
      nextSteps: 'Continue testing with WAVE or axe DevTools. Ensure all interactive elements are keyboard accessible. Add skip links for navigation.',
      priority: 'low'
    }
  },

  geoMetaScore: {
    notImplemented: {
      title: 'Geographic Schema & Meta Tags',
      finding: (score, threshold, evidence) =>
        `Status: Missing Geographic Schema\n\nMissing geographic schema types (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points). No GeoCoordinates, Place, or PostalAddress schema detected.`,
      whyItMatters: `Search engines and AI assistants cannot accurately determine the geographical relevance of your business, leading to reduced visibility in location-based searches.`,
      priority: 'medium'
    },
    implemented: {
      title: 'Geographic Schema & Meta Tags',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nGeographic Data Detected! Found ${evidence.geoSchemas?.join(', ') || 'PostalAddress, GeoCoordinates'} schema. Your business location is properly marked up. (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your geographic schema helps AI assistants recommend you for location-relevant queries like "best [service] near me" or "top [service] in [city]".`,
      nextSteps: 'Ensure your address is consistent across all pages and external listings (Google Business Profile, Yelp, etc.). Add maps with embedded coordinates.',
      priority: 'low'
    }
  },

  // ========================================
  // TRUST & AUTHORITY CATEGORY (12%)
  // ========================================

  authorBiosScore: {
    notImplemented: {
      title: 'Author Bios / Team Credentials',
      finding: (score, threshold, evidence) =>
        `Status: Missing Author Info\n\nNo author bios or team credentials detected (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points).`,
      whyItMatters: `AI assistants look for E-E-A-T signals (Experience, Expertise, Authority, Trust). Author bios with credentials boost trust and authority signals.`,
      priority: 'high'
    },
    implemented: {
      title: 'Author Bios / Team Credentials',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nAuthor/Team Credentials Detected! Found team information with professional credentials and expertise indicators. (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your team credentials help establish E-E-A-T (Experience, Expertise, Authority, Trust) which AI assistants use to evaluate credibility.`,
      nextSteps: 'Add Person schema markup to author bios. Link to LinkedIn profiles and other professional credentials. Include photos and detailed backgrounds.',
      priority: 'low'
    }
  },

  thoughtLeadershipScore: {
    notImplemented: {
      title: 'Thought Leadership Content',
      finding: (score, threshold, evidence) =>
        `Status: Limited Thought Leadership\n\nLimited thought leadership signals detected (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points).`,
      whyItMatters: `AI assistants prioritize authoritative voices. Thought leadership content (blog posts, whitepapers, original research) signals expertise and builds authority.`,
      priority: 'high'
    },
    implemented: {
      title: 'Thought Leadership Content',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nThought Leadership Detected! Found ${evidence.blogPosts || 'content'} indicating expertise and original insights. (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your thought leadership content signals expertise to AI assistants, increasing confidence in recommending you as an industry expert.`,
      nextSteps: 'Continue publishing original insights. Promote content to earn backlinks and citations. Update older content with fresh perspectives. Guest post on authoritative sites.',
      priority: 'low'
    }
  },

  domainAuthorityScore: {
    notImplemented: {
      title: 'Domain Authority Signals',
      finding: (score, threshold, evidence) =>
        `Status: Low Authority Signals\n\nLow domain authority signals detected (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points).`,
      whyItMatters: `Domain authority (backlinks, content depth, age) influences AI trust. Higher authority sites are more likely to be cited by AI assistants.`,
      priority: 'medium'
    },
    implemented: {
      title: 'Domain Authority Signals',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nStrong Authority Signals Detected! Your domain shows indicators of authority and trustworthiness. (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your domain authority helps AI assistants trust your content and prioritize it in recommendations.`,
      nextSteps: 'Continue earning quality backlinks. Create linkable assets (research, tools, guides). Build relationships with industry publications.',
      priority: 'low'
    }
  },

  thirdPartyProfilesScore: {
    notImplemented: {
      title: 'Third-Party Profiles & Citations',
      finding: (score, threshold, evidence) =>
        `Status: Missing External Profiles\n\nLimited third-party profiles detected (Score: ${score}/100, Target: ${threshold}/100, Gap: ${threshold - score} points).`,
      whyItMatters: `External profiles (LinkedIn, industry directories, review sites) provide validation signals. AI cross-references these to verify your business is legitimate.`,
      priority: 'medium'
    },
    implemented: {
      title: 'Third-Party Profiles & Citations',
      finding: (score, threshold, evidence) =>
        `Status: Excellent! ✅\n\nThird-Party Profiles Detected! Found presence on LinkedIn, industry directories, and/or review platforms. (Score: ${score}/100, Target: ${threshold}/100).`,
      whyItMatters: `Your third-party profiles help AI verify your business legitimacy and build trust signals.`,
      nextSteps: 'Claim all relevant business profiles. Keep NAP (Name, Address, Phone) consistent. Encourage and respond to reviews. Link profiles from your website.',
      priority: 'low'
    }
  },

  // Add remaining subfactors with similar pattern...
  // This file can be extended as needed
};

/**
 * Generic fallback for subfactors not yet in the config
 */
function generateGenericRecommendationText(subfactor, currentScore, threshold, evidence = {}) {
  const isImplemented = currentScore >= threshold;
  const readableName = subfactor
    .replace(/Score$/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .replace(/^./, str => str.toUpperCase());

  if (isImplemented) {
    return {
      title: readableName,
      finding: `Status: Excellent! ✅\n\n${readableName} Detected! Current score: ${currentScore}/100 (Target: ${threshold}/100). This aspect of your AI visibility is properly configured.`,
      whyItMatters: `Your ${readableName.toLowerCase()} implementation meets the recommended threshold for AI visibility.`,
      nextSteps: `Continue monitoring and optimizing this aspect. Look for opportunities to exceed the baseline and set new benchmarks.`,
      priority: 'low',
      status: 'detected_implemented'
    };
  } else {
    return {
      title: `Improve ${readableName}`,
      finding: `Status: Needs Improvement\n\nYour ${readableName.toLowerCase()} score is ${currentScore}/100 (Target: ${threshold}/100, Gap: ${threshold - currentScore} points).`,
      whyItMatters: `Improving ${readableName.toLowerCase()} helps AI assistants better understand and recommend your business.`,
      howToImplement: 'Review the specific findings above. Implement the recommended changes. Rescan to verify improvement.',
      priority: 'medium',
      status: 'not_implemented'
    };
  }
}

/**
 * Get dynamic recommendation text for a subfactor
 */
function getRecommendationText(subfactor, currentScore, threshold, evidence = {}) {
  const config = RECOMMENDATION_TEXT[subfactor];

  if (!config) {
    // Use generic fallback
    return generateGenericRecommendationText(subfactor, currentScore, threshold, evidence);
  }

  const isImplemented = currentScore >= threshold;
  const textConfig = isImplemented ? config.implemented : config.notImplemented;

  return {
    title: textConfig.title,
    finding: typeof textConfig.finding === 'function'
      ? textConfig.finding(currentScore, threshold, evidence)
      : textConfig.finding,
    whyItMatters: textConfig.whyItMatters,
    howToImplement: textConfig.howToImplement || null,
    nextSteps: textConfig.nextSteps || null,
    priority: textConfig.priority || (isImplemented ? 'low' : 'medium'),
    status: isImplemented ? 'detected_implemented' : 'not_implemented'
  };
}

module.exports = {
  RECOMMENDATION_TEXT,
  getRecommendationText,
  generateGenericRecommendationText
};
