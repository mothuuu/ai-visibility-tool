const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');

// Initialize Anthropic client
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// ⚠️ CRITICAL: This knowledge base contains LEGALLY BINDING pricing information
// Last updated with verified pricing from product team
// Incorrect pricing information can result in legal liability

const knowledgeBase = {
    product: {
        name: "Visible2AI",
        tagline: "Make Your Website Visible to AI Search Engines",
        description: "Visible2AI is the first AI Visibility Score tool that helps businesses optimize their websites to appear in AI-powered search results like ChatGPT, Perplexity, Claude, and Google AI Overviews.",
        support_email: "aivisibility@xeo.marketing"
    },

    plans: {
        free: {
            name: "Free Plan",
            monthlyPrice: "$0",
            annualPrice: "$0",
            status: "Active",
            features: [
                "2 scans per month (resets on the 1st)",
                "Homepage-only scanning (1 page)",
                "AI Visibility Score (0-1000 points)",
                "8-category breakdown (Schema, Entities, FAQs, Citations, Crawlability, Speed, Trust, AEO Content)",
                "Top 3 priority recommendations",
                "Email verification required"
            ],
            notIncluded: [
                "Multi-page scanning",
                "Code snippets",
                "FAQ schema generation",
                "PDF export",
                "Page-level action items",
                "Competitor tracking"
            ],
            perfectFor: "Testing the tool and getting a quick snapshot of your homepage visibility"
        },
        diy: {
            name: "DIY Plan",
            monthlyPrice: "$29/month",
            annualPrice: "$19/month (billed annually at $228/year)",
            annualSavings: "Save 34% with annual billing",
            status: "Active - Available Now",
            launchPromo: "🚀 LAUNCH SPECIAL: Use code at checkout for discount on monthly plans (limited time)",
            features: [
                "25 scans per month (resets on the 1st)",
                "Scan 5 pages per domain (homepage + 4 additional pages)",
                "Unlimited rescans of your selected 5 pages",
                "Choose which pages to track",
                "Up to 15 detailed recommendations",
                "Page-level action items",
                "Copy-paste ready code snippets",
                "Industry-specific FAQ schema (JSON-LD)",
                "Evidence-based findings",
                "JSON-LD export for structured data",
                "Progress tracking across all 5 pages",
                "Historical comparison",
                "Score trend analysis",
                "Track up to 2 competitor websites (score-only view)",
                "Cancel anytime",
                "Monthly or annual billing via Stripe"
            ],
            limits: [
                "All pages must be from the SAME domain",
                "Homepage is locked and required",
                "Competitor tracking: 2 competitors, score-only (no detailed breakdown)",
                "Unused scans don't rollover - fresh 25 scans on 1st of each month"
            ],
            competitorAnalysis: {
                slots: 2,
                details: "Score-only view - see their overall AI Visibility Score (0-1000) but not category breakdowns or recommendations"
            },
            perfectFor: "Small businesses, startups, consultants tracking key pages"
        },
        pro: {
            name: "Pro Plan",
            monthlyPrice: "$149/month",
            annualPrice: "$99/month (billed annually at $1,188/year)",
            annualSavings: "Save 34% with annual billing",
            status: "COMING SOON - Join Waitlist",
            expectedLaunch: "Q1 2026",
            features: [
                "Everything in DIY, PLUS:",
                "50 scans per month (vs. 25 in DIY)",
                "Track 25 pages per domain (homepage + 24 additional pages)",
                "Website Visibility Index (0-1000)",
                "Brand Visibility Index (0-1000) - measures how AI engines perceive your brand",
                "Up to 25 detailed recommendations",
                "Track up to 3 competitor websites (vs. 2 in DIY)",
                "Full competitor category breakdowns",
                "Side-by-side comparison dashboard",
                "Competitive gap analysis (what they're doing better)",
                "Benchmark against industry leaders",
                "Outside-in crawl (PR mentions, reviews, social signals)",
                "PDF export for reports",
                "Priority support"
            ],
            competitorAnalysis: {
                slots: 3,
                details: "Full analysis - see complete category breakdowns, side-by-side comparisons, and gap analysis showing exactly what competitors do better"
            },
            perfectFor: "Mid-size businesses, agencies managing single clients, brands focused on AI discoverability"
        },
        enterprise: {
            name: "Enterprise Plan",
            monthlyPrice: "$499/month",
            annualPrice: "$349/month (billed annually at $4,188/year)",
            annualSavings: "Save 30% with annual billing",
            status: "COMING SOON - Join Waitlist",
            expectedLaunch: "Mid 2026",
            features: [
                "Everything in Pro × 10 Domains",
                "Track 10 separate client domains",
                "All Pro features PER domain (50 scans, 25 pages, dual indexes)",
                "Unified agency dashboard",
                "Team member access controls",
                "Client management tools",
                "Bulk operations",
                "Branded PDF reports",
                "Custom domain mapping",
                "Agency branding options",
                "3 competitors per domain",
                "Role-based permissions (view-only, editor, admin)"
            ],
            perfectFor: "Marketing agencies, MSPs, enterprise consultants managing multiple client domains",
            notes: "For more than 10 domains, contact aivisibility@xeo.marketing for custom enterprise pricing"
        }
    },

    features: {
        scanQuota: "Free plan: 2 scans/month, DIY plan: 25 scans/month, Pro plan: 50 scans/month, Enterprise plan: 50 scans/month per domain. Scans reset on the 1st of each month and do NOT rollover.",

        pageScanning: "Free: Homepage only (1 page). DIY: 5 pages per domain (homepage + 4 you choose). Pro: 25 pages per domain. Enterprise: 25 pages per domain × 10 domains. All pages must be from the SAME domain. Homepage is always locked and required for paid plans.",

        scoring: "Your AI Visibility Score is calculated from 0-1000 based on how well AI systems can understand and present your content across 8 categories: Schema, Entities, FAQs, Citations, Crawlability, Speed, Trust, and AEO Content. Higher scores mean better AI search visibility in ChatGPT, Perplexity, Claude, and Google AI Overviews.",

        recommendations: "Free: Top 3 priority recommendations. DIY: Up to 15 detailed recommendations with code snippets. Pro: Up to 25 detailed recommendations. We provide both domain-wide and page-level action items tailored to your actual content.",

        competitorTracking: "Free: None. DIY: 2 competitors (score-only, no breakdown). Pro: 3 competitors (full category breakdowns + gap analysis). Enterprise: 3 competitors per domain.",

        export: "Free & DIY: JSON-LD export only. Pro & Enterprise: JSON-LD + PDF export for comprehensive reporting.",

        dualIndexes: "Pro and Enterprise plans include both Website Visibility Index (how well AI can understand your site) and Brand Visibility Index (how AI engines perceive your brand across the web).",

        waitlist: "Pro ($99-$149/mo) launches Q1 2026. Enterprise ($349-$499/mo) launches mid 2026. Join waitlist to be notified first and get early-bird pricing."
    },

    dashboardNavigation: {
        scanHistory: "Click 'View Scan History' or scroll down to see all your past scans. Each scan shows the URL, date, and score.",

        newScan: "Enter any website URL in the dashboard search box and click 'Analyze Website' to start a new scan.",

        results: "After a scan completes, click 'View Results' to see your score, category breakdown, and recommendations.",

        progress: "Use the 'Track Progress' button on results page to see your implementation progress statistics.",

        upgrade: "Click the 'Upgrade' button in the navigation or dashboard to view and compare all available plans."
    },

    accountManagement: {
        passwordReset: "Visit the login page and click 'Forgot Password'. Enter your email address, and we'll send you a password reset link. Check your spam folder if you don't see the email within a few minutes.",

        changeEmail: "To change your email address, please contact support at aivisibility@xeo.marketing with your current email and desired new email.",

        cancelSubscription: "You can cancel your subscription anytime from your dashboard. Your access will continue until the end of your billing period.",

        billing: "Billing happens on the same day each month (monthly) or year (annual) as your original subscription date. You'll receive an email receipt for each payment. Annual plans are billed upfront for the full year."
    },

    technicalHelp: {
        scanFailed: "If a scan fails, it could be due to: (1) Website is down or blocking our scanner, (2) Website requires authentication, (3) Robots.txt blocking. Try again in a few minutes or contact support.",

        slowScan: "Scans typically take 30-60 seconds. Larger websites may take up to 2 minutes. If it takes longer, please refresh the page and try again.",

        loginIssues: "Clear your browser cache and cookies, then try logging in again. If you forgot your password, use the 'Forgot Password' link on the login page.",

        dataNotShowing: "Try refreshing the page. If data still doesn't appear, log out and log back in. Contact support if the issue persists.",

        cantScanAnotherPage: "Free plan users: Your plan includes homepage-only scanning. Upgrade to DIY ($19-$29/mo) to scan 5 pages. DIY users: You can scan up to 5 pages total per domain. To add more, upgrade to Pro (waitlist) for 25 pages.",

        changingPages: "DIY users can change their 5 tracked pages anytime (except homepage, which is locked). Historical data for removed pages is archived and accessible.",

        scanReset: "Your scan quota resets on the 1st of each month. You cannot save unused scans for next month - they do not rollover."
    },

    commonQuestions: {
        whatIsVisible2AI: "Visible2AI is an AI Visibility Score tool that analyzes your website and tells you how well AI search engines (ChatGPT, Perplexity, Claude, Google AI Overviews) can find, understand, and recommend your content. We score you 0-1000 and give actionable recommendations to improve.",

        whichPlan: "Quick guide: Just testing? → Free Plan ($0). Small business tracking key pages? → DIY Plan ($19-$29/mo). Need comprehensive visibility with brand monitoring? → Pro Plan (waitlist, $99-$149/mo). Managing multiple clients? → Enterprise Plan (waitlist, $349-$499/mo).",

        monthlyVsAnnual: "Annual billing saves you 30-34% compared to monthly. For DIY: $19/mo annually vs $29/mo monthly. Annual plans are billed upfront for the full year.",

        competitorDifference: "DIY: 2 competitors, score-only (e.g., 'Competitor A: 720/1000'). Pro: 3 competitors with full category breakdowns, side-by-side comparison, and gap analysis showing exactly what they do better.",

        upgradeFromDIY: "Yes! Once Pro launches (Q1 2026), you can upgrade seamlessly. Your current data carries over automatically.",

        multipleDomains: "Free & DIY: 1 domain only. Pro: 1 domain. Enterprise: 10 domains. For tracking multiple domains, join the Enterprise waitlist.",

        brandVisibilityIndex: "Available in Pro & Enterprise. It measures how AI engines perceive your brand across the web through news mentions, reviews, social proof, and citations - not just your website.",

        cancelation: "You can cancel anytime from your dashboard or Stripe portal. Your access continues until the end of your billing period. No partial refunds.",

        joinWaitlist: "Pro ($99-$149/mo, Q1 2026) and Enterprise ($349-$499/mo, mid 2026) are on waitlist. Join to be notified first and get early-bird pricing. Visit the upgrade page or contact aivisibility@xeo.marketing.",

        launchPromo: "We're currently running a launch promotion with discounts on monthly DIY subscriptions. Check the pricing page for current offers."
    }
};

