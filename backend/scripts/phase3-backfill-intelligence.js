/**
 * Phase 3 Directory Intelligence Backfill
 *
 * SAFE BACKFILL: Only updates NULL values - never overwrites existing data
 *
 * Usage: node backend/scripts/phase3-backfill-intelligence.js [--dry-run]
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Intelligence defaults by directory type
const INTELLIGENCE_DEFAULTS = {
  ai_tools: {
    search_type: 'name_search',
    requires_captcha: false,
    requires_email_verification: true,
    requires_payment: false,
    form_fields_mapping: {
      name: 'tool_name',
      url: 'website_url',
      description: 'short_description',
      category: 'category'
    },
    duplicate_check_config: {
      match_threshold: 0.8,
      match_fields: ['name', 'url'],
      action: 'skip'
    }
  },
  saas_review: {
    search_type: 'name_search',
    requires_captcha: false,
    requires_email_verification: true,
    requires_payment: false,
    form_fields_mapping: {
      name: 'product_name',
      url: 'website',
      description: 'description'
    },
    duplicate_check_config: {
      match_threshold: 0.85,
      match_fields: ['name'],
      action: 'update'
    }
  },
  startup: {
    search_type: 'name_search',
    requires_captcha: false,
    requires_email_verification: true,
    requires_payment: false,
    form_fields_mapping: {
      name: 'startup_name',
      url: 'website',
      description: 'tagline'
    },
    duplicate_check_config: {
      match_threshold: 0.9,
      match_fields: ['name', 'url'],
      action: 'skip'
    }
  },
  business_citation: {
    search_type: 'name_search',
    requires_captcha: true,
    requires_email_verification: true,
    requires_payment: false,
    form_fields_mapping: {
      name: 'business_name',
      url: 'website',
      phone: 'phone',
      address: 'address'
    },
    duplicate_check_config: {
      match_threshold: 0.85,
      match_fields: ['name', 'phone'],
      action: 'claim'
    }
  },
  dev_registry: {
    search_type: 'url_search',
    requires_captcha: false,
    requires_email_verification: true,
    requires_payment: false,
    form_fields_mapping: {
      name: 'package_name',
      url: 'repository_url',
      description: 'description'
    },
    duplicate_check_config: {
      match_threshold: 1.0,
      match_fields: ['url'],
      action: 'update'
    }
  },
  marketplace: {
    search_type: 'name_search',
    requires_captcha: true,
    requires_email_verification: true,
    requires_payment: false,
    form_fields_mapping: {
      name: 'listing_title',
      url: 'website',
      description: 'description'
    },
    duplicate_check_config: {
      match_threshold: 0.9,
      match_fields: ['name', 'url'],
      action: 'skip'
    }
  }
};

// Directory-specific overrides (by slug)
const DIRECTORY_OVERRIDES = {
  'theresanaiforthat': {
    search_url_template: 'https://theresanaiforthat.com/search/?q={{business_name}}',
    api_config: null // No API available
  },
  'futurepedia': {
    search_url_template: 'https://www.futurepedia.io/search?q={{business_name}}',
    api_config: null
  },
  'g2': {
    search_url_template: 'https://www.g2.com/search?query={{business_name}}',
    requires_captcha: true,
    api_config: {
      available: true,
      docs_url: 'https://developer.g2.com',
      requires_partnership: true
    }
  },
  'capterra': {
    search_url_template: 'https://www.capterra.com/search/?search={{business_name}}',
    requires_captcha: true,
    api_config: null
  },
  'product-hunt': {
    search_url_template: 'https://www.producthunt.com/search?q={{business_name}}',
    api_config: {
      available: true,
      docs_url: 'https://api.producthunt.com/v2/docs',
      auth_type: 'oauth2'
    }
  },
  'github-awesome': {
    search_type: 'url_search',
    requires_captcha: false,
    requires_email_verification: false,
    form_fields_mapping: {
      name: 'project_name',
      url: 'github_url',
      description: 'description'
    }
  },
  'npm-registry': {
    search_type: 'url_search',
    search_url_template: 'https://www.npmjs.com/search?q={{business_name}}',
    requires_captcha: false,
    requires_email_verification: false,
    api_config: {
      available: true,
      endpoint: 'https://registry.npmjs.org',
      auth_type: 'token'
    }
  }
};

async function backfillIntelligence(dryRun = false) {
  const client = await pool.connect();

  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Phase 3 Directory Intelligence Backfill${dryRun ? ' (DRY RUN)' : ''}`);
    console.log(`${'='.repeat(60)}\n`);

    // Get all directories with their current intelligence columns
    const result = await client.query(`
      SELECT id, slug, name, directory_type,
             search_type, search_url_template, requires_captcha,
             requires_email_verification, requires_payment,
             form_fields_mapping, api_config, duplicate_check_config
      FROM directories
      ORDER BY id
    `);

    console.log(`Found ${result.rows.length} directories to process\n`);

    let updated = 0;
    let skipped = 0;
    const updates = [];

    for (const dir of result.rows) {
      const typeDefaults = INTELLIGENCE_DEFAULTS[dir.directory_type] || {};
      const overrides = DIRECTORY_OVERRIDES[dir.slug] || {};

      // Merge: typeDefaults <- overrides (overrides win)
      const intelligence = { ...typeDefaults, ...overrides };

      // Build update for NULL columns only
      const columnsToUpdate = [];
      const values = [];
      let paramIndex = 1;

      // Check each intelligence column
      const columns = [
        { name: 'search_type', current: dir.search_type, default: intelligence.search_type || 'none' },
        { name: 'search_url_template', current: dir.search_url_template, default: intelligence.search_url_template || null },
        { name: 'requires_captcha', current: dir.requires_captcha, default: intelligence.requires_captcha || false },
        { name: 'requires_email_verification', current: dir.requires_email_verification, default: intelligence.requires_email_verification || false },
        { name: 'requires_payment', current: dir.requires_payment, default: intelligence.requires_payment || false },
        { name: 'form_fields_mapping', current: dir.form_fields_mapping, default: intelligence.form_fields_mapping ? JSON.stringify(intelligence.form_fields_mapping) : null },
        { name: 'api_config', current: dir.api_config, default: intelligence.api_config ? JSON.stringify(intelligence.api_config) : null },
        { name: 'duplicate_check_config', current: dir.duplicate_check_config, default: intelligence.duplicate_check_config ? JSON.stringify(intelligence.duplicate_check_config) : null }
      ];

      for (const col of columns) {
        // Only update if current value is NULL and we have a default
        if (col.current === null && col.default !== null) {
          columnsToUpdate.push(`${col.name} = $${paramIndex}`);
          values.push(col.default);
          paramIndex++;
        }
      }

      if (columnsToUpdate.length > 0) {
        values.push(dir.id); // For WHERE clause
        const updateQuery = `
          UPDATE directories
          SET ${columnsToUpdate.join(', ')}, updated_at = NOW()
          WHERE id = $${paramIndex}
        `;

        updates.push({
          directory: dir.name,
          slug: dir.slug,
          columns: columnsToUpdate.length,
          query: updateQuery,
          values: values
        });

        if (!dryRun) {
          await client.query(updateQuery, values);
        }

        console.log(`✅ ${dir.name} (${dir.slug}): ${columnsToUpdate.length} columns ${dryRun ? 'would be ' : ''}updated`);
        columnsToUpdate.forEach(col => {
          console.log(`   - ${col.split(' = ')[0]}`);
        });
        updated++;
      } else {
        console.log(`⏭️  ${dir.name} (${dir.slug}): No NULL columns to update`);
        skipped++;
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Summary${dryRun ? ' (DRY RUN - no changes made)' : ''}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Directories updated: ${updated}`);
    console.log(`Directories skipped: ${skipped}`);
    console.log(`Total: ${result.rows.length}`);

    if (dryRun && updates.length > 0) {
      console.log(`\nRun without --dry-run to apply these changes.`);
    }

    return { updated, skipped, total: result.rows.length };

  } catch (error) {
    console.error('\n❌ Backfill failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run script
const isDryRun = process.argv.includes('--dry-run');
backfillIntelligence(isDryRun)
  .then(() => {
    console.log('\n🎉 Backfill complete!\n');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  });
