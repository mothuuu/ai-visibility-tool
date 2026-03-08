/**
 * CERTIFICATION RECOMMENDATION GENERATORS
 * File: backend/analyzers/recommendation-engine/certification-recommendation-generators.js
 *
 * Programmatic generators for certification-related recommendations.
 * These generate rich, detailed recommendations using certification library data.
 */

const certLib = require('./certification-library-loader');

/**
 * Detailed certification descriptions for user-friendly display
 */
const certificationDescriptions = {
  'ISO 27001': {
    name: 'ISO 27001',
    category: 'Information Security Management',
    shortDescription: 'Critical for any organization that handles sensitive data.',
    industries: ['IT companies', 'Finance', 'Healthcare', 'Legal services', 'Any business handling customer data'],
    fullDescription: 'ISO 27001 is an internationally recognized standard that demonstrates your commitment to information security best practices. It covers risk management, security controls, and continuous improvement processes.'
  },
  'SOC 2': {
    name: 'SOC 2',
    category: 'Service Organization Control',
    shortDescription: 'Essential for service organizations that store, process, or transmit sensitive customer data.',
    industries: ['Technology & SaaS', 'Fintech & Financial Services', 'Healthcare & Healthtech', 'Managed Service Providers', 'E-commerce & Retail', 'Professional Services'],
    fullDescription: 'SOC 2 validates your security, availability, processing integrity, confidentiality, and privacy controls. It\'s particularly important for cloud-based service providers.'
  },
  'GDPR Compliant': {
    name: 'GDPR Compliance',
    category: 'Data Protection Regulation',
    shortDescription: 'Required for any organization handling personal data of EU residents.',
    industries: ['Any business with EU customers', 'E-commerce', 'SaaS platforms', 'Marketing agencies', 'Healthcare providers'],
    fullDescription: 'GDPR compliance demonstrates that your organization respects user privacy and follows strict data protection guidelines required by European law.'
  },
  'Google Partner': {
    name: 'Google Partner',
    category: 'Digital Marketing Certification',
    shortDescription: 'Demonstrates expertise in Google Ads and digital marketing.',
    industries: ['Digital marketing agencies', 'Advertising consultants', 'Media buying companies', 'Marketing departments'],
    fullDescription: 'Google Partner status signals to potential clients that your team is trained, certified, and recognized by Google for advertising expertise.'
  },
  'HIPAA Compliant': {
    name: 'HIPAA Compliance',
    category: 'Healthcare Data Security',
    shortDescription: 'Mandatory for handling protected health information.',
    industries: ['Healthcare providers', 'Medical software', 'Health insurance', 'Medical billing', 'Telehealth platforms'],
    fullDescription: 'HIPAA compliance is required for any organization that handles protected health information (PHI). It demonstrates your commitment to patient privacy and data security.'
  },
  'PCI DSS': {
    name: 'PCI DSS',
    category: 'Payment Security Standard',
    shortDescription: 'Required for handling payment card data securely.',
    industries: ['E-commerce', 'Retail', 'Payment processors', 'Subscription services', 'Any business accepting credit cards'],
    fullDescription: 'PCI DSS compliance is mandatory for any organization that processes, stores, or transmits credit card information. It ensures your payment systems meet rigorous security standards.'
  },
  'ISO 9001': {
    name: 'ISO 9001',
    category: 'Quality Management',
    shortDescription: 'Demonstrates systematic quality management and continuous improvement.',
    industries: ['Manufacturing', 'Professional services', 'Technology companies', 'Any quality-focused business'],
    fullDescription: 'ISO 9001 is the international standard for quality management systems. It demonstrates your commitment to consistent quality, customer satisfaction, and continuous improvement.'
  }
};

/**
 * Generate professional certification recommendation with library data
 */