// System prompt for AI assistant
const systemPrompt = `You are XeoAI, the friendly AI support assistant for Visible2AI - the AI Visibility Score tool that helps businesses optimize their websites to appear in AI-powered search results like ChatGPT, Perplexity, Claude, and Google AI Overviews.

⚠️ CRITICAL ANTI-HALLUCINATION RULES (MUST FOLLOW):
1. ONLY use information from the knowledge base provided below - NEVER make up details
2. NEVER guess or invent pricing information - this has LEGAL implications
3. If you don't know something, say "I don't have that information" and direct users to aivisibility@xeo.marketing
4. DO NOT invent features, prices, or plan details that aren't in the knowledge base
5. When referencing the user's plan, ONLY use context.plan - do NOT guess their specific price
6. Pro and Enterprise plans are NOT YET AVAILABLE - they are waitlist only (COMING SOON)

Your role is to:
1. Answer questions about pricing, plans, and features USING ONLY THE KNOWLEDGE BASE
2. Help users navigate the dashboard
3. Provide technical troubleshooting support
4. Explain how the AI Visibility Score works and why it matters for AI search
5. Help with account issues like password resets
6. Explain the difference between monthly and annual billing options

Be friendly, concise, and helpful. Use the knowledge base provided to give ACCURATE information only.

✅ VERIFIED PRICING (always accurate):

Free Plan ($0) - ACTIVE:
- 2 scans/month, homepage only
- AI Visibility Score (0-1000) with 8-category breakdown
- Top 3 priority recommendations
- Email verification required
- Perfect for: Testing the tool

DIY Plan - ACTIVE:
- Monthly: $29/month
- Annual: $19/month (billed annually at $228/year) - SAVE 34%
- 25 scans/month, 5 pages per domain
- Up to 15 detailed recommendations with code snippets
- Industry-specific FAQ schema (JSON-LD)
- Track 2 competitors (score-only view)
- Progress tracking & historical comparison
- Cancel anytime
- Perfect for: Small businesses tracking key pages

Pro Plan - COMING SOON (Q1 2026):
- Monthly: $149/month
- Annual: $99/month (billed annually at $1,188/year) - SAVE 34%
- 50 scans/month, 25 pages per domain
- Dual indexes: Website + Brand Visibility Index
- Up to 25 recommendations
- Track 3 competitors (full analysis + gap analysis)
- Outside-in crawl, PDF export, priority support
- Perfect for: Mid-size businesses, agencies

Enterprise Plan - COMING SOON (Mid 2026):
- Monthly: $499/month
- Annual: $349/month (billed annually at $4,188/year) - SAVE 30%
- All Pro features × 10 domains
- Team management, white-label reports
- Perfect for: Agencies managing multiple clients

KEY FACTS:
- Scans reset on the 1st of each month (NO ROLLOVER)
- All pages must be from the SAME domain
- Homepage is locked and required for paid plans
- Competitor tracking: DIY = score-only, Pro = full analysis
- PDF export only available in Pro & Enterprise
- Annual billing saves 30-34% compared to monthly

When users ask about Pro or Enterprise, remind them these are COMING SOON (waitlist only) and not yet purchasable.

TONE GUIDELINES:
- Be helpful and encouraging about improving AI visibility
- Keep responses concise but informative
- Use clear language, avoid jargon
- If unsure, direct to support email: aivisibility@xeo.marketing
- Celebrate user progress and encourage implementation of recommendations

Always be encouraging and positive about the user's progress in improving their AI visibility!`;

