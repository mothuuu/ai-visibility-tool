/**
 * Google Analytics 4 Tracking Utility
 *
 * Provides GA4 initialization and event tracking for the AI Visibility Score app.
 * Measurement ID can be configured via window.GA_MEASUREMENT_ID or defaults to G-QHHP88BK1C
 */

(function() {
    'use strict';

    // Configuration - can be overridden before this script loads
    const GA_MEASUREMENT_ID = window.GA_MEASUREMENT_ID || 'G-QHHP88BK1C';

    // Check if we should disable tracking (e.g., in development)
    const isDevMode = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const disableTracking = window.GA_DISABLE_TRACKING === true;

    /**
     * Initialize Google Analytics 4
     * Dynamically loads the gtag.js script and configures it
     */
    function initGA() {
        if (disableTracking) {
            console.log('[Analytics] Tracking disabled');
            return;
        }

        if (!GA_MEASUREMENT_ID) {
            console.warn('[Analytics] No measurement ID configured');
            return;
        }

        // Check if already initialized
        if (window.gtag) {
            console.log('[Analytics] Already initialized');
            return;
        }

        // Create dataLayer if it doesn't exist
        window.dataLayer = window.dataLayer || [];

        // Define gtag function
        window.gtag = function() {
            window.dataLayer.push(arguments);
        };

        // Initialize with timestamp
        window.gtag('js', new Date());

        // Configure GA4 with the measurement ID
        window.gtag('config', GA_MEASUREMENT_ID, {
            send_page_view: true,
            debug_mode: isDevMode
        });

        // Load the gtag.js script asynchronously
        const script = document.createElement('script');
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
        document.head.appendChild(script);

        console.log(`[Analytics] GA4 initialized with ID: ${GA_MEASUREMENT_ID}`);
    }

    /**
     * Track a custom event
     * @param {string} eventName - Name of the event (e.g., 'scan_started')
     * @param {Object} parameters - Event parameters
     */
    function trackEvent(eventName, parameters = {}) {
        if (disableTracking || !window.gtag) {
            if (isDevMode) {
                console.log(`[Analytics Dev] Event: ${eventName}`, parameters);
            }
            return;
        }

        try {
            window.gtag('event', eventName, parameters);
            console.log(`[Analytics] Tracked: ${eventName}`, parameters);
        } catch (error) {
            console.error('[Analytics] Error tracking event:', error);
        }
    }

    /**
     * Track a page view (for SPA navigation)
     * @param {string} pagePath - The page path (e.g., '/dashboard')
     * @param {string} pageTitle - The page title
     */
    function trackPageView(pagePath, pageTitle) {
        if (disableTracking || !window.gtag) {
            if (isDevMode) {
                console.log(`[Analytics Dev] Page view: ${pagePath}`);
            }
            return;
        }

        try {
            window.gtag('event', 'page_view', {
                page_path: pagePath || window.location.pathname,
                page_title: pageTitle || document.title,
                page_location: window.location.href
            });
            console.log(`[Analytics] Page view: ${pagePath || window.location.pathname}`);
        } catch (error) {
            console.error('[Analytics] Error tracking page view:', error);
        }
    }

    // ========================================
    // Predefined Event Tracking Functions
    // ========================================

    /**
     * Track when a user starts a scan
     * @param {string} url - The URL being scanned
     */
    function trackScanStarted(url) {
        trackEvent('scan_started', {
            url: url,
            event_category: 'engagement',
            event_label: url
        });
    }

    /**
     * Track when scan results are displayed
     * @param {string} url - The scanned URL
     * @param {number} score - The overall visibility score
     */
    function trackScanCompleted(url, score) {
        trackEvent('scan_completed', {
            url: url,
            score: score,
            event_category: 'engagement',
            event_label: `${url} - Score: ${score}`
        });
    }

    /**
     * Track when a user starts the signup process
     * @param {string} source - Where the signup was initiated ('header', 'results', 'cta', etc.)
     */
    function trackSignupStarted(source) {
        trackEvent('signup_started', {
            source: source,
            event_category: 'acquisition',
            event_label: source
        });
    }

    /**
     * Track when a user successfully creates an account
     * @param {string} method - The signup method ('email', 'google', etc.)
     */
    function trackSignupCompleted(method) {
        trackEvent('signup_completed', {
            method: method || 'email',
            event_category: 'acquisition',
            event_label: method || 'email'
        });
    }

    /**
     * Track when a user starts the checkout process
     * @param {string} plan - The plan being purchased ('diy', 'pro', etc.)
     */
    function trackCheckoutStarted(plan) {
        trackEvent('checkout_started', {
            plan: plan,
            event_category: 'ecommerce',
            event_label: plan
        });
    }

    /**
     * Track when a purchase is completed
     * @param {string} plan - The purchased plan
     * @param {number} value - The purchase value
     */
    function trackPurchaseCompleted(plan, value) {
        trackEvent('purchase_completed', {
            plan: plan,
            value: value,
            currency: 'USD',
            event_category: 'ecommerce',
            event_label: `${plan} - $${value}`
        });

        // Also track as a GA4 purchase event for ecommerce reports
        trackEvent('purchase', {
            transaction_id: `${Date.now()}`,
            value: value,
            currency: 'USD',
            items: [{
                item_name: `${plan.toUpperCase()} Plan`,
                item_category: 'subscription',
                price: value,
                quantity: 1
            }]
        });
    }

    /**
     * Track when a user clicks an upgrade button
     * @param {string} source - Where the upgrade was clicked ('dashboard', 'results', 'nav', etc.)
     * @param {string} plan - The target plan
     */
    function trackUpgradeClicked(source, plan) {
        trackEvent('upgrade_clicked', {
            source: source,
            plan: plan,
            event_category: 'engagement',
            event_label: `${source} - ${plan}`
        });
    }

    /**
     * Track when a user logs in
     * @param {string} method - The login method ('email', 'google', etc.)
     */
    function trackLogin(method) {
        trackEvent('login', {
            method: method || 'email',
            event_category: 'engagement'
        });
    }

    // ========================================
    // Auto-initialization
    // ========================================

    // Initialize GA when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initGA);
    } else {
        initGA();
    }

    // ========================================
    // Export to global scope
    // ========================================

    window.Analytics = {
        init: initGA,
        trackEvent: trackEvent,
        trackPageView: trackPageView,
        trackScanStarted: trackScanStarted,
        trackScanCompleted: trackScanCompleted,
        trackSignupStarted: trackSignupStarted,
        trackSignupCompleted: trackSignupCompleted,
        trackCheckoutStarted: trackCheckoutStarted,
        trackPurchaseCompleted: trackPurchaseCompleted,
        trackUpgradeClicked: trackUpgradeClicked,
        trackLogin: trackLogin,
        // Expose measurement ID for debugging
        measurementId: GA_MEASUREMENT_ID
    };

})();