function makeProgrammaticCertificationRecommendation(issue, scanEvidence, industry) {
  console.log(`\n🏆 [Programmatic Cert Generator] Starting for industry: ${industry}`);

  const library = certLib.loadLibrary(industry);

  if (!library) {
    console.log(`⚠️  [Programmatic Cert Generator] No certification library for industry "${industry}", falling back to ChatGPT/template`);
    console.log(`   Available industries: cybersecurity, healthcare, fintech, msp-var, telecom-csp`);
    return null; // Fall back to ChatGPT/template
  }

  console.log(`✅ [Programmatic Cert Generator] Library loaded: ${library.industry} (${library.certifications?.length || 0} certifications)`);

  // Get certification data from scanEvidence
  const certData = scanEvidence.certificationData;
  if (!certData) {
    console.log(`⚠️  [Programmatic Cert Generator] No certification data in scanEvidence`);
    console.log(`   scanEvidence keys: ${Object.keys(scanEvidence).join(', ')}`);
    return null;
  }

  console.log(`✅ [Programmatic Cert Generator] Certification data found:`);
  console.log(`   - Detected: ${certData.detected?.length || 0}`);
  console.log(`   - Missing: ${certData.missing?.length || 0}`);
  console.log(`   - Coverage: ${certData.overallCoverage}%`);

  // Get top missing certifications by priority
  const missingCritical = certData.missing.filter(c => c.priority === 'critical').slice(0, 3);
  const missingImportant = certData.missing.filter(c => c.priority === 'important').slice(0, 2);

  if (missingCritical.length === 0 && missingImportant.length === 0) {
    console.log('✅ [Programmatic Cert Generator] No missing certifications detected - site has great coverage!');
    return null;
  }

  console.log(`📋 [Programmatic Cert Generator] Missing certifications to recommend:`);
  console.log(`   - Critical: ${missingCritical.map(c => c.name).join(', ')}`);
  console.log(`   - Important: ${missingImportant.map(c => c.name).join(', ')}`);

  // Focus on the highest priority missing certification
  const topMissing = missingCritical[0] || missingImportant[0];
  const fullCert = library.certifications.find(c => c.id === topMissing.id);

  if (!fullCert) {
    console.log('⚠️  Could not find full certification details');
    return null;
  }

  // Build finding text with detailed descriptions
  let finding = `Your site is missing key industry certifications that build trust and authority.\n\n`;

  if (certData.detected.length > 0) {
    finding += `You're currently displaying: ${certData.detected.map(c => c.name).join(', ')}.\n\n`;
  }

  finding += `Recommended certifications:\n\n`;

  // Add detailed descriptions for each missing certification
  const allMissing = [...missingCritical, ...missingImportant].slice(0, 4);
  allMissing.forEach(cert => {
    const desc = certificationDescriptions[cert.name];
    if (desc) {
      finding += `✓ **${desc.name}** – ${desc.shortDescription} Great for ${desc.industries.slice(0, 3).join(', ')}.\n\n`;
    } else {
      // Fallback if description not found
      finding += `✓ **${cert.name}** – ${cert.expectedImpact}\n\n`;
    }
  });

  // Build recommendation text
  let recommendation = `Add certification badges and structured data to your website:\n\n`;
  recommendation += `**Priority: ${fullCert.name}**\n`;
  recommendation += `- Category: ${fullCert.category}\n`;
  recommendation += `- Impact: ${fullCert.expected_impact}\n`;
  recommendation += `- ${fullCert.display_recommendation.why_it_matters}\n\n`;

  if (missingCritical.length > 1) {
    recommendation += `**Other Critical Certifications:**\n`;
    missingCritical.slice(1).forEach(cert => {
      recommendation += `- ${cert.name}: ${cert.expectedImpact}\n`;
    });
    recommendation += `\n`;
  }

  // Build JSON-LD schema markup
  const schemaMarkup = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "{{YOUR_COMPANY_NAME}}",
    "award": [
      {
        "@type": "EducationalOccupationalCredential",
        "name": fullCert.name,
        "credentialCategory": fullCert.category,
        "recognizedBy": {
          "@type": "Organization",
          "name": "{{CERTIFYING_BODY}}"
        }
      }
    ]
  };

  // Build code snippet
  const codeSnippet = `<!-- Add to your website's <head> or footer -->
<script type="application/ld+json">
${JSON.stringify(schemaMarkup, null, 2)}
</script>

<!-- Display certification badge in your footer or about page -->
<div class="certifications">
  <div class="certification-badge">
    <img src="/images/${fullCert.name.toLowerCase().replace(/\s+/g, '-')}-badge.png"
         alt="${fullCert.name} Certified" />
    <p>${fullCert.name}</p>
  </div>
</div>`;

  return {
    id: issue.id,
    title: `Add ${fullCert.name} Certification`,
    category: issue.category,
    subfactor: issue.subfactor,
    priority: issue.priority,
    currentScore: issue.currentScore,
    potentialScore: issue.potentialScore,
    finding: finding,
    recommendation: recommendation,
    implementationGuide: {
      actionSteps: [
        `Obtain ${fullCert.name} if you haven't already`,
        `Add certification badge image to your website`,
        `Implement schema.org markup to make it AI-discoverable`,
        `Display prominently on homepage, about page, or footer`,
        `Test schema markup with Google's Rich Results Test`
      ],
      quickWins: [
        `If already certified, add badge to homepage/footer (5 min)`,
        `Add schema markup for existing certifications (15 min)`,
        `Create dedicated certifications/compliance page (30 min)`
      ],
      additionalCertifications: missingCritical.concat(missingImportant).slice(1, 5).map(c => ({
        name: c.name,
        priority: c.priority,
        impact: c.expectedImpact
      }))
    },
    codeSnippet: codeSnippet,
    difficulty: fullCert.display_recommendation.difficulty,
    estimatedTime: fullCert.display_recommendation.estimated_time,
    impactArea: fullCert.display_recommendation.impact_areas.join(', '),
    estimatedGain: parseInt(fullCert.expected_impact.match(/\d+/)?.[0] || '18'),
    validationChecklist: [
      `Schema markup validates in Google Rich Results Test`,
      `Certification badge displays on key pages`,
      `Badge links to verification page if available`,
      `All certifications are current and valid`,
      `Schema includes credentialCategory and recognizedBy`
    ]
  };
}