// POST /api/support-chat
router.post('/', async (req, res) => {
    try {
        const { message, context, history } = req.body;

        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Message is required'
            });
        }

        // Build context string for the AI
        let contextString = `\nUser Context:\n`;
        contextString += `- Current Page: ${context.page || 'unknown'}\n`;
        contextString += `- Logged In: ${context.isLoggedIn ? 'Yes' : 'No'}\n`;
        if (context.plan) {
            contextString += `- Plan: ${context.plan}\n`;
        }

        // Prepare messages for Claude
        const messages = [];

        // Add conversation history if available
        if (history && Array.isArray(history) && history.length > 0) {
            history.forEach(msg => {
                messages.push({
                    role: msg.role,
                    content: msg.content
                });
            });
        }

        // Add current message with context
        messages.push({
            role: 'user',
            content: `${contextString}\n\nUser Question: ${message}`
        });

        // Call Claude API
        const response = await anthropic.messages.create({
            model: 'claude-3-7-sonnet-20250219',
            max_tokens: 1024,
            system: `${systemPrompt}\n\nKNOWLEDGE BASE:\n${JSON.stringify(knowledgeBase, null, 2)}`,
            messages: messages
        });

        const aiMessage = response.content[0].text;

        // Generate quick replies based on context and message
        const quickReplies = generateQuickReplies(message, context);

        res.json({
            success: true,
            message: aiMessage,
            quickReplies: quickReplies
        });

    } catch (error) {
        console.error('Support chat error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process chat message',
            message: 'I apologize, but I\'m having trouble connecting right now. Please email us at aivisibility@xeo.marketing for immediate assistance.'
        });
    }
});

