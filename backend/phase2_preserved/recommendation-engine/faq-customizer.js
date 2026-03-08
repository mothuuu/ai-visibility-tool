require('dotenv').config({ path: './backend/.env' });

/**
 * FAQ CUSTOMIZER - Part 3 (ENHANCED with Library)
 * File: backend/analyzers/recommendation-engine/faq-customizer.js
 * 
 * Generates industry-specific FAQ schemas:
 * - Uses high-quality library FAQs when available
 * - Falls back to Claude generation for missing industries
 * - Maintains two-tier answer structure (human + backend)
 * - Preserves factual anchors and confidence tracking
 */

const Anthropic = require('@anthropic-ai/sdk');
const { hasLibrary, loadLibrary } = require('./faq-library-loader');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// ========================================
// MAIN FAQ GENERATION FUNCTION
// ========================================

/**
 * Generate customized FAQ schema for a website
 * @param {string} industry - User's industry
 * @param {Object} siteData - Extracted site information
 * @param {number} count - Number of FAQs to generate (default: 5)
 * @returns {Object} - Customized FAQ package
 */
async function generateCustomizedFAQ(industry, siteData, count = 5) {
  console.log(`   Generating FAQs for ${industry}...`);
  
  // Check if we have a library for this industry
  if (hasLibrary(industry)) {
    console.log(`   ✅ Using high-quality library for ${industry}`);
    return await generateFromLibrary(industry, siteData, count);
  } else {
    console.log(`   ⚠️  No library for ${industry}, using Claude fallback`);
    return await generateWithClaudeFallback(industry, siteData, count);
  }
}

// ========================================
// LIBRARY-BASED GENERATION (High Quality)
// ========================================

/**
 * Generate FAQs using library + Claude customization
 */
async function generateFromLibrary(industry, siteData, count) {
  const library = loadLibrary(industry);
  
  if (!library) {
    return await generateWithClaudeFallback(industry, siteData, count);
  }
  
  // Select top N FAQs by priority
  const selectedFAQs = library.faqs
    .sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    })
    .slice(0, count);
  
  console.log(`   Selected ${selectedFAQs.length} FAQs from library`);
  
  // Extract site data using library extraction rules
  const extractedData = await extractSiteDataUsingRules(siteData, selectedFAQs);
  
  // Customize each FAQ with Claude
  const customizedFAQs = [];
  
  for (const libraryFAQ of selectedFAQs) {
    try {
      const customized = await customizeFAQWithClaude(libraryFAQ, extractedData, siteData);
      customizedFAQs.push(customized);
    } catch (error) {
      console.error(`   ⚠️  Failed to customize FAQ ${libraryFAQ.id}:`, error.message);
      // Use library version as-is
      customizedFAQs.push(formatLibraryFAQ(libraryFAQ, siteData));
    }
  }
  
  // Build complete schema
  const fullSchema = buildFAQSchema(customizedFAQs, siteData.url);
  
  return {
    source: 'library',
    industry: library.industry,
    quality: 'high',
    faqCount: customizedFAQs.length,
    faqs: customizedFAQs,
    fullSchemaCode: fullSchema,
    implementation: {
      where: 'Add to <head> or <body> of your main pages',
      validation: 'Test at https://validator.schema.org',
      tip: 'Place on homepage and key service pages for maximum impact'
    }
  };
}

/**
 * Extract site data using library's extraction rules
 */
async function extractSiteDataUsingRules(siteData, faqs) {
  const extracted = {
    url: siteData.url || 'your website',
    companyName: extractCompanyName(siteData),
    title: siteData.title || '',
    description: siteData.description || ''
  };
  
  // Extract common variables from extraction rules
  for (const faq of faqs) {
    if (!faq.extraction_rules) continue;
    
    for (const [varName, rule] of Object.entries(faq.extraction_rules)) {
      if (extracted[varName]) continue; // Already extracted
      
      extracted[varName] = await extractVariable(varName, rule, siteData);
    }
  }
  
  return extracted;
}

/**
 * Extract a single variable using extraction rule
 */
async function extractVariable(varName, rule, siteData) {
  const method = rule.method;
  const fallback = rule.fallback || '';
  
  if (method === 'entity_extraction' || method === 'keyword_scan') {
    const lookFor = rule.look_for || rule.keywords || [];
    const content = JSON.stringify(siteData).toLowerCase();
    
    for (const keyword of lookFor) {
      if (content.includes(keyword.toLowerCase())) {
        return keyword;
      }
    }
  }
  
  if (method === 'pattern_scan') {
    const patterns = rule.patterns || [];
    const content = JSON.stringify(siteData);
    
    for (const pattern of patterns) {
      const regex = new RegExp(pattern);
      const match = content.match(regex);
      if (match) return match[1] || match[0];
    }
  }
  
  return fallback;
}