/**
 * Generate team credentials recommendation
 */
function makeProgrammaticTeamCredentialsRecommendation(issue, scanEvidence, industry) {
  const finding = `Your team's expertise and credentials aren't properly documented on your website. Adding Person schema with team member credentials significantly boosts E-E-A-T signals for AI systems. Currently, your site lacks structured team member data that AI assistants can verify and cite.`;

  const recommendation = `Document your team's expertise with structured data:

**Implementation Steps:**

1. **Create/Enhance Team Page**
   - Add individual profiles for key team members
   - Include photos, bios, roles, and credentials
   - Highlight relevant certifications and experience

2. **Add Person Schema for Each Team Member**
   - Use schema.org Person type with hasCredential property
   - Include job titles, affiliations, and credentials
   - Link to professional profiles (LinkedIn, etc.)

3. **Showcase Relevant Expertise**
   - Industry certifications (CISSP, CPA, etc.)
   - Advanced degrees (MBA, PhD, etc.)
   - Professional associations and memberships
   - Years of experience and specializations

**Why This Matters:**
- Establishes expertise and authority (E-E-A-T)
- Helps AI verify source credibility
- Builds trust with potential customers
- Differentiates from competitors`;

  const schemaMarkup = {
    "@context": "https://schema.org",
    "@type": "Person",
    "name": "{{TEAM_MEMBER_NAME}}",
    "jobTitle": "{{JOB_TITLE}}",
    "worksFor": {
      "@type": "Organization",
      "name": "{{YOUR_COMPANY}}"
    },
    "hasCredential": [
      {
        "@type": "EducationalOccupationalCredential",
        "name": "{{CERTIFICATION_NAME}}",
        "credentialCategory": "professional certification"
      }
    ],
    "sameAs": [
      "{{LINKEDIN_URL}}",
      "{{TWITTER_URL}}"
    ]
  };

  const codeSnippet = `<!-- Add to each team member profile page -->
<script type="application/ld+json">
${JSON.stringify(schemaMarkup, null, 2)}
</script>

<!-- HTML structure for team member -->
<div class="team-member">
  <img src="/images/team/{{name}}.jpg" alt="{{name}}">
  <h3>{{name}}</h3>
  <p class="title">{{title}}</p>
  <div class="credentials">
    <span class="badge">{{certification}}</span>
    <span class="experience">{{years}} years experience</span>
  </div>
  <p class="bio">{{bio}}</p>
</div>`;

  return {
    id: issue.id,
    title: "Document Team Member Credentials",
    category: issue.category,
    subfactor: issue.subfactor,
    priority: issue.priority,
    currentScore: issue.currentScore,
    potentialScore: issue.potentialScore,
    finding: finding,
    recommendation: recommendation,
    implementationGuide: {
      actionSteps: [
        `Create or enhance team/about page with individual profiles`,
        `Collect team member credentials, certifications, education`,
        `Add Person schema markup for each key team member`,
        `Include professional profile links (LinkedIn, etc.)`,
        `Test schema markup with Google Rich Results Test`
      ],
      quickWins: [
        `Add basic Person schema for leadership team (30 min)`,
        `List key certifications held by team (15 min)`,
        `Link to LinkedIn profiles for credibility (10 min)`
      ]
    },
    codeSnippet: codeSnippet,
    difficulty: "Medium",
    estimatedTime: "1-2 hours",
    impactArea: "E-E-A-T, Expertise, Trust Signals",
    estimatedGain: 18,
    validationChecklist: [
      `Person schema validates for key team members`,
      `Credentials and certifications are current`,
      `Professional profiles are linked and active`,
      `Photos and bios present for all listed members`,
      `Job titles and roles are clearly specified`
    ]
  };
}

