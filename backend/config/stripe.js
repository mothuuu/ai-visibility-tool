const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    interval: 'month',
    features: [
      '2 scans per month',
      'Homepage only (1 page)',
      'Basic AI visibility score',
      'Top 3 recommendations'
    ]
  },
  diy: {
    name: 'DIY/Starter',
    price: 2900, // $29.00
    interval: 'month',
    priceId: process.env.STRIPE_STARTER_PRICE_ID,
    features: [
      '10 scans per month',
      'Homepage + 4 pages YOU choose (5 total)',
      'Page-level TODO lists',
      'Progress tracking',
      'Basic JSON-LD export',
      'Combined recommendations',
      'Email support'
    ]
  },
  pro: {
    name: 'Pro',
    price: 9900, // $99.00
    interval: 'month',
    priceId: process.env.STRIPE_PRO_PRICE_ID,
    features: [
      '50 scans per month',
      'Up to 25 pages per scan',
      'Brand Visibility Index',
      'Competitor benchmarking (3 domains)',
      'Outside-in crawl (PR, reviews, social)',
      'Advanced JSON-LD pack',
      'Knowledge Graph fields',
      'Live dashboard & analytics',
      'PDF export',
      'Priority email support'
    ]
  },
  enterprise: {
    name: 'Enterprise',
    price: 24900, // $249.00
    interval: 'month',
    priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID,
    features: [
      '200 scans per month',
      'Track 100 pages per domain',
      'Monitor 10 competitors',
      'Media & social monitoring',
      'Thought leadership tracking',
      'White-label reports',
      'API access',
      'Team members (up to 5)',
      'Dedicated account manager',
      'Priority phone support'
    ]
  },
  agency: {
    name: 'Agency',
    price: 49900, // $499.00
    interval: 'month',
    priceId: process.env.STRIPE_AGENCY_PRICE_ID,
    features: [
      'Unlimited scans',
      'Unlimited pages tracked',
      'Unlimited competitors',
      'Multi-client dashboard',
      'White-label everything',
      'Custom branding',
      'Full API access',
      'Team members (unlimited)',
      'Reseller pricing',
      'Dedicated support team',
      'Custom integrations'
    ]
  }
};

module.exports = { stripe, PLANS };