/**
 * Customize a library FAQ with Claude using extracted data
 */
async function customizeFAQWithClaude(libraryFAQ, extracted, siteData) {
  const prompt = buildLibraryCustomizationPrompt(libraryFAQ, extracted, siteData);
  
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });
  
  const claudeResponse = response.content[0].text;
  
  // Parse Claude's customized answers
  const humanAnswer = extractSection(claudeResponse, 'HUMAN_ANSWER');
  const backendAnswer = extractSection(claudeResponse, 'BACKEND_ANSWER');
  
  return {
    id: libraryFAQ.id,
    priority: libraryFAQ.priority,
    question: customizeTemplate(libraryFAQ.question, extracted),
    
    answer_human_friendly: {
      text: humanAnswer || libraryFAQ.answer_human_friendly.text,
      tone: libraryFAQ.answer_human_friendly.tone,
      focus: libraryFAQ.answer_human_friendly.focus
    },
    
    answer_factual_backend: {
      text: backendAnswer || libraryFAQ.answer_factual_backend.text,
      tone: libraryFAQ.answer_factual_backend.tone,
      focus: libraryFAQ.answer_factual_backend.focus,
      factual_anchors: libraryFAQ.answer_factual_backend.factual_anchors
    },
    
    schema_jsonld: customizeSchema(libraryFAQ.schema_jsonld, extracted, humanAnswer || libraryFAQ.answer_factual_backend.text),
    
    expected_impact: libraryFAQ.expected_impact,
    seo_aeo_value: libraryFAQ.seo_aeo_value
  };
}

/**
 * Build prompt for Claude to customize library FAQ
 */
function buildLibraryCustomizationPrompt(libraryFAQ, extracted, siteData) {
  return `You are customizing a high-quality FAQ for ${siteData.url}.

LIBRARY FAQ TO CUSTOMIZE:
Question: ${libraryFAQ.question}

HUMAN-FRIENDLY ANSWER (Template):
${libraryFAQ.answer_human_friendly.text}
Tone: ${libraryFAQ.answer_human_friendly.tone}

BACKEND ANSWER (Template):
${libraryFAQ.answer_factual_backend.text}
Tone: ${libraryFAQ.answer_factual_backend.tone}

EXTRACTED SITE DATA:
${JSON.stringify(extracted, null, 2)}

TASK:
Customize BOTH answers using the extracted site data. Replace generic terms with specific company info.

CRITICAL RULES:
1. Maintain the EXACT tone and focus of each answer
2. Keep factual claims and percentages UNCHANGED (these are verified)
3. Replace company names and generic terms with extracted data
4. Keep word count similar to original
5. Preserve the strategic depth and quality

FORMAT YOUR RESPONSE:

[HUMAN_ANSWER]
[Your customized human-friendly answer here - ${libraryFAQ.answer_human_friendly.word_count} words approximately]

[BACKEND_ANSWER]
[Your customized backend answer here - ${libraryFAQ.answer_factual_backend.word_count} words approximately]

DO NOT include any other text or explanations.`;
}

/**
 * Format library FAQ as-is (when customization fails)
 */
function formatLibraryFAQ(libraryFAQ, siteData) {
  return {
    id: libraryFAQ.id,
    priority: libraryFAQ.priority,
    question: libraryFAQ.question,
    answer_human_friendly: libraryFAQ.answer_human_friendly,
    answer_factual_backend: libraryFAQ.answer_factual_backend,
    schema_jsonld: libraryFAQ.schema_jsonld,
    expected_impact: libraryFAQ.expected_impact,
    seo_aeo_value: libraryFAQ.seo_aeo_value
  };
}

// ========================================
// CLAUDE FALLBACK (No Library Available)
// ========================================

/**
 * Generate FAQs using Claude only (when library doesn't exist)
 */
async function generateWithClaudeFallback(industry, siteData, count) {
  const context = {
    url: siteData.url || 'your website',
    companyName: extractCompanyName(siteData),
    industry: industry,
    title: siteData.title || '',
    description: siteData.description || ''
  };
  
  const prompt = buildClaudeFallbackPrompt(context, count);
  
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });
    
    const claudeResponse = response.content[0].text;
    const faqs = parseClaudeFAQs(claudeResponse);
    const fullSchema = buildFAQSchema(faqs, context.url);
    
    return {
      source: 'claude_fallback',
      industry: industry,
      quality: 'standard',
      faqCount: faqs.length,
      faqs: faqs,
      fullSchemaCode: fullSchema,
      implementation: {
        where: 'Add to <head> or <body> of your main pages',
        validation: 'Test at https://validator.schema.org',
        tip: 'Consider requesting a custom library for your industry for higher quality FAQs'
      }
    };
    
  } catch (error) {
    console.error('   ❌ Claude fallback failed:', error.message);
    return generateGenericFAQs(industry, context, count);
  }
}