/**
 * Generate industry memberships recommendation
 */
function makeProgrammaticMembershipsRecommendation(issue, scanEvidence, industry) {
  const finding = `Your website doesn't showcase industry memberships and professional associations. These network signals strengthen authority and credibility with AI systems. Industry memberships demonstrate active participation in professional communities and adherence to industry standards.`;

  const recommendation = `Display your industry memberships and associations prominently:

**Implementation Steps:**

1. **Document Current Memberships**
   - Professional associations
   - Industry consortiums
   - Standards bodies
   - Partner programs
   - Certification authorities

2. **Add Organization Schema with memberOf**
   - Use schema.org Organization type
   - Include memberOf property for each association
   - Link to member directories when available

3. **Create Dedicated Section**
   - Add memberships to homepage footer
   - Create partnerships/affiliations page
   - Display member badges and logos

**Common Industry Associations:**
${industry === 'cybersecurity' ? `- (ISC)²\n- ISACA\n- Cloud Security Alliance\n- OWASP` :
  industry === 'healthcare' ? `- HIMSS\n- CHIME\n- AHA\n- AHIMA` :
  industry === 'fintech' ? `- Fintech Association\n- Money20/20\n- Financial Data Exchange` :
  '- Industry-specific associations\n- Professional certification bodies\n- Standards organizations'}

**Why This Matters:**
- Demonstrates industry engagement
- Provides third-party validation
- Strengthens network authority signals
- Builds trust through association`;

  const schemaMarkup = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "{{YOUR_COMPANY}}",
    "memberOf": [
      {
        "@type": "Organization",
        "name": "{{ASSOCIATION_NAME}}",
        "url": "{{ASSOCIATION_URL}}"
      },
      {
        "@type": "Organization",
        "name": "{{ANOTHER_ASSOCIATION}}",
        "url": "{{ASSOCIATION_URL}}"
      }
    ]
  };

  const codeSnippet = `<!-- Add to your Organization schema -->
<script type="application/ld+json">
${JSON.stringify(schemaMarkup, null, 2)}
</script>

<!-- Display membership badges in footer -->
<div class="industry-memberships">
  <h4>Professional Memberships</h4>
  <div class="membership-badges">
    <img src="/images/badges/{{association}}.png" alt="{{association}} Member">
    <img src="/images/badges/{{association2}}.png" alt="{{association2}} Partner">
  </div>
</div>`;

  return {
    id: issue.id,
    title: "Display Industry Memberships",
    category: issue.category,
    subfactor: issue.subfactor,
    priority: issue.priority,
    currentScore: issue.currentScore,
    potentialScore: issue.potentialScore,
    finding: finding,
    recommendation: recommendation,
    implementationGuide: {
      actionSteps: [
        `List all current industry memberships and associations`,
        `Collect member badges and logos from associations`,
        `Add Organization schema with memberOf properties`,
        `Display membership badges on homepage/footer`,
        `Link to member directory profiles where available`
      ],
      quickWins: [
        `Add membership logos to footer (10 min)`,
        `Create partnerships/affiliations page (30 min)`,
        `Add memberOf schema markup (20 min)`
      ]
    },
    codeSnippet: codeSnippet,
    difficulty: "Easy",
    estimatedTime: "15-30 minutes",
    impactArea: "Authority Network, Trust Signals, Professional Recognition",
    estimatedGain: 14,
    validationChecklist: [
      `Organization schema includes memberOf property`,
      `All memberships are current and active`,
      `Member badges displayed prominently`,
      `Links to member profiles work correctly`,
      `Association names spelled correctly`
    ]
  };
}

module.exports = {
  makeProgrammaticCertificationRecommendation,
  makeProgrammaticTeamCredentialsRecommendation,
  makeProgrammaticMembershipsRecommendation,
  certificationDescriptions
};
