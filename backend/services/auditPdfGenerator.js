/**
 * Audit PDF Generator
 *
 * Renders an existing scan's data into a branded PDF report. No AI calls.
 * Used by the audit_pdf pack template (cost: 10 tokens — formatting only).
 *
 * Lazy-loads `pdfkit` so this module can be required even when the dep
 * isn't installed (tests stub it via Module._load).
 *
 * Brand:
 *   Cyan      #00B9DA
 *   Hot Pink  #f31c7e
 *   Purple    #7D41A5
 *   Teal      #4DACA6
 *   Deep Navy #0D0D1A
 *   Fonts:    Syne (display) + DM Sans (body) — fall back to PDFKit defaults
 *             when not registered (avoids font-file dependency).
 */

const BRAND = Object.freeze({
  cyan:    '#00B9DA',
  pink:    '#f31c7e',
  purple:  '#7D41A5',
  teal:    '#4DACA6',
  navy:    '#0D0D1A',
  white:   '#FFFFFF',
  gray100: '#f3f4f6',
  gray400: '#9ca3af',
  gray700: '#374151',
  red:     '#dc2626',
  orange:  '#ea580c',
  yellow:  '#ca8a04',
  green:   '#16a34a'
});

function severityColor(severity) {
  switch ((severity || '').toLowerCase()) {
    case 'critical': return BRAND.red;
    case 'high':     return BRAND.orange;
    case 'medium':   return BRAND.yellow;
    case 'low':      return BRAND.green;
    default:         return BRAND.gray400;
  }
}

function pillarBucketColor(pct) {
  if (pct < 40) return BRAND.red;
  if (pct < 60) return BRAND.orange;
  if (pct < 80) return BRAND.yellow;
  return BRAND.green;
}

function buildExecutiveSummary(domain, score, severityCounts, pillarCount) {
  const critical = severityCounts.critical || 0;
  const high = severityCounts.high || 0;
  return (
    `This report analyzes ${domain || 'the site'}'s visibility across AI assistants. ` +
    `The site scored ${score ?? 'n/a'}/1000, with ${critical} critical and ${high} high-priority ` +
    `findings across ${pillarCount} evaluation categories.`
  );
}

function countSeverities(findings) {
  const c = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings || []) {
    const s = (f.severity || '').toLowerCase();
    if (c[s] !== undefined) c[s]++;
  }
  return c;
}

/**
 * Build the audit PDF for a scan context.
 *
 * @param {object} context - PackEngine context: { domain, scanScore, pillarScores,
 *                            findings, pageUrls, pageCount, ... }
 * @returns {Promise<{ pdf_base64: string, byte_size: number, executive_summary: string,
 *                     severity_counts: object, sections: string[] }>}
 */
