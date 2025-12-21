/**
 * Evidence Builder
 *
 * Constructs standardized scan evidence from page extraction and crawl results.
 * Ensures consistent evidence structure across the system.
 */

const { CONTRACT_VERSION, validateEvidence } = require('./evidence-contract');

function buildScanEvidence({ pageExtract, crawlResult, scanContext }) {
  const url = scanContext?.url || pageExtract?.url || '';

  // Navigation with separated sources
  const navigation = {
    keyPages: pageExtract?.navigation?.keyPages || {},
    headerLinks: pageExtract?.navigation?.headerLinks || [],
    navLinks: pageExtract?.navigation?.navLinks || [],
    footerLinks: pageExtract?.navigation?.footerLinks || [],
    allNavLinks: pageExtract?.navigation?.allNavLinks || [],
    totalNavLinks: pageExtract?.navigation?.totalNavLinks || 0,
    hasSemanticNav: pageExtract?.navigation?.hasSemanticNav || false,
    hasHeader: pageExtract?.navigation?.hasHeader || false,
    hasFooter: pageExtract?.navigation?.hasFooter || false
  };

  // Structure with hierarchy
  const structure = {
    hasNav: pageExtract?.structure?.hasNav || false,
    hasHeader: pageExtract?.structure?.hasHeader || false,
    hasFooter: pageExtract?.structure?.hasFooter || false,
    hasMain: pageExtract?.structure?.hasMain || false,
    headingHierarchy: pageExtract?.structure?.headingHierarchy || [],
    headingCount: pageExtract?.structure?.headingCount || 0
  };

  // Content
  const content = {
    paragraphs: pageExtract?.content?.paragraphs || [],
    headings: pageExtract?.content?.headings || {},
    faqs: pageExtract?.content?.faqs || [],
    tabs: pageExtract?.content?.tabs || [],
    wordCount: pageExtract?.content?.wordCount || 0
  };

  // Technical
  const technical = pageExtract?.technical || {};

  // Build sitemap from multiple sources
  const rawSitemap = crawlResult?.sitemap || {};
  const aggregateSitemap = crawlResult?.aggregateEvidence?.sitemap || {};

  const sitemap = {
    detected: rawSitemap.detected || aggregateSitemap.detected || false,
    location: rawSitemap.location || aggregateSitemap.location || null,
    urls: rawSitemap.urls || aggregateSitemap.urls || [],
    totalUrls: rawSitemap.totalUrls || rawSitemap.urls?.length || 0,
    // Merge URL classifications from both sources
    blogUrls: rawSitemap.blogUrls || aggregateSitemap.blogUrls || [],
    faqUrls: rawSitemap.faqUrls || aggregateSitemap.faqUrls || [],
    aboutUrls: rawSitemap.aboutUrls || aggregateSitemap.aboutUrls || [],
    contactUrls: rawSitemap.contactUrls || aggregateSitemap.contactUrls || [],
    pricingUrls: rawSitemap.pricingUrls || aggregateSitemap.pricingUrls || [],
    // Boolean flags
    hasBlogUrls: (rawSitemap.blogUrls?.length > 0) ||
                 (aggregateSitemap.blogUrls?.length > 0) || false,
    hasFaqUrls: (rawSitemap.faqUrls?.length > 0) ||
                (aggregateSitemap.faqUrls?.length > 0) || false
  };

  // Crawler (from site-wide crawl) with merged sitemap signals
  const crawler = {
    discoveredSections: {
      ...(crawlResult?.discoveredSections || crawlResult?.siteMetrics?.discoveredSections || {}),
      hasBlogUrl: crawlResult?.discoveredSections?.hasBlogUrl || sitemap.hasBlogUrls || false,
      hasFaqUrl: crawlResult?.discoveredSections?.hasFaqUrl || sitemap.hasFaqUrls || false,
      hasAboutUrl: crawlResult?.discoveredSections?.hasAboutUrl || (sitemap.aboutUrls?.length > 0) || false,
      hasContactUrl: crawlResult?.discoveredSections?.hasContactUrl || (sitemap.contactUrls?.length > 0) || false,
      blogUrls: crawlResult?.discoveredSections?.blogUrls || sitemap.blogUrls || [],
      faqUrls: crawlResult?.discoveredSections?.faqUrls || sitemap.faqUrls || []
    },
    totalDiscoveredUrls: crawlResult?.totalDiscoveredUrls || crawlResult?.allDiscoveredUrls?.length || 0,
    crawledPageCount: crawlResult?.crawledPageCount || crawlResult?.pageCount || 0,
    robotsTxt: crawlResult?.robotsTxt || { found: false },
    sitemap: sitemap
  };

  // siteMetrics (convenience) with URL counts
  const siteMetrics = {
    discoveredSections: crawler.discoveredSections,
    totalDiscoveredUrls: crawler.totalDiscoveredUrls,
    sitemap: crawler.sitemap,
    robotsTxt: crawler.robotsTxt,
    blogUrlCount: sitemap.blogUrls.length,
    faqUrlCount: sitemap.faqUrls.length
  };

  const evidence = {
    contractVersion: CONTRACT_VERSION,
    url,
    timestamp: scanContext?.timestamp || new Date().toISOString(),
    navigation,
    structure,
    content,
    technical,
    crawler,
    siteMetrics,
    _meta: {
      hasCrawlData: crawler.totalDiscoveredUrls > 0
    }
  };

  // DEBUG: Final evidence structure
  console.log('[EvidenceBuilder] DEBUG - Final evidence:', {
    url: evidence.url,
    hasCrawlData: evidence._meta.hasCrawlData,
    hasBlogUrl: evidence.crawler.discoveredSections?.hasBlogUrl,
    hasFaqUrl: evidence.crawler.discoveredSections?.hasFaqUrl,
    sitemapBlogUrls: evidence.siteMetrics.sitemap?.blogUrls?.length || 0,
    sitemapFaqUrls: evidence.siteMetrics.sitemap?.faqUrls?.length || 0,
    sitemapHasBlogUrls: evidence.siteMetrics.sitemap?.hasBlogUrls,
    sitemapHasFaqUrls: evidence.siteMetrics.sitemap?.hasFaqUrls,
    crawlResultSitemap: !!crawlResult?.sitemap,
    crawlResultBlogUrls: crawlResult?.sitemap?.blogUrls?.length || 0
  });

  return evidence;
}

module.exports = { buildScanEvidence };
