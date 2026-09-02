/* In-memory stand-in for the Apps Script runtime, so Code.gs can be exercised
 * in Node exactly as deployed. Shared by test_backend.js and test_compat.js. */

const fs = require('fs');
const crypto = require('crypto');
const vm = require('vm');

const CODE = '/tmp/energytech_app/energytech_quiz_app_session_sync_fixed/google_apps_script/Code.gs';

/* Sheets does not store what you hand it verbatim. A string that looks like a
 * date or a number is converted on the way in -- an intake labelled MAY26 comes
 * back as a Date, and an all-digit trainee ID loses its leading zeros. Only a
 * cell already formatted as plain text ('@') is left alone. The stub reproduces
 * that, because a stub that stores strings faithfully hides the bug. */
const DATE_LIKE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[\s-]*(\d{1,4})$/i;
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function coerceLikeSheets(value, format) {
  if (format === '@') return value;                       // plain text: untouched
  if (typeof value !== 'string' || !value.trim()) return value;
  const m = value.trim().match(DATE_LIKE);
  if (m) return new Date(2026, MONTHS[m[1].toLowerCase()], Math.min(Number(m[2]), 28));
  if (/^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
  return value;
}

function makeSheet(name) {
  const rows = [];
  const formats = {};                                     // "row,col" -> number format
  const fmt = (r, c) => formats[`${r},${c}`] || '';
  const api = {
    name,
    rows,
    getName: () => name,
    formats,
    appendRow: r => {
      const rowNumber = rows.length + 1;
      rows.push(r.map((v, i) => coerceLikeSheets(v, fmt(rowNumber, i + 1))));
    },
    clear: () => { rows.length = 0; },
    setFrozenRows: () => api,
    getLastRow: () => rows.length,
    getLastColumn: () => rows.reduce((m, r) => Math.max(m, r.length), 0),
    deleteRow: i => { rows.splice(i - 1, 1); },
    deleteColumn: c => {
      rows.forEach(r => r.splice(c - 1, 1));
      // Cell formats are addressed by column, so they shift with the data.
      const next = {};
      Object.keys(formats).forEach(k => {
        const [r, col] = k.split(',').map(Number);
        if (col === c) return;
        next[`${r},${col > c ? col - 1 : col}`] = formats[k];
      });
      Object.keys(formats).forEach(k => delete formats[k]);
      Object.assign(formats, next);
    },
    getDataRange: () => {
      const width = api.getLastColumn();
      return {
        getValues: () => rows.map(r => { const c = r.slice(); while (c.length < width) c.push(''); return c; })
      };
    },
    getRange: (row, col, numRows = 1, numCols = 1) => ({
      getValues: () => {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const src = rows[row - 1 + r] || [];
          const line = [];
          for (let c = 0; c < numCols; c++) line.push(src[col - 1 + c] === undefined ? '' : src[col - 1 + c]);
          out.push(line);
        }
        return out;
      },
      setValues: vals => {
        vals.forEach((line, r) => {
          const i = row - 1 + r;
          while (rows.length <= i) rows.push([]);
          line.forEach((v, c) => { rows[i][col - 1 + c] = coerceLikeSheets(v, fmt(row + r, col + c)); });
        });
        return this;
      },
      setValue: v => {
        const i = row - 1;
        while (rows.length <= i) rows.push([]);
        rows[i][col - 1] = coerceLikeSheets(v, fmt(row, col));
      },
      setNumberFormat: f => {
        for (let r = 0; r < numRows; r++) {
          for (let c = 0; c < numCols; c++) formats[`${row + r},${col + c}`] = f;
        }
        return api.getRange(row, col, numRows, numCols);
      },
      getValue: () => (rows[row - 1] || [])[col - 1]
    })
  };
  return api;
}

function makeSpreadsheet() {
  const sheets = {};
  return {
    sheets,
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = makeSheet(n)),
    getSheets: () => Object.values(sheets)
  };
}

/* `codePath` lets a test load a different snapshot of Code.gs -- used to run the
 * currently deployed backend and the new one side by side. */
function loadBackend(ss, codePath = CODE) {
  ss = ss || makeSpreadsheet();
  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => {} },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_alg, value) =>
        [...crypto.createHash('sha256').update(String(value), 'utf8').digest()].map(b => b > 127 ? b - 256 : b),
      getUuid: () => crypto.randomUUID()
    },
    ContentService: {
      MimeType: { JSON: 'json', JAVASCRIPT: 'js' },
      createTextOutput: t => ({ _t: t, setMimeType() { return this; }, getContent() { return this._t; } })
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    console, Date, JSON, Math, String, Number, Object, Array, Boolean, RegExp, isNaN, parseInt, parseFloat
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), sandbox, { filename: codePath });
  return { ss, api: sandbox };
}

/* Apps Script re-evaluates globals for every execution, so anything the script
 * caches in one lives only for that request. The sandbox here is long-lived, so
 * the per-execution state is cleared before each call -- otherwise a cache in
 * the script would look correct in tests and be wrong in production. */
function freshExecution(api) {
  if (api.ENSURED_) api.ENSURED_ = {};
}
const get = (api, action, params = {}) => {
  freshExecution(api);
  return JSON.parse(api.doGet({ parameter: Object.assign({ action }, params) }).getContent());
};
const post = (api, payload) => {
  freshExecution(api);
  return JSON.parse(api.doPost({ postData: { contents: JSON.stringify(payload) } }).getContent());
};

module.exports = { makeSheet, makeSpreadsheet, loadBackend, get, post, CODE };