/**
 * Build prompt for Claude fallback generation
 */
function buildClaudeFallbackPrompt(context, count) {
  return `Generate ${count} high-quality FAQ entries for this ${context.industry} website:

Company: ${context.companyName}
URL: ${context.url}
Description: ${context.description || 'Not available'}

Create FAQs that:
- Address common questions in the ${context.industry} industry
- Are specific to this company where possible
- Have clear, helpful answers (2-3 sentences each)
- Focus on value and outcomes, not just features

FORMAT EACH FAQ EXACTLY LIKE THIS:

[FAQ1]
Question: [Question here]
Answer: [2-3 sentence answer here]

[FAQ2]
Question: [Question here]
Answer: [2-3 sentence answer here]

Continue for all ${count} FAQs. Be specific and professional.`;
}

/**
 * Parse Claude's FAQ response
 */
function parseClaudeFAQs(response) {
  const faqs = [];
  const faqBlocks = response.split(/\[FAQ\d+\]/i).filter(b => b.trim());
  
  for (const block of faqBlocks) {
    const qMatch = block.match(/Question:\s*(.+?)(?=Answer:|$)/is);
    const aMatch = block.match(/Answer:\s*(.+?)(?=\[FAQ|$)/is);
    
    if (qMatch && aMatch) {
      faqs.push({
        question: qMatch[1].trim(),
        answer_human_friendly: {
          text: aMatch[1].trim()
        }
      });
    }
  }
  
  return faqs;
}

/**
 * Generate generic FAQs (last resort)
 */
function generateGenericFAQs(industry, context, count) {
  const genericQuestions = [
    `What services does ${context.companyName} provide?`,
    `How can I contact ${context.companyName}?`,
    `What makes ${context.companyName} different?`,
    `Where is ${context.companyName} located?`,
    `What industries does ${context.companyName} serve?`
  ];
  
  const faqs = genericQuestions.slice(0, count).map(q => ({
    question: q,
    answer_human_friendly: {
      text: `Visit ${context.url} or contact ${context.companyName} directly for detailed information.`
    }
  }));
  
  return {
    source: 'generic',
    industry: industry,
    quality: 'basic',
    faqCount: faqs.length,
    faqs: faqs,
    fullSchemaCode: buildFAQSchema(faqs, context.url)
  };
}

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Extract company name from site data
 */
function extractCompanyName(siteData) {
  if (siteData.companyName) return siteData.companyName;
  
  if (siteData.schemas && Array.isArray(siteData.schemas)) {
    const orgSchema = siteData.schemas.find(s => s['@type'] === 'Organization');
    if (orgSchema && orgSchema.name) return orgSchema.name;
  }
  
  if (siteData.title) {
    return siteData.title.replace(/\s*[-|]\s*(Home|Welcome|Official Site).*$/i, '').trim();
  }
  
  if (siteData.url) {
    const domain = new URL(siteData.url).hostname;
    return domain.replace(/^www\./, '').replace(/\.\w+$/, '');
  }
  
  return '[Your Company]';
}

/**
 * Customize template with extracted variables
 */
function customizeTemplate(template, extracted) {
  let customized = template;
  
  for (const [key, value] of Object.entries(extracted)) {
    const placeholder = new RegExp(`{{${key}}}`, 'g');
    customized = customized.replace(placeholder, value);
  }
  
  return customized;
}

/**
 * Customize schema with company data
 */
function customizeSchema(schemaTemplate, extracted, answerText) {
  const schema = JSON.parse(JSON.stringify(schemaTemplate));
  
  if (schema.mainEntity && schema.mainEntity[0]) {
    schema.mainEntity[0].acceptedAnswer.text = answerText;
  }
  
  return schema;
}

/**
 * Build complete FAQ schema
 */
function buildFAQSchema(faqs, url) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(faq => ({
      "@type": "Question",
      "name": faq.question,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": faq.answer_factual_backend?.text || faq.answer_human_friendly.text
      }
    }))
  };
  
  return `<script type="application/ld+json">
${JSON.stringify(schema, null, 2)}
</script>`;
}

/**
 * Extract section from Claude response
 */
function extractSection(response, sectionName) {
  const regex = new RegExp(`\\[${sectionName}\\]\\s*([\\s\\S]*?)(?=\\[|$)`, 'i');
  const match = response.match(regex);
  return match ? match[1].trim() : '';
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  generateCustomizedFAQ
};