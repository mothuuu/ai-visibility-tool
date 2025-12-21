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

  // Crawler (from site-wide crawl)
  const crawler = {
    discoveredSections: crawlResult?.discoveredSections || crawlResult?.siteMetrics?.discoveredSections || {},
    totalDiscoveredUrls: crawlResult?.totalDiscoveredUrls || crawlResult?.allDiscoveredUrls?.length || 0,
    robotsTxt: crawlResult?.robotsTxt || {},
    sitemap: crawlResult?.sitemap || {}
  };

  // siteMetrics (convenience)
  const siteMetrics = {
    discoveredSections: crawler.discoveredSections,
    totalDiscoveredUrls: crawler.totalDiscoveredUrls,
    sitemap: crawler.sitemap,
    robotsTxt: crawler.robotsTxt
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
