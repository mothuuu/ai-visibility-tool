'use strict';

/**
 * Citation domain classification — config-driven typing of the cited-source
 * landscape for the Opportunity evidence pass.
 *
 * THREE classes (one domain → exactly one class). Brand-owned domains are
 * collapsed UPSTREAM (in opportunityEvidence) before classification, so this
 * module only decides among:
 *
 *   social_junk : social networks, OTAs/aggregators, generic UGC/reference —
 *                 real demand signal but NOT competitive diversity.
 *   media       : authoritative editorial / luxury press — coverage, not a
 *                 competitor a brand "wins" the listing from.
 *   competitor  : DEFAULT — brokerages, developments, listing aggregators, and
 *                 anything not brand / social / media. The real third-party field.
 *
 * Precedence applied by classifyDomain(): social_junk → media → competitor.
 * (Brand precedence is handled before this is called.)
 *
 * Lists are plain config — extend freely; match is by exact REGISTRABLE domain
 * (eTLD+1), the same granularity the evidence pass stores.
 */

// social / aggregator / OTA / generic UGC + reference
const SOCIAL_JUNK = new Set([
  // social networks / UGC
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
  'youtube.com', 'linkedin.com', 'pinterest.com', 'reddit.com', 'quora.com',
  'threads.net', 'medium.com', 'snapchat.com', 'tumblr.com',
  // reviews / jobs / generic directories
  'yelp.com', 'trustpilot.com', 'glassdoor.com', 'indeed.com', 'foursquare.com',
  // travel OTAs / aggregators
  'tripadvisor.com', 'expedia.com', 'booking.com', 'hotels.com', 'trivago.com',
  'kayak.com', 'agoda.com', 'priceline.com', 'airbnb.com', 'vrbo.com',
  'hostelworld.com', 'makemytrip.com', 'orbitz.com', 'travelocity.com',
  'hotwire.com', 'skyscanner.net', 'momondo.com',
  // generic reference
  'wikipedia.org', 'wikimedia.org',
]);

// authoritative media / editorial / luxury press (seeded from real 174 dumps)
const MEDIA = new Set([
  'forbes.com', 'robbreport.com', 'mansionglobal.com', 'architecturaldigest.com',
  'bloomberg.com', 'hauteliving.com', 'hauteresidence.com', 'foratravel.com',
  'wsj.com', 'ft.com', 'cnbc.com', 'businessinsider.com', 'barrons.com',
  'fortune.com', 'travelandleisure.com', 'cntraveler.com', 'departures.com',
  'townandcountrymag.com', 'elledecor.com', 'veranda.com', 'dwell.com',
  'luxurylaunches.com', 'dujour.com', 'galeriemagazine.com',
]);

const CLASSES = Object.freeze(['social_junk', 'media', 'competitor']);

/**
 * Classify a registrable domain (brand already excluded by the caller).
 * Precedence: social_junk → media → competitor (default).
 * @param {string|null} domain registrable domain (eTLD+1)
 * @returns {'social_junk'|'media'|'competitor'}
 */
function classifyDomain(domain) {
  if (!domain) return 'competitor';
  if (SOCIAL_JUNK.has(domain)) return 'social_junk';
  if (MEDIA.has(domain)) return 'media';
  return 'competitor';
}

module.exports = { SOCIAL_JUNK, MEDIA, CLASSES, classifyDomain };
