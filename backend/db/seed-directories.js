const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function seedDirectories() {
  try {
    console.log('🔄 Seeding directories table with 50 directories...');

    // Clear existing directories
    await pool.query('TRUNCATE directories RESTART IDENTITY CASCADE;');
    console.log('✅ Cleared existing directories');

    // Insert all directories
    await pool.query(`
      INSERT INTO directories (
        name, slug, website_url, logo_url, description,
        directory_type, tier, region_scope, priority_score,
        submission_mode, submission_url, requires_account, account_creation_url,
        verification_method, requires_customer_account, publishes_phone_publicly, requires_phone_verification,
        required_fields, max_description_length, accepts_logo,
        approval_type, typical_approval_days,
        pricing_model, free_tier_limitations,
        is_active, validation_status, notes
      ) VALUES

      -- =============================================
      -- AI TOOLS DIRECTORIES (15)
      -- =============================================

      -- 1. There's An AI For That (TAAFT)
      (
        'There''s An AI For That', 'theresanaiforthat', 'https://theresanaiforthat.com', NULL,
        'Comprehensive AI tools directory with 10,000+ tools',
        'ai_tools', 1, 'global', 90,
        'manual', 'https://theresanaiforthat.com/submit/', true, 'https://theresanaiforthat.com/submit/',
        'email', false, false, false,
        '["name", "url", "short_description", "category"]', 500, true,
        'review', 3,
        'free', NULL,
        true, 'valid', 'Very popular AI directory, good for visibility'
      ),

      -- 2. Futurepedia
      (
        'Futurepedia', 'futurepedia', 'https://www.futurepedia.io', NULL,
        'AI tools directory updated daily',
        'ai_tools', 1, 'global', 88,
        'manual', 'https://www.futurepedia.io/submit-tool', true, 'https://www.futurepedia.io/submit-tool',
        'email', false, false, false,
        '["name", "url", "short_description", "category"]', 300, true,
        'review', 5,
        'free', NULL,
        true, 'valid', 'High traffic AI directory'
      ),

      -- 3. AI Tool Directory
      (
        'AI Tool Directory', 'aitooldirectory', 'https://aitool.directory', NULL,
        'Curated directory of AI tools and applications',
        'ai_tools', 2, 'global', 70,
        'manual', 'https://aitool.directory/submit', true, 'https://aitool.directory/submit',
        'email', false, false, false,
        '["name", "url", "short_description"]', 500, true,
        'review', 7,
        'free', NULL,
        true, 'valid', NULL
      ),

      -- 4. TopAI.tools
      (
        'TopAI.tools', 'topaitools', 'https://topai.tools', NULL,
        'Directory of top AI tools and software',
        'ai_tools', 2, 'global', 68,
        'manual', 'https://topai.tools/submit', true, 'https://topai.tools/submit',
        'email', false, false, false,
        '["name", "url", "short_description", "category"]', 400, true,
        'review', 5,
        'free', NULL,
        true, 'valid', NULL
      ),

      -- 5. AI Tools Directory
      (
        'AI Tools Directory', 'aitoolsdirectory', 'https://www.aitoolsdirectory.com', NULL,
        'Comprehensive list of AI tools',
        'ai_tools', 2, 'global', 65,
        'manual', 'https://www.aitoolsdirectory.com/submit', true, 'https://www.aitoolsdirectory.com/submit',
        'email', false, false, false,
        '["name", "url", "short_description"]', 500, true,
        'review', 7,
        'free', NULL,
        true, 'valid', NULL
      ),

      -- 6. AIcyclopedia
      (
        'AIcyclopedia', 'aicyclopedia', 'https://www.aicyclopedia.com', NULL,
        'Encyclopedia of AI tools and resources',
        'ai_tools', 2, 'global', 62,
        'manual', 'https://www.aicyclopedia.com/submit', true, 'https://www.aicyclopedia.com/submit',
        'email', false, false, false,
        '["name", "url", "short_description"]', 500, true,
        'review', 7,
        'free', NULL,
        true, 'valid', NULL
      ),

      -- 7. AI Scout
      (
        'AI Scout', 'aiscout', 'https://aiscout.net', NULL,
        'Discover AI tools for any use case',
        'ai_tools', 3, 'global', 55,
        'manual', 'https://aiscout.net/submit/', true, 'https://aiscout.net/submit/',
        'email', false, false, false,
        '["name", "url", "short_description"]', 400, true,
        'review', 7,
        'free', NULL,
        true, 'valid', NULL
      ),

      -- 8. Easy With AI
      (
        'Easy With AI', 'easywith-ai', 'https://easywithai.com', NULL,
        'Find the right AI tool for your needs',
        'ai_tools', 2, 'global', 64,
        'manual', 'https://easywithai.com/submit/', true, 'https://easywithai.com/submit/',
        'email', false, false, false,
        '["name", "url", "short_description", "category"]', 500, true,
        'review', 5,
        'free', NULL,
        true, 'valid', NULL
      ),

      -- 9. Tool Pilot
      (
        'Tool Pilot', 'toolpilot', 'https://www.toolpilot.ai', NULL,
        'AI tools directory with reviews',
        'ai_tools', 2, 'global', 60,
        'manual', 'https://www.toolpilot.ai/submit', true, 'https://www.toolpilot.ai/submit',
        'email', false, false, false,
        '["name", "url", "short_description"]', 400, true,
        'review', 7,
        'free', NULL,
        true, 'valid', NULL
      ),

      -- 10. GPT Store
      (
        'GPT Store Directory', 'gptstore', 'https://gptstore.ai', NULL,
        'Directory of GPTs and AI assistants',
        'ai_tools', 2, 'global', 58,
        'manual', 'https://gptstore.ai/submit', true, 'https://gptstore.ai/submit',
        'email', false, false, false,
        '["name", "url", "short_description"]', 300, true,
        'review', 5,
        'free', NULL,
        true, 'valid', 'Good for GPT-based tools'
      ),

      -- 11. SaaS AI Tools
      (
        'SaaS AI Tools', 'saasaitools', 'https://saasaitools.com', NULL,
        'Directory of AI-powered SaaS tools',
        'ai_tools', 3, 'global', 52,
        'manual', 'https://saasaitools.com/submit-tool/', true, 'https://saasaitools.com/submit-tool/',
        'email', false, false, false,
        '["name", "url", "short_description"]', 500, true,
        'review', 7,
        'free', NULL,
        true, 'valid', NULL
      ),

      -- 12. Insidr AI
      (
        'Insidr AI', 'insidr-ai', 'https://www.insidr.ai', NULL,
        'AI tools and news directory',
        'ai_tools', 2, 'global', 60,
        'manual', 'https://www.insidr.ai/submit-tool/', true, 'https://www.insidr.ai/submit-tool/',
        'email', false, false, false,
        '["name", "url", "short_description", "category"]', 400, true,
        'review', 5,
        'free', NULL,
        true, 'valid', NULL
      ),

      -- 13. AI Depot
      (
        'AI Depot', 'aidepot', 'https://aidepot.co', NULL,
        'Curated AI tools marketplace',
        'ai_tools', 3, 'global', 50,
        'manual', 'https://aidepot.co/submit', true, 'https://aidepot.co/submit',
        'email', false, false, false,
        '["name", "url", "short_description"]', 400, true,
        'review', 7,
        'free', NULL,
        true, 'valid', NULL
      ),

      -- 14. Based Tools
      (
        'Based Tools', 'basedtools', 'https://www.basedtools.ai', NULL,
        'AI tools rated by the community',
        'ai_tools', 3, 'global', 48,
        'manual', 'https://www.basedtools.ai/submit', true, 'https://www.basedtools.ai/submit',
        'email', false, false, false,
        '["name", "url", "short_description"]', 300, true,
        'review', 5,
        'free', NULL,
        true, 'valid', NULL
      ),

      -- 15. Supertools
      (
        'Supertools', 'supertools', 'https://supertools.therundown.ai', NULL,
        'AI tools directory by The Rundown',
        'ai_tools', 2, 'global', 66,
        'manual', 'https://supertools.therundown.ai/submit', true, 'https://supertools.therundown.ai/submit',
        'email', false, false, false,
        '["name", "url", "short_description", "category"]', 500, true,
        'review', 5,
        'free', NULL,
        true, 'valid', 'Associated with popular AI newsletter'
      ),

      -- =============================================
      -- SAAS REVIEW DIRECTORIES (10)
      -- =============================================

      -- 16. G2
      (
        'G2', 'g2', 'https://www.g2.com', NULL,
        'World''s largest B2B software review platform',
        'saas_review', 1, 'global', 95,
        'manual', 'https://www.g2.com/products/new', true, 'https://www.g2.com/seller/sign_up',
        'email', false, false, false,
        '["name", "url", "short_description", "long_description", "logo", "category"]', 1000, true,
        'review', 5,
        'freemium', 'Free: basic listing, collect reviews. Paid: badges, analytics, lead gen',
        true, 'valid', 'Top priority - highest authority SaaS review site'
      ),

      -- 17. Capterra
      (
        'Capterra', 'capterra', 'https://www.capterra.com', NULL,
        'Leading software review and comparison platform',
        'saas_review', 1, 'global', 93,
        'manual', 'https://www.capterra.com/vendors/sign-up', true, 'https://www.capterra.com/vendors/sign-up',
        'email', false, false, false,
        '["name", "url", "short_description", "long_description", "logo", "category"]', 1000, true,
        'review', 7,
        'freemium', 'Free: basic listing. Paid: PPC, featured placement',
        true, 'valid', 'Part of Gartner Digital Markets'
      ),

      -- 18. TrustRadius
      (
        'TrustRadius', 'trustradius', 'https://www.trustradius.com', NULL,
        'In-depth B2B software reviews',
        'saas_review', 1, 'global', 88,
        'manual', 'https://www.trustradius.com/vendor-signup', true, 'https://www.trustradius.com/vendor-signup',
        'email', false, false, false,
        '["name", "url", "short_description", "long_description", "logo"]', 1500, true,
        'review', 7,
        'freemium', 'Free: basic listing. Paid: buyer intent data, enhanced profile',
        true, 'valid', 'High-quality detailed reviews'
      ),

      -- 19. GetApp
      (
        'GetApp', 'getapp', 'https://www.getapp.com', NULL,
        'Business software discovery platform',
        'saas_review', 1, 'global', 85,
        'manual', 'https://www.getapp.com/vendor-signup', true, 'https://www.getapp.com/vendor-signup',
        'email', false, false, false,
        '["name", "url", "short_description", "logo", "category"]', 800, true,
        'review', 7,
        'freemium', 'Free: basic listing. Paid: category ads, featured',
        true, 'valid', 'Part of Gartner Digital Markets'
      ),

      -- 20. Software Advice
      (
        'Software Advice', 'software-advice', 'https://www.softwareadvice.com', NULL,
        'Software recommendations and reviews',
        'saas_review', 1, 'global', 84,
        'manual', 'https://www.softwareadvice.com/vendors/', true, 'https://www.softwareadvice.com/vendors/',
        'email', false, false, false,
        '["name", "url", "short_description", "logo", "category"]', 800, true,
        'review', 7,
        'freemium', 'Free: basic listing. Paid: lead gen, featured',
        true, 'valid', 'Part of Gartner Digital Markets'
      ),

      -- 21. SaaSHub
      (
        'SaaSHub', 'saashub', 'https://www.saashub.com', NULL,
        'Independent SaaS marketplace',
        'saas_review', 2, 'global', 72,
        'manual', 'https://www.saashub.com/submit', true, 'https://www.saashub.com/submit',
        'email', false, false, false,
        '["name", "url", "short_description"]', 500, true,
        'review', 5,
        'free', NULL,
        true, 'valid', 'Good for alternatives discovery'
      ),

      -- 22. Crozdesk
      (
        'Crozdesk', 'crozdesk', 'https://crozdesk.com', NULL,
        'Business software discovery engine',
        'saas_review', 2, 'global', 68,
        'manual', 'https://crozdesk.com/for-vendors', true, 'https://crozdesk.com/for-vendors',
        'email', false, false, false,
        '["name", "url", "short_description", "logo"]', 600, true,
        'review', 7,
        'freemium', 'Free: basic listing. Paid: premium features',
        true, 'valid', NULL
      ),

      -- 23. SourceForge
      (
        'SourceForge', 'sourceforge', 'https://sourceforge.net', NULL,
        'Open source and business software directory',
        'saas_review', 2, 'global', 75,
        'manual', 'https://sourceforge.net/create/', true, 'https://sourceforge.net/auth/',
        'email', false, false, false,
        '["name", "url", "short_description", "category"]', 1000, true,
        'review', 3,
        'free', NULL,
        true, 'valid', 'Good domain authority, also for open source'
      ),

      -- 24. Slashdot
      (
        'Slashdot Software', 'slashdot', 'https://slashdot.org', NULL,
        'Tech news and software reviews',
        'saas_review', 2, 'global', 70,
        'manual', 'https://sourceforge.net/software/vendors/', true, 'https://sourceforge.net/auth/',
        'email', false, false, false,
        '["name", "url", "short_description"]', 500, true,
        'review', 5,
        'freemium', 'Free: basic listing. Paid: featured reviews',
        true, 'valid', 'Connected to SourceForge'
      ),

      -- 25. SoftwareSuggest
      (
        'SoftwareSuggest', 'softwaresuggest', 'https://www.softwaresuggest.com', NULL,
        'Software discovery platform for businesses',
        'saas_review', 2, 'global', 65,
        'manual', 'https://www.softwaresuggest.com/vendors', true, 'https://www.softwaresuggest.com/vendors',
        'email', false, false, false,
        '["name", "url", "short_description", "logo", "category"]', 800, true,
        'review', 7,
        'freemium', 'Free: basic listing. Paid: leads, featured',
        true, 'valid', 'Strong in India/Asia market'
      ),

      -- =============================================
      -- STARTUP DIRECTORIES (8)
      -- =============================================

      -- 26. Product Hunt
      (
        'Product Hunt', 'producthunt', 'https://www.producthunt.com', NULL,
        'Platform to launch and discover new products',
        'startup', 1, 'global', 92,
        'editorial', 'https://www.producthunt.com/posts/new', true, 'https://www.producthunt.com/login',
        'email', false, false, false,
        '["name", "url", "short_description", "tagline", "logo"]', 260, true,
        'editorial', 1,
        'free', NULL,
        true, 'valid', 'Best for launch day visibility - plan timing carefully'
      ),

      -- 27. Crunchbase
      (
        'Crunchbase', 'crunchbase', 'https://www.crunchbase.com', NULL,
        'Platform for finding business information about companies',
        'startup', 1, 'global', 90,
        'manual', 'https://www.crunchbase.com/add-new', true, 'https://www.crunchbase.com/register',
        'email', false, false, false,
        '["name", "url", "short_description", "long_description", "logo", "founded_date"]', 500, true,
        'review', 5,
        'freemium', 'Free: basic profile. Paid: pro features, exports',
        true, 'valid', 'Important for startup credibility'
      ),

      -- 28. AngelList / Wellfound
      (
        'Wellfound (AngelList)', 'wellfound', 'https://wellfound.com', NULL,
        'Startup jobs and company profiles',
        'startup', 1, 'global', 85,
        'manual', 'https://wellfound.com/company/new', true, 'https://wellfound.com/login',
        'email', false, false, false,
        '["name", "url", "short_description", "logo"]', 500, true,
        'review', 3,
        'free', NULL,
        true, 'valid', 'Good for hiring + visibility'
      ),

      -- 29. BetaList
      (
        'BetaList', 'betalist', 'https://betalist.com', NULL,
        'Discover and get early access to startups',
        'startup', 2, 'global', 75,
        'editorial', 'https://betalist.com/submit', true, 'https://betalist.com/users/sign_up',
        'email', false, false, false,
        '["name", "url", "short_description", "tagline"]', 300, true,
        'editorial', 7,
        'freemium', 'Free: submit and wait. Paid: skip queue',
        true, 'valid', 'Good for pre-launch/beta products'
      ),

      -- 30. Launching Next
      (
        'Launching Next', 'launchingnext', 'https://www.launchingnext.com', NULL,
        'Startup launch platform',
        'startup', 2, 'global', 65,
        'manual', 'https://www.launchingnext.com/submit/', true, 'https://www.launchingnext.com/submit/',
        'email', false, false, false,
        '["name", "url", "short_description"]', 400, true,
        'review', 5,
        'free', NULL,
        true, 'valid', NULL
      ),

      -- 31. StartupBase
      (
        'StartupBase', 'startupbase', 'https://startupbase.io', NULL,
        'Discover startups and tools',
        'startup', 3, 'global', 55,
        'manual', 'https://startupbase.io/submit', true, 'https://startupbase.io/submit',
        'email', false, false, false,
        '["name", "url", "short_description"]', 300, true,
        'review', 5,
        'free', NULL,
        true, 'valid', NULL
      ),

      -- 32. SideProjectors
      (
        'SideProjectors', 'sideprojectors', 'https://www.sideprojectors.com', NULL,
        'Marketplace for side projects',
        'startup', 3, 'global', 50,
        'manual', 'https://www.sideprojectors.com/project/new', true, 'https://www.sideprojectors.com/auth/register',
        'email', false, false, false,
        '["name", "url", "short_description"]', 500, true,
        'review', 3,
        'free', NULL,
        true, 'valid', 'Good for side projects/MVPs'
      ),

      -- 33. Startup Stash
      (
        'Startup Stash', 'startupstash', 'https://startupstash.com', NULL,
        'Curated directory of startup resources and tools',
        'startup', 2, 'global', 68,
        'manual', 'https://startupstash.com/add-listing/', true, 'https://startupstash.com/add-listing/',
        'email', false, false, false,
        '["name", "url", "short_description", "category"]', 400, true,
        'review', 7,
        'free', NULL,
        true, 'valid', 'Good resource directory'
      ),

      -- =============================================
      -- BUSINESS CITATION / LOCAL (8)
      -- =============================================

      -- 34. Google Business Profile
      (
        'Google Business Profile', 'google-business', 'https://www.google.com/business/', NULL,
        'Manage your business presence on Google',
        'business_citation', 1, 'global', 98,
        'manual', 'https://business.google.com/create', true, 'https://accounts.google.com',
        'advanced', true, true, true,
        '["name", "url", "short_description", "phone", "address", "category"]', 750, true,
        'review', 14,
        'free', NULL,
        true, 'valid', 'REQUIRES CUSTOMER ACCOUNT - verification by postcard/phone'
      ),

      -- 35. Yelp
      (
        'Yelp', 'yelp', 'https://www.yelp.com', NULL,
        'Local business reviews and recommendations',
        'business_citation', 1, 'us', 92,
        'manual', 'https://biz.yelp.com/claim', true, 'https://biz.yelp.com/signup',
        'phone', true, true, true,
        '["name", "url", "short_description", "phone", "address", "category"]', 500, true,
        'review', 7,
        'freemium', 'Free: basic listing. Paid: ads, enhanced profile',
        true, 'valid', 'REQUIRES CUSTOMER ACCOUNT - phone verification'
      ),

      -- 36. Bing Places
      (
        'Bing Places', 'bing-places', 'https://www.bingplaces.com', NULL,
        'Manage your business on Bing',
        'business_citation', 1, 'global', 85,
        'manual', 'https://www.bingplaces.com/Dashboard', true, 'https://www.bingplaces.com',
        'email', true, true, false,
        '["name", "url", "short_description", "phone", "address", "category"]', 500, true,
        'review', 7,
        'free', NULL,
        true, 'valid', 'REQUIRES CUSTOMER ACCOUNT - Microsoft account needed'
      ),

      -- 37. Apple Business Connect
      (
        'Apple Business Connect', 'apple-business', 'https://businessconnect.apple.com', NULL,
        'Manage your business on Apple Maps',
        'business_citation', 1, 'global', 88,
        'manual', 'https://businessconnect.apple.com', true, 'https://appleid.apple.com',
        'phone', true, true, true,
        '["name", "url", "short_description", "phone", "address", "category"]', 500, true,
        'review', 7,
        'free', NULL,
        true, 'valid', 'REQUIRES CUSTOMER ACCOUNT - Apple ID required'
      ),

      -- 38. Foursquare
      (
        'Foursquare', 'foursquare', 'https://foursquare.com', NULL,
        'Location-based business listings',
        'business_citation', 2, 'global', 70,
        'manual', 'https://foursquare.com/add-place', true, 'https://foursquare.com/login',
        'email', false, true, false,
        '["name", "url", "short_description", "phone", "address"]', 400, true,
        'instant', 1,
        'free', NULL,
        true, 'valid', NULL
      ),

      -- 39. Hotfrog
      (
        'Hotfrog', 'hotfrog', 'https://www.hotfrog.com', NULL,
        'Business directory for local businesses',
        'business_citation', 3, 'global', 55,
        'manual', 'https://www.hotfrog.com/AddYourBusiness.aspx', true, 'https://www.hotfrog.com/AddYourBusiness.aspx',
        'email', false, true, false,
        '["name", "url", "short_description", "phone", "address"]', 500, true,
        'instant', 1,
        'free', NULL,
        true, 'valid', NULL
      ),

      -- 40. Manta
      (
        'Manta', 'manta', 'https://www.manta.com', NULL,
        'Small business directory',
        'business_citation', 3, 'us', 58,
        'manual', 'https://www.manta.com/claim', true, 'https://www.manta.com/claim',
        'email', false, true, false,
        '["name", "url", "short_description", "phone", "address"]', 500, true,
        'review', 3,
        'freemium', 'Free: basic listing. Paid: enhanced features',
        true, 'valid', 'US-focused'
      ),

      -- 41. Cylex
      (
        'Cylex', 'cylex', 'https://www.cylex.us.com', NULL,
        'Online business directory',
        'business_citation', 3, 'us', 52,
        'manual', 'https://www.cylex.us.com/add-company.html', true, 'https://www.cylex.us.com/add-company.html',
        'email', false, true, false,
        '["name", "url", "short_description", "phone", "address"]', 500, true,
        'review', 3,
        'free', NULL,
        true, 'valid', NULL
      ),

      -- =============================================
      -- DEV REGISTRY / TOOLS (5)
      -- =============================================

      -- 42. GitHub
      (
        'GitHub', 'github', 'https://github.com', NULL,
        'Code hosting and version control platform',
        'dev_registry', 1, 'global', 95,
        'manual', 'https://github.com/new', true, 'https://github.com/signup',
        'email', false, false, false,
        '["name", "short_description"]', 250, false,
        'instant', 1,
        'freemium', 'Free: public repos. Paid: private repos, advanced features',
        true, 'valid', 'Essential for open source visibility'
      ),

      -- 43. DevHunt
      (
        'DevHunt', 'devhunt', 'https://devhunt.org', NULL,
        'Product Hunt for developer tools',
        'dev_registry', 2, 'global', 72,
        'editorial', 'https://devhunt.org/submit', true, 'https://devhunt.org/submit',
        'email', false, false, false,
        '["name", "url", "short_description", "tagline"]', 300, true,
        'editorial', 3,
        'free', NULL,
        true, 'valid', 'Good for dev-focused products'
      ),

      -- 44. StackShare
      (
        'StackShare', 'stackshare', 'https://stackshare.io', NULL,
        'Tech stack and tools discovery platform',
        'dev_registry', 2, 'global', 75,
        'manual', 'https://stackshare.io/submit', true, 'https://stackshare.io/signup',
        'email', false, false, false,
        '["name", "url", "short_description", "category"]', 500, true,
        'review', 5,
        'free', NULL,
        true, 'valid', 'Good for showing tech stack'
      ),

      -- 45. LibHunt
      (
        'LibHunt', 'libhunt', 'https://www.libhunt.com', NULL,
        'Trending open-source projects and libraries',
        'dev_registry', 3, 'global', 60,
        'manual', 'https://www.libhunt.com/submit', true, 'https://www.libhunt.com/submit',
        'email', false, false, false,
        '["name", "url", "short_description"]', 300, true,
        'review', 5,
        'free', NULL,
        true, 'valid', 'For open-source projects'
      ),

      -- 46. Open Source Alternative
      (
        'Open Source Alternative', 'opensourcealternative', 'https://www.opensourcealternative.to', NULL,
        'Open source alternatives to popular software',
        'dev_registry', 3, 'global', 55,
        'pull_request', 'https://github.com/btw-so/open-source-alternatives', true, 'https://github.com',
        'none', false, false, false,
        '["name", "url", "short_description"]', 200, false,
        'review', 7,
        'free', NULL,
        true, 'valid', 'Submit via GitHub PR'
      ),

      -- =============================================
      -- MARKETPLACE / OTHER (4)
      -- =============================================

      -- 47. AlternativeTo
      (
        'AlternativeTo', 'alternativeto', 'https://alternativeto.net', NULL,
        'Crowdsourced software recommendations',
        'marketplace', 1, 'global', 88,
        'manual', 'https://alternativeto.net/software/new/', true, 'https://alternativeto.net/signup/',
        'email', false, false, false,
        '["name", "url", "short_description"]', 500, true,
        'review', 3,
        'free', NULL,
        true, 'valid', 'Great for alternative discovery - high traffic'
      ),

      -- 48. AppSumo Marketplace
      (
        'AppSumo Marketplace', 'appsumo', 'https://appsumo.com', NULL,
        'Deals platform for software products',
        'marketplace', 1, 'global', 80,
        'editorial', 'https://sell.appsumo.com', true, 'https://appsumo.com/account/login/',
        'email', false, false, false,
        '["name", "url", "short_description", "long_description", "logo"]', 1000, true,
        'editorial', 14,
        'freemium', 'Listing free, but most do paid deals',
        true, 'valid', 'Editorial review required - good for LTD launches'
      ),

      -- 49. Remote Tools
      (
        'Remote Tools', 'remotetools', 'https://www.remote.tools', NULL,
        'Tools for remote work and teams',
        'marketplace', 2, 'global', 62,
        'manual', 'https://www.remote.tools/submit', true, 'https://www.remote.tools/submit',
        'email', false, false, false,
        '["name", "url", "short_description", "category"]', 400, true,
        'review', 5,
        'free', NULL,
        true, 'valid', 'Good for remote/collaboration tools'
      ),

      -- 50. Startup Buffer
      (
        'Startup Buffer', 'startupbuffer', 'https://startupbuffer.com', NULL,
        'Startup promotion and discovery platform',
        'marketplace', 3, 'global', 50,
        'manual', 'https://startupbuffer.com/site/submit', true, 'https://startupbuffer.com/site/register',
        'email', false, false, false,
        '["name", "url", "short_description"]', 300, true,
        'review', 5,
        'free', NULL,
        true, 'valid', NULL
      );
    `);

    console.log('✅ Inserted 50 directories');

    // Update timestamps
    await pool.query('UPDATE directories SET last_validated_at = NOW(), updated_at = NOW();');
    console.log('✅ Updated timestamps');

    // Verify the seed
    console.log('\n📊 Verification:');

    const typeCount = await pool.query(`
      SELECT directory_type, COUNT(*) as count
      FROM directories
      GROUP BY directory_type
      ORDER BY count DESC
    `);
    console.log('\nBy Type:');
    typeCount.rows.forEach(row => {
      console.log(`  ${row.directory_type}: ${row.count}`);
    });

    const tierCount = await pool.query(`
      SELECT tier, COUNT(*) as count
      FROM directories
      GROUP BY tier
      ORDER BY tier
    `);
    console.log('\nBy Tier:');
    tierCount.rows.forEach(row => {
      console.log(`  Tier ${row.tier}: ${row.count}`);
    });

    const pricingCount = await pool.query(`
      SELECT pricing_model, COUNT(*) as count
      FROM directories
      GROUP BY pricing_model
    `);
    console.log('\nBy Pricing:');
    pricingCount.rows.forEach(row => {
      console.log(`  ${row.pricing_model}: ${row.count}`);
    });

    const totalCount = await pool.query('SELECT COUNT(*) as count FROM directories');
    console.log(`\nTotal directories: ${totalCount.rows[0].count}`);

    console.log('\n🎉 Directories seeding complete!');
    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    await pool.end();
    process.exit(1);
  }
}

seedDirectories();
