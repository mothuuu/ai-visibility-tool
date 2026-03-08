// backend/analyzers/recommendation-engine/jsonld.js
/**
 * PROGRAMMATIC JSON-LD BUILDER
 * Generates schema markup using extracted facts - NO PLACEHOLDERS
 */

function absolute(origin, maybeUrl) {
  try { 
    return new URL(maybeUrl, origin).href; 
  } catch { 
    return undefined; 
  }
}

function buildCoreJsonLd(pageUrl, facts) {
  const origin = new URL(pageUrl).origin;
  const brand = facts.find(f => f.name === 'brand')?.value || facts.find(f => f.name === 'site_name')?.value;
  const logo = facts.find(f => f.name === 'logo')?.value;
  const desc = facts.find(f => f.name === 'description')?.value;
  const socials = facts.find(f => f.name === 'social_links')?.value || [];
  
  const orgId = `${origin}/#organization`;
  const siteId = `${origin}/#website`;
  const pageId = `${pageUrl.replace(/#.*$/, '')}/#webpage`;
  
  const Organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": orgId,
    "name": brand,
    "url": origin,
    ...(logo ? { "logo": { "@type": "ImageObject", "url": absolute(origin, logo) }} : {}),
    ...(Array.isArray(socials) && socials.length ? { "sameAs": socials } : {})
  };
  
  const WebSite = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": siteId,
    "url": origin,
    ...(brand ? { "name": brand } : {}),
    "publisher": { "@id": orgId }
  };
  
  const WebPage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": pageId,
    "url": pageUrl,
    "isPartOf": { "@id": siteId },
    ...(desc ? { "description": desc } : {})
  };
  
  return [Organization, WebSite, WebPage];
}

function buildFAQJsonLd(pageUrl, qaPairs = []) {
  if (!qaPairs.length) return null;
  
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${pageUrl.replace(/#.*$/, '')}/#faq`,
    "mainEntity": qaPairs.map(({q, a}) => ({
      "@type": "Question",
      "name": q,
      "acceptedAnswer": { 
        "@type": "Answer", 
        "text": a 
      }
    }))
  };
}

module.exports = { 
  buildCoreJsonLd, 
  buildFAQJsonLd 
};