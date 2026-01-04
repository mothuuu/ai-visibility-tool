/**
 * Visible2AI Migration Runner v6
 *
 * Features:
 * - Transaction per migration (atomic)
 * - Checksum tracking (detect changes)
 * - Advisory lock (prevent concurrent runs)
 * - Backfill protection with categorization
 * - Re-apply after rollback support (revives rolled-back rows)
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const LOCK_ID = 12345;

const MIGRATION_CATEGORIES = {
  '000': 'infrastructure',
  '001': 'schema',
  '002': 'schema',
  '003': 'data-creating-backfill',
  '004': 'schema',
  '005': 'linkage-backfill',
  '006': 'schema',
  '007': 'data-creating-backfill',
  '008': 'schema',
  '009': 'data-creating-backfill',
  '010': 'schema'
};

const DANGEROUS_ROLLBACKS = ['003', '007', '009'];

async function acquireLock(client) {
  const result = await client.query('SELECT pg_try_advisory_lock($1)', [LOCK_ID]);
  return result.rows[0].pg_try_advisory_lock;
}

async function releaseLock(client) {
  await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
}

function getChecksum(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      version VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(50),
      applied_at TIMESTAMPTZ DEFAULT NOW(),
      rolled_back_at TIMESTAMPTZ,
      checksum VARCHAR(64),
      execution_time_ms INTEGER
    )
  `);

  await client.query(`
    ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS category VARCHAR(50)
  `);
}

async function runMigrations(direction = 'up') {
  const client = await pool.connect();
  let exitCode = 0;
  let lockAcquired = false;

  try {
    lockAcquired = await acquireLock(client);
    if (!lockAcquired) throw new Error('Another migration is in progress. Aborting.');

    await ensureMigrationsTable(client);

    const migrationsDir = path.join(__dirname, 'migrations/phase1');

    if (direction === 'up') {
      const files = fs
        .readdirSync(migrationsDir)
        .filter(f => f.match(/^\d{3}_.*\.sql$/) && !f.includes('_rollback'))
        .sort();

      const { rows: allMigrations } = await client.query(
        'SELECT version, checksum, rolled_back_at FROM schema_migrations'
      );
      const migrationMap = new Map(allMigrations.map(r => [r.version, r]));

      for (const file of files) {
        const version = file.split('_')[0];
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        const checksum = getChecksum(sql);
        const category = MIGRATION_CATEGORIES[version] || 'unknown';

        const existing = migrationMap.get(version);

        if (existing && !existing.rolled_back_at) {
          if (existing.checksum !== checksum) console.warn(`⚠️  Warning: ${file} has been modified since applied`);
          console.log(`⏭️  Skipping ${file} (already applied)`);
          continue;
        }

        const categoryLabel = category.includes('backfill') ? ` [${category.toUpperCase()}]` : '';
        const reapplyLabel = existing?.rolled_back_at ? ' (re-applying)' : '';
        console.log(`🚀 Applying ${file}${categoryLabel}${reapplyLabel}...`);
        const startTime = Date.now();

        await client.query('BEGIN');
        try {
          await client.query(sql);
          const executionTime = Date.now() - startTime;

          if (existing?.rolled_back_at) {
            await client.query(
              `UPDATE schema_migrations
               SET rolled_back_at = NULL,
                   applied_at = NOW(),
                   name = $1,
                   checksum = $2,
                   execution_time_ms = $3,
                   category = $4
               WHERE version = $5`,
              [file, checksum, executionTime, category, version]
            );
          } else {
            await client.query(
              `INSERT INTO schema_migrations (version, name, category, checksum, execution_time_ms)
               VALUES ($1, $2, $3, $4, $5)`,
              [version, file, category, checksum, executionTime]
            );
          }

          await client.query('COMMIT');
          console.log(`✅ Applied ${file} (${executionTime}ms)`);
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`❌ Failed ${file}:`, err.message);
          throw err;
        }
      }

      console.log('\n✅ All migrations applied successfully');
    } else if (direction === 'down') {
      const { rows } = await client.query(
        `SELECT version, name, category FROM schema_migrations
         WHERE rolled_back_at IS NULL
         ORDER BY version DESC LIMIT 1`
      );

      if (rows.length === 0) {
        console.log('No migrations to rollback');
        return;
      }

      const { version, name, category } = rows[0];

      if (DANGEROUS_ROLLBACKS.includes(version)) {
        console.log('\n' + '⚠️'.repeat(25));
        console.log(`\n🚨 DANGER: ${name} is a DATA-CREATING BACKFILL!`);
        console.log('Rolling back will DELETE PRODUCTION DATA (organizations, domains, or usage data).');
        console.log('\n📁 RECOMMENDED: Restore from full backup instead:');
        console.log('   pg_restore --clean --if-exists --no-owner --no-privileges -d $DATABASE_URL backend/db/backups/pre_phase1_full.dump');
        console.log('\nTo force destructive rollback anyway: npm run db:rollback:force');
        console.log('\n' + '⚠️'.repeat(25) + '\n');

        if (process.argv[3] !== '--force') throw new Error('Dangerous rollback blocked. Use --force to override.');
        console.log('⚠️  Force flag detected. Proceeding with DESTRUCTIVE rollback...\n');
      }

      const rollbackFile = name.replace('.sql', '_rollback.sql');
      const rollbackPath = path.join(migrationsDir, rollbackFile);
      if (!fs.existsSync(rollbackPath)) throw new Error(`No rollback file found: ${rollbackFile}`);

      console.log(`⏪ Rolling back ${name} [${category}]...`);
      const sql = fs.readFileSync(rollbackPath, 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(`UPDATE schema_migrations SET rolled_back_at = NOW() WHERE version = $1`, [version]);
        await client.query('COMMIT');
        console.log(`✅ Rolled back ${name}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ Rollback failed:`, err.message);
        throw err;
      }
    } else if (direction === 'status') {
      const { rows } = await client.query(
        `SELECT version, name, category, applied_at, rolled_back_at, execution_time_ms
         FROM schema_migrations ORDER BY version`
      );

      console.log('\n📋 Migration Status\n');
      for (const row of rows) {
        const status = row.rolled_back_at ? '⏪' : '✅';
        const cat = row.category ? ` [${row.category}]` : '';
        console.log(`${status} ${row.version} | ${row.name}${cat} | ${row.execution_time_ms}ms`);
      }
    }
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    exitCode = 1;
  } finally {
    if (lockAcquired) {
      try { await releaseLock(client); }
      catch (e) { console.error('⚠️  Warning: failed to release advisory lock:', e.message); }
    }
    client.release();
    await pool.end();
    process.exit(exitCode);
  }
}

const direction = process.argv[2] || 'up';
runMigrations(direction);
