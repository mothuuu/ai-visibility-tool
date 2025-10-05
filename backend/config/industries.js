// backend/config/industries.js
// Enhanced industry detection with weighted keywords, context patterns, and exclusions

const INDUSTRIES = [
  // ============ DEFAULT FALLBACK ============
  {
    key: 'general_b2b',
    name: 'General B2B',
    strongKeywords: ['enterprise solutions', 'business solutions', 'b2b platform'],
    mediumKeywords: ['platform', 'enterprise', 'business'],
    weakKeywords: ['solutions', 'services', 'consulting'],
    domainKeywords: [],
    painPoints: ['cost reduction', 'operational efficiency', 'scalability', 'integration'],
    priority: 0 // Lowest priority - only if nothing else matches
  },

  // ============ TECHNOLOGY & SOFTWARE ============
  {
    key: 'saas',
    name: 'SaaS / Software',
    strongKeywords: [
      'saas platform', 'software as a service', 'subscription software',
      'cloud-based software', 'multi-tenant', 'per user pricing'
    ],
    mediumKeywords: [
      'api integration', 'webhooks', 'dashboard', 'user management',
      'free trial', 'pricing plans', 'monthly subscription', 'annual billing',
      'self-service', 'onboarding', 'admin panel'
    ],
    weakKeywords: ['software', 'cloud', 'platform', 'app', 'application'],
    domainKeywords: ['app', 'saas', 'cloud', 'platform', 'software'],
    contextPatterns: [
      'sign up free', 'start free trial', 'per user per month',
      'cancel anytime', 'no credit card required', 'freemium'
    ],
    excludeKeywords: [
      'software development services', 'custom software development',
      'software consulting', 'it services'
    ],
    painPoints: [
      'user adoption', 'data migration', 'integration complexity',
      'api limits', 'vendor lock-in', 'security compliance'
    ],
    certifications: ['soc 2', 'iso 27001', 'gdpr compliant'],
    priority: 8
  },

  {
    key: 'ai_ml',
    name: 'AI / Machine Learning',
    strongKeywords: [
      'artificial intelligence platform', 'machine learning platform',
      'generative ai', 'large language model', 'llm', 'neural network',
      'deep learning', 'ai models', 'ai training'
    ],
    mediumKeywords: [
      'ai automation', 'predictive analytics', 'computer vision',
      'natural language processing', 'nlp', 'ai agent',
      'model training', 'inference', 'embeddings'
    ],
    weakKeywords: ['ai', 'artificial intelligence', 'machine learning', 'ml', 'automation'],
    domainKeywords: ['ai', 'ml', 'labs', 'intelligence', 'neural'],
    contextPatterns: [
      'train your model', 'ai-powered', 'powered by ai',
      'machine learning models', 'ai capabilities'
    ],
    painPoints: [
      'model accuracy', 'training data', 'compute cost',
      'model bias', 'explainability', 'inference latency'
    ],
    certifications: ['iso 42001', 'responsible ai'],
    priority: 9
  },

  {
    key: 'cybersecurity',
    name: 'Cybersecurity',
    strongKeywords: [
      'zero trust security', 'siem platform', 'security operations center',
      'xdr solution', 'edr platform', 'threat detection',
      'security information and event management'
    ],
    mediumKeywords: [
      'endpoint protection', 'vulnerability management', 'penetration testing',
      'incident response', 'threat intelligence', 'security monitoring',
      'access control', 'identity management'
    ],
    weakKeywords: ['security', 'cybersecurity', 'firewall', 'antivirus', 'protection'],
    domainKeywords: ['sec', 'cyber', 'security', 'shield', 'guard'],
    contextPatterns: [
      'detect threats', 'prevent breaches', 'security posture',
      'attack surface', 'threat hunting'
    ],
    excludeKeywords: ['physical security', 'security guard'],
    painPoints: [
      'data breach', 'ransomware attacks', 'zero-day exploits',
      'compliance violations', 'alert fatigue', 'threat detection'
    ],
    certifications: ['cissp', 'cisa', 'cism', 'soc 2 type 2'],
    priority: 9
  },

  {
    key: 'devtools',
    name: 'Developer Tools / DevOps',
    strongKeywords: [
      'developer platform', 'ci/cd pipeline', 'kubernetes platform',
      'container orchestration', 'observability platform', 'apm tool'
    ],
    mediumKeywords: [
      'code repository', 'version control', 'deployment automation',
      'infrastructure as code', 'monitoring and logging', 'debugging tools',
      'api testing', 'performance monitoring'
    ],
    weakKeywords: ['developers', 'devops', 'api', 'sdk', 'cli', 'tools'],
    domainKeywords: ['dev', 'code', 'git', 'deploy', 'ops'],
    contextPatterns: [
      'ship code faster', 'deploy with confidence', 'for developers',
      'developer experience', 'developer-first'
    ],
    painPoints: [
      'deployment complexity', 'slow builds', 'debugging difficulty',
      'environment parity', 'tool sprawl', 'integration overhead'
    ],
    certifications: ['kubernetes certified', 'aws certified devops'],
    priority: 8
  },

  // ============ IT SERVICES ============
  {
    key: 'msp',
    name: 'Managed Service Provider (MSP)',
    strongKeywords: [
      'managed it services', 'managed service provider', 'it outsourcing',
      'remote monitoring and management', 'rmm', 'network monitoring services'
    ],
    mediumKeywords: [
      'it support services', '24/7 helpdesk', 'proactive monitoring',
      'patch management', 'backup and disaster recovery', 'cloud migration services',
      'service level agreement', 'break-fix support'
    ],
    weakKeywords: ['it support', 'managed services', 'helpdesk', 'it consulting'],
    domainKeywords: ['msp', 'itsupport', 'managed', 'itservices'],
    contextPatterns: [
      'we manage your it', 'outsourced it department', 'it as a service',
      'guaranteed uptime', 'proactive it support'
    ],
    excludeKeywords: [
      'software development', 'saas platform', 'product company',
      'software product', 'api platform'
    ],
    painPoints: [
      'system downtime', 'data loss', 'compliance requirements',
      'it budget constraints', 'cybersecurity threats', 'legacy systems'
    ],
    certifications: ['comptia managed services', 'microsoft gold partner'],
    priority: 7
  },

  {
    key: 'telecom',
    name: 'Telecommunications',
    strongKeywords: [
      'telecommunications provider', 'broadband internet', 'fiber optic network',
      '5g network', 'wireless carrier', 'network infrastructure'
    ],
    mediumKeywords: [
      'internet service provider', 'isp', 'mobile network', 'data plans',
      'voice and data', 'network coverage', 'cellular service', 'unified communications'
    ],
    weakKeywords: ['telecom', 'communications', 'network', 'connectivity', 'bandwidth'],
    domainKeywords: ['telecom', 'fiber', 'wireless', 'mobile', 'network'],
    contextPatterns: [
      'network coverage', 'data speeds', 'unlimited data',
      'nationwide network', 'fiber to the home'
    ],
    painPoints: [
      'network coverage gaps', 'bandwidth limitations', 'customer churn',
      'infrastructure costs', 'regulatory compliance', '5g deployment'
    ],
    certifications: ['fcc licensed', 'iso 9001'],
    priority: 8
  },

  // ============ MARKETING & SALES ============
  {
    key: 'martech',
    name: 'Marketing Technology',
    strongKeywords: [
      'marketing automation platform', 'email marketing software',
      'marketing analytics platform', 'customer data platform', 'cdp',
      'campaign management software'
    ],
    mediumKeywords: [
      'email campaigns', 'lead nurturing', 'marketing workflows',
      'landing page builder', 'a/b testing', 'conversion optimization',
      'customer segmentation', 'multi-channel marketing'
    ],
    weakKeywords: ['marketing', 'email', 'campaigns', 'analytics', 'crm'],
    domainKeywords: ['mail', 'campaign', 'market', 'engage'],
    contextPatterns: [
      'automate marketing', 'personalize emails', 'track campaign performance',
      'nurture leads', 'marketing attribution', 'grow your audience'
    ],
    excludeKeywords: [
      'marketing agency', 'marketing services', 'marketing consulting',
      'digital marketing services', 'seo services'
    ],
    painPoints: [
      'low email open rates', 'poor lead quality', 'attribution accuracy',
      'marketing roi', 'data silos', 'deliverability issues'
    ],
    certifications: ['hubspot certified', 'marketo certified', 'salesforce certified'],
    integrations: ['salesforce', 'hubspot', 'marketo', 'mailchimp'],
    priority: 8
  },

  {
    key: 'sales_tech',
    name: 'Sales Technology / CRM',
    strongKeywords: [
      'crm software', 'sales automation platform', 'customer relationship management',
      'sales engagement platform', 'revenue operations', 'sales intelligence'
    ],
    mediumKeywords: [
      'pipeline management', 'deal tracking', 'sales forecasting',
      'contact management', 'sales analytics', 'lead scoring',
      'sales enablement', 'quote to cash'
    ],
    weakKeywords: ['sales', 'crm', 'pipeline', 'deals', 'contacts'],
    domainKeywords: ['crm', 'sales', 'pipeline', 'revenue'],
    contextPatterns: [
      'close more deals', 'accelerate sales', 'sales productivity',
      'win rate', 'sales velocity', 'forecast accuracy'
    ],
    painPoints: [
      'long sales cycles', 'low win rates', 'poor forecast accuracy',
      'data entry burden', 'rep productivity', 'pipeline visibility'
    ],
    certifications: ['salesforce certified', 'hubspot sales certified'],
    priority: 8
  },

  // ============ HR & PEOPLE ============
  {
    key: 'hrtech',
    name: 'HR Technology / HCM',
    strongKeywords: [
      'human capital management', 'hcm software', 'hr management system',
      'applicant tracking system', 'ats', 'payroll software',
      'performance management software'
    ],
    mediumKeywords: [
      'talent acquisition', 'employee onboarding', 'time and attendance',
      'benefits administration', 'compensation management', 'hr analytics',
      'employee engagement', 'succession planning'
    ],
    weakKeywords: ['hr', 'human resources', 'recruiting', 'payroll', 'benefits'],
    domainKeywords: ['hr', 'talent', 'jobs', 'careers', 'recruiting'],
    contextPatterns: [
      'hire better talent', 'employee experience', 'workforce management',
      'talent management', 'people analytics', 'streamline hr'
    ],
    painPoints: [
      'time-to-hire', 'employee turnover', 'compliance risk',
      'manual processes', 'talent shortage', 'engagement scores'
    ],
    certifications: ['shrm certified', 'hrci certified'],
    priority: 7
  },

  // ============ FINANCE ============
  {
    key: 'fintech',
    name: 'Financial Technology',
    strongKeywords: [
      'digital banking platform', 'payment processing', 'fintech solution',
      'embedded finance', 'banking as a service', 'baas', 'open banking'
    ],
    mediumKeywords: [
      'payment gateway', 'merchant services', 'fraud prevention',
      'kyc verification', 'aml compliance', 'digital wallet',
      'peer-to-peer payments', 'real-time payments'
    ],
    weakKeywords: ['payments', 'banking', 'financial', 'money', 'transactions'],
    domainKeywords: ['pay', 'bank', 'fin', 'wallet', 'money'],
    contextPatterns: [
      'instant payments', 'secure transactions', 'frictionless checkout',
      'payment orchestration', 'financial infrastructure'
    ],
    excludeKeywords: ['financial advisory', 'wealth management services', 'investment firm'],
    painPoints: [
      'payment fraud', 'transaction fees', 'regulatory compliance',
      'pci dss', 'cross-border payments', 'settlement times'
    ],
    certifications: ['pci dss certified', 'iso 27001', 'soc 2'],
    priority: 9
  },

  {
    key: 'accounting',
    name: 'Accounting / Finance Software',
    strongKeywords: [
      'accounting software', 'financial management system', 'erp software',
      'accounts payable automation', 'expense management software', 'financial close'
    ],
    mediumKeywords: [
      'bookkeeping', 'accounts receivable', 'general ledger', 'financial reporting',
      'tax compliance', 'audit trail', 'revenue recognition', 'invoicing'
    ],
    weakKeywords: ['accounting', 'finance', 'invoices', 'expenses', 'reporting'],
    domainKeywords: ['accounting', 'finance', 'quickbooks', 'erp'],
    contextPatterns: [
      'automate accounting', 'financial close process', 'real-time financials',
      'gaap compliant', 'ifrs compliant'
    ],
    painPoints: [
      'manual data entry', 'reconciliation errors', 'compliance risk',
      'close process time', 'audit readiness', 'financial visibility'
    ],
    certifications: ['cpa approved', 'gaap compliant', 'sox compliant'],
    priority: 7
  },

  // ============ ECOMMERCE & RETAIL ============
  {
    key: 'ecommerce',
    name: 'eCommerce Platform',
    strongKeywords: [
      'ecommerce platform', 'online store builder', 'shopping cart software',
      'headless commerce', 'composable commerce', 'marketplace platform'
    ],
    mediumKeywords: [
      'product catalog', 'checkout optimization', 'inventory management',
      'multi-channel selling', 'payment integration', 'shipping integration',
      'abandoned cart recovery', 'product recommendations'
    ],
    weakKeywords: ['ecommerce', 'online store', 'shop', 'cart', 'checkout'],
    domainKeywords: ['shop', 'store', 'cart', 'commerce', 'buy'],
    contextPatterns: [
      'sell online', 'launch your store', 'grow your online business',
      'increase conversions', 'omnichannel retail'
    ],
    excludeKeywords: ['retail consulting', 'retail services'],
    painPoints: [
      'cart abandonment', 'conversion rate', 'inventory sync',
      'shipping costs', 'returns management', 'mobile optimization'
    ],
    certifications: ['pci dss', 'gdpr compliant'],
    priority: 8
  },

  // ============ HEALTHCARE ============
  {
    key: 'healthtech',
    name: 'Healthcare Technology',
    strongKeywords: [
      'electronic health records', 'ehr system', 'emr software',
      'practice management software', 'patient portal', 'telehealth platform',
      'clinical decision support'
    ],
    mediumKeywords: [
      'patient scheduling', 'medical billing', 'clinical workflows',
      'care coordination', 'population health', 'patient engagement',
      'medical imaging', 'lab integration', 'e-prescribing'
    ],
    weakKeywords: ['healthcare', 'medical', 'patient', 'clinical', 'hospital'],
    domainKeywords: ['health', 'medical', 'care', 'clinic', 'patient'],
    contextPatterns: [
      'improve patient outcomes', 'clinical efficiency', 'patient care',
      'value-based care', 'interoperability'
    ],
    painPoints: [
      'hipaa compliance', 'interoperability', 'documentation burden',
      'patient no-shows', 'claim denials', 'ehr usability'
    ],
    certifications: ['hipaa compliant', 'hitrust', 'hl7', 'fhir'],
    priority: 9
  },

  // ============ DATA & ANALYTICS ============
  {
    key: 'data_analytics',
    name: 'Data & Analytics Platform',
    strongKeywords: [
      'business intelligence platform', 'data warehouse', 'data lake',
      'analytics platform', 'etl tool', 'data pipeline', 'data integration'
    ],
    mediumKeywords: [
      'data visualization', 'reporting dashboards', 'predictive analytics',
      'self-service analytics', 'data governance', 'data quality',
      'real-time analytics', 'data modeling'
    ],
    weakKeywords: ['analytics', 'data', 'reporting', 'insights', 'dashboards'],
    domainKeywords: ['data', 'analytics', 'bi', 'insights'],
    contextPatterns: [
      'data-driven decisions', 'actionable insights', 'unified data view',
      'single source of truth', 'democratize data'
    ],
    painPoints: [
      'data silos', 'data quality', 'slow reporting', 'data literacy',
      'integration complexity', 'scalability'
    ],
    certifications: ['iso 27001', 'soc 2'],
    priority: 7
  },

  // ============ CUSTOMER SUPPORT ============
  {
    key: 'customer_support',
    name: 'Customer Support / Success',
    strongKeywords: [
      'helpdesk software', 'customer support platform', 'ticketing system',
      'customer success platform', 'live chat software', 'knowledge base software'
    ],
    mediumKeywords: [
      'ticket management', 'omnichannel support', 'chatbot', 'self-service portal',
      'customer health scoring', 'churn prediction', 'support analytics',
      'sla management'
    ],
    weakKeywords: ['support', 'helpdesk', 'customer service', 'tickets', 'chat'],
    domainKeywords: ['support', 'help', 'service', 'desk'],
    contextPatterns: [
      'customer satisfaction', 'reduce churn', 'first response time',
      'csat score', 'nps score', 'customer retention'
    ],
    painPoints: [
      'response times', 'ticket volume', 'customer churn', 'agent productivity',
      'knowledge gaps', 'escalations'
    ],
    certifications: ['copc certified', 'itil certified'],
    priority: 7
  },

  // ============ EDUCATION ============
  {
    key: 'edtech',
    name: 'Education Technology',
    strongKeywords: [
      'learning management system', 'lms platform', 'online course platform',
      'student information system', 'virtual classroom', 'educational software'
    ],
    mediumKeywords: [
      'online learning', 'course authoring', 'student engagement',
      'assessment tools', 'grade book', 'learning analytics',
      'adaptive learning', 'skills development'
    ],
    weakKeywords: ['education', 'learning', 'courses', 'students', 'teaching'],
    domainKeywords: ['edu', 'learn', 'school', 'academy', 'course'],
    contextPatterns: [
      'personalized learning', 'student outcomes', 'learning paths',
      'competency-based', 'blended learning'
    ],
    painPoints: [
      'student engagement', 'learning outcomes', 'accessibility',
      'content creation time', 'assessment validity', 'learner retention'
    ],
    certifications: ['ferpa compliant', 'coppa compliant', 'wcag 2.1'],
    priority: 7
  },

  // ============ REAL ESTATE ============
  {
    key: 'proptech',
    name: 'Property Technology',
    strongKeywords: [
      'property management software', 'real estate platform', 'proptech solution',
      'tenant portal', 'lease management', 'building management system'
    ],
    mediumKeywords: [
      'rent collection', 'maintenance requests', 'property listings',
      'showing scheduling', 'tenant screening', 'lease tracking',
      'vacancy management', 'portfolio analytics'
    ],
    weakKeywords: ['property', 'real estate', 'rental', 'lease', 'tenant'],
    domainKeywords: ['property', 'realty', 'homes', 'rent', 'estate'],
    contextPatterns: [
      'property owners', 'landlords', 'commercial real estate',
      'multifamily', 'occupancy rate'
    ],
    painPoints: [
      'vacancy rates', 'rent collection', 'maintenance coordination',
      'tenant turnover', 'compliance tracking', 'operating expenses'
    ],
    priority: 7
  },

  // ============ MANUFACTURING & INDUSTRIAL ============
  {
    key: 'manufacturing',
    name: 'Manufacturing Software',
    strongKeywords: [
      'manufacturing execution system', 'mes software', 'production planning',
      'quality management system', 'qms', 'supply chain management',
      'plm software', 'oee tracking'
    ],
    mediumKeywords: [
      'work order management', 'inventory control', 'shop floor control',
      'production scheduling', 'traceability', 'preventive maintenance',
      'bill of materials', 'capacity planning'
    ],
    weakKeywords: ['manufacturing', 'production', 'factory', 'assembly', 'quality'],
    domainKeywords: ['mfg', 'factory', 'industrial', 'production'],
    contextPatterns: [
      'lean manufacturing', 'reduce downtime', 'improve oee',
      'production efficiency', 'digital twin'
    ],
    painPoints: [
      'unplanned downtime', 'quality defects', 'inventory waste',
      'production bottlenecks', 'compliance documentation', 'supply chain disruption'
    ],
    certifications: ['iso 9001', 'iso 13485', 'iatf 16949'],
    priority: 8
  },

  // ============ LOGISTICS ============
  {
    key: 'logistics',
    name: 'Logistics & Supply Chain',
    strongKeywords: [
      'transportation management system', 'tms software', 'warehouse management',
      'wms platform', 'fleet management', 'last mile delivery', 'route optimization'
    ],
    mediumKeywords: [
      'shipment tracking', 'freight management', 'carrier integration',
      'order fulfillment', 'inventory optimization', 'dock scheduling',
      'yard management', 'load planning'
    ],
    weakKeywords: ['logistics', 'shipping', 'warehouse', 'delivery', 'freight'],
    domainKeywords: ['logistics', 'freight', 'shipping', 'fleet', 'transport'],
    contextPatterns: [
      'on-time delivery', 'reduce shipping costs', 'supply chain visibility',
      'track and trace', 'optimize routes'
    ],
    painPoints: [
      'delivery delays', 'shipping costs', 'inventory accuracy',
      'carrier capacity', 'last mile challenges', 'visibility gaps'
    ],
    certifications: ['iso 9001', 'c-tpat', 'hazmat certified'],
    priority: 8
  },

  // ============ PROFESSIONAL SERVICES ============
  {
    key: 'psa',
    name: 'Professional Services Automation',
    strongKeywords: [
      'professional services automation', 'psa software', 'project management software',
      'resource management platform', 'time tracking software', 'billing and invoicing'
    ],
    mediumKeywords: [
      'project accounting', 'resource allocation', 'utilization tracking',
      'project profitability', 'expense tracking', 'client portal',
      'milestone billing', 'capacity planning'
    ],
    weakKeywords: ['consulting', 'professional services', 'projects', 'billable hours'],
    domainKeywords: ['consult', 'services', 'projects', 'advisory'],
    contextPatterns: [
      'professional services firm', 'consulting firm', 'billable utilization',
      'project delivery', 'resource utilization'
    ],
    excludeKeywords: ['software development services', 'marketing services'],
    painPoints: [
      'resource utilization', 'project profitability', 'scope creep',
      'accurate forecasting', 'billing delays', 'capacity planning'
    ],
    priority: 7
  },

  // ============ CONSTRUCTION ============
  {
    key: 'construction',
    name: 'Construction Technology',
    strongKeywords: [
      'construction management software', 'bim platform', 'project controls',
      'general contractor software', 'subcontractor management', 'construction erp'
    ],
    mediumKeywords: [
      'bid management', 'rfp management', 'change orders', 'punch lists',
      'daily reports', 'job costing', 'safety management', 'document control'
    ],
    weakKeywords: ['construction', 'building', 'contractor', 'project'],
    domainKeywords: ['build', 'construction', 'contractor', 'project'],
    contextPatterns: [
      'construction projects', 'job sites', 'field workers',
      'general contractor', 'subcontractors'
    ],
    painPoints: [
      'project delays', 'cost overruns', 'safety incidents',
      'communication breakdowns', 'document control', 'change order management'
    ],
    certifications: ['osha compliant', 'leed certified'],
    priority: 7
  },

  // ============ LEGAL ============
  {
    key: 'legaltech',
    name: 'Legal Technology',
    strongKeywords: [
      'legal practice management', 'case management software', 'contract lifecycle management',
      'clm software', 'legal billing software', 'e-discovery platform'
    ],
    mediumKeywords: [
      'matter management', 'document automation', 'legal research',
      'time and billing', 'trust accounting', 'client intake',
      'docket management', 'conflict checking'
    ],
    weakKeywords: ['legal', 'law', 'attorney', 'lawyer', 'contracts'],
    domainKeywords: ['legal', 'law', 'attorney', 'counsel'],
    contextPatterns: [
      'law firm', 'legal department', 'corporate legal',
      'legal operations', 'matter lifecycle'
    ],
    painPoints: [
      'billable hours', 'client communication', 'deadline management',
      'document version control', 'compliance tracking', 'conflict checks'
    ],
    certifications: ['abanet approved', 'legal hold compliant'],
    priority: 7
  },

  // ============ INSURANCE ============
  {
    key: 'insurtech',
    name: 'Insurance Technology',
    strongKeywords: [
      'insurance platform', 'policy administration system', 'claims management software',
      'underwriting software', 'insurance broker platform', 'insurtech solution'
    ],
    mediumKeywords: [
      'policy lifecycle', 'claims processing', 'risk assessment',
      'agent portal', 'quote and bind', 'commission tracking',
      'actuarial analysis', 'reinsurance'
    ],
    weakKeywords: ['insurance', 'policy', 'claims', 'underwriting', 'coverage'],
    domainKeywords: ['insurance', 'policy', 'claims', 'coverage'],
    contextPatterns: [
      'insurance carriers', 'policy administration', 'claims adjusters',
      'loss ratio', 'combined ratio'
    ],
    painPoints: [
      'claims processing time', 'fraud detection', 'policy lapses',
      'regulatory compliance', 'legacy systems', 'customer retention'
    ],
    certifications: ['iso compliant', 'naic approved'],
    priority: 8
  },

  // ============ NONPROFIT ============
  {
    key: 'nonprofit',
    name: 'Nonprofit Technology',
    strongKeywords: [
      'nonprofit software', 'donor management system', 'fundraising platform',
      'grant management software', 'volunteer management', 'nonprofit crm'
    ],
    mediumKeywords: [
      'donation processing', 'donor engagement', 'campaign management',
      'grant tracking', 'impact reporting', 'event management',
      'membership management', 'peer-to-peer fundraising'
    ],
    weakKeywords: ['nonprofit', 'charity', 'donations', 'fundraising', 'volunteers'],
    domainKeywords: ['nonprofit', 'charity', 'foundation', 'giving'],
    contextPatterns: [
      'nonprofit organization', 'charitable giving', 'donor retention',
      'fundraising campaigns', 'mission impact'
    ],
    painPoints: [
      'donor retention', 'fundraising efficiency', 'volunteer coordination',
      'grant reporting', 'donor data management', 'recurring donations'
    ],
    certifications: ['pci dss', 'gdpr compliant'],
    priority: 6
  }
];

// Scoring weights
const KEYWORD_WEIGHTS = {
  strong: 3,
  medium: 1.5,
  weak: 0.5,
  domain: 3,
  context: 2,
  certification: 1.5,
  painPoint: 0.5,
  exclude: -2
};

module.exports = { INDUSTRIES, KEYWORD_WEIGHTS };
