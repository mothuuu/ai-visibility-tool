#!/usr/bin/env node
/**
 * Identify Top 10 subfactors from golden fixtures + playbook priority.
 * Phase 4A.3c Step 1
 */
const fs = require('fs');
const path = require('path');

const goldenDir = path.join(__dirname, '../../tests/fixtures/golden');
const freq = {};
const dirs = fs.readdirSync(goldenDir, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('_'));

for (const dir of dirs) {
  const apiPath = path.join(goldenDir, dir.name, 'api_response.json');
  if (!fs.existsSync(apiPath)) continue;
  const data = JSON.parse(fs.readFileSync(apiPath, 'utf8'));
  for (const rec of (data.recommendations || [])) {
    const key = rec.pillar_key || rec.subfactor_key || 'unknown';
    freq[key] = (freq[key] || 0) + 1;
  }
}

console.log('=== Fixture frequency ===');
Object.entries(freq).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(v, k));

const { SUBFACTOR_TO_PLAYBOOK } = require('../../backend/recommendations/subfactorPlaybookMap');
console.log('\n=== Playbook entries by priority ===');
const ranked = Object.entries(SUBFACTOR_TO_PLAYBOOK)
  .sort((a, b) => {
    const pw = { P0: 3, P1: 2, P2: 1 };
    const iw = { High: 4, 'Med-High': 3, Med: 2, 'Low-Med': 1 };
    return ((pw[b[1].priority] || 0) * 10 + (iw[b[1].impact] || 0)) - ((pw[a[1].priority] || 0) * 10 + (iw[a[1].impact] || 0));
  });

ranked.forEach(([k, v]) => console.log(v.priority, v.impact, k));

// Combine: top 10 = union of most frequent in fixtures + highest priority in playbook
const fixtureKeys = Object.keys(freq);
const playbookTopKeys = ranked.slice(0, 15).map(([k]) => k);

// Merge: fixture keys first (they appear in real data), then playbook priority fills remaining
const top10Set = new Set();
for (const k of fixtureKeys) {
  if (top10Set.size < 10) top10Set.add(k);
}
for (const k of playbookTopKeys) {
  if (top10Set.size < 10) top10Set.add(k);
}

const top10 = Array.from(top10Set);
console.log('\n=== TOP 10 SUBFACTORS ===');
top10.forEach((k, i) => console.log(`${i + 1}. ${k}`));

// Write to file
const outPath = path.join(__dirname, '../../backend/recommendations/topSubfactors.phase4a3c.json');
fs.writeFileSync(outPath, JSON.stringify({ top10, generated_at: new Date().toISOString(), source: 'fixtures + playbook priority' }, null, 2) + '\n');
console.log(`\nWritten to ${outPath}`);