async function generateAuditPdf(context) {
  let PDFDocument;
  try {
    PDFDocument = require('pdfkit');
  } catch (err) {
    throw new Error(
      `pdfkit not installed (audit_pdf pack requires it). Run: npm install pdfkit. (${err.message})`
    );
  }

  const domain = context.domain || 'unknown';
  const score = context.scanScore;
  const pillarScores = context.pillarScores || {};
  const findings = context.findings || [];
  const pageUrls = context.pageUrls || [];
  const reportDate = new Date().toISOString().slice(0, 10);

  const severityCounts = countSeverities(findings);
  const pillarCount = Object.keys(pillarScores).length || 8;
  const executiveSummary = buildExecutiveSummary(domain, score, severityCounts, pillarCount);

  const sectionsRendered = [];
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: {
    Title: `AI Visibility Audit — ${domain}`,
    Author: 'Visible2AI',
    Subject: `Audit report for ${domain}`,
    CreationDate: new Date()
  }});

  // Collect output as a Buffer
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  // -------------------------------------------------------------------------
  // 1) Cover page
  // -------------------------------------------------------------------------
  sectionsRendered.push('cover');
  doc.fillColor(BRAND.navy).rect(0, 0, doc.page.width, doc.page.height).fill();

  // Logo word-mark
  doc.fillColor(BRAND.cyan).fontSize(32).text('Visible', 50, 80, { continued: true });
  doc.fillColor(BRAND.pink).text('2', { continued: true });
  doc.fillColor(BRAND.purple).text('AI');

  doc.moveDown(4);
  doc.fillColor(BRAND.white).fontSize(28).text('AI Visibility Audit Report');

  doc.moveDown(1);
  doc.fillColor(BRAND.cyan).fontSize(20).text(domain);

  doc.moveDown(0.5);
  doc.fillColor(BRAND.gray400).fontSize(12).text(`Report date: ${reportDate}`);

  // Big score block
  doc.moveDown(4);
  doc.fillColor(BRAND.white).fontSize(14).text('Overall Score', { align: 'center' });
  doc.moveDown(0.3);
  doc.fillColor(BRAND.cyan).fontSize(72).text(
    `${score ?? '—'}`, { align: 'center', continued: true }
  );
  doc.fillColor(BRAND.gray400).fontSize(28).text(' / 1000', { align: 'center' });

  // -------------------------------------------------------------------------
  // 2) Executive summary
  // -------------------------------------------------------------------------
  doc.addPage();
  sectionsRendered.push('executive_summary');
  doc.fillColor(BRAND.navy).fontSize(20).text('Executive Summary');
  doc.moveDown(0.5);
  doc.fillColor(BRAND.gray700).fontSize(11).text(executiveSummary, { align: 'left', lineGap: 4 });

  // -------------------------------------------------------------------------
  // 3) Score breakdown — pillar table
  // -------------------------------------------------------------------------
  doc.moveDown(2);
  sectionsRendered.push('score_breakdown');
  doc.fillColor(BRAND.navy).fontSize(16).text('Score Breakdown');
  doc.moveDown(0.5);

  const pillarMaxAssumed = 1000; // per-pillar max as captured in scan data
  const pillars = Object.entries(pillarScores);
  if (pillars.length === 0) {
    doc.fillColor(BRAND.gray400).fontSize(10).text('(no pillar score data)');
  } else {
    for (const [name, raw] of pillars) {
      const num = Number(raw) || 0;
      const pct = Math.round((num / pillarMaxAssumed) * 100);
      const color = pillarBucketColor(pct);
      doc.fillColor(BRAND.gray700).fontSize(11).text(`${name}`, { continued: true });
      doc.fillColor(BRAND.gray400).text(`   ${num} / ${pillarMaxAssumed}   `, { continued: true });
      doc.fillColor(color).text(`${pct}%`);
    }
  }

  // -------------------------------------------------------------------------
  // 4) Findings summary — severity distribution + table
  // -------------------------------------------------------------------------
  doc.moveDown(1.5);
  sectionsRendered.push('findings_summary');
  doc.fillColor(BRAND.navy).fontSize(16).text('Findings Summary');
  doc.moveDown(0.5);

  doc.fillColor(BRAND.gray700).fontSize(11)
    .text(`Critical: ${severityCounts.critical}`, { continued: true })
    .fillColor(BRAND.gray400).text('   |   ', { continued: true })
    .fillColor(BRAND.gray700).text(`High: ${severityCounts.high}`, { continued: true })
    .fillColor(BRAND.gray400).text('   |   ', { continued: true })
    .fillColor(BRAND.gray700).text(`Medium: ${severityCounts.medium}`, { continued: true })
    .fillColor(BRAND.gray400).text('   |   ', { continued: true })
    .fillColor(BRAND.gray700).text(`Low: ${severityCounts.low}`);

  doc.moveDown(0.8);

  // Sort findings critical → low (already sorted by buildContext but be safe)
  const sortedFindings = [...findings].sort((a, b) => {
    const order = { critical: 1, high: 2, medium: 3, low: 4 };
    return (order[a.severity] || 5) - (order[b.severity] || 5);
  });

  if (sortedFindings.length === 0) {
    doc.fillColor(BRAND.gray400).fontSize(10).text('(no findings)');
  } else {
    for (const f of sortedFindings) {
      doc.fillColor(severityColor(f.severity)).fontSize(10)
        .text(`[${(f.severity || '?').toUpperCase()}] `, { continued: true });
      doc.fillColor(BRAND.gray700)
        .text(`${f.pillar || ''} :: ${f.title || '(no title)'} (URLs: ${f.impacted_url_count ?? 0})`);
    }
  }

  // -------------------------------------------------------------------------
  // 5) Detailed findings — one per row with description + impacted URLs
  // -------------------------------------------------------------------------
  if (sortedFindings.length > 0) {
    doc.addPage();
    sectionsRendered.push('detailed_findings');
    doc.fillColor(BRAND.navy).fontSize(20).text('Detailed Findings');

    for (const f of sortedFindings) {
      doc.moveDown(1);
      // Severity badge text
      doc.fillColor(severityColor(f.severity)).fontSize(11)
        .text(`[${(f.severity || '?').toUpperCase()}] `, { continued: true });
      doc.fillColor(BRAND.navy).fontSize(13).text(f.title || '(no title)');

      doc.fillColor(BRAND.gray400).fontSize(9)
        .text(`Pillar: ${f.pillar || 'unknown'}` +
              (f.subfactor_key ? ` · ${f.subfactor_key}` : '') +
              (f.suggested_pack_type ? ` · suggested: ${f.suggested_pack_type}` : ''));

      if (f.description) {
        doc.moveDown(0.3);
        doc.fillColor(BRAND.gray700).fontSize(10).text(f.description, { lineGap: 2 });
      }

      const urls = Array.isArray(f.impacted_urls) ? f.impacted_urls : [];
      if (urls.length > 0) {
        doc.moveDown(0.3);
        doc.fillColor(BRAND.gray700).fontSize(9).text('Impacted URLs:');
        for (const u of urls.slice(0, 10)) {
          doc.fillColor(BRAND.cyan).fontSize(9).text(`  • ${u}`);
        }
        if (urls.length > 10) {
          doc.fillColor(BRAND.gray400).fontSize(9).text(`  …and ${urls.length - 10} more`);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 6) Footer on every page (after all pages rendered) + page numbers
  // -------------------------------------------------------------------------
  sectionsRendered.push('footer');
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.height - 30;
    doc.fillColor(BRAND.gray400).fontSize(8)
      .text(
        `Generated by Visible2AI · visible2ai.com · ${reportDate}    Page ${i - range.start + 1} of ${range.count}`,
        50, bottom, { width: doc.page.width - 100, align: 'center', lineBreak: false }
      );
  }

  doc.end();
  await done;

  const buffer = Buffer.concat(chunks);
  return {
    pdf_base64: buffer.toString('base64'),
    byte_size: buffer.length,
    executive_summary: executiveSummary,
    severity_counts: severityCounts,
    sections: sectionsRendered
  };
}

module.exports = { generateAuditPdf, BRAND };