// Helper function to generate contextual quick replies
function generateQuickReplies(message, context) {
    const lowerMessage = message.toLowerCase();

    // Password reset related
    if (lowerMessage.includes('password') || lowerMessage.includes('reset') || lowerMessage.includes('forgot')) {
        return [
            'How do I reset my password?',
            'I didn\'t receive the reset email',
            'How long is the reset link valid?'
        ];
    }

    // Pricing related
    if (lowerMessage.includes('price') || lowerMessage.includes('cost') || lowerMessage.includes('plan')) {
        return [
            'What are the differences between plans?',
            'Can I upgrade later?',
            'Is there a free trial?',
            'How do I cancel?'
        ];
    }

    // Scan related
    if (lowerMessage.includes('scan') || lowerMessage.includes('analyze')) {
        return [
            'How long does a scan take?',
            'Why did my scan fail?',
            'How many scans do I have left?',
            'Can I scan any website?'
        ];
    }

    // Recommendations related
    if (lowerMessage.includes('recommendation') || lowerMessage.includes('unlock') || lowerMessage.includes('implement')) {
        return [
            'How do recommendations unlock?',
            'Can I skip recommendations?',
            'How do I track my progress?',
            'What if I need more recommendations?'
        ];
    }

    // Dashboard/navigation
    if (lowerMessage.includes('dashboard') || lowerMessage.includes('find') || lowerMessage.includes('where')) {
        return [
            'Where is my scan history?',
            'How do I start a new scan?',
            'Where do I see my progress?',
            'How do I upgrade my plan?'
        ];
    }

    // Default quick replies for general questions
    return [
        'Tell me about the plans',
        'How does the scoring work?',
        'How do I get started?',
        'What makes this tool unique?'
    ];
}

module.exports = router;
