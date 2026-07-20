'use strict';

/**
 * csvSanitizer.js — CSV cell/row/document helpers with spreadsheet
 * formula-injection protection (OWASP CSV injection).
 *
 * A cell whose text begins with = + - @ (or a leading tab/carriage return) is
 * interpreted as a formula by Excel/Sheets/LibreOffice. We neutralise those by
 * prefixing a single quote, then apply normal RFC-4180 quoting (wrap in double
 * quotes, double any internal quote) whenever the value contains a comma,
 * quote, or newline. buildCsv() also prepends a UTF-8 BOM so Excel reads it as
 * UTF-8 instead of the system locale.
 *
 * Read-only presentation helper — no DB, no app state.
 */

// Leading characters that make a spreadsheet treat the cell as a formula.
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Neutralise a single value for safe CSV output.
 * @param {*} value
 * @returns {string}
 */
function sanitizeCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);

  // Formula-injection guard: prefix a single quote so the leading operator is
  // rendered as text, not evaluated.
  if (s.length > 0 && FORMULA_TRIGGERS.includes(s[0])) {
    s = `'${s}`;
  }

  // RFC-4180 quoting: needed when the value has a comma, double quote, or
  // newline. Escape embedded quotes by doubling them.
  if (/[",\r\n]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Build one CSV line from an array of raw cell values.
 * @param {Array<*>} cells
 * @returns {string}
 */
function toCsvRow(cells) {
  return (Array.isArray(cells) ? cells : [cells]).map(sanitizeCell).join(',');
}

/**
 * Build a full CSV document (BOM + header + rows), CRLF line endings.
 * @param {Array<string>} header - column names (also sanitized)
 * @param {Array<Array<*>>} rows
 * @returns {string}
 */
function buildCsv(header, rows) {
  const lines = [];
  lines.push(toCsvRow(header));
  for (const row of rows) lines.push(toCsvRow(row));
  // UTF-8 BOM so Excel doesn't mangle non-ASCII; CRLF per RFC 4180.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = {
  sanitizeCell,
  toCsvRow,
  buildCsv,
  FORMULA_TRIGGERS,
};
