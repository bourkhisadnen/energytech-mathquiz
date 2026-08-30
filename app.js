/* EnergyTech Mathematics Quiz App */
const LETTERS = ['a', 'b', 'c', 'd'];
let currentQuiz = [];
let lastFeedback = null;
let currentSession = null;
let activeRole = 'teacher';
let studentSubmitted = false;
const DEFAULT_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbw1sVWwd_TxFFFZGhwKQN9tI-l5ihSYcd2zjIQrivLBrHxVAtNmooUu_lPTAbrsE_OH/exec';
const WEB_APP_URL_STORAGE_KEY = 'energytechWebAppUrl_v2';
const AUTH_TOKEN_KEY = 'energytechAuthToken_v1';
const AUTH_USER_KEY = 'energytechAuthUser_v1';
let authToken = null;
let authUser = null; // { username, displayName, role }

const $ = (id) => document.getElementById(id);

/* ---------------- Chapters and question sets ----------------
 * A quiz is identified by a composite key "<chapter>:<set>", e.g. "ch03:version_b".
 * Keys saved before Chapter 03 existed have no prefix ("version_b"); those still
 * resolve to Chapters 01 & 02, so old session codes keep working.
 */
const CHAPTERS = {
  ch12: { label: 'Chapters 01 & 02', sets: () => window.QUESTION_BANK_SETS || {} },
  ch03: { label: 'Chapter 03', sets: () => window.QUESTION_BANK_SETS_CH03 || {} }
};
const DEFAULT_CHAPTER = 'ch12';
const DEFAULT_SET = 'original_pdf';

// Composite key of the quiz currently on screen (may come from a session rather
// than the dropdowns, which is why it is tracked separately).
let currentSetKey = null;

// Last dashboard payload from the backend. The page shows only the worst 20
// attempts and 30 questions; CSV exports read this instead so they are complete.
let lastDashboardData = null;

function parseSetKey(key) {
  const raw = String(key || '').trim();
  const i = raw.indexOf(':');
  if (i === -1) return { chapterKey: DEFAULT_CHAPTER, setId: raw || DEFAULT_SET };
  return {
    chapterKey: CHAPTERS[raw.slice(0, i)] ? raw.slice(0, i) : DEFAULT_CHAPTER,
    setId: raw.slice(i + 1) || DEFAULT_SET
  };
}

function composeSetKey(chapterKey, setId) {
  return `${chapterKey}:${setId}`;
}

function chapterSets(chapterKey) {
  return (CHAPTERS[chapterKey] || CHAPTERS[DEFAULT_CHAPTER]).sets();
}

function chapterLabel(chapterKey) {
  return (CHAPTERS[chapterKey] || CHAPTERS[DEFAULT_CHAPTER]).label;
}

function resolveSet(key) {
  const { chapterKey, setId } = parseSetKey(key);
  const sets = chapterSets(chapterKey);
  return sets[setId]
    || sets[DEFAULT_SET]
    || Object.values(sets)[0]
    || { label: setId, questions: [] };
}

// Human-readable name that also says which chapter, so the dashboard and the
// Google Sheet stay readable without needing a separate column.
function fullSetLabel(key) {
  const { chapterKey } = parseSetKey(key);
  return `${chapterLabel(chapterKey)} — ${resolveSet(key).label || ''}`.trim();
}

const SET_ORDER = ['original_pdf', 'version_b', 'version_c', 'version_d'];

/* ---------------- Question selection ----------------
 * The instructor picks an arbitrary set of questions from the tree, so a quiz is
 * no longer "one paper". The selection is held as { "<chapter>:<set>": Set(numbers) }
 * and encoded into the existing questionSetKey field, which keeps the Google Sheet
 * schema (and the deployed Apps Script) untouched:
 *
 *   ch03:version_b                     whole paper  -- identical to the old format
 *   ch03:version_b=1-20,25             a subset
 *   ch03:version_b=1-20;ch12:original_pdf=5-9    several papers
 *
 * A bare legacy key such as "version_b" still parses, so session codes created
 * before any of this keep working.
 */
let selection = Object.create(null);

function allPapers() {
  const out = [];
  Object.keys(CHAPTERS).forEach(chapterKey => {
    const sets = chapterSets(chapterKey);
    const ids = SET_ORDER.filter(id => sets[id])
      .concat(Object.keys(sets).filter(id => !SET_ORDER.includes(id)));
    ids.forEach(setId => out.push({
      chapterKey,
      setId,
      key: composeSetKey(chapterKey, setId),
      chapterLabel: chapterLabel(chapterKey),
      setLabel: sets[setId].label || setId,
      questions: sets[setId].questions || []
    }));
  });
  return out;
}

function paperByKey(key) {
  return allPapers().find(p => p.key === key) || null;
}

function selectedSet(key) {
  return selection[key] || (selection[key] = new Set());
}

function totalSelected() {
  return Object.keys(selection).reduce((a, k) => a + selection[k].size, 0);
}

/* --- compact range encoding: {1,2,3,7,8} -> "1-3,7-8" --- */
function rangesFrom(nums) {
  const a = [...nums].sort((x, y) => x - y);
  const out = [];
  let i = 0;
  while (i < a.length) {
    let j = i;
    while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
    out.push(i === j ? String(a[i]) : `${a[i]}-${a[j]}`);
    i = j + 1;
  }
  return out.join(',');
}

function parseRanges(str) {
  const set = new Set();
  String(str || '').split(',').forEach(part => {
    part = part.trim();
    if (!part) return;
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const lo = Number(m[1]);
      const hi = Number(m[2]);
      for (let n = Math.min(lo, hi); n <= Math.max(lo, hi); n++) set.add(n);
    } else if (/^\d+$/.test(part)) {
      set.add(Number(part));
    }
  });
  return set;
}

function encodeSelection(sel = selection) {
  const parts = [];
  allPapers().forEach(p => {
    const s = sel[p.key];
    if (!s || !s.size) return;
    parts.push(s.size === p.questions.length ? p.key : `${p.key}=${rangesFrom(s)}`);
  });
  return parts.join(';');
}

function decodeSelection(str) {
  const out = Object.create(null);
  String(str || '').split(';').forEach(chunk => {
    chunk = chunk.trim();
    if (!chunk) return;
    const eq = chunk.indexOf('=');
    const rawKey = eq === -1 ? chunk : chunk.slice(0, eq);
    const { chapterKey, setId } = parseSetKey(rawKey);
    const key = composeSetKey(chapterKey, setId);
    const questions = (resolveSet(key).questions || []);
    const valid = new Set(questions.map(q => q.original_number));
    if (eq === -1) {
      out[key] = new Set(valid);
    } else {
      const want = parseRanges(chunk.slice(eq + 1));
      out[key] = new Set([...want].filter(n => valid.has(n)));
    }
  });
  return out;
}

/* Questions for a selection, each tagged with the paper it came from so that
 * diagrams and explanation videos resolve correctly in a mixed-chapter quiz. */
function questionsFromSelection(sel) {
  const out = [];
  allPapers().forEach(p => {
    const s = sel[p.key];
    if (!s || !s.size) return;
    p.questions.forEach(q => {
      if (s.has(q.original_number)) {
        out.push(Object.assign({}, q, {
          __chapter: p.chapterKey, __setId: p.setId, __paper: p.key,
          __paperLabel: `${p.chapterLabel} — ${p.setLabel}`
        }));
      }
    });
  });
  return out;
}

function activeSetKey() {
  return encodeSelection();
}

// Name for the pool a quiz draws on. The question count is reported separately
// everywhere this is shown, so it is deliberately not repeated here.
function selectionLabel(key) {
  const sel = decodeSelection(key);
  const keys = Object.keys(sel).filter(k => sel[k].size);
  if (!keys.length) return 'No questions selected';
  const named = k => {
    const total = (resolveSet(k).questions || []).length;
    const n = sel[k].size;
    return n === total ? fullSetLabel(k) : `${fullSetLabel(k)} (${n} of ${total})`;
  };
  if (keys.length === 1) return named(keys[0]);
  if (keys.length === 2) return `${named(keys[0])} + ${named(keys[1])}`;
  return `${keys.length} papers`;
}

function activeSetLabel() {
  return selectionLabel(activeSetKey());
}

// Fallback chapter for the on-screen quiz. Individual questions carry __chapter,
// which is what diagrams and videos actually use; this only covers stray calls.
function currentChapterKey() {
  const keys = Object.keys(decodeSelection(currentSetKey || activeSetKey()));
  return keys.length ? parseSetKey(keys[0]).chapterKey : DEFAULT_CHAPTER;
}

/* ---------------- Selection tree UI ---------------- */

function lessonsOf(paper) {
  const map = new Map();
  paper.questions.forEach(q => {
    if (!map.has(q.lesson)) map.set(q.lesson, []);
    map.get(q.lesson).push(q);
  });
  return map;
}

function renderQuestionTree() {
  const root = $('questionTree');
  if (!root) return;
  const papers = allPapers();
  const html = Object.keys(CHAPTERS).map(chapterKey => {
    const mine = papers.filter(p => p.chapterKey === chapterKey);
    if (!mine.length) return '';
    const total = mine.reduce((a, p) => a + p.questions.length, 0);
    return `
      <details class="tree-node tree-chapter">
        <summary class="tree-row">
          <input type="checkbox" class="tree-check" data-level="chapter" data-chapter="${escapeHtml(chapterKey)}" />
          <span class="tree-label">${escapeHtml(chapterLabel(chapterKey))}</span>
          <span class="tree-count" data-count="chapter:${escapeHtml(chapterKey)}">0 / ${total}</span>
        </summary>
        <div class="tree-children">${mine.map(paperNodeHtml).join('')}</div>
      </details>`;
  }).join('');
  root.innerHTML = html;
  syncTree();
}

function paperNodeHtml(p) {
  return `
    <details class="tree-node tree-paper" data-paper="${escapeHtml(p.key)}">
      <summary class="tree-row">
        <input type="checkbox" class="tree-check" data-level="paper" data-paper="${escapeHtml(p.key)}" />
        <span class="tree-label">${escapeHtml(p.setLabel)}</span>
        <span class="tree-count" data-count="paper:${escapeHtml(p.key)}">0 / ${p.questions.length}</span>
      </summary>
      <div class="tree-children" data-lazy="1"></div>
    </details>`;
}

/* Lesson and question rows are built the first time a paper is opened -- all
 * eight papers at once would be ~830 checkboxes before the panel is even used. */
function fillPaperNode(details) {
  const holder = details.querySelector(':scope > .tree-children');
  if (!holder || holder.dataset.lazy !== '1') return;
  const p = paperByKey(details.dataset.paper);
  if (!p) return;
  const rows = [];
  lessonsOf(p).forEach((qs, lesson) => {
    rows.push(`
      <details class="tree-node tree-lesson">
        <summary class="tree-row">
          <input type="checkbox" class="tree-check" data-level="lesson"
                 data-paper="${escapeHtml(p.key)}" data-lesson="${escapeHtml(lesson)}" />
          <span class="tree-label">Lesson ${escapeHtml(lesson)}</span>
          <span class="tree-count" data-count="lesson:${escapeHtml(p.key)}:${escapeHtml(lesson)}">0 / ${qs.length}</span>
        </summary>
        <div class="tree-children tree-questions">
          ${qs.map(q => `
            <label class="tree-q">
              <input type="checkbox" class="tree-check" data-level="question"
                     data-paper="${escapeHtml(p.key)}" data-q="${q.original_number}" />
              <span>Q${q.original_number}</span>
            </label>`).join('')}
        </div>
      </details>`);
  });
  holder.innerHTML = rows.join('');
  holder.dataset.lazy = '0';
  syncTree();
}

function applyTriState(cb, n, total) {
  cb.checked = total > 0 && n === total;
  cb.indeterminate = n > 0 && n < total;
}

function setCount(token, n, total) {
  const el = document.querySelector(`[data-count="${CSS && CSS.escape ? CSS.escape(token) : token}"]`);
  if (el) el.textContent = `${n} / ${total}`;
}

function syncTree() {
  const root = $('questionTree');
  if (!root) return;

  root.querySelectorAll('input[data-level="question"]').forEach(cb => {
    const s = selection[cb.dataset.paper];
    cb.checked = Boolean(s && s.has(Number(cb.dataset.q)));
  });

  root.querySelectorAll('input[data-level="lesson"]').forEach(cb => {
    const p = paperByKey(cb.dataset.paper);
    if (!p) return;
    const qs = p.questions.filter(q => q.lesson === cb.dataset.lesson);
    const s = selection[p.key] || new Set();
    const n = qs.filter(q => s.has(q.original_number)).length;
    applyTriState(cb, n, qs.length);
    setCount(`lesson:${p.key}:${cb.dataset.lesson}`, n, qs.length);
  });

  allPapers().forEach(p => {
    const s = selection[p.key] || new Set();
    const cb = root.querySelector(`input[data-level="paper"][data-paper="${p.key}"]`);
    if (cb) applyTriState(cb, s.size, p.questions.length);
    setCount(`paper:${p.key}`, s.size, p.questions.length);
  });

  Object.keys(CHAPTERS).forEach(ck => {
    const mine = allPapers().filter(p => p.chapterKey === ck);
    const n = mine.reduce((a, p) => a + (selection[p.key] || new Set()).size, 0);
    const total = mine.reduce((a, p) => a + p.questions.length, 0);
    const cb = root.querySelector(`input[data-level="chapter"][data-chapter="${ck}"]`);
    if (cb) applyTriState(cb, n, total);
    setCount(`chapter:${ck}`, n, total);
  });
}

function setPaperSelected(p, on) {
  if (!p) return;
  if (on) selection[p.key] = new Set(p.questions.map(q => q.original_number));
  else delete selection[p.key];
}

function setQuestionSelected(paperKey, num, on) {
  const s = selectedSet(paperKey);
  if (on) s.add(num); else s.delete(num);
  if (!s.size) delete selection[paperKey];
}

function onTreeChange(e) {
  const el = e.target;
  if (!el || !el.classList || !el.classList.contains('tree-check')) return;
  const on = el.checked;
  switch (el.dataset.level) {
    case 'chapter':
      allPapers().filter(p => p.chapterKey === el.dataset.chapter)
        .forEach(p => setPaperSelected(p, on));
      break;
    case 'paper':
      setPaperSelected(paperByKey(el.dataset.paper), on);
      break;
    case 'lesson': {
      const p = paperByKey(el.dataset.paper);
      if (p) p.questions.filter(q => q.lesson === el.dataset.lesson)
        .forEach(q => setQuestionSelected(p.key, q.original_number, on));
      break;
    }
    default:
      setQuestionSelected(el.dataset.paper, Number(el.dataset.q), on);
  }
  afterSelectionChange();
}

function selectAll(on) {
  selection = Object.create(null);
  if (on) allPapers().forEach(p => setPaperSelected(p, true));
  afterSelectionChange();
}

function expandTree(open) {
  const root = $('questionTree');
  if (!root) return;
  if (open) root.querySelectorAll('details.tree-paper').forEach(fillPaperNode);
  root.querySelectorAll('details').forEach(d => { d.open = open; });
}

/* A name that describes what was actually ticked, so the session code, the
 * dashboard and the Google Sheet all say something meaningful. */
function suggestedSessionName() {
  const sel = decodeSelection(activeSetKey());
  const keys = Object.keys(sel).filter(k => sel[k].size);
  if (!keys.length) return 'Quiz Session';

  const chapters = [];
  keys.forEach(k => {
    const c = parseSetKey(k).chapterKey;
    if (!chapters.includes(c)) chapters.push(c);
  });

  if (keys.length === 1) {
    const p = paperByKey(keys[0]);
    if (!p) return 'Quiz Session';
    const chosen = sel[keys[0]];
    if (chosen.size === p.questions.length) return `${p.chapterLabel} — ${p.setLabel}`;

    // If the selection is made of whole lessons, name it after them.
    const whole = [];
    let covered = 0;
    lessonsOf(p).forEach((qs, lesson) => {
      if (qs.every(q => chosen.has(q.original_number))) {
        whole.push(lesson);
        covered += qs.length;
      }
    });
    if (whole.length && covered === chosen.size) {
      return whole.length <= 3
        ? `${p.chapterLabel} — Lesson${whole.length > 1 ? 's' : ''} ${whole.join(', ')}`
        : `${p.chapterLabel} — ${whole.length} lessons`;
    }
    return `${p.chapterLabel} — ${p.setLabel} (selection)`;
  }

  if (chapters.length === 1) return `${chapterLabel(chapters[0])} — mixed versions`;
  return chapters.map(chapterLabel).join(' + ');
}

// Left alone the moment the instructor types their own name; emptying the field
// hands control back to the suggestion.
let sessionNameIsAuto = true;

function refreshSessionName() {
  const el = $('sessionName');
  if (el && sessionNameIsAuto) el.value = suggestedSessionName();
}

function afterSelectionChange() {
  syncTree();
  updateCountControl();
  refreshSessionName();
  const el = $('selectionSummary');
  const n = totalSelected();
  if (el) {
    el.className = `feedback ${n ? 'good' : 'warn'}`;
    el.innerHTML = n
      ? `<strong>${n}</strong> question${n === 1 ? '' : 's'} selected — ${escapeHtml(activeSetLabel())}`
      : 'Nothing selected yet. Tick a chapter, a version, a lesson, or individual questions.';
  }
}

/* ---------------- Question count control ---------------- */

function currentCount() {
  const el = $('questionCount');
  return el ? Math.floor(Number(el.value) || 0) : 0;
}

function setCountValue(n) {
  const max = totalSelected();
  const clamped = max ? Math.min(Math.max(1, Math.floor(n) || 1), max) : 0;
  const input = $('questionCount');
  const range = $('questionCountRange');
  if (input) input.value = String(clamped);
  if (range) range.value = String(clamped || 1);
  const hint = $('countHint');
  if (hint) {
    hint.textContent = max
      ? `of ${max} selected${clamped === max ? ' (all of them)' : ''}`
      : 'select some questions first';
  }
  return clamped;
}

/* Max follows the selection; a count larger than the pool is clamped down. */
function updateCountControl() {
  const max = totalSelected();
  const input = $('questionCount');
  const range = $('questionCountRange');
  const wanted = currentCount() || 30;
  if (input) { input.max = String(Math.max(1, max)); input.disabled = !max; }
  if (range) { range.max = String(Math.max(1, max)); range.disabled = !max; }
  ['countMinusBtn', 'countPlusBtn', 'countAllBtn'].forEach(id => {
    if ($(id)) $(id).disabled = !max;
  });
  setCountValue(Math.min(wanted, max || 1));
}

function setOnlineStatus(message, type = 'empty') {
  const el = $('onlineStatus');
  if (!el) return;
  el.className = `feedback ${type}`;
  el.innerHTML = message;
}

function setDashboardStatus(message, type = 'empty') {
  const el = $('dashboardStatus');
  if (!el) return;
  el.className = `feedback ${type}`;
  el.innerHTML = message;
}

/* One place decides which backend URL a call uses. Login read the saved value
 * while the roster calls read the on-screen "Instructor connection setup" box,
 * so anything left in that box made login succeed against one deployment while
 * every roster call went to another -- which looks exactly like the backend
 * ignoring only the new features. */
function activeWebAppUrl() {
  const typed = $('webAppUrl') ? $('webAppUrl').value : '';
  return normalizeUrl(typed || savedWebAppUrl());
}

function savedWebAppUrl() {
  return localStorage.getItem(WEB_APP_URL_STORAGE_KEY) || DEFAULT_WEB_APP_URL;
}

function normalizeUrl(url) {
  return String(url || '').trim();
}

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a) {
  return function() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededRandom(seed) {
  return mulberry32(xmur3(String(seed))());
}

function shuffle(array, rng) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[ch]));
}

function findBalancedBraces(str, startIndex) {
  if (str[startIndex] !== '{') return null;
  let depth = 0;
  for (let i = startIndex; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}') {
      depth--;
      if (depth === 0) return { content: str.slice(startIndex + 1, i), end: i + 1 };
    }
  }
  return null;
}

function convertFractions(str) {
  let out = '';
  for (let i = 0; i < str.length;) {
    if (str.startsWith('\\dfrac', i) || str.startsWith('\\frac', i)) {
      const cmdLen = str.startsWith('\\dfrac', i) ? 6 : 5;
      let j = i + cmdLen;
      while (str[j] === ' ') j++;
      let num, den;
      if (str[j] === '{') {
        const n = findBalancedBraces(str, j);
        if (!n) { out += str[i++]; continue; }
        j = n.end;
        while (str[j] === ' ') j++;
        if (str[j] !== '{') { out += str[i++]; continue; }
        const d = findBalancedBraces(str, j);
        if (!d) { out += str[i++]; continue; }
        num = n.content;
        den = d.content;
        j = d.end;
      } else {
        // Supports short TeX forms such as \dfrac34.
        num = str[j] || '';
        den = str[j + 1] || '';
        j += 2;
      }
      out += `<span class="frac"><span>${renderMath(num)}</span><span>${renderMath(den)}</span></span>`;
      i = j;
    } else {
      out += str[i];
      i++;
    }
  }
  return out;
}

function convertSuperscripts(str) {
  // Braced superscripts: 10^{-6}, ft^{3}
  str = str.replace(/\^\{([^{}]+)\}/g, (_, exp) => `<sup>${renderMath(exp)}</sup>`);
  // Single-character superscripts: 10^6
  str = str.replace(/\^([\-+]?\d|[A-Za-z])/g, (_, exp) => `<sup>${escapeHtml(exp)}</sup>`);
  return str;
}

function renderMath(raw) {
  if (raw == null) return '';
  let s = String(raw);
  s = s.replace(/\\left|\\right/g, '');
  s = s.replace(/\\mathrm\{([^{}]+)\}/g, '$1');
  s = s.replace(/\\text\{([^{}]+)\}/g, '$1');
  s = s.replace(/\\scriptsize/g, '');
  s = s.replace(/\\displaystyle/g, '');
  s = s.replace(/\\[()\[\]]/g, '');
  s = s.replace(/\\hspace\{[^{}]*\}/g, '____');
  s = s.replace(/\\underline\{([^{}]*)\}/g, '$1');
  s = s.replace(/\\%/g, '%');
  s = s.replace(/\\,/g, ' ');
  s = s.replace(/\\ /g, ' ');
  s = s.replace(/\\Omega/g, 'Ω');
  s = s.replace(/\\times/g, '×');
  s = s.replace(/\\div/g, '÷');
  s = s.replace(/\\cdot/g, '·');
  s = s.replace(/\\inunit/g, 'in');
  s = s.replace(/\\gal/g, 'gal');
  s = s.replace(/\\mi/g, 'mi');
  s = s.replace(/\\ftcubed/g, 'ft^{3}');
  s = s.replace(/\{\}/g, '');
  s = convertFractions(s);
  s = convertSuperscripts(s);
  s = s.replace(/[{}]/g, '');
  return s;
}

function renderText(raw) {
  if (raw == null) return '';
  let s = String(raw);
  const DOLLAR_PLACEHOLDER = '__LITERAL_DOLLAR__';

  // Preserve escaped currency symbols before inline-math parsing.
  s = s.replace(/\\\$/g, DOLLAR_PLACEHOLDER);

  // Replace TikZ diagrams with SVG diagrams keyed by original question number later.
  s = s.replace(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}\\par?/g, '[[DIAGRAM]]');

  // Arithmetic stacks.
  s = s.replace(/\\calcstack\{([\s\S]*?)\}/g, (_, inner) => calcStackToHtml(inner));

  s = s.replace(/\\\\\[-?\d+pt\]/g, '<br>');
  s = s.replace(/\\par/g, '<br>');
  s = s.replace(/\\vspace\{[^}]*\}/g, '');
  s = s.replace(/\\centering/g, '');
  s = s.replace(/\\centerline\{\$([\s\S]*?)\$\}/g, (_, math) => `<span class="center-math">${renderMath(math)}</span>`);
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => `<span class="math">${renderMath(math)}</span>`);
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `<span class="math">${renderMath(math)}</span>`);
  s = s.replace(/\$([^$]+)\$/g, (_, math) => `<span class="math">${renderMath(math)}</span>`);
  s = renderMath(s);
  s = s.replaceAll(DOLLAR_PLACEHOLDER, '$');
  return s;
}

function calcStackToHtml(inner) {
  const parts = inner.split('\\\\');
  const lines = [];
  let ruleNext = false;
  for (let part of parts) {
    part = part.trim();
    if (!part) continue;
    if (part.includes('\\hline')) {
      part = part.replace('\\hline', '').trim();
      if (part) lines.push(`<span class="line">${renderMath(part)}</span>`);
      ruleNext = true;
    } else {
      lines.push(`<span class="line ${ruleNext ? 'rule' : ''}">${renderMath(part)}</span>`);
      ruleNext = false;
    }
  }
  if (ruleNext) lines.push('<span class="line rule">&nbsp;</span>');
  return `<div class="calc-stack">${lines.join('')}</div>`;
}

function splitChoices(choiceString) {
  return choiceString
    .split(/\\item\s+/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((text, index) => ({ letter: LETTERS[index], text }));
}

function diagramSvg(q) {
  // Explicit diagrams win, whatever the chapter.
  if (q.diagram && q.diagram.type === 'image') return `<img class="diagram-img" src="${q.diagram.src}" alt="question diagram" />`;
  if (q.diagram && q.diagram.type === 'tape') return tapeSvg(q.diagram);
  if (q.diagram && q.diagram.type === 'circuit') return circuitSvg(q);

  // Everything below is keyed by question NUMBER and belongs to the Chapters
  // 01 & 02 bank. Without this guard, Chapter 03's Q7 would be handed a series
  // circuit and its Q28/Q31/Q32 would get geometry diagrams. A quiz may mix
  // chapters, so the question's own origin decides -- not a global.
  const chapter = q.__chapter || currentChapterKey();
  if (chapter !== 'ch12') return '';

  const setId = q.__setId || parseSetKey(currentSetKey || activeSetKey()).setId;
  if (setId === DEFAULT_SET && q.original_number === 7) {
    return `<img class="diagram-img" src="./images/original_q07_circuit.png" alt="series circuit diagram" />`;
  }
  if (q.original_number === 7) return circuitSvg(q);
  if (q.original_number === 28) return shaftSvg(q);
  if (q.original_number === 31) return missingDimensionSvg(q);
  if (q.original_number === 32) return missingSideSvg(q);
  return '';
}

/* Tape measure used by the generated Chapter 03 versions. The original
 * worksheet keeps its scanned rulers; B/C/D need different readings, so they
 * are drawn instead of scanned. */
function tapeSvg(d) {
  const start = Number(d.start);
  const end = Number(d.end);
  const reading = Number(d.reading);
  if (!isFinite(start) || !isFinite(end) || end <= start) return '';

  const W = 640, H = 150;
  const padL = 26, padR = 26;
  const usable = W - padL - padR;
  const span = end - start;
  const xAt = (cm) => padL + ((cm - start) / span) * usable;

  const bodyTop = 58, bodyH = 66;
  const bodyBottom = bodyTop + bodyH;

  let ticks = '';
  const totalMm = Math.round(span * 10);
  for (let i = 0; i <= totalMm; i++) {
    const cm = start + i / 10;
    const x = xAt(cm);
    const isCm = i % 10 === 0;
    const isHalf = i % 5 === 0;
    const len = isCm ? 20 : (isHalf ? 14 : 9);
    ticks += `<line x1="${x.toFixed(1)}" y1="${bodyTop}" x2="${x.toFixed(1)}" y2="${(bodyTop + len).toFixed(1)}" stroke="#1d1d1d" stroke-width="${isCm ? 1.8 : 1}"/>`;
    ticks += `<line x1="${x.toFixed(1)}" y1="${bodyBottom}" x2="${x.toFixed(1)}" y2="${(bodyBottom - (isCm ? 16 : (isHalf ? 11 : 7))).toFixed(1)}" stroke="#1d1d1d" stroke-width="${isCm ? 1.6 : 0.9}"/>`;
  }

  let labels = '';
  for (let cm = Math.ceil(start); cm <= Math.floor(end); cm++) {
    labels += `<text x="${xAt(cm).toFixed(1)}" y="${bodyTop + 43}" text-anchor="middle" font-size="19" font-weight="700" fill="#1d1d1d">${cm}</text>`;
  }

  const ax = xAt(reading);
  const arrow = `
    <line x1="${ax.toFixed(1)}" y1="10" x2="${ax.toFixed(1)}" y2="${bodyTop - 6}" stroke="#1BA5D8" stroke-width="4" stroke-linecap="round"/>
    <path d="M ${(ax - 8).toFixed(1)} ${bodyTop - 16} L ${ax.toFixed(1)} ${bodyTop - 2} L ${(ax + 8).toFixed(1)} ${bodyTop - 16} Z" fill="#1BA5D8"/>`;

  return `<svg class="diagram tape-diagram" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tape measure with an arrow pointing at a reading in centimetres">
    <rect x="${padL - 12}" y="${bodyTop}" width="${usable + 24}" height="${bodyH}" fill="#F5DF10" stroke="#C9B400" stroke-width="1"/>
    ${ticks}${labels}${arrow}
    <text x="${padL - 12}" y="${bodyBottom + 18}" font-size="15" font-weight="700" fill="#c0392b">cm</text>
  </svg>`;
}

function resistor(x, y, bodyW = 46, amp = 11, lead = 12) {
  const step = bodyW / 6;
  let d = `M ${x} ${y} H ${x + lead} `;
  let px = x + lead;
  for (let i = 0; i < 6; i++) {
    px += step;
    const py = y + (i % 2 === 0 ? -amp : amp);
    d += `L ${px} ${py} `;
  }
  d += `L ${x + lead + bodyW} ${y} H ${x + lead + bodyW + lead}`;
  return `<path d="${d}" fill="none" stroke="#9a9a9a" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
}

function subscriptNumber(n) {
  const map = {'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉'};
  return String(n).split('').map(ch => map[ch] || ch).join('');
}

function circuitSvg(q = {}) {
  const defaultTop = [[1,420], [2,680], [3,90], [4,150]];
  const defaultBottom = [[8,1800], [7,10], [6,620], [5,950]];
  const topVals = q.diagram && q.diagram.top ? q.diagram.top : defaultTop;
  const bottomVals = q.diagram && q.diagram.bottom ? q.diagram.bottom : defaultBottom;
  const xs = [135, 275, 415, 555];
  const topY = 72;
  const botY = 170;
  const bodyW = 46;
  const lead = 12;
  const resTotalW = bodyW + 2 * lead;

  const top = topVals.map((rv, i) => ({ x: xs[i], r: `R${subscriptNumber(rv[0])}`, v: `${Number(rv[1]).toLocaleString()} Ω` }));
  const bottom = bottomVals.map((rv, i) => ({ x: xs[i], r: `R${subscriptNumber(rv[0])}`, v: `${Number(rv[1]).toLocaleString()} Ω` }));

  const topWire = [
    `M 72 ${topY} H ${xs[0]}`,
    ...top.slice(0,3).map(({x}) => `M ${x + resTotalW} ${topY} H ${x + 140}`),
    `M ${xs[3] + resTotalW} ${topY} H 640 V ${botY} H ${xs[3] + resTotalW}`
  ].join(' ');

  const bottomWire = [
    `M 72 ${botY} H ${xs[0]}`,
    ...bottom.slice(0,3).map(({x}) => `M ${x + resTotalW} ${botY} H ${x + 140}`),
    `M 72 ${topY} V ${botY}`
  ].join(' ');

  return `<svg class="diagram" viewBox="0 0 700 245" aria-label="series circuit diagram">
    <path d="${topWire}" fill="none" stroke="#ababab" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${bottomWire}" fill="none" stroke="#ababab" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>

    <!-- battery -->
    <g stroke="#002673" stroke-width="2.2" stroke-linecap="round">
      <line x1="48" y1="98" x2="78" y2="98"/>
      <line x1="56" y1="114" x2="78" y2="114"/>
      <line x1="48" y1="130" x2="78" y2="130"/>
      <line x1="56" y1="146" x2="78" y2="146"/>
    </g>

    ${top.map(({x}) => resistor(x, topY, bodyW, 11, lead)).join('')}
    ${bottom.map(({x}) => resistor(x, botY, bodyW, 11, lead)).join('')}

    ${top.map(({x,r,v}) => `<text x="${x + resTotalW/2}" y="43" text-anchor="middle" fill="#002673" font-size="17">${r}</text><text x="${x + resTotalW/2}" y="95" text-anchor="middle" fill="#002673" font-size="15">${v}</text>`).join('')}
    ${bottom.map(({x,r,v}) => `<text x="${x + resTotalW/2}" y="195" text-anchor="middle" fill="#002673" font-size="17">${r}</text><text x="${x + resTotalW/2}" y="219" text-anchor="middle" fill="#002673" font-size="15">${v}</text>`).join('')}
  </svg>`;
}

function shaftSvg() {
  return `<svg class="diagram" viewBox="0 0 560 170" aria-label="shaft length diagram">
    <defs>
      <linearGradient id="shaftGrad" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#e9e9e9"/>
        <stop offset="50%" stop-color="#cfcfcf"/>
        <stop offset="100%" stop-color="#efefef"/>
      </linearGradient>
      <marker id="d" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0,4 L8,0 L8,8 Z" fill="#444"/>
      </marker>
    </defs>

    <!-- shaft body -->
    <path d="M28 34 H342 V22 H480 L492 48 L480 74 H342 V62 H28 Z" fill="url(#shaftGrad)" stroke="#bcbcbc"/>
    <line x1="0" y1="48" x2="532" y2="48" stroke="#555" stroke-width="2" stroke-dasharray="18 10 4 10"/>

    <!-- extension lines -->
    <line x1="24" y1="78" x2="24" y2="126" stroke="#444" stroke-width="1.5"/>
    <line x1="342" y1="62" x2="342" y2="126" stroke="#444" stroke-width="1.5"/>
    <line x1="480" y1="74" x2="480" y2="126" stroke="#444" stroke-width="1.5"/>

    <!-- dimension lines -->
    <line x1="24" y1="120" x2="342" y2="120" stroke="#444" stroke-width="1.8" marker-start="url(#d)" marker-end="url(#d)"/>
    <line x1="342" y1="120" x2="480" y2="120" stroke="#444" stroke-width="1.8" marker-start="url(#d)" marker-end="url(#d)"/>

    <!-- labels -->
    <text x="183" y="114" text-anchor="middle" fill="#002673" font-size="18">3 ⅛ in.</text>
    <text x="411" y="114" text-anchor="middle" fill="#002673" font-size="18">2 ⅛ in.</text>
  </svg>`;
}

function missingDimensionSvg() {
  return `<svg class="diagram" viewBox="0 0 590 160" aria-label="missing dimension diagram">
    <rect x="65" y="70" width="450" height="38" fill="#f2fbff" stroke="#555"/>
    <line x1="65" y1="128" x2="515" y2="128" stroke="#444" marker-start="url(#b)" marker-end="url(#b)"/>
    <text x="290" y="153" text-anchor="middle" fill="#002673" font-size="18">8 3/4 in</text>
    <line x1="65" y1="48" x2="250" y2="48" stroke="#444" marker-start="url(#b)" marker-end="url(#b)"/>
    <text x="158" y="37" text-anchor="middle" fill="#002673" font-size="18">3 5/8 in</text>
    <line x1="400" y1="48" x2="515" y2="48" stroke="#444" marker-start="url(#b)" marker-end="url(#b)"/>
    <text x="458" y="37" text-anchor="middle" fill="#002673" font-size="18">2 1/4 in</text>
    <text x="325" y="95" text-anchor="middle" fill="#002673" font-size="22">A</text>
    <defs><marker id="b" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,4 L8,0 L8,8 Z" fill="#444"/></marker></defs>
  </svg>`;
}

function missingSideSvg() {
  return `<svg class="diagram" viewBox="0 0 470 250" aria-label="missing side diagram">
    <path d="M85 205 H355 V45 H280 V85 H220 V145 H85 Z" fill="#e9fbff" stroke="#555" stroke-width="2"/>
    <line x1="62" y1="205" x2="62" y2="145" stroke="#444" marker-start="url(#c)" marker-end="url(#c)"/>
    <text x="50" y="180" fill="#002673" font-size="16" text-anchor="end">2 3/4 in</text>
    <line x1="380" y1="205" x2="380" y2="45" stroke="#444" marker-start="url(#c)" marker-end="url(#c)"/>
    <text x="392" y="130" fill="#002673" font-size="16">6 1/2 in</text>
    <line x1="293" y1="85" x2="293" y2="45" stroke="#444" marker-start="url(#c)" marker-end="url(#c)"/>
    <text x="304" y="68" fill="#002673" font-size="16">1 5/8 in</text>
    <text x="250" y="120" text-anchor="middle" fill="#002673" font-size="22">A</text>
    <defs><marker id="c" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,4 L8,0 L8,8 Z" fill="#444"/></marker></defs>
  </svg>`;
}

function renderQuestion(q, index) {
  const choices = splitChoices(q.choices);
  let body = renderText(q.body);
  body = body.replace('[[DIAGRAM]]', diagramSvg(q));
  const showOriginal = currentSession && Object.prototype.hasOwnProperty.call(currentSession, 'showOriginalNumbers')
    ? currentSession.showOriginalNumbers !== false
    : ($('showOriginalNumbers') ? $('showOriginalNumbers').checked : true);
  // When a quiz draws on more than one paper, "Original Q7" is ambiguous on its
  // own -- say which paper it came from.
  const multiPaper = new Set(currentQuiz.map(x => x.__paper).filter(Boolean)).size > 1;
  const originalNote = showOriginal
    ? `<span class="original">Original Q${q.original_number}${
        multiPaper && q.__paperLabel ? ` · ${escapeHtml(q.__paperLabel)}` : ''}</span>`
    : '';
  const choiceHtml = choices.map(ch => `
    <label class="choice" data-choice="${ch.letter}">
      <input type="radio" name="q${index}" value="${ch.letter}" />
      <span>${ch.letter}) ${renderText(ch.text)}</span>
    </label>`).join('');
  return `<article class="question-card" id="card-${index}">
    <div class="q-head">Q${index + 1}: <span class="lesson">${escapeHtml(q.lesson)}</span>${originalNote}</div>
    <div class="q-body">${body}</div>
    <div class="q-choices">${choiceHtml}</div>
  </article>`;
}

/* The exact list of questions a set of settings produces. Pure: it touches no
 * globals and no DOM, so a past attempt can be rebuilt from the seed, key,
 * count and order stored with it and shown back question by question. */
function selectQuestionsFor(settings = {}) {
  const setKey = settings.questionSetKey || activeSetKey();
  // The pool is whatever the instructor ticked -- possibly spanning several
  // papers. Each question carries its own paper, so a mixed quiz still renders
  // the right diagram and links the right video.
  const bank = questionsFromSelection(decodeSelection(setKey));
  const requested = Number(settings.questionCount
    || ($('questionCount') ? $('questionCount').value : 30)) || 30;
  const n = Math.max(0, Math.min(requested, bank.length));
  const seed = String(settings.seed || ($('seedInput') ? $('seedInput').value.trim() : '') || Date.now());
  const orderMode = settings.orderMode || ($('orderMode') ? $('orderMode').value : 'original');
  const rng = seededRandom(seed);
  let selected = shuffle(bank, rng).slice(0, n);
  if (orderMode === 'original') {
    // Group by paper first, so a cross-chapter quiz reads in a sensible order
    // instead of interleaving two papers that both number from 1.
    const order = allPapers().map(p => p.key);
    selected.sort((a, b) =>
      (order.indexOf(a.__paper) - order.indexOf(b.__paper)) ||
      (a.original_number - b.original_number));
  } else {
    selected = shuffle(selected, rng);
  }
  return { setKey, selected, n };
}

function buildQuizFromSettings(settings = {}, target = 'teacher') {
  const { setKey, selected, n } = selectQuestionsFor(settings);
  currentSetKey = setKey;

  currentQuiz = selected;
  lastFeedback = null;
  studentSubmitted = false;

  const setLabel = selectionLabel(setKey);
  const summaryText = `Session <strong>${escapeHtml((currentSession && currentSession.sessionCode) || 'Preview')}</strong> — <strong>${n}</strong> questions from <strong>${escapeHtml(setLabel)}</strong>. Mode: <span class="mode-pill ${escapeHtml((currentSession && currentSession.mode) || 'practice')}">${escapeHtml(((currentSession && currentSession.mode) || 'practice').toUpperCase())}</span>.`;

  const summaryEl = target === 'student' ? $('studentQuizSummary') : $('quizSummary');
  const containerEl = target === 'student' ? $('studentQuizContainer') : $('quizContainer');
  const feedbackEl = target === 'student' ? $('studentFeedback') : $('feedback');

  if (summaryEl) summaryEl.innerHTML = summaryText;
  if (containerEl) containerEl.innerHTML = selected.map(renderQuestion).join('');
  if (feedbackEl) {
    feedbackEl.className = 'feedback empty';
    feedbackEl.innerHTML = target === 'student'
      ? 'Answer all questions. You cannot submit until every question has an answer.'
      : 'Preview the quiz here before giving the code to trainees.';
  }

  if ($('teacherPreviewArea') && target === 'teacher') $('teacherPreviewArea').hidden = false;
  if ($('studentQuizArea') && target === 'student') $('studentQuizArea').hidden = false;
}

/* Nothing ticked means there is no pool to draw from -- say so plainly rather
 * than producing an empty quiz or a session code trainees cannot use. */
function requireSelection() {
  if (totalSelected() > 0) return true;
  const status = $('sessionStatus');
  if (status) {
    status.className = 'feedback warn';
    status.innerHTML = 'Choose what the quiz covers first — tick a chapter, a version, a lesson or some questions above.';
  }
  const tree = $('questionTree');
  if (tree) tree.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return false;
}

function generateQuiz() {
  if (!requireSelection()) return;
  currentSession = {
    sessionCode: 'TEACHER-PREVIEW',
    sessionName: $('sessionName') ? $('sessionName').value.trim() : 'Instructor Preview',
    group: $('sessionGroup') ? $('sessionGroup').value : '',
    questionSetKey: activeSetKey(),
    questionSet: activeSetLabel(),
    questionCount: $('questionCount') ? Number($('questionCount').value) : 30,
    seed: $('seedInput') ? $('seedInput').value.trim() : String(Date.now()),
    orderMode: $('orderMode') ? $('orderMode').value : 'original',
    mode: $('sessionMode') ? $('sessionMode').value : 'practice',
    showOriginalNumbers: $('showOriginalNumbers') ? $('showOriginalNumbers').checked : true
  };
  buildQuizFromSettings(currentSession, 'teacher');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function getAnswer(index) {
  const root = activeRole === 'student' ? $('studentQuizArea') : $('teacherPreviewArea');
  const checked = (root || document).querySelector(`input[name="q${index}"]:checked`);
  return checked ? checked.value : '';
}

function unansweredIndices() {
  return currentQuiz.map((_, idx) => getAnswer(idx) ? null : idx).filter(v => v !== null);
}

function markMissingRequired(indices) {
  const root = activeRole === 'student' ? $('studentQuizArea') : $('teacherPreviewArea');
  (root || document).querySelectorAll('.question-card').forEach(card => card.classList.remove('missing-required'));
  indices.forEach(i => {
    const card = (root || document).querySelector(`#card-${i}`);
    if (card) card.classList.add('missing-required');
  });
}

function calculateScore(options = {}) {
  const target = options.target || activeRole || 'teacher';
  const requireAll = Boolean(options.requireAll);
  const reveal = options.reveal !== false;
  const feedbackEl = target === 'student' ? $('studentFeedback') : $('feedback');

  if (!currentQuiz.length) {
    if (target === 'teacher') generateQuiz();
    else {
      if (feedbackEl) {
        feedbackEl.className = 'feedback warn';
        feedbackEl.innerHTML = 'Load the session first.';
      }
      return false;
    }
  }

  const missing = unansweredIndices();
  if (requireAll && missing.length) {
    markMissingRequired(missing);
    if (feedbackEl) {
      feedbackEl.className = 'feedback warn';
      feedbackEl.innerHTML = `You must answer all questions before submitting.<br><strong>Unanswered:</strong> ${missing.map(i => `Q${i + 1}`).join(', ')}`;
    }
    const root = activeRole === 'student' ? $('studentQuizArea') : $('teacherPreviewArea');
    const first = (root || document).querySelector(`#card-${missing[0]}`);
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }

  let correct = 0;
  const wrong = [];
  const unanswered = [];
  const details = [];

  currentQuiz.forEach((q, idx) => {
    const ans = getAnswer(idx);
    const root = target === 'student' ? $('studentQuizArea') : $('teacherPreviewArea');
    const card = (root || document).querySelector(`#card-${idx}`);
    if (card) {
      card.classList.remove('flag-correct', 'flag-wrong', 'flag-unanswered', 'missing-required');
      card.querySelectorAll('.choice').forEach(el => el.classList.remove('correct-choice', 'wrong-choice'));
    }
    details.push({ quizNumber: idx + 1, originalNumber: q.original_number, lesson: q.lesson, answer: ans, correctAnswer: q.answer, result: !ans ? 'Unanswered' : (ans === q.answer ? 'Correct' : 'Wrong') });
    if (!ans) {
      unanswered.push(idx);
      if (reveal && card) card.classList.add('flag-unanswered');
    } else if (ans === q.answer) {
      correct++;
      if (reveal && card) card.classList.add('flag-correct');
    } else {
      wrong.push(idx);
      if (reveal && card) {
        card.classList.add('flag-wrong');
        const chosen = card.querySelector(`.choice[data-choice="${ans}"]`);
        if (chosen) chosen.classList.add('wrong-choice');
      }
    }
    if (reveal && card) {
      const correctEl = card.querySelector(`.choice[data-choice="${q.answer}"]`);
      if (correctEl) correctEl.classList.add('correct-choice');
    }
  });

  const total = currentQuiz.length;
  const percent = total ? Math.round((correct / total) * 1000) / 10 : 0;
  const setKey = (currentSession && currentSession.questionSetKey) || activeSetKey();
  const setLabel = selectionLabel(setKey);
  lastFeedback = {
    correct, total, percent, wrong, unanswered, details,
    seed: (currentSession && currentSession.seed) || ($('seedInput') ? $('seedInput').value.trim() : ''),
    questionSet: setLabel,
    questionSetKey: setKey,
    orderMode: (currentSession && currentSession.orderMode) || ($('orderMode') ? $('orderMode').value : 'original')
  };
  renderFeedback(target, reveal);
  return true;
}

function explanationLinkForQuestion(q) {
  // A generated variant that asks about a different subject must not inherit the
  // original question's video: Version B's "SI unit of electric current" would
  // otherwise open the clip explaining the watt. Variants that only changed the
  // numbers keep their video, because it teaches the same method.
  if (q && q.video_ok === false) return '';

  // Links are keyed per chapter. Without this, Chapter 03 Q1 would open the
  // Chapter 01 Q1 video, since both banks number their questions from 1. In a
  // mixed-chapter quiz the question's own chapter is what counts.
  const links = window.EXPLANATION_VIDEO_LINKS || {};
  const chapter = (q && q.__chapter) || currentChapterKey();
  const scoped = links[chapter];
  if (scoped && typeof scoped === 'object') return scoped[String(q.original_number)] || '';
  // A flat legacy map (no chapter keys) can only be Chapters 01 & 02.
  if (chapter === DEFAULT_CHAPTER) return links[String(q.original_number)] || '';
  return '';
}

function pillList(indices, options = {}) {
  if (!indices.length) return '<span class="list-pill good">None</span>';
  return indices.map(i => {
    const q = currentQuiz[i];
    const label = `Q${i + 1} <small>(Original Q${q.original_number})</small>`;
    if (options.withVideos) {
      const url = explanationLinkForQuestion(q);
      if (url) {
        return `<a class="list-pill video-pill" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="Open explanation video in a new tab">${label} <strong>▶ Video</strong></a>`;
      }
      return `<span class="list-pill no-video-pill" title="No explanation video available">${label} <small>No video</small></span>`;
    }
    return `<span class="list-pill">${label}</span>`;
  }).join('');
}

function renderFeedback(target = 'teacher', reveal = true) {
  const f = lastFeedback;
  const el = target === 'student' ? $('studentFeedback') : $('feedback');
  if (!el || !f) return;
  el.className = 'feedback';

  const mode = currentSession && currentSession.mode ? currentSession.mode : 'practice';
  if (target === 'student' && mode === 'assessment' && !reveal) {
    el.className = 'feedback good';
    el.innerHTML = `
      <p><strong>Your answers have been submitted successfully.</strong></p>
      <p>This was an assessment session. Detailed feedback is hidden and will be reviewed by the teacher.</p>
    `;
    return;
  }

  const showVideoLinks = mode !== 'assessment' && reveal;
  el.innerHTML = `
    <div class="score-line">
      <div class="score-box"><span>Total score</span><strong>${f.correct} / ${f.total}</strong></div>
      <div class="score-box"><span>Percentage</span><strong>${f.percent}%</strong></div>
      <div class="score-box"><span>Answered</span><strong>${f.total - f.unanswered.length} / ${f.total}</strong></div>
    </div>
    <p class="bad"><strong>Wrong questions:</strong></p>
    <div>${pillList(f.wrong, { withVideos: showVideoLinks })}</div>
    ${showVideoLinks && f.wrong.length ? '<p class="hint video-hint">Click the ▶ Video button beside a wrong question to open its explanation in a new tab.</p>' : ''}
    <p class="warn"><strong>Unanswered questions:</strong></p>
    <div>${pillList(f.unanswered)}</div>
  `;
}

function clearAnswers(target = activeRole || 'teacher') {
  const root = target === 'student' ? $('studentQuizArea') : $('teacherPreviewArea');
  const scope = root || document;
  scope.querySelectorAll('input[type="radio"]').forEach(el => { el.checked = false; });
  scope.querySelectorAll('.question-card').forEach(card => {
    card.classList.remove('flag-correct', 'flag-wrong', 'flag-unanswered', 'missing-required');
    card.querySelectorAll('.choice').forEach(el => el.classList.remove('correct-choice', 'wrong-choice'));
  });
  lastFeedback = null;
  studentSubmitted = false;
  const el = target === 'student' ? $('studentFeedback') : $('feedback');
  if (el) {
    el.className = 'feedback empty';
    el.innerHTML = target === 'student'
      ? 'Answers cleared. Answer all questions before submitting.'
      : 'Answers cleared. Check preview answers when ready.';
  }
}

function teacherReferenceText() {
  if (!currentQuiz.length) generateQuiz();
  const seed = $('seedInput').value.trim();
  const lines = [];
  lines.push('EnergyTech Mathematics Quiz — teacher reference');
  lines.push(`Question set: ${activeSetLabel()}`);
  lines.push(`Seed: ${seed}`);
  lines.push(`Number of questions: ${currentQuiz.length}`);
  lines.push('');
  lines.push('Quiz Q | Original Q | Lesson | Answer');
  lines.push('-------------------------------------');
  currentQuiz.forEach((q, i) => lines.push(`${String(i + 1).padStart(6)} | ${String(q.original_number).padStart(10)} | ${q.lesson} | ${q.answer}`));
  return lines.join('\n');
}

async function copyReference() {
  const txt = teacherReferenceText();
  try {
    await navigator.clipboard.writeText(txt);
    alert('Instructor reference copied to clipboard.');
  } catch {
    const blob = new Blob([txt], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'teacher_reference.txt';
    a.click();
    URL.revokeObjectURL(url);
  }
}

function downloadResult() {
  if (!lastFeedback) calculateScore();
  const who = studentIdentity();
  const lines = [];
  lines.push('EnergyTech Mathematics Quiz — result');
  lines.push(`Name: ${who.name}`);
  lines.push(`Group: ${who.group}`);
  lines.push(`EnergyTech ID: ${who.energytechId}`);
  lines.push(`Question set: ${lastFeedback.questionSet}`);
  lines.push(`Seed: ${lastFeedback.seed}`);
  lines.push(`Score: ${lastFeedback.correct} / ${lastFeedback.total}`);
  lines.push(`Percentage: ${lastFeedback.percent}%`);
  lines.push('');
  lines.push('Wrong questions:');
  lines.push(lastFeedback.wrong.length ? lastFeedback.wrong.map(i => `Q${i + 1} (Original Q${currentQuiz[i].original_number})`).join(', ') : 'None');
  lines.push('');
  lines.push('Unanswered questions:');
  lines.push(lastFeedback.unanswered.length ? lastFeedback.unanswered.map(i => `Q${i + 1} (Original Q${currentQuiz[i].original_number})`).join(', ') : 'None');
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `quiz_result_${new Date().toISOString().slice(0,10)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}


function buildSubmissionPayload() {
  if (!lastFeedback) calculateScore({ target: activeRole || 'student', requireAll: false, reveal: true });
  const attemptId = `ATT-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const who = studentIdentity();
  const { name, group, energytechId } = who;
  const wrongQuestions = lastFeedback.wrong.map(i => `Q${i + 1} (Original Q${currentQuiz[i].original_number})`);
  const unansweredQuestions = lastFeedback.unanswered.map(i => `Q${i + 1} (Original Q${currentQuiz[i].original_number})`);
  return {
    type: 'quiz_attempt',
    attemptId,
    submittedAt: new Date().toISOString(),
    // The token is what the backend trusts: when it is present the name, ID,
    // group and intake are read from the roster row, not from these fields.
    traineeToken: who.token || '',
    student: { name, group, energytechId, spspId: energytechId },
    session: currentSession || {},
    quiz: {
      sessionCode: (currentSession && currentSession.sessionCode) || '',
      sessionName: (currentSession && currentSession.sessionName) || '',
      mode: (currentSession && currentSession.mode) || 'practice',
      questionSet: lastFeedback.questionSet,
      questionSetKey: lastFeedback.questionSetKey,
      seed: lastFeedback.seed,
      orderMode: lastFeedback.orderMode,
      questionCount: currentQuiz.length
    },
    score: {
      correct: lastFeedback.correct,
      total: lastFeedback.total,
      percent: lastFeedback.percent,
      wrongQuestions,
      unansweredQuestions
    },
    items: lastFeedback.details.map(d => ({
      quizNumber: d.quizNumber,
      originalNumber: d.originalNumber,
      lesson: d.lesson,
      studentAnswer: d.answer || '',
      correctAnswer: d.correctAnswer,
      result: d.result
    })),
    userAgent: navigator.userAgent
  };
}

async function submitOnlineResult(target = 'student') {
  const url = normalizeUrl((target !== 'student' && $('webAppUrl') && $('webAppUrl').value) || savedWebAppUrl());
  const feedbackEl = target === 'student' ? $('studentFeedback') : $('onlineStatus');
  if (!url) {
    if (feedbackEl) {
      feedbackEl.className = 'feedback warn';
      feedbackEl.innerHTML = 'Please save the Google Apps Script Web App URL first.';
    }
    return;
  }

  const mode = currentSession && currentSession.mode ? currentSession.mode : 'practice';
  const reveal = !(target === 'student' && mode === 'assessment');
  const ok = calculateScore({ target, requireAll: true, reveal });
  if (!ok) return;

  const payload = buildSubmissionPayload();
  if (feedbackEl) {
    feedbackEl.className = 'feedback empty';
    feedbackEl.innerHTML = 'Submitting result to Google Sheets...';
  }

  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify(payload)
    });
    studentSubmitted = true;
    if (target === 'student') {
      renderFeedback('student', reveal);
      if (mode === 'practice') {
        $('studentFeedback').innerHTML += `<p class="good"><strong>Result submitted online.</strong></p>`;
      }
      // The POST is opaque (no-cors), so there is nothing to wait on. Give the
      // Sheet a moment to finish writing the rows, then pull the record again so
      // the quiz they have just sat is in their own list when they scroll down.
      if (traineeLoggedIn()) setTimeout(loadMyHistory, 2500);
    } else {
      setOnlineStatus(
        `Result submitted. Trainee: <strong>${escapeHtml(payload.student.name || 'Unnamed')}</strong>. Score: <strong>${payload.score.correct} / ${payload.score.total}</strong> (${payload.score.percent}%).`,
        'good'
      );
    }
  } catch (err) {
    if (feedbackEl) {
      feedbackEl.className = 'feedback bad';
      feedbackEl.innerHTML = `Submission failed: ${escapeHtml(err.message || String(err))}`;
    }
  }
}

function saveWebAppUrl() {
  const url = normalizeUrl($('webAppUrl').value);
  if (!url) {
    setOnlineStatus('No URL entered.', 'warn');
    return;
  }
  localStorage.setItem(WEB_APP_URL_STORAGE_KEY, url);
  setOnlineStatus('Web App URL saved on this device.', 'good');
}

async function loadDashboard() {
  if (!isLoggedIn()) {
    setDashboardStatus('You are not logged in. Please log in again.', 'bad');
    return;
  }
  const url = activeWebAppUrl();
  if (!url) {
    setDashboardStatus('No Google Apps Script URL found.', 'warn');
    return;
  }

  setDashboardStatus('Loading instructor dashboard from Google Sheets...', 'empty');
  setOnlineStatus('Loading instructor dashboard from Google Sheets...', 'empty');

  try {
    const data = await getJsonp(url, { action: 'summary', token: authToken }, 'energytechDashboard');
    if (!data || data.ok === false) {
      const msg = (data && data.error) || 'No data returned.';
      setDashboardStatus(`Dashboard error: ${escapeHtml(msg)}`, 'bad');
      setOnlineStatus(`Dashboard error: ${escapeHtml(msg)}`, 'bad');
      return;
    }
    lastDashboardData = data;
    renderDashboard(data);
    const count = data.attempts ? data.attempts.length : 0;
    setDashboardStatus(`Instructor dashboard loaded. Attempts found: <strong>${count}</strong>.`, 'good');
    setOnlineStatus(`Instructor dashboard loaded. Attempts found: <strong>${count}</strong>.`, 'good');
  } catch (err) {
    const msg = escapeHtml(err.message || String(err));
    setDashboardStatus(msg, 'bad');
    setOnlineStatus(msg, 'bad');
  }
}

function tableHtml(headers, rows, emptyMessage) {
  if (!rows || !rows.length) return `<p class="hint">${escapeHtml(emptyMessage)}</p>`;
  return `<div class="table-wrap"><table class="dashboard-table"><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function renderDashboard(data) {
  const out = $('teacherDashboard');
  if (!out) return;
  const attempts = data.attempts || [];
  const questions = data.questionAnalysis || [];
  const lessons = data.lessonAnalysis || [];
  const showOwner = Boolean(data.viewer && data.viewer.role === 'admin');
  const ownerCell = (row) => `<td>${escapeHtml(row.ownerDisplayName || row.ownerUsername || 'Unknown')}</td>`;

  const lowHeaders = ['Time','Name','Group','EnergyTech ID','Session','Mode','Set','Score','%','Wrong','Unanswered'];
  if (showOwner) lowHeaders.splice(5, 0, 'Instructor');
  const lowRows = attempts.slice().sort((a,b) => Number(a.percent) - Number(b.percent)).slice(0, 20).map(a => `
    <tr>
      <td>${escapeHtml(a.timestamp || '')}</td>
      <td>${escapeHtml(a.name || '')}</td>
      <td>${escapeHtml(a.group || '')}</td>
      <td>${escapeHtml(a.energytechId || '')}</td>
      <td>${escapeHtml(a.sessionCode || '')}</td>
      ${showOwner ? ownerCell(a) : ''}
      <td>${escapeHtml(a.mode || '')}</td>
      <td>${escapeHtml(a.questionSet || '')}</td>
      <td>${escapeHtml(a.score || '')}/${escapeHtml(a.total || '')}</td>
      <td>${escapeHtml(a.percent || '')}%</td>
      <td>${escapeHtml(a.wrongCount || 0)}</td>
      <td>${escapeHtml(a.unansweredCount || 0)}</td>
    </tr>`);

  const qHeaders = ['Session','Question','Lesson','Set','Attempts','Correct','Wrong','Unanswered','Success','Common wrong'];
  if (showOwner) qHeaders.splice(1, 0, 'Instructor');
  const qRows = questions.slice().sort((a,b) => Number(a.successRate) - Number(b.successRate)).slice(0, 30).map(q => `
    <tr>
      <td>${escapeHtml(q.sessionCode || '')}</td>
      ${showOwner ? ownerCell(q) : ''}
      <td>Original Q${escapeHtml(q.originalNumber)}</td>
      <td>${escapeHtml(q.lesson || '')}</td>
      <td>${escapeHtml(q.questionSet || '')}</td>
      <td>${escapeHtml(q.attempts)}</td>
      <td>${escapeHtml(q.correct)}</td>
      <td>${escapeHtml(q.wrong)}</td>
      <td>${escapeHtml(q.unanswered)}</td>
      <td>${escapeHtml(q.successRate)}%</td>
      <td>${escapeHtml(q.commonWrong || '')}</td>
    </tr>`);

  const lessonHeaders = ['Session','Lesson','Set','Attempts','Correct','Wrong','Unanswered','Success'];
  if (showOwner) lessonHeaders.splice(1, 0, 'Instructor');
  const lessonRows = lessons.slice().sort((a,b) => Number(a.successRate) - Number(b.successRate)).map(l => `
    <tr>
      <td>${escapeHtml(l.sessionCode || '')}</td>
      ${showOwner ? ownerCell(l) : ''}
      <td>${escapeHtml(l.lesson || '')}</td>
      <td>${escapeHtml(l.questionSet || '')}</td>
      <td>${escapeHtml(l.attempts)}</td>
      <td>${escapeHtml(l.correct)}</td>
      <td>${escapeHtml(l.wrong)}</td>
      <td>${escapeHtml(l.unanswered)}</td>
      <td>${escapeHtml(l.successRate)}%</td>
    </tr>`);

  const viewerLine = data.viewer
    ? `<p class="hint">Viewing as <strong>${escapeHtml(data.viewer.displayName)}</strong> — ${showOwner ? 'admin view, showing all instructors.' : 'showing only your sessions.'}</p>`
    : '';

  out.innerHTML = `
    ${viewerLine}
    <h3>Lowest performers</h3>
    ${tableHtml(lowHeaders, lowRows, 'No trainee attempts yet.')}
    <h3>Most problematic questions</h3>
    ${tableHtml(qHeaders, qRows, 'No item responses yet.')}
    <h3>Most problematic lessons</h3>
    ${tableHtml(lessonHeaders, lessonRows, 'No lesson data yet.')}
  `;
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

function csvRows(rows) {
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}

/* Excel opens a .csv as UTF-8 only if it sees a byte-order mark, otherwise names
 * with accents arrive mangled. */
function downloadCsv(text, filename) {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/* One row per trainee submission, every attempt the dashboard loaded.
 * Built from the data rather than scraped from the page: the on-screen table
 * only lists the 20 lowest performers, so scraping it would quietly leave most
 * of the class out of the file. */
function downloadActivityCsv() {
  const attempts = (lastDashboardData && lastDashboardData.attempts) || [];
  if (!attempts.length) {
    setDashboardStatus('Load the instructor dashboard first — there is no trainee activity to download yet.', 'warn');
    return;
  }
  const showOwner = Boolean(lastDashboardData.viewer && lastDashboardData.viewer.role === 'admin');
  const headers = ['Submitted', 'Name', 'Group', 'EnergyTech ID', 'Session code', 'Session name'];
  if (showOwner) headers.push('Instructor');
  headers.push('Mode', 'Question set', 'Questions', 'Score', 'Total', 'Percentage',
               'Wrong', 'Unanswered', 'Seed', 'Question order', 'Attempt ID');

  const rows = attempts
    .slice()
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
    .map(a => {
      const r = [a.timestamp || '', a.name || '', a.group || '', a.energytechId || '',
                 a.sessionCode || '', a.sessionName || ''];
      if (showOwner) r.push(a.ownerDisplayName || a.ownerUsername || '');
      r.push(a.mode || '', a.questionSet || '', a.questionCount || '',
             a.score, a.total, a.percent, a.wrongCount, a.unansweredCount,
             a.seed || '', a.orderMode || '', a.attemptId || '');
      return r;
    });

  downloadCsv(csvRows([headers].concat(rows)), `energytech_trainee_activity_${stamp()}.csv`);
  setDashboardStatus(`Downloaded <strong>${rows.length}</strong> trainee submission${rows.length === 1 ? '' : 's'} as CSV.`, 'good');
}

/* The three analysis tables, complete -- the page caps them at 20 and 30 rows. */
function exportDashboardCsv() {
  if (!lastDashboardData) {
    setDashboardStatus('Load the instructor dashboard before exporting.', 'warn');
    return;
  }
  const d = lastDashboardData;
  const showOwner = Boolean(d.viewer && d.viewer.role === 'admin');
  const out = [];

  const attempts = (d.attempts || []).slice()
    .sort((a, b) => Number(a.percent) - Number(b.percent));
  out.push(['Trainee attempts (all, weakest first)']);
  const h1 = ['Submitted','Name','Group','EnergyTech ID','Session','Mode','Question set','Score','Total','Percentage','Wrong','Unanswered'];
  if (showOwner) h1.splice(5, 0, 'Instructor');
  out.push(h1);
  attempts.forEach(a => {
    const r = [a.timestamp||'', a.name||'', a.group||'', a.energytechId||'', a.sessionCode||''];
    if (showOwner) r.push(a.ownerDisplayName || a.ownerUsername || '');
    r.push(a.mode||'', a.questionSet||'', a.score, a.total, a.percent, a.wrongCount, a.unansweredCount);
    out.push(r);
  });
  out.push([]);

  const questions = (d.questionAnalysis || []).slice()
    .sort((a, b) => Number(a.successRate) - Number(b.successRate));
  out.push(['Question analysis (all, hardest first)']);
  const h2 = ['Session','Original question','Lesson','Question set','Attempts','Correct','Wrong','Unanswered','Success %','Most common wrong choice'];
  if (showOwner) h2.splice(1, 0, 'Instructor');
  out.push(h2);
  questions.forEach(q => {
    const r = [q.sessionCode||''];
    if (showOwner) r.push(q.ownerDisplayName || q.ownerUsername || '');
    r.push(`Q${q.originalNumber}`, q.lesson||'', q.questionSet||'', q.attempts, q.correct,
           q.wrong, q.unanswered, q.successRate, q.commonWrong||'');
    out.push(r);
  });
  out.push([]);

  const lessons = (d.lessonAnalysis || []).slice()
    .sort((a, b) => Number(a.successRate) - Number(b.successRate));
  out.push(['Lesson analysis (all, hardest first)']);
  const h3 = ['Session','Lesson','Question set','Attempts','Correct','Wrong','Unanswered','Success %'];
  if (showOwner) h3.splice(1, 0, 'Instructor');
  out.push(h3);
  lessons.forEach(l => {
    const r = [l.sessionCode||''];
    if (showOwner) r.push(l.ownerDisplayName || l.ownerUsername || '');
    r.push(l.lesson||'', l.questionSet||'', l.attempts, l.correct, l.wrong, l.unanswered, l.successRate);
    out.push(r);
  });

  downloadCsv(csvRows(out), `energytech_dashboard_${stamp()}.csv`);
  setDashboardStatus(`Exported the full dashboard: ${attempts.length} attempts, ${questions.length} questions, ${lessons.length} lessons.`, 'good');
}


/* ---------------- Instructor accounts (login / signup / admin) ---------------- */

function loadAuthFromStorage() {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    const userRaw = localStorage.getItem(AUTH_USER_KEY);
    if (token && userRaw) {
      authToken = token;
      authUser = JSON.parse(userRaw);
    }
  } catch { authToken = null; authUser = null; }
}

function persistAuth() {
  if (authToken && authUser) {
    localStorage.setItem(AUTH_TOKEN_KEY, authToken);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(authUser));
  } else {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
  }
}

function isLoggedIn() { return Boolean(authToken && authUser); }
function isAdmin() { return Boolean(authUser && authUser.role === 'admin'); }

function showOnly(panelId) {
  ['landingPanel','teacherLoginPanel','teacherInterface','studentInterface'].forEach(id => {
    const el = $(id);
    if (el) el.hidden = id !== panelId;
  });
}

function goHome() {
  activeRole = '';
  showOnly('landingPanel');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// showTraineeMode lives with the roster module at the bottom of this file --
// which trainee screen opens depends on whether a trainee account is signed in.

function showInstructorLogin() {
  activeRole = 'teacher';
  if (isLoggedIn()) { enterInstructorInterface(); return; }
  showOnly('teacherLoginPanel');
  toggleSignupPanel(false);
  if ($('teacherLoginUsername')) $('teacherLoginUsername').focus();
}

function enterInstructorInterface() {
  showOnly('teacherInterface');
  if ($('webAppUrl')) $('webAppUrl').value = savedWebAppUrl();
  renderInstructorAccountBar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderInstructorAccountBar() {
  const el = $('instructorAccountBar');
  const adminSection = $('adminPanelSection');
  const intakeSection = $('intakePanelSection');
  if (!authUser) return;
  if (el) {
    el.innerHTML = `Logged in as <strong>${escapeHtml(authUser.displayName)}</strong> (${escapeHtml(authUser.username)})${authUser.role === 'admin' ? ' <span class="mode-pill">ADMIN</span>' : ''}`;
  }
  if (adminSection) adminSection.hidden = !isAdmin();
  if (intakeSection) intakeSection.hidden = !isAdmin();
  // Every instructor picks an intake and group when creating a session, so the
  // roster is loaded for all of them -- the admin-only part is editing it.
  if (typeof loadRosterForSessionPickers === 'function') loadRosterForSessionPickers();
}

async function attemptInstructorLogin() {
  const username = $('teacherLoginUsername') ? $('teacherLoginUsername').value.trim() : '';
  const password = $('teacherLoginPassword') ? $('teacherLoginPassword').value : '';
  const statusEl = $('teacherLoginStatus');
  if (!username || !password) {
    if (statusEl) { statusEl.className = 'feedback warn'; statusEl.innerHTML = 'Enter your username and password.'; }
    return;
  }
  const url = activeWebAppUrl();
  if (!url) {
    if (statusEl) { statusEl.className = 'feedback bad'; statusEl.innerHTML = 'No Google Apps Script URL is configured.'; }
    return;
  }
  if (statusEl) { statusEl.className = 'feedback empty'; statusEl.innerHTML = 'Checking credentials...'; }
  try {
    const data = await getJsonp(url, { action: 'auth_login', username, password }, 'energytechLogin');
    if (!data || !data.ok) {
      if (statusEl) { statusEl.className = 'feedback bad'; statusEl.innerHTML = escapeHtml((data && data.error) || 'Login failed.'); }
      return;
    }
    // An Apps Script deployment that predates instructor accounts has no
    // auth_login branch, so doGet falls through to its default reply -- ok:true
    // with no token. Accepting that produced a half-login: "Signed in", an
    // account bar reading "undefined", and every later action refusing with
    // "You are not logged in." Treat a missing token as the failure it is.
    if (!data.token || !data.username) {
      if (statusEl) {
        statusEl.className = 'feedback bad';
        statusEl.innerHTML = 'This Google Apps Script is running an <strong>older version</strong> that does not support instructor accounts, so it accepted the request without issuing a login.'
          + '<br>Fix: open the Sheet → <strong>Extensions → Apps Script</strong>, paste the latest <code>Code.gs</code>, then <strong>Deploy → Manage deployments → edit → Version: New version → Deploy</strong>.'
          + '<br>If that gives you a new Web App URL, paste it into <strong>Instructor connection setup</strong> and press <strong>Save URL</strong>.';
      }
      return;
    }
    authToken = data.token;
    authUser = { username: data.username, displayName: data.displayName, role: data.role };
    persistAuth();
    if ($('teacherLoginPassword')) $('teacherLoginPassword').value = '';
    if (statusEl) { statusEl.className = 'feedback empty'; statusEl.innerHTML = 'Signed in.'; }
    enterInstructorInterface();
  } catch (err) {
    if (statusEl) { statusEl.className = 'feedback bad'; statusEl.innerHTML = escapeHtml(err.message || String(err)); }
  }
}

function clearDashboardData() {
  lastDashboardData = null;
  if ($('teacherDashboard')) $('teacherDashboard').innerHTML = '';
}

function logoutInstructor() {
  const token = authToken;
  const url = activeWebAppUrl();
  authToken = null;
  authUser = null;
  persistAuth();
  // Do not leave one instructor's results downloadable by whoever logs in next.
  clearDashboardData();
  if (token && url) {
    getJsonp(url, { action: 'auth_logout', token }, 'energytechLogout').catch(() => {});
  }
  goHome();
}

function toggleSignupPanel(forceShow) {
  const el = $('teacherSignupPanel');
  if (!el) return;
  const show = typeof forceShow === 'boolean' ? forceShow : el.hidden;
  el.hidden = !show;
  if ($('toggleSignupBtn')) $('toggleSignupBtn').textContent = show ? 'Back to login' : 'Need an account? Request one';
}

async function requestInstructorAccount() {
  const displayName = $('signupDisplayName') ? $('signupDisplayName').value.trim() : '';
  const username = $('signupUsername') ? $('signupUsername').value.trim() : '';
  const password = $('signupPassword') ? $('signupPassword').value : '';
  const confirm = $('signupConfirmPassword') ? $('signupConfirmPassword').value : '';
  const statusEl = $('signupStatus');
  if (!displayName || !username || !password) {
    if (statusEl) { statusEl.className = 'feedback warn'; statusEl.innerHTML = 'Fill in your display name, username, and password.'; }
    return;
  }
  if (password !== confirm) {
    if (statusEl) { statusEl.className = 'feedback warn'; statusEl.innerHTML = 'Passwords do not match.'; }
    return;
  }
  const url = activeWebAppUrl();
  if (!url) {
    if (statusEl) { statusEl.className = 'feedback bad'; statusEl.innerHTML = 'No Google Apps Script URL is configured.'; }
    return;
  }
  if (statusEl) { statusEl.className = 'feedback empty'; statusEl.innerHTML = 'Submitting request...'; }
  try {
    const data = await getJsonp(url, { action: 'auth_signup', username, password, displayName }, 'energytechSignup');
    if (!data || !data.ok) {
      if (statusEl) { statusEl.className = 'feedback bad'; statusEl.innerHTML = escapeHtml((data && data.error) || 'Request failed.'); }
      return;
    }
    // Same trap as login: an old deployment answers ok:true from its default
    // branch, which would look like a successful request that never arrived.
    if (data.status !== 'pending') {
      if (statusEl) {
        statusEl.className = 'feedback bad';
        statusEl.innerHTML = 'The backend accepted the request but did not record it — it is running an <strong>older version</strong> that does not support instructor accounts. Ask your admin to redeploy the latest <code>Code.gs</code> as a new version.';
      }
      return;
    }
    if (statusEl) { statusEl.className = 'feedback good'; statusEl.innerHTML = 'Request submitted. An admin needs to approve your account before you can log in.'; }
    ['signupDisplayName','signupUsername','signupPassword','signupConfirmPassword'].forEach(id => { if ($(id)) $(id).value = ''; });
  } catch (err) {
    if (statusEl) { statusEl.className = 'feedback bad'; statusEl.innerHTML = escapeHtml(err.message || String(err)); }
  }
}

async function changeMyPassword() {
  if (!isLoggedIn()) return;
  const oldPassword = $('changeOldPassword') ? $('changeOldPassword').value : '';
  const newPassword = $('changeNewPassword') ? $('changeNewPassword').value : '';
  if (!oldPassword || !newPassword) {
    setOnlineStatus('Enter your current password and a new password.', 'warn');
    return;
  }
  if (newPassword.length < 6) {
    setOnlineStatus('New password must be at least 6 characters.', 'warn');
    return;
  }
  const url = activeWebAppUrl();
  try {
    const data = await getJsonp(url, { action: 'auth_change_password', token: authToken, oldPassword, newPassword }, 'energytechChangePw');
    if (!data || !data.ok) {
      setOnlineStatus(escapeHtml((data && data.error) || 'Could not change password.'), 'bad');
      return;
    }
    setOnlineStatus('Password changed.', 'good');
    ['changeOldPassword','changeNewPassword'].forEach(id => { if ($(id)) $(id).value = ''; });
  } catch (err) {
    setOnlineStatus(escapeHtml(err.message || String(err)), 'bad');
  }
}

async function loadInstructorAccounts() {
  if (!isLoggedIn() || !isAdmin()) return;
  const url = activeWebAppUrl();
  const out = $('instructorAccountsOutput');
  if (out) out.innerHTML = '<p class="hint">Loading accounts...</p>';
  try {
    const data = await getJsonp(url, { action: 'admin_list_instructors', token: authToken }, 'energytechAccounts');
    if (!data || !data.ok) {
      if (out) out.innerHTML = `<p class="hint">${escapeHtml((data && data.error) || 'Could not load accounts.')}</p>`;
      return;
    }
    renderInstructorAccounts(data.instructors || []);
  } catch (err) {
    if (out) out.innerHTML = `<p class="hint">${escapeHtml(err.message || String(err))}</p>`;
  }
}

function renderInstructorAccounts(list) {
  const out = $('instructorAccountsOutput');
  if (!out) return;
  const pending = list.filter(i => i.status === 'pending');
  const others = list.filter(i => i.status !== 'pending');
  const me = authUser && authUser.username;

  const row = (i) => `
    <tr>
      <td>${escapeHtml(i.displayName)}</td>
      <td>${escapeHtml(i.username)}</td>
      <td><span class="status-badge status-${escapeHtml(i.status)}">${escapeHtml(i.status)}</span></td>
      <td>${escapeHtml(i.role)}</td>
      <td class="account-actions">
        ${i.status !== 'approved' ? `<button type="button" class="secondary account-approve-btn" data-username="${escapeHtml(i.username)}">Approve</button>` : ''}
        ${i.status !== 'rejected' && i.username !== me ? `<button type="button" class="secondary account-reject-btn" data-username="${escapeHtml(i.username)}">${i.status === 'pending' ? 'Reject' : 'Revoke'}</button>` : ''}
        ${i.role !== 'admin' && i.status === 'approved' ? `<button type="button" class="secondary account-promote-btn" data-username="${escapeHtml(i.username)}">Make admin</button>` : ''}
        ${i.role === 'admin' && i.username !== me ? `<button type="button" class="secondary account-demote-btn" data-username="${escapeHtml(i.username)}">Remove admin</button>` : ''}
      </td>
    </tr>`;

  out.innerHTML = `
    <h3>Pending requests${pending.length ? ` (${pending.length})` : ''}</h3>
    ${tableHtml(['Name','Username','Status','Role','Actions'], pending.map(row), 'No pending requests.')}
    <h3>All instructor accounts</h3>
    ${tableHtml(['Name','Username','Status','Role','Actions'], others.map(row), 'No other accounts yet.')}
  `;
}

async function setInstructorStatus(username, status) {
  const url = activeWebAppUrl();
  try {
    const data = await getJsonp(url, { action: 'admin_set_status', token: authToken, targetUsername: username, status }, 'energytechSetStatus');
    if (!data || !data.ok) { alert((data && data.error) || 'Could not update account.'); return; }
    loadInstructorAccounts();
  } catch (err) { alert(err.message || String(err)); }
}

async function setInstructorRole(username, role) {
  const url = activeWebAppUrl();
  try {
    const data = await getJsonp(url, { action: 'admin_set_role', token: authToken, targetUsername: username, role }, 'energytechSetRole');
    if (!data || !data.ok) { alert((data && data.error) || 'Could not update role.'); return; }
    loadInstructorAccounts();
  } catch (err) { alert(err.message || String(err)); }
}

function sessionCodeFrom(group) {
  const prefix = String(group || 'ENTECH').trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6) || 'EnergyTech';
  const num = Math.floor(Math.random() * 9000) + 1000;
  return `${prefix}-${num}`;
}

function sessionPayloadFromInstructor() {
  // Composite "<chapter>:<set>" key, so a trainee loading this code gets the
  // same chapter the instructor picked.
  const key = activeSetKey();
  const intake = $('sessionIntake') ? $('sessionIntake').value : '';
  const group = $('sessionGroup') ? $('sessionGroup').value : '';
  return {
    type: 'quiz_session',
    session: {
      sessionCode: sessionCodeFrom(group || intake),
      sessionName: $('sessionName').value.trim() || 'Quiz Session',
      intake,
      group,
      allowWalkIn: Boolean($('allowWalkIn') && $('allowWalkIn').checked),
      questionSetKey: key,
      questionSet: selectionLabel(key),
      questionCount: Number($('questionCount').value) || 30,
      seed: $('seedInput').value.trim() || String(Date.now()),
      orderMode: $('orderMode').value,
      mode: $('sessionMode').value,
      showOriginalNumbers: $('showOriginalNumbers').checked,
      requireAll: true
    }
  };
}

function sessionCodeHtml(code) {
  return `<span class="session-code-box">${escapeHtml(code)}</span>
    <button type="button" class="copy-session-btn" data-session-code="${escapeHtml(code)}" title="Copy session code" aria-label="Copy session code">📋 Copy</button>`;
}

async function copySessionCodeFromButton(btn) {
  const code = btn.getAttribute('data-session-code') || '';
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    btn.textContent = '✓ Copied';
    setTimeout(() => { btn.textContent = '📋 Copy'; }, 1600);
  } catch {
    const temp = document.createElement('input');
    temp.value = code;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    temp.remove();
    btn.textContent = '✓ Copied';
    setTimeout(() => { btn.textContent = '📋 Copy'; }, 1600);
  }
}

async function createSession() {
  const status = $('sessionStatus');
  if (!isLoggedIn()) {
    if (status) { status.className = 'feedback bad'; status.innerHTML = 'You are not logged in. Please log in again.'; }
    return;
  }
  if (!requireSelection()) return;
  const url = activeWebAppUrl();
  const payload = sessionPayloadFromInstructor();
  payload.token = authToken;
  currentSession = payload.session;
  localStorage.setItem(`energytechSession_${currentSession.sessionCode}`, JSON.stringify(currentSession));
  buildQuizFromSettings(currentSession, 'teacher');

  if (status) {
    status.className = 'feedback empty';
    status.innerHTML = `Session code: ${sessionCodeHtml(currentSession.sessionCode)}<br>Mode: <span class="mode-pill ${escapeHtml(currentSession.mode)}">${escapeHtml(currentSession.mode.toUpperCase())}</span><p>Saving session online...</p>`;
  }

  if (!url) {
    if (status) {
      status.className = 'feedback bad';
      status.innerHTML += '<p><strong>Not saved online:</strong> no Google Apps Script URL found. Trainees on other devices will not be able to load this code.</p>';
    }
    return;
  }

  try {
    await fetch(url, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });

    let verified = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 900 * attempt));
      try {
        const data = await getSessionByJsonp(url, currentSession.sessionCode);
        if (data && data.ok && data.session && data.session.sessionCode === currentSession.sessionCode) {
          verified = data.session;
          break;
        }
      } catch {}
    }

    if (verified) {
      if (status) {
        status.className = 'feedback good';
        status.innerHTML = `Session saved online and verified.<br>Session code: ${sessionCodeHtml(currentSession.sessionCode)}<br>Mode: <span class="mode-pill ${escapeHtml(currentSession.mode)}">${escapeHtml(currentSession.mode.toUpperCase())}</span><p><strong>Trainees can now load this code from any device.</strong></p>`;
      }
    } else {
      if (status) {
        status.className = 'feedback bad';
        status.innerHTML = `Session created only on this device.<br>Session code: ${sessionCodeHtml(currentSession.sessionCode)}<p><strong>Online save was not verified.</strong> Trainees on other devices may not be able to load this code. Check the Google Apps Script deployment and internet connection, then create a new session.</p>`;
      }
    }
  } catch (err) {
    if (status) {
      status.className = 'feedback bad';
      status.innerHTML = `Session created only on this device.<br>Session code: ${sessionCodeHtml(currentSession.sessionCode)}<p><strong>Online save failed:</strong> ${escapeHtml(err.message || String(err))}</p>`;
    }
  }
}


function getJsonp(url, params = {}, prefix = 'energytechJsonp', timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const callbackName = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    let finished = false;
    const timeoutId = setTimeout(() => {
      if (finished) return;
      finished = true;
      delete window[callbackName];
      const old = document.getElementById(callbackName);
      if (old) old.remove();
      reject(new Error('Google Apps Script did not answer in time. '
        + 'Press Refresh to try again, or run Test backend connection if it keeps happening.'));
    }, timeoutMs);

    window[callbackName] = (data) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      delete window[callbackName];
      const old = document.getElementById(callbackName);
      if (old) old.remove();
      resolve(data);
    };

    const script = document.createElement('script');
    script.id = callbackName;
    const query = new URLSearchParams(Object.assign({}, params, { callback: callbackName, t: Date.now() }));
    const sep = url.includes('?') ? '&' : '?';
    script.src = `${url}${sep}${query.toString()}`;
    script.onerror = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      delete window[callbackName];
      script.remove();
      reject(new Error('Could not load Google Apps Script. Check deployment permissions and the Web App URL.'));
    };
    document.body.appendChild(script);
  });
}

/* Runs a short sequence of probes rather than a single check, because
 * "it does not work" has several very different causes and they need
 * different fixes. Each probe is caught on its own so one failure still
 * leaves the rest of the report readable. */
async function testBackendConnection() {
  const url = activeWebAppUrl();
  if (!url) { setDashboardStatus('No Google Apps Script URL is saved.', 'bad'); return; }
  setDashboardStatus('Running backend checks...', 'empty');

  // An untokened call to a protected action is the version probe: the current
  // backend refuses it with an error, an older one that has never heard of the
  // action falls through to its generic ok reply.
  const refuses = d => Boolean(d && d.ok === false && d.error);
  const probes = [
    { label: 'Backend is reachable', action: 'ping', token: false,
      pass: d => Boolean(d && d.ok),
      fail: 'The script did not answer. Check the Web App URL, and that <strong>Who has access</strong> is <strong>Anyone</strong>.' },
    { label: 'Instructor accounts supported', action: 'admin_list_instructors', token: false,
      pass: refuses,
      fail: 'This deployment predates instructor accounts. Paste the latest <code>Code.gs</code> and deploy a <strong>New version</strong>.' },
    { label: 'Intake module supported', action: 'roster_list', token: false,
      pass: refuses,
      fail: 'This deployment does not have the intake module yet. Paste the latest <code>Code.gs</code> and deploy a <strong>New version</strong>.' },
    { label: 'Your login is still valid', action: 'roster_list', token: true,
      pass: d => Boolean(d && d.ok === true),
      fail: 'The backend is up to date, but it did not accept your login. Log out and log in again.' }
  ];

  const rows = [];
  let firstProblem = null;
  for (const probe of probes) {
    if (probe.token && !authToken) {
      rows.push({ label: probe.label, state: 'skip', detail: 'not logged in on this device' });
      continue;
    }
    const params = { action: probe.action };
    if (probe.token) params.token = authToken;
    let detail = '';
    let good = false;
    try {
      const data = await getJsonp(url, params, 'energytechDiag', 12000);
      good = probe.pass(data);
      detail = data && data.error ? String(data.error)
        : data && data.message ? String(data.message)
        : 'replied';
    } catch (err) {
      detail = 'no reply within 12 seconds';
    }
    rows.push({ label: probe.label, state: good ? 'ok' : 'bad', detail });
    if (!good && !firstProblem) firstProblem = probe;
    if (!good) break;                 // later probes depend on the earlier ones
  }

  const icon = { ok: '&#10003;', bad: '&#10007;', skip: '&ndash;' };
  const cls  = { ok: 'status-approved', bad: 'status-rejected', skip: 'status-pending' };
  const list = rows.map(r =>
    `<li><span class="status-badge ${cls[r.state]}">${icon[r.state]}</span> ${escapeHtml(r.label)}
      <span class="hint"> &mdash; ${escapeHtml(r.detail)}</span></li>`).join('');

  const allGood = rows.length === probes.length && rows.every(r => r.state === 'ok');
  setDashboardStatus(
    `<ul class="diag-list">${list}</ul>`
    + (allGood
        ? '<p><strong>Everything is up to date.</strong></p>'
        : `<p><strong>What to do:</strong> ${firstProblem ? firstProblem.fail : 'Log in and run this again.'}</p>`
          + `<p class="hint">To see the raw reply, open this in a new tab:<br>`
          + `<a href="${escapeHtml(url)}?action=${escapeHtml(firstProblem ? firstProblem.action : 'ping')}" target="_blank" rel="noopener">${escapeHtml(url)}?action=${escapeHtml(firstProblem ? firstProblem.action : 'ping')}</a></p>`),
    allGood ? 'good' : 'bad');
}

function getSessionByJsonp(url, code) {
  return getJsonp(url, { action: 'session', code }, 'energytechSession');
}

// One place to resolve a session code, used by the signed-in trainee path and
// by the walk-in path. Returns null when the code is unknown.
async function fetchSessionByCode(code) {
  const local = localStorage.getItem(`energytechSession_${code}`);
  if (local) {
    try { return JSON.parse(local); } catch { /* fall through to the network */ }
  }
  const url = activeWebAppUrl();
  if (!url) return null;
  const data = await getSessionByJsonp(url, code);
  return (data && data.ok && data.session) ? data.session : null;
}

async function loadTraineeSession() {
  const status = $('studentStatus');
  const code = $('studentSessionCode').value.trim().toUpperCase();
  if (!code) {
    status.className = 'feedback warn';
    status.innerHTML = 'Enter the session code from your instructor.';
    return;
  }
  if (!traineeLoggedIn()) {
    status.className = 'feedback warn';
    status.innerHTML = 'Log in with your EnergyTech ID before starting.';
    return;
  }
  walkInIdentity = null;

  status.className = 'feedback empty';
  status.innerHTML = 'Loading session...';
  let session = null;
  try {
    session = await fetchSessionByCode(code);
  } catch (err) {
    status.className = 'feedback bad';
    status.innerHTML = escapeHtml(err.message || String(err));
    return;
  }

  if (!session) {
    status.className = 'feedback bad';
    status.innerHTML = 'Session not found. Check the code and make sure the Google Apps Script URL is saved.';
    return;
  }

  currentSession = session;
  activeRole = 'student';
  status.className = 'feedback good';
  status.innerHTML = `Session loaded: <strong>${escapeHtml(session.sessionName || code)}</strong> — <span class="mode-pill ${escapeHtml(session.mode || 'practice')}">${escapeHtml((session.mode || 'practice').toUpperCase())}</span>`;
  buildQuizFromSettings(session, 'student');
  $('studentQuizArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function saveTraineeWebAppUrl() {
  const s = $('studentStatus');
  if (s) {
    s.className = 'feedback good';
    s.innerHTML = 'The connection URL is already built into the app.';
  }
}

function studentDownloadResult() {
  if (!lastFeedback) {
    const ok = calculateScore({ target: 'student', requireAll: true, reveal: true });
    if (!ok) return;
  }
  downloadResult();
}

function init() {
  // Landing and role navigation
  if ($('studentModeBtn')) $('studentModeBtn').addEventListener('click', showTraineeMode);
  if ($('teacherModeBtn')) $('teacherModeBtn').addEventListener('click', showInstructorLogin);
  if ($('homeBtn')) $('homeBtn').addEventListener('click', goHome);
  if ($('backFromInstructorLoginBtn')) $('backFromInstructorLoginBtn').addEventListener('click', goHome);
  if ($('backFromTraineeBtn')) $('backFromTraineeBtn').addEventListener('click', goHome);
  if ($('teacherLoginBtn')) $('teacherLoginBtn').addEventListener('click', attemptInstructorLogin);
  if ($('teacherLoginPassword')) $('teacherLoginPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptInstructorLogin(); });
  if ($('teacherLoginUsername')) $('teacherLoginUsername').addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptInstructorLogin(); });
  if ($('toggleSignupBtn')) $('toggleSignupBtn').addEventListener('click', () => toggleSignupPanel());
  if ($('requestAccountBtn')) $('requestAccountBtn').addEventListener('click', requestInstructorAccount);
  if ($('logoutBtn')) $('logoutBtn').addEventListener('click', logoutInstructor);
  if ($('changePasswordBtn')) $('changePasswordBtn').addEventListener('click', changeMyPassword);
  if ($('loadInstructorAccountsBtn')) $('loadInstructorAccountsBtn').addEventListener('click', loadInstructorAccounts);

  // Instructor tools
  if ($('createSessionBtn')) $('createSessionBtn').addEventListener('click', createSession);
  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest && e.target.closest('.copy-session-btn');
    if (copyBtn) { copySessionCodeFromButton(copyBtn); return; }
    const approveBtn = e.target.closest && e.target.closest('.account-approve-btn');
    if (approveBtn) { setInstructorStatus(approveBtn.dataset.username, 'approved'); return; }
    const rejectBtn = e.target.closest && e.target.closest('.account-reject-btn');
    if (rejectBtn) { setInstructorStatus(rejectBtn.dataset.username, 'rejected'); return; }
    const promoteBtn = e.target.closest && e.target.closest('.account-promote-btn');
    if (promoteBtn) { setInstructorRole(promoteBtn.dataset.username, 'admin'); return; }
    const demoteBtn = e.target.closest && e.target.closest('.account-demote-btn');
    if (demoteBtn) { setInstructorRole(demoteBtn.dataset.username, 'instructor'); return; }
  });
  if ($('previewSessionBtn')) $('previewSessionBtn').addEventListener('click', generateQuiz);
  if ($('newSeedBtn')) $('newSeedBtn').addEventListener('click', () => { $('seedInput').value = String(Math.floor(Math.random() * 90000000) + 10000000); });
  if ($('submitBtn')) $('submitBtn').addEventListener('click', () => calculateScore({ target: 'teacher', requireAll: false, reveal: true }));
  if ($('resetAnswersBtn')) $('resetAnswersBtn').addEventListener('click', () => clearAnswers('teacher'));
  if ($('copyReferenceBtn')) $('copyReferenceBtn').addEventListener('click', copyReference);
  if ($('downloadResultBtn')) $('downloadResultBtn').addEventListener('click', downloadResult);
  if ($('saveWebAppUrlBtn')) $('saveWebAppUrlBtn').addEventListener('click', saveWebAppUrl);
  if ($('loadDashboardBtn')) $('loadDashboardBtn').addEventListener('click', loadDashboard);
  if ($('testBackendBtn')) $('testBackendBtn').addEventListener('click', testBackendConnection);
  if ($('exportDashboardCsvBtn')) $('exportDashboardCsvBtn').addEventListener('click', exportDashboardCsv);
  if ($('downloadActivityBtn')) $('downloadActivityBtn').addEventListener('click', downloadActivityCsv);
  if ($('showOriginalNumbers')) $('showOriginalNumbers').addEventListener('change', () => {
    if (currentQuiz.length) {
      const target = activeRole === 'student' ? 'student' : 'teacher';
      const container = target === 'student' ? $('studentQuizContainer') : $('quizContainer');
      if (container) container.innerHTML = currentQuiz.map(renderQuestion).join('');
    }
  });

  // Trainee tools
  if ($('loadTraineeSessionBtn')) $('loadTraineeSessionBtn').addEventListener('click', loadTraineeSession);
  if ($('studentSessionCode')) $('studentSessionCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
  if ($('studentSubmitBtn')) $('studentSubmitBtn').addEventListener('click', () => submitOnlineResult('student'));
  if ($('studentClearBtn')) $('studentClearBtn').addEventListener('click', () => clearAnswers('student'));
  if ($('studentDownloadResultBtn')) $('studentDownloadResultBtn').addEventListener('click', studentDownloadResult);
  
  // Selection tree
  const tree = $('questionTree');
  if (tree) {
    tree.addEventListener('change', onTreeChange);
    // 'toggle' does not bubble, so capture it to build a paper's rows on first open.
    tree.addEventListener('toggle', (e) => {
      const d = e.target;
      if (d && d.tagName === 'DETAILS' && d.open && d.classList.contains('tree-paper')) fillPaperNode(d);
    }, true);
  }
  if ($('sessionName')) {
    $('sessionName').addEventListener('input', (e) => {
      sessionNameIsAuto = e.target.value.trim() === '';
      if (sessionNameIsAuto) refreshSessionName();
    });
  }
  if ($('selAllBtn')) $('selAllBtn').addEventListener('click', () => selectAll(true));
  if ($('selNoneBtn')) $('selNoneBtn').addEventListener('click', () => selectAll(false));
  if ($('selExpandBtn')) $('selExpandBtn').addEventListener('click', () => expandTree(true));
  if ($('selCollapseBtn')) $('selCollapseBtn').addEventListener('click', () => expandTree(false));

  // Question count: number field, slider and steppers all stay in sync.
  if ($('questionCount')) {
    $('questionCount').addEventListener('input', () => setCountValue(currentCount()));
    $('questionCount').addEventListener('blur', () => setCountValue(currentCount()));
  }
  if ($('questionCountRange')) {
    $('questionCountRange').addEventListener('input', (e) => setCountValue(Number(e.target.value)));
  }
  if ($('countMinusBtn')) $('countMinusBtn').addEventListener('click', () => setCountValue(currentCount() - 1));
  if ($('countPlusBtn')) $('countPlusBtn').addEventListener('click', () => setCountValue(currentCount() + 1));
  if ($('countAllBtn')) $('countAllBtn').addEventListener('click', () => setCountValue(totalSelected()));

  renderQuestionTree();
  // Open on the original Chapters 01 & 02 paper, matching the previous default.
  setPaperSelected(paperByKey(composeSetKey(DEFAULT_CHAPTER, DEFAULT_SET)), true);
  afterSelectionChange();
  setCountValue(30);

  if ($('printBtn')) $('printBtn').addEventListener('click', () => window.print());
  if ($('webAppUrl')) $('webAppUrl').value = savedWebAppUrl();
    if ($('onlineStatus')) setOnlineStatus('Google Apps Script URL is embedded in this version. Session codes will be checked after saving, so you will know whether trainees can load them from other devices.', 'good');
  if ($('dashboardStatus')) setDashboardStatus('Google Apps Script URL is embedded. Click <strong>Load instructor dashboard</strong> after submissions.', 'empty');

  loadAuthFromStorage();
  goHome();

  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if ($('installBtn')) $('installBtn').hidden = false;
  });
  if ($('installBtn')) $('installBtn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('installBtn').hidden = true;
  });

  wireRosterUi();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);

/* ==========================================================================
 * Intake management (admin) and trainee accounts
 * ========================================================================== */

const TRAINEE_TOKEN_KEY = 'energytechTraineeToken_v1';
const TRAINEE_PROFILE_KEY = 'energytechTraineeProfile_v1';

let traineeToken = null;
let traineeProfile = null;     // { energytechId, name, intake, group }
let walkInIdentity = null;     // { name, group, energytechId } for a guest sitting
let rosterCache = null;        // { intakes: [], groups: [] }
let pendingImport = null;      // rows waiting for the instructor to confirm

/* ---------------- shared backend call ---------------- */

async function rosterCall(action, params = {}, prefix = 'energytechRoster', retries = 0) {
  const url = activeWebAppUrl();
  if (!url) throw new Error('No Google Apps Script URL is configured.');
  let data;
  for (let attempt = 0; ; attempt++) {
    try {
      data = await getJsonp(url, Object.assign({ action }, params), prefix);
      break;
    } catch (err) {
      if (attempt >= retries) throw err;
    }
  }
  if (!data) throw new Error('No response from the backend.');
  // An Apps Script that predates this module has no such action and falls
  // through to its generic reply, so ok:true arrives with nothing in it.
  if (data.ok && data.message && !data.intakes && !data.trainees && !data.trainee
      && data.added === undefined && !data.label && !data.name && !data.deleted
      && !data.energytechId && !data.token && !data.status) {
    throw new Error('This Google Apps Script does not have the intake module yet. '
      + 'Paste the latest Code.gs into Apps Script, then Deploy → Manage deployments → '
      + 'edit → Version: New version → Deploy.');
  }
  return data;
}

/* ---------------- trainee session storage ---------------- */

function loadTraineeFromStorage() {
  try {
    const t = localStorage.getItem(TRAINEE_TOKEN_KEY);
    const p = localStorage.getItem(TRAINEE_PROFILE_KEY);
    if (t && p) { traineeToken = t; traineeProfile = JSON.parse(p); }
  } catch { traineeToken = null; traineeProfile = null; }
}

function persistTrainee() {
  if (traineeToken && traineeProfile) {
    localStorage.setItem(TRAINEE_TOKEN_KEY, traineeToken);
    localStorage.setItem(TRAINEE_PROFILE_KEY, JSON.stringify(traineeProfile));
  } else {
    localStorage.removeItem(TRAINEE_TOKEN_KEY);
    localStorage.removeItem(TRAINEE_PROFILE_KEY);
  }
}

function traineeLoggedIn() { return Boolean(traineeToken && traineeProfile); }

function traineeFullName(p) {
  return String((p && p.name) || '').trim();
}

/* ---------------- trainee mode screens ---------------- */

function showTraineeMode() {
  activeRole = 'student';
  showOnly('studentInterface');
  renderTraineeHome();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderTraineeHome() {
  const loggedIn = traineeLoggedIn();
  if ($('traineeLoginPanel')) $('traineeLoginPanel').hidden = loggedIn;
  if ($('traineeHomePanel')) $('traineeHomePanel').hidden = !loggedIn;
  // A guest who is midway through a session keeps their quiz on screen.
  if ($('studentQuizArea') && !loggedIn && !walkInIdentity) $('studentQuizArea').hidden = true;
  if (!loggedIn) {
    // A guest must not be left looking at the last trainee's results.
    if ($('myHistoryPanel')) $('myHistoryPanel').hidden = true;
    if ($('myHistoryBody')) $('myHistoryBody').innerHTML = '';
    MY_VIEW.data = null;
    return;
  }
  walkInIdentity = null;

  const p = traineeProfile;
  if ($('traineeAccountBar')) {
    $('traineeAccountBar').innerHTML = `Logged in as <strong>${escapeHtml(traineeFullName(p))}</strong>`;
  }
  if ($('traineeProfile')) {
    $('traineeProfile').innerHTML = `
      <dl class="profile-grid">
        <div><dt>EnergyTech ID</dt><dd>${escapeHtml(p.energytechId || '')}</dd></div>
        <div><dt>Name</dt><dd>${escapeHtml(p.name || '')}</dd></div>
        <div><dt>Intake</dt><dd>${escapeHtml(p.intake || '—')}</dd></div>
        <div><dt>Group</dt><dd>${escapeHtml(p.group || '—')}</dd></div>
      </dl>`;
  }

  // Their record loads on its own; the home screen is usable before it arrives.
  loadMyHistory();
}

function toggleTraineeSignup(force) {
  const el = $('traineeSignupPanel');
  if (!el) return;
  el.hidden = force === undefined ? !el.hidden : !force;
  if (!el.hidden && $('walkInPanel')) $('walkInPanel').hidden = true;
}

function toggleWalkIn(force) {
  const el = $('walkInPanel');
  if (!el) return;
  el.hidden = force === undefined ? !el.hidden : !force;
  if (!el.hidden && $('traineeSignupPanel')) $('traineeSignupPanel').hidden = true;
}

async function traineeLogIn() {
  const id = $('traineeLoginId') ? $('traineeLoginId').value.trim() : '';
  const password = $('traineeLoginPassword') ? $('traineeLoginPassword').value : '';
  const st = $('traineeLoginStatus');
  if (!id || !password) {
    if (st) { st.className = 'feedback warn'; st.innerHTML = 'Enter your EnergyTech ID and password.'; }
    return;
  }
  if (st) { st.className = 'feedback empty'; st.innerHTML = 'Checking…'; }
  try {
    const data = await rosterCall('trainee_login', { energytechId: id, password }, 'energytechTraineeLogin');
    if (!data.ok || !data.token || !data.trainee) {
      if (st) { st.className = 'feedback bad'; st.innerHTML = escapeHtml(data.error || 'Login failed.'); }
      return;
    }
    traineeToken = data.token;
    traineeProfile = data.trainee;
    persistTrainee();
    if ($('traineeLoginPassword')) $('traineeLoginPassword').value = '';
    if (st) { st.className = 'feedback good'; st.innerHTML = 'Signed in.'; }
    renderTraineeHome();
  } catch (err) {
    if (st) { st.className = 'feedback bad'; st.innerHTML = escapeHtml(err.message || String(err)); }
  }
}

async function traineeSignUp() {
  const id = $('traineeSignupId') ? $('traineeSignupId').value.trim() : '';
  const pw = $('traineeSignupPassword') ? $('traineeSignupPassword').value : '';
  const confirm = $('traineeSignupConfirm') ? $('traineeSignupConfirm').value : '';
  const st = $('traineeSignupStatus');
  if (!id || !pw) {
    if (st) { st.className = 'feedback warn'; st.innerHTML = 'Enter your EnergyTech ID and choose a password.'; }
    return;
  }
  if (pw !== confirm) {
    if (st) { st.className = 'feedback warn'; st.innerHTML = 'The two passwords do not match.'; }
    return;
  }
  if (st) { st.className = 'feedback empty'; st.innerHTML = 'Creating your account…'; }
  try {
    const data = await rosterCall('trainee_signup', { energytechId: id, password: pw }, 'energytechTraineeSignup');
    if (!data.ok || !data.token) {
      if (st) { st.className = 'feedback bad'; st.innerHTML = escapeHtml(data.error || 'Could not create the account.'); }
      return;
    }
    traineeToken = data.token;
    traineeProfile = data.trainee;
    persistTrainee();
    ['traineeSignupId', 'traineeSignupPassword', 'traineeSignupConfirm']
      .forEach(k => { if ($(k)) $(k).value = ''; });
    renderTraineeHome();
  } catch (err) {
    if (st) { st.className = 'feedback bad'; st.innerHTML = escapeHtml(err.message || String(err)); }
  }
}

function traineeLogOut() {
  const token = traineeToken;
  traineeToken = null;
  traineeProfile = null;
  walkInIdentity = null;
  persistTrainee();
  currentSession = null;
  currentQuiz = [];
  if ($('studentQuizArea')) $('studentQuizArea').hidden = true;
  if (token) {
    const url = activeWebAppUrl();
    if (url) getJsonp(url, { action: 'trainee_logout', token }, 'energytechTraineeLogout').catch(() => {});
  }
  renderTraineeHome();
  goHome();
}

async function traineeChangePassword() {
  const oldPw = $('traineeOldPassword') ? $('traineeOldPassword').value : '';
  const newPw = $('traineeNewPassword') ? $('traineeNewPassword').value : '';
  const st = $('traineePasswordStatus');
  if (!oldPw || !newPw) {
    if (st) { st.className = 'feedback warn'; st.innerHTML = 'Fill in both password fields.'; }
    return;
  }
  try {
    const data = await rosterCall('trainee_change_password',
      { token: traineeToken, oldPassword: oldPw, newPassword: newPw }, 'energytechTraineePw');
    if (st) {
      st.className = data.ok ? 'feedback good' : 'feedback bad';
      st.innerHTML = escapeHtml(data.ok ? 'Password changed.' : (data.error || 'Could not change it.'));
    }
    if (data.ok) ['traineeOldPassword', 'traineeNewPassword'].forEach(k => { if ($(k)) $(k).value = ''; });
  } catch (err) {
    if (st) { st.className = 'feedback bad'; st.innerHTML = escapeHtml(err.message || String(err)); }
  }
}
/* ==========================================================================
 * Admin roster workspace
 *
 * Three panes, drilled through left to right: intakes -> groups -> trainees.
 * The trainee list sits beside the group you clicked rather than far below it,
 * which is what made the old layout impossible to find your way around.
 * ========================================================================== */

let rosterSel = { intake: '', group: '' };   // what is currently drilled into
let traineeCache = [];                       // trainees of the open group
let traineeFilter = 'all';
let selectedIds = new Set();                 // for bulk move / revoke
let searchTerm = '';
let allTrainees = null;                      // every trainee, for the search box
let editingId = '';                          // trainee row open for editing

/* ---------------- status lines ---------------- */

function rosterTopStatus(msg, kind) {
  const el = $('rosterStatusLine');
  if (!el) return;
  if (!msg) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.className = `feedback ${kind || 'empty'}`;
  el.innerHTML = msg;
}

function rosterStatus(msg, kind) {
  const el = $('traineeManagerStatus');
  if (!el) return;
  if (!msg) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.className = `feedback ${kind || 'empty'}`;
  el.innerHTML = msg;
}

/* A message that clears itself, so the panel does not keep showing what
 * happened several actions ago. Errors stay until the next action. */
let flashTimer = null;
function rosterFlash(msg, kind) {
  rosterTopStatus(msg, kind);
  clearTimeout(flashTimer);
  if (kind !== 'bad') flashTimer = setTimeout(() => rosterTopStatus(''), 4000);
}

/* ---------------- loading ---------------- */

async function loadRoster(quiet) {
  if (!isLoggedIn()) return;
  if (!quiet) rosterTopStatus('Loading&hellip;');
  try {
    const data = await rosterCall('roster_list', { token: authToken }, 'energytechRoster', 1);
    if (!data.ok) {
      if (isAdmin()) rosterTopStatus(escapeHtml(data.error || 'Could not load intakes.'), 'bad');
      return;
    }
    rosterCache = { intakes: data.intakes || [], groups: data.groups || [] };
    if (!quiet) rosterTopStatus('');
    if (isAdmin()) {
      // Keep the drill-down pointing somewhere real after a rename or delete.
      if (rosterSel.intake && !rosterCache.intakes.some(i => i.label === rosterSel.intake)) {
        rosterSel = { intake: '', group: '' };
      }
      if (rosterSel.group && !rosterCache.groups.some(g => g.intake === rosterSel.intake && g.name === rosterSel.group)) {
        rosterSel.group = '';
      }
      renderWorkspace();
    }
    populateSessionIntakes();
  } catch (err) {
    if (isAdmin()) rosterTopStatus(escapeHtml(err.message || String(err)), 'bad');
  }
}

/* Any signed-in instructor may read the roster, so the Intake and Group pickers
 * on the session form are filled for everyone -- only editing is admin-only.
 * Failures are silent here: a missing roster must not block session creation. */
function loadRosterForSessionPickers() {
  if (!isLoggedIn()) return;
  loadRoster(true).catch(() => {});
}

function groupsOf(intake) {
  return (rosterCache ? rosterCache.groups : [])
    .filter(g => g.intake === intake)
    .sort((a, b) => Number(String(a.name).slice(1)) - Number(String(b.name).slice(1)));
}

/* ---------------- rendering ---------------- */

function renderWorkspace() {
  renderIntakePane();
  renderGroupPane();
  renderTraineePane();
}

function countLine(groups) {
  const trainees = groups.reduce((a, g) => a + g.trainees, 0);
  const logins = groups.reduce((a, g) => a + g.withAccount, 0);
  const missing = trainees - logins;
  return `${groups.length} group${groups.length === 1 ? '' : 's'} · ${trainees} trainee${trainees === 1 ? '' : 's'}`
    + (missing ? `<br><span class="warn-text">${missing} without a login</span>` : '');
}

function renderIntakePane() {
  const box = $('intakeList');
  if (!box) return;
  const intakes = rosterCache ? rosterCache.intakes : [];
  if (!intakes.length) {
    box.innerHTML = '<p class="pane-empty">No intakes yet.<br><strong>+ New</strong> to add your first one, for example JAN26.</p>';
    return;
  }
  box.innerHTML = intakes.map(i => {
    const on = i.label === rosterSel.intake;
    return `<div class="pane-item${on ? ' is-selected' : ''}" data-intake="${escapeHtml(i.label)}" role="button" tabindex="0">
        <span class="pane-item-main">
          <span class="pane-item-name">${escapeHtml(i.label)}</span>
          <span class="pane-item-sub">${countLine(groupsOf(i.label))}</span>
        </span>
        ${on ? `<span class="pane-item-actions">
          <button type="button" class="icon-btn intake-rename" data-label="${escapeHtml(i.label)}" title="Rename ${escapeHtml(i.label)}">Rename</button>
          <button type="button" class="icon-btn danger intake-delete" data-label="${escapeHtml(i.label)}" title="Delete ${escapeHtml(i.label)}">Delete</button>
        </span>` : ''}
      </div>`;
  }).join('');
}

function renderGroupPane() {
  const box = $('groupList');
  const title = $('groupPaneTitle');
  const add = $('showAddGroup');
  if (!box) return;
  if (!rosterSel.intake) {
    if (title) title.textContent = 'Groups';
    if (add) add.hidden = true;
    if ($('addGroupForm')) $('addGroupForm').hidden = true;
    box.innerHTML = '<p class="pane-empty">Pick an intake to see its groups.</p>';
    return;
  }
  if (title) title.textContent = 'Groups';
  if (add) add.hidden = false;
  const groups = groupsOf(rosterSel.intake);
  if (!groups.length) {
    box.innerHTML = '<p class="pane-empty">No groups in this intake yet.<br><strong>+ New</strong> to add G1 — or import a CSV with a Group column and they will be made for you.</p>';
    return;
  }
  box.innerHTML = groups.map(g => {
    const on = g.name === rosterSel.group;
    const missing = g.trainees - g.withAccount;
    return `<div class="pane-item${on ? ' is-selected' : ''}" data-group="${escapeHtml(g.name)}" role="button" tabindex="0">
        <span class="pane-item-main">
          <span class="pane-item-name">${escapeHtml(g.name)}</span>
          <span class="pane-item-sub">${g.trainees} trainee${g.trainees === 1 ? '' : 's'}${missing ? `<br><span class="warn-text">${missing} without a login</span>` : ''}</span>
        </span>
        ${on ? `<span class="pane-item-actions">
          <button type="button" class="icon-btn group-rename" data-name="${escapeHtml(g.name)}" title="Rename ${escapeHtml(g.name)}">Rename</button>
          <button type="button" class="icon-btn danger group-delete" data-name="${escapeHtml(g.name)}" title="Delete ${escapeHtml(g.name)}">Delete</button>
        </span>` : ''}
      </div>`;
  }).join('');
}

function accountBadge(status) {
  const label = { active: 'has a login', revoked: 'revoked', none: 'no login yet' }[status] || status;
  const cls = { active: 'status-approved', revoked: 'status-rejected', none: 'status-pending' }[status] || '';
  return `<span class="status-badge ${cls}">${label}</span>`;
}

function visibleTrainees() {
  let list = traineeCache;
  if (traineeFilter !== 'all') list = list.filter(t => (t.accountStatus || 'none') === traineeFilter);
  return list;
}

function traineeRow(t, opts) {
  const id = escapeHtml(t.energytechId);
  if (t.energytechId === editingId) {
    const groups = groupsOf(rosterSel.intake);
    return `<tr class="trainee-edit-row"><td colspan="5">
      <div class="grid trainee-fields">
        <label>EnergyTech ID <input class="edit-id" value="${id}" /></label>
        <label class="name-field">Full name <input class="edit-name" value="${escapeHtml(t.name || '')}" /></label>
        <label>Group <select class="edit-group">${groups.map(g =>
          `<option value="${escapeHtml(g.name)}"${g.name === t.group ? ' selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}</select></label>
      </div>
      <div class="pane-form-actions">
        <button type="button" class="save-trainee" data-id="${id}">Save</button>
        <button type="button" class="secondary cancel-edit">Cancel</button>
      </div>
    </td></tr>`;
  }
  const where = opts && opts.showWhere
    ? `<td class="where">${escapeHtml(t.intake || '')} / ${escapeHtml(t.group || '')}</td>` : '';
  const box = opts && opts.showWhere ? ''
    : `<td class="pick"><input type="checkbox" class="pick-trainee" data-id="${id}"${selectedIds.has(t.energytechId) ? ' checked' : ''} aria-label="Select ${id}" /></td>`;
  return `<tr>
    ${box}
    <td class="mono">${id}</td>
    <td class="trainee-name"><button type="button" class="name-link open-profile" data-id="${id}">${escapeHtml(t.name || '')}</button></td>
    ${where}
    <td>${accountBadge(t.accountStatus || 'none')}</td>
    <td class="row-actions">
      <button type="button" class="icon-btn trainee-edit" data-id="${id}">Edit</button>
      <button type="button" class="icon-btn danger trainee-delete" data-id="${id}">Delete</button>
    </td>
  </tr>`;
}

function renderTraineePane() {
  const box = $('traineeList');
  const title = $('traineePaneTitle');
  const actions = $('traineePaneActions');
  const filters = $('traineeFilters');
  if (!box) return;

  if (searchTerm) {
    if (title) title.textContent = `Search: “${searchTerm}”`;
    if (actions) actions.hidden = true;
    if (filters) filters.hidden = true;
    if ($('bulkBar')) $('bulkBar').hidden = true;
    const term = searchTerm.toLowerCase();
    const hits = (allTrainees || []).filter(t =>
      `${t.energytechId} ${t.name || ''}`.toLowerCase().includes(term));
    box.innerHTML = !allTrainees
      ? '<p class="pane-empty">Searching&hellip;</p>'
      : hits.length
        ? `<div class="table-wrap"><table class="dashboard-table">
            <thead><tr><th>EnergyTech ID</th><th>Name</th><th>Where</th><th>Account</th><th></th></tr></thead>
            <tbody>${hits.slice(0, 100).map(t => traineeRow(t, { showWhere: true })).join('')}</tbody></table></div>
           ${hits.length > 100 ? `<p class="hint">Showing the first 100 of ${hits.length}.</p>` : `<p class="hint">${hits.length} match${hits.length === 1 ? '' : 'es'}.</p>`}`
        : `<p class="pane-empty">Nobody matches “${escapeHtml(searchTerm)}”.</p>`;
    return;
  }

  if (!rosterSel.group) {
    if (title) title.textContent = 'Trainees';
    if (actions) actions.hidden = true;
    if (filters) filters.hidden = true;
    if ($('bulkBar')) $('bulkBar').hidden = true;
    box.innerHTML = `<p class="pane-empty">${rosterSel.intake
      ? 'Pick a group to see its trainees.'
      : 'Pick an intake, then a group.'}</p>`;
    return;
  }

  if (title) title.textContent = `${rosterSel.intake} / ${rosterSel.group}`;
  if (actions) actions.hidden = false;
  if (filters) filters.hidden = false;

  const list = visibleTrainees();
  const counts = {
    all: traineeCache.length,
    none: traineeCache.filter(t => (t.accountStatus || 'none') === 'none').length,
    active: traineeCache.filter(t => t.accountStatus === 'active').length,
    revoked: traineeCache.filter(t => t.accountStatus === 'revoked').length
  };
  document.querySelectorAll('#traineeFilters .filter-chip').forEach(chip => {
    const key = chip.dataset.filter;
    chip.classList.toggle('is-on', key === traineeFilter);
    const base = chip.textContent.replace(/\s*\(\d+\)$/, '');
    chip.textContent = `${base} (${counts[key] || 0})`;
  });

  if (!traineeCache.length) {
    box.innerHTML = '<p class="pane-empty">No trainees in this group yet.<br>Use <strong>+ Add</strong> for one, or <strong>Import CSV</strong> for a whole list.</p>';
    renderBulkBar();
    return;
  }
  if (!list.length) {
    box.innerHTML = `<p class="pane-empty">No trainees here match that filter.</p>`;
    renderBulkBar();
    return;
  }

  const allPicked = list.every(t => selectedIds.has(t.energytechId));
  box.innerHTML = `<div class="table-wrap"><table class="dashboard-table roster-table">
      <thead><tr>
        <th class="pick"><input type="checkbox" id="pickAll"${allPicked ? ' checked' : ''} aria-label="Select all shown" /></th>
        <th>EnergyTech ID</th><th>Name</th><th>Account</th><th></th>
      </tr></thead>
      <tbody>${list.map(t => traineeRow(t)).join('')}</tbody></table></div>`;
  renderBulkBar();
}

function renderBulkBar() {
  const bar = $('bulkBar');
  if (!bar) return;
  const n = selectedIds.size;
  bar.hidden = n === 0;
  if (!n) return;
  $('bulkCount').textContent = `${n} selected`;
  const sel = $('bulkMoveTarget');
  const groups = groupsOf(rosterSel.intake).filter(g => g.name !== rosterSel.group);
  sel.innerHTML = groups.length
    ? groups.map(g => `<option value="${escapeHtml(g.name)}">Move to ${escapeHtml(g.name)}</option>`).join('')
    : '<option value="">no other group</option>';
  sel.disabled = !groups.length;
  $('bulkMoveBtn').disabled = !groups.length;
}

/* ---------------- drilling in ---------------- */

async function selectIntake(label) {
  rosterSel = { intake: label, group: '' };
  traineeCache = [];
  selectedIds.clear();
  editingId = '';
  renderWorkspace();
}

async function selectGroup(name) {
  rosterSel.group = name;
  selectedIds.clear();
  editingId = '';
  traineeFilter = 'all';
  renderWorkspace();
  await refreshTrainees();
}

async function refreshTrainees() {
  const { intake, group } = rosterSel;
  if (!intake || !group) return;
  try {
    const data = await rosterCall('trainee_list', { token: authToken, intake, group }, 'energytechTraineeList', 1);
    if (!data.ok) { rosterStatus(escapeHtml(data.error || 'Could not load trainees.'), 'bad'); return; }
    traineeCache = data.trainees || [];
    rosterStatus('');
    renderTraineePane();
  } catch (err) {
    rosterStatus(escapeHtml(err.message || String(err)), 'bad');
  }
}

/* ---------------- actions ---------------- */

/* The backend confirms what it did, so the change is applied to the local copy
 * and drawn straight away. Waiting for a second round trip to re-read the whole
 * roster made every add feel like it had not worked -- and if that read timed
 * out, the list genuinely never updated. The re-read still happens, quietly,
 * afterwards, to pick up anything another instructor changed. */
function reconcileSoon() {
  allTrainees = null;                         // the search index is now stale
  clearTimeout(reconcileSoon._t);
  reconcileSoon._t = setTimeout(() => { loadRoster(true).catch(() => {}); }, 400);
}

async function rosterAction(action, params, okMessage, apply) {
  try {
    const data = await rosterCall(action, Object.assign({ token: authToken }, params));
    if (!data.ok) { rosterTopStatus(escapeHtml(data.error || 'That did not work.'), 'bad'); return false; }
    if (apply) { apply(data); renderWorkspace(); }
    reconcileSoon();
    if (okMessage) rosterFlash(escapeHtml(okMessage), 'good');
    return true;
  } catch (err) {
    rosterTopStatus(escapeHtml(err.message || String(err)), 'bad');
    return false;
  }
}

async function traineeAction(action, params, okMessage, apply) {
  try {
    const data = await rosterCall(action, Object.assign({ token: authToken }, params), 'energytechTraineeAdmin');
    if (!data.ok) { rosterStatus(escapeHtml(data.error || 'That did not work.'), 'bad'); return false; }
    if (apply) { apply(data); renderGroupPane(); renderTraineePane(); }
    reconcileSoon();
    if (okMessage) rosterFlash(escapeHtml(okMessage), 'good');
    return true;
  } catch (err) {
    rosterStatus(escapeHtml(err.message || String(err)), 'bad');
    return false;
  }
}

/* Keeps a group's counters honest between the local change and the re-read. */
function bumpGroup(intake, name, dTrainees, dLogins) {
  const g = (rosterCache ? rosterCache.groups : []).find(x => x.intake === intake && x.name === name);
  if (!g) return;
  g.trainees = Math.max(0, g.trainees + (dTrainees || 0));
  g.withAccount = Math.max(0, g.withAccount + (dLogins || 0));
}

/* ---------------- search across every intake ---------------- */

async function ensureAllTrainees() {
  if (allTrainees) return;
  try {
    const data = await rosterCall('trainee_list', { token: authToken }, 'energytechTraineeAll');
    allTrainees = data.ok ? (data.trainees || []) : [];
  } catch { allTrainees = []; }
  renderTraineePane();
}

function onSearch(value) {
  searchTerm = String(value || '').trim();
  if (searchTerm) { ensureAllTrainees(); }
  renderTraineePane();
}

/* ---------------- CSV ---------------- */

/* A small RFC-4180 reader: fields may be quoted, and a quoted field may hold
 * commas, newlines and doubled quotes -- all of which turn up in long
 * multi-part given names. */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   // strip a BOM from Excel
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',' || c === ';' || c === '\t') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

const HEADER_WORDS = /^(energytech\s*id|id|spsp\s*id|full\s*name|name|trainee|trainee\s*name|family|family\s*name|surname|last\s*name|given|given\s*name|first\s*name|group|class|section)$/i;
const GROUP_RE = /^G([1-9]|1[0-9]|20)$/;

/* Columns are ID, family, given, and optionally group. The group may also be
 * the last column when the given name is split across several -- so it is
 * taken from the final cell whenever that cell looks like a group name. */
function readTraineeCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { rows: [], bad: [], hadHeader: false };
  const first = rows[0].map(c => String(c).trim());
  const hadHeader = first.length >= 2 && first.filter(c => HEADER_WORDS.test(c)).length >= 2;
  const out = [], bad = [];
  for (let i = hadHeader ? 1 : 0; i < rows.length; i++) {
    const cells = rows[i].map(c => String(c).trim());
    let group = '';
    // With one name column a normal row is ID, Name, Group -- three cells. A
    // name broken across cells by a stray comma makes it longer, never shorter,
    // so anything from three cells up may end in a group name.
    if (cells.length >= 3 && GROUP_RE.test(cells[cells.length - 1].toUpperCase())) {
      group = cells.pop().toUpperCase();
    }
    const id = cells[0] || '';
    // Everything after the ID is the name, so a name split across several cells
    // by a stray comma still comes through whole.
    const name = cells.slice(1).join(' ').replace(/\s+/g, ' ').trim();
    if (!id) { bad.push({ line: i + 1, reason: 'no EnergyTech ID' }); continue; }
    if (!name) { bad.push({ line: i + 1, reason: 'no name' }); continue; }
    out.push({ energytechId: id.toUpperCase(), name, group });
  }
  return { rows: out, bad, hadHeader };
}

async function previewCsv(file) {
  const { intake, group } = rosterSel;
  if (!intake) { rosterStatus('Pick an intake first.', 'warn'); return; }
  let text;
  try { text = await file.text(); }
  catch { rosterStatus('Could not read that file.', 'bad'); return; }

  const { rows, bad, hadHeader } = readTraineeCsv(text);
  if (!rows.length && !bad.length) { rosterStatus('That file has no rows.', 'warn'); return; }

  // Compare against every trainee on record, not just this group, so an ID
  // already sitting elsewhere is reported rather than silently skipped.
  await ensureAllTrainees();
  const existing = new Set((allTrainees || []).map(t => String(t.energytechId).toUpperCase()));

  const seen = new Set();
  const fresh = [], dupInFile = [], already = [];
  rows.forEach(r => {
    const row = Object.assign({}, r, { group: r.group || group });
    if (seen.has(row.energytechId)) { dupInFile.push(row); return; }
    seen.add(row.energytechId);
    if (existing.has(row.energytechId)) already.push(row); else fresh.push(row);
  });

  const noGroup = fresh.filter(r => !r.group);
  const byGroup = {};
  fresh.forEach(r => { if (r.group) byGroup[r.group] = (byGroup[r.group] || 0) + 1; });
  const knownGroups = new Set(groupsOf(intake).map(g => g.name));
  const willCreate = Object.keys(byGroup).filter(g => !knownGroups.has(g)).sort();

  pendingImport = fresh.filter(r => r.group);
  const el = $('csvPreview');
  if (!el) return;
  el.hidden = false;
  el.innerHTML = `
    <h4>Import into ${escapeHtml(intake)}</h4>
    <ul class="csv-summary">
      <li><strong>${pendingImport.length}</strong> new trainee${pendingImport.length === 1 ? '' : 's'} will be added</li>
      ${Object.keys(byGroup).length
        ? `<li>By group: ${Object.keys(byGroup).sort().map(g => `${escapeHtml(g)}&nbsp;(${byGroup[g]})`).join(', ')}</li>` : ''}
      ${willCreate.length ? `<li class="good-text">${willCreate.length} group${willCreate.length === 1 ? '' : 's'} will be created: ${escapeHtml(willCreate.join(', '))}</li>` : ''}
      ${noGroup.length ? `<li class="bad-line">${noGroup.length} row${noGroup.length === 1 ? '' : 's'} name no group and will be skipped${group ? '' : ' — open a group first, or add a Group column'}</li>` : ''}
      ${already.length ? `<li>${already.length} already on record, skipped: ${escapeHtml(already.slice(0, 6).map(r => r.energytechId).join(', '))}${already.length > 6 ? '…' : ''}</li>` : ''}
      ${dupInFile.length ? `<li>${dupInFile.length} repeated inside the file, skipped</li>` : ''}
      ${bad.length ? `<li class="bad-line">${bad.length} row${bad.length === 1 ? '' : 's'} could not be read: ${escapeHtml(bad.slice(0, 4).map(b => `line ${b.line} (${b.reason})`).join('; '))}</li>` : ''}
      ${hadHeader ? '<li>A header row was detected and ignored.</li>' : ''}
    </ul>
    ${pendingImport.length ? `<div class="table-wrap"><table class="dashboard-table">
      <thead><tr><th>EnergyTech ID</th><th>Name</th><th>Group</th></tr></thead>
      <tbody>${pendingImport.slice(0, 8).map(r => `<tr><td class="mono">${escapeHtml(r.energytechId)}</td><td class="trainee-name">${escapeHtml(r.name)}</td><td>${escapeHtml(r.group)}</td></tr>`).join('')}</tbody></table></div>
      ${pendingImport.length > 8 ? `<p class="hint">…and ${pendingImport.length - 8} more.</p>` : ''}` : ''}
    <div class="button-row">
      <button type="button" id="confirmImportBtn"${pendingImport.length ? '' : ' disabled'}>Import ${pendingImport.length} trainee${pendingImport.length === 1 ? '' : 's'}</button>
      <button type="button" id="cancelImportBtn" class="secondary">Cancel</button>
    </div>`;
}

async function confirmImport() {
  const { intake } = rosterSel;
  if (!pendingImport || !pendingImport.length) return;
  const url = activeWebAppUrl();
  const before = pendingImport.length;
  const wanted = pendingImport.slice();
  rosterStatus(`Importing ${before} trainee(s)&hellip;`);
  try {
    // Sent by POST: a whole intake of long names does not fit in a URL. The
    // response is opaque, so the roster is re-read afterwards to report what
    // actually landed.
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify({ type: 'trainee_import', token: authToken, intake, rows: wanted })
    });
    let added = 0;
    for (let attempt = 1; attempt <= 4; attempt++) {
      await new Promise(r => setTimeout(r, 700 * attempt));
      const check = await rosterCall('trainee_list', { token: authToken, intake }, 'energytechImportCheck');
      if (check.ok) {
        const ids = new Set((check.trainees || []).map(t => String(t.energytechId).toUpperCase()));
        added = wanted.filter(r => ids.has(r.energytechId)).length;
        if (added >= before) break;
      }
    }
    pendingImport = null;
    allTrainees = null;
    if ($('csvPreview')) { $('csvPreview').hidden = true; $('csvPreview').innerHTML = ''; }
    await loadRoster(true);
    await refreshTrainees();
    rosterStatus('');
    rosterFlash(added >= before
      ? `Imported ${added} trainee(s) into ${escapeHtml(intake)}.`
      : `Imported ${added} of ${before}. Press Refresh to check the rest.`,
      added >= before ? 'good' : 'warn');
  } catch (err) {
    rosterStatus(escapeHtml(err.message || String(err)), 'bad');
  }
}

function downloadGroupCsv() {
  if (!traineeCache.length) { rosterStatus('Nothing to download — open a group first.', 'warn'); return; }
  const head = ['EnergyTech ID', 'Name', 'Group', 'Account'];
  const rows = traineeCache.map(t => [t.energytechId, t.name || '', t.group, t.accountStatus || 'none']);
  downloadCsv(csvRows([head].concat(rows)),
    `trainees_${rosterSel.intake}_${rosterSel.group}_${stamp()}.csv`.replace(/\s+/g, ''));
}

/* ---------------- session intake and group pickers ---------------- */

function populateSessionIntakes() {
  const sel = $('sessionIntake');
  if (!sel || !rosterCache) return;
  const previous = sel.value;
  sel.innerHTML = '<option value="">— none —</option>'
    + rosterCache.intakes.map(i => `<option value="${escapeHtml(i.label)}">${escapeHtml(i.label)}</option>`).join('');
  sel.value = rosterCache.intakes.some(i => i.label === previous) ? previous : '';
  populateSessionGroups();
}

function populateSessionGroups() {
  const sel = $('sessionGroup');
  const intake = $('sessionIntake') ? $('sessionIntake').value : '';
  if (!sel) return;
  const previous = sel.value;
  const groups = groupsOf(intake);
  sel.innerHTML = '<option value="">— none —</option>'
    + groups.map(g => `<option value="${escapeHtml(g.name)}">${escapeHtml(g.name)} (${g.trainees})</option>`).join('');
  sel.value = groups.some(g => g.name === previous) ? previous : '';
}
/* ---------------- walk-ins ---------------- */

async function startWalkIn() {
  const st = $('walkInStatus');
  const code = $('walkInCode') ? $('walkInCode').value.trim().toUpperCase() : '';
  const name = $('walkInName') ? $('walkInName').value.trim() : '';
  const group = $('walkInGroup') ? $('walkInGroup').value.trim() : '';
  const id = $('walkInId') ? $('walkInId').value.trim() : '';
  const warn = (m) => { if (st) { st.className = 'feedback warn'; st.innerHTML = m; } };
  if (!code) { warn('Enter the session code from your instructor.'); return; }
  if (!name || !group || !id) { warn('Enter your name, group and EnergyTech ID.'); return; }

  if (st) { st.className = 'feedback empty'; st.innerHTML = 'Checking the session…'; }
  let session = null;
  try {
    session = await fetchSessionByCode(code);
  } catch (err) {
    if (st) { st.className = 'feedback bad'; st.innerHTML = escapeHtml(err.message || String(err)); }
    return;
  }
  if (!session) {
    if (st) { st.className = 'feedback bad'; st.innerHTML = 'Session not found. Check the code with your instructor.'; }
    return;
  }
  // The instructor decides per session whether guests may sit it.
  if (!session.allowWalkIn) {
    if (st) {
      st.className = 'feedback bad';
      st.innerHTML = 'This session is for trainees with an account. Create your account above, or ask your instructor to allow guests.';
    }
    return;
  }

  walkInIdentity = { name, group, energytechId: id };
  currentSession = session;
  activeRole = 'student';
  if (st) {
    st.className = 'feedback good';
    st.innerHTML = `Session loaded: <strong>${escapeHtml(session.sessionName || code)}</strong> — <span class="mode-pill ${escapeHtml(session.mode || 'practice')}">${escapeHtml((session.mode || 'practice').toUpperCase())}</span><br>Your result will be recorded as <strong>unregistered</strong>.`;
  }
  buildQuizFromSettings(session, 'student');
  if ($('studentQuizArea')) $('studentQuizArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* Who is sitting the quiz: the signed-in trainee, else the walk-in details,
 * else nobody. The token is what the backend actually trusts -- when it is
 * sent, the roster row overrides every field below. */
function studentIdentity() {
  if (traineeLoggedIn()) {
    return {
      name: traineeFullName(traineeProfile),
      group: traineeProfile.group || '',
      energytechId: traineeProfile.energytechId || '',
      intake: traineeProfile.intake || '',
      token: traineeToken
    };
  }
  if (walkInIdentity) {
    return {
      name: walkInIdentity.name,
      group: walkInIdentity.group,
      energytechId: walkInIdentity.energytechId,
      intake: '',
      token: ''
    };
  }
  return { name: '', group: '', energytechId: '', intake: '', token: '' };
}

/* ==========================================================================
 * Trainee profile: one person's record, and one attempt in full
 *
 * Two people look at this: an instructor opening a trainee from the roster, and
 * the trainee looking at their own record on their home screen. They see the
 * same thing, so there is one renderer and one view object per audience saying
 * where to draw, which backend action to call, and whose token to send. Writing
 * it twice would let the two drift, and the trainee's copy is the one nobody
 * would notice going stale.
 * ========================================================================== */

const INSTRUCTOR_VIEW = {
  self: false,
  target: 'profileBody',
  scrollTo: 'traineeProfileView',
  historyAction: 'trainee_history',
  attemptAction: 'attempt_detail',
  data: null,
  auth: () => ({ token: authToken })
};

const MY_VIEW = {
  self: true,
  target: 'myHistoryBody',
  scrollTo: 'myHistoryPanel',
  historyAction: 'my_history',
  attemptAction: 'my_attempt',
  data: null,
  auth: () => ({ token: traineeToken })
};

let profileId = '';          // trainee whose profile is open, '' when closed
let profileData = null;      // kept as an alias of INSTRUCTOR_VIEW.data

function showRoster() {
  profileId = '';
  profileData = null;
  if ($('traineeProfileView')) $('traineeProfileView').hidden = true;
  if ($('rosterWorkspace')) $('rosterWorkspace').hidden = false;
  if ($('rosterSearch')) $('rosterSearch').closest('.roster-toolbar').hidden = false;
}

function paint(view, html) {
  const el = $(view.target);
  if (el) el.innerHTML = html;
}

async function loadHistoryInto(view, params) {
  paint(view, '<p class="pane-empty">Loading&hellip;</p>');
  try {
    const data = await rosterCall(view.historyAction,
      Object.assign(view.auth(), params), 'energytechHistory', 1);
    if (!data.ok) {
      paint(view, `<div class="feedback bad">${escapeHtml(data.error || 'Could not load this record.')}</div>`);
      return false;
    }
    view.data = data;
    if (view === INSTRUCTOR_VIEW) profileData = data;
    renderProfile(view);
    return true;
  } catch (err) {
    paint(view, `<div class="feedback bad">${escapeHtml(err.message || String(err))}</div>`);
    return false;
  }
}

async function openProfile(energytechId) {
  profileId = energytechId;
  profileData = null;
  INSTRUCTOR_VIEW.data = null;
  if ($('rosterWorkspace')) $('rosterWorkspace').hidden = true;
  if ($('rosterSearch')) $('rosterSearch').closest('.roster-toolbar').hidden = true;
  if ($('traineeProfileView')) $('traineeProfileView').hidden = false;
  if ($('profileCrumb')) $('profileCrumb').textContent = energytechId;
  if ($('traineeProfileView')) $('traineeProfileView').scrollIntoView({ behavior: 'smooth', block: 'start' });
  await loadHistoryInto(INSTRUCTOR_VIEW, { energytechId });
}

/* The trainee's own record, on their home screen. Nothing identifies them in
 * the request: the backend reads the id off the token. */
async function loadMyHistory() {
  if (!traineeLoggedIn() || !$('myHistoryBody')) return;
  if ($('myHistoryPanel')) $('myHistoryPanel').hidden = false;
  await loadHistoryInto(MY_VIEW, {});
}

function whenText(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* Date and time separately, so a narrow screen can drop the time and still show
 * the score, which is the column a trainee actually came for. */
function whenParts(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return { date: String(iso || ''), time: '' };
  return {
    date: d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
    time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  };
}

function scoreBand(percent) {
  return percent >= 80 ? 'good' : percent >= 50 ? 'warn' : 'bad';
}

function renderProfile(view) {
  view = view || INSTRUCTOR_VIEW;
  const { trainee, attempts, lessons } = view.data;
  const self = view.self;
  if (!self && $('profileCrumb')) $('profileCrumb').textContent = `${trainee.name || trainee.energytechId}`;

  const done = attempts.length;
  const avg = done ? Math.round(attempts.reduce((a, x) => a + x.percent, 0) / done) : 0;
  const best = done ? Math.max(...attempts.map(x => x.percent)) : 0;
  const answered = lessons.reduce((a, l) => a + l.total, 0);

  // Only lessons with enough questions to mean anything, weakest first.
  const weak = lessons.filter(l => l.total >= 2 && l.percent < 100).slice(0, 5);

  // How many quizzes fall on each date, so the time can be shown on the days
  // that had more than one and left off every other row.
  const sameDay = {};
  attempts.forEach(a => {
    const d = whenParts(a.timestamp).date;
    sameDay[d] = (sameDay[d] || 0) + 1;
  });

  const head = self ? '' : `
    <header class="profile-head">
      <div>
        <h3>${escapeHtml(trainee.name || '(no name)')}</h3>
        <p class="profile-sub"><span class="mono">${escapeHtml(trainee.energytechId)}</span>
          · ${escapeHtml(trainee.intake || '—')} / ${escapeHtml(trainee.group || '—')}
          · ${accountBadge(trainee.accountStatus || 'none')}</p>
      </div>
    </header>`;

  paint(view, `
    ${head}
    <div class="stat-row">
      <div class="stat"><span class="stat-value">${done}</span><span class="stat-label">quiz${done === 1 ? '' : 'zes'} taken</span></div>
      <div class="stat"><span class="stat-value ${done ? scoreBand(avg) + '-text' : ''}">${done ? avg + '%' : '—'}</span><span class="stat-label">average</span></div>
      <div class="stat"><span class="stat-value">${done ? best + '%' : '—'}</span><span class="stat-label">best</span></div>
      <div class="stat"><span class="stat-value">${answered}</span><span class="stat-label">questions answered</span></div>
    </div>

    <h4 class="profile-h">${self ? 'Lessons to go back over' : 'Weakest lessons'}</h4>
    ${weak.length ? `<ul class="lesson-bars">${weak.map(l => `
      <li>
        <span class="lesson-name">Lesson ${escapeHtml(l.lesson)}</span>
        <span class="bar"><span class="bar-fill ${scoreBand(l.percent)}" style="width:${Math.max(l.percent, 2)}%"></span></span>
        <span class="lesson-score ${scoreBand(l.percent)}-text">${l.percent}%</span>
        <span class="lesson-count">${l.correct} of ${l.total}</span>
      </li>`).join('')}</ul>`
      : `<p class="pane-empty">${answered
          ? (self
              ? 'Nothing stands out — every lesson with more than one question is at 100%.'
              : 'Nothing stands out yet — every lesson with more than one question is at 100%.')
          : (self
              ? 'You have not answered any questions yet, so there is nothing to analyse.'
              : 'No questions answered yet, so there is nothing to analyse.')}</p>`}

    <h4 class="profile-h">${self ? 'My quizzes' : 'History'}</h4>
    ${done ? `<p class="hint">${self ? 'Tap a quiz to see every question and what you answered.' : 'Open a row to see the paper as it was answered.'}</p>
      <div class="table-wrap"><table class="dashboard-table history-table${self ? ' simple' : ''}">
        ${self
          ? '<thead><tr><th>When</th><th>Quiz</th><th>Score</th></tr></thead>'
          : '<thead><tr><th>When</th><th>Session</th><th>Covering</th><th>Mode</th><th>Score</th><th></th></tr></thead>'}
        <tbody>${attempts.map(a => {
          const when = whenParts(a.timestamp);
          const guest = a.registered && a.registered !== 'yes'
            ? '<span class="guest-tag" title="Sat as a guest, without logging in">guest</span>' : '';
          const mode = `<span class="mode-pill ${escapeHtml(a.mode || 'practice')}">${escapeHtml((a.mode || 'practice').toUpperCase())}</span>`;
          const score = `<td class="score-cell"><strong class="${scoreBand(a.percent)}-text">${a.score} / ${a.total}</strong> <span class="hint">${a.percent}%</span></td>`;
          const open = `<tr class="attempt-row" data-attempt="${escapeHtml(a.attemptId)}" tabindex="0" role="button">`;

          // The trainee's own list leads with the session name -- the label
          // their instructor gave the sitting, which is what they will have
          // heard it called -- and carries what it covered underneath. The
          // session code stays out: it is a join code, thrown away once the
          // session is over. The time is shown only when two quizzes fall on
          // the same day and the date alone cannot tell them apart.
          if (self) {
            const title = a.sessionName || a.questionSet || '—';
            const covered = a.questionSet && a.sessionName && a.questionSet !== a.sessionName
              ? `<br><span class="hint">${escapeHtml(a.questionSet)}</span>` : '';
            return `${open}
              <td><span class="when-date">${escapeHtml(when.date)}</span>
                ${sameDay[when.date] > 1 ? `<span class="when-time hint">${escapeHtml(when.time)}</span>` : ''}</td>
              <td><span class="quiz-name">${escapeHtml(title)}</span> ${mode} ${guest}${covered}</td>
              ${score}
            </tr>`;
          }
          return `${open}
            <td><span class="when-date">${escapeHtml(when.date)}</span>
              <span class="when-time hint">${escapeHtml(when.time)}</span></td>
            <td>${escapeHtml(a.sessionName || a.sessionCode || '—')} ${guest}
              <br><span class="mono hint">${escapeHtml(a.sessionCode)}</span></td>
            <td>${escapeHtml(a.questionSet || '—')}</td>
            <td>${mode}</td>
            ${score}
            <td class="row-actions"><button type="button" class="icon-btn open-attempt" data-attempt="${escapeHtml(a.attemptId)}">See answers</button></td>
          </tr>`;
        }).join('')}</tbody></table></div>`
      : `<p class="pane-empty">${self ? 'You have not sat a quiz yet. Once you do, it will appear here.' : 'This trainee has not sat a quiz yet.'}</p>`}`);
}

/* ---------------- one attempt, question by question ---------------- */

async function openAttempt(view, attemptId) {
  const back = `<div class="button-row"><button type="button" class="secondary back-to-profile">${
    view.self ? '&#8592; Back to my results' : 'Back to the profile'}</button></div>`;
  paint(view, '<p class="pane-empty">Loading the answers&hellip;</p>');
  try {
    const data = await rosterCall(view.attemptAction,
      Object.assign(view.auth(), { attemptId }), 'energytechAttempt', 1);
    if (!data.ok) {
      paint(view, `<div class="feedback bad">${escapeHtml(data.error || 'Could not load that attempt.')}</div>${back}`);
      return;
    }
    renderAttempt(view, data);
  } catch (err) {
    paint(view, `<div class="feedback bad">${escapeHtml(err.message || String(err))}</div>${back}`);
  }
}

/* The questions themselves are not stored with the attempt -- only the answers
 * are. They are rebuilt from the seed, set key, count and order that were saved
 * with it, which is exactly how the trainee's paper was generated in the first
 * place, so question N here is question N as they saw it. */
function rebuildAttemptQuestions(attempt) {
  try {
    const { selected } = selectQuestionsFor({
      questionSetKey: attempt.questionSetKey,
      questionCount: attempt.questionCount,
      seed: attempt.seed,
      orderMode: attempt.orderMode
    });
    return selected;
  } catch { return []; }
}

function renderAttempt(view, data) {
  const { attempt, items } = data;
  const questions = rebuildAttemptQuestions(attempt);
  // If the bank has changed since, the rebuild will not line up; say so rather
  // than showing the wrong question next to an answer.
  const trustworthy = questions.length === items.length && items.length > 0;

  const cards = items.map(it => {
    const q = trustworthy ? questions[it.quizNumber - 1] : null;
    const verdict = it.result === 'correct' ? 'correct' : it.result === 'wrong' ? 'wrong' : 'skipped';
    const label = { correct: 'Correct', wrong: 'Wrong', skipped: 'Not answered' }[verdict];
    let body = '';
    if (q) {
      const choices = splitChoices(q.choices);
      body = `<div class="q-body">${renderText(q.body).replace('[[DIAGRAM]]', diagramSvg(q))}</div>
        <div class="q-choices review">${choices.map(ch => {
          const picked = ch.letter === it.answer;
          const right = ch.letter === it.correctAnswer;
          const cls = right ? 'is-right' : picked ? 'is-picked-wrong' : '';
          const mark = right ? '&#10003;' : picked ? '&#10007;' : '';
          return `<div class="choice ${cls}"><span class="choice-mark">${mark}</span>
            <span>${ch.letter}) ${renderText(ch.text)}</span></div>`;
        }).join('')}</div>`;
    } else {
      body = `<p class="hint">Answered <strong>${escapeHtml(it.answer || '—')}</strong>, correct answer <strong>${escapeHtml(it.correctAnswer)}</strong>.</p>`;
    }
    return `<article class="question-card review-card ${verdict}">
      <div class="q-head">Q${it.quizNumber}
        <span class="lesson">${escapeHtml(it.lesson)}</span>
        ${it.originalNumber ? `<span class="original">Original Q${it.originalNumber}</span>` : ''}
        <span class="verdict ${verdict}">${label}</span></div>
      ${body}
    </article>`;
  }).join('');

  paint(view, `
    <div class="button-row">
      <button type="button" class="secondary back-to-profile">&#8592; Back to ${
        view.self ? 'my results' : escapeHtml(attempt.name || 'the profile')}</button>
    </div>
    <header class="profile-head">
      <div>
        <h3>${escapeHtml(attempt.sessionName || attempt.sessionCode)}</h3>
        <p class="profile-sub">${escapeHtml(whenText(attempt.timestamp))}
          · ${escapeHtml(attempt.questionSet || '')}
          · <span class="mode-pill ${escapeHtml(attempt.mode || 'practice')}">${escapeHtml((attempt.mode || 'practice').toUpperCase())}</span></p>
      </div>
      <div class="attempt-score ${scoreBand(attempt.percent)}-text">${attempt.score} / ${attempt.total}
        <span>${attempt.percent}%</span></div>
    </header>
    ${trustworthy ? '' : `<div class="feedback warn">The questions could not be rebuilt for this attempt, so only the answers are shown. This happens when the question bank has changed since it was sat.</div>`}
    <div class="review-list">${cards}</div>`);
  const anchor = $(view.scrollTo);
  if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------------- event wiring ---------------- */

function wireRosterUi() {
  loadTraineeFromStorage();

  /* --- trainee login / signup / walk-in --- */
  if ($('traineeLoginBtn')) $('traineeLoginBtn').addEventListener('click', traineeLogIn);
  if ($('traineeLoginPassword')) $('traineeLoginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') traineeLogIn(); });
  if ($('traineeLoginId')) $('traineeLoginId').addEventListener('keydown', e => { if (e.key === 'Enter') traineeLogIn(); });
  if ($('toggleTraineeSignupBtn')) $('toggleTraineeSignupBtn').addEventListener('click', () => toggleTraineeSignup());
  if ($('traineeSignupBtn')) $('traineeSignupBtn').addEventListener('click', traineeSignUp);
  if ($('toggleWalkInBtn')) $('toggleWalkInBtn').addEventListener('click', () => toggleWalkIn());
  if ($('walkInStartBtn')) $('walkInStartBtn').addEventListener('click', startWalkIn);
  if ($('walkInCode')) $('walkInCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase(); });
  if ($('traineeLogoutBtn')) $('traineeLogoutBtn').addEventListener('click', traineeLogOut);
  if ($('backFromTraineeHomeBtn')) $('backFromTraineeHomeBtn').addEventListener('click', goHome);
  if ($('traineeChangePasswordToggle')) $('traineeChangePasswordToggle').addEventListener('click', () => {
    const el = $('traineePasswordPanel');
    if (el) el.hidden = !el.hidden;
  });
  if ($('traineeChangePasswordBtn')) $('traineeChangePasswordBtn').addEventListener('click', traineeChangePassword);

  /* --- roster: toolbar --- */
  // Refresh has to reload the open group too, or the counts update while the
  // list below them still shows what it showed a minute ago.
  if ($('loadRosterBtn')) $('loadRosterBtn').addEventListener('click', async () => {
    allTrainees = null;
    await loadRoster(false);
    await refreshTrainees();
  });
  if ($('rosterSearch')) {
    let debounce = null;
    $('rosterSearch').addEventListener('input', e => {
      const v = e.target.value;
      clearTimeout(debounce);
      debounce = setTimeout(() => onSearch(v), 180);
    });
  }

  /* --- roster: the three little add forms --- */
  const toggleForm = (formId, inputId, on) => {
    const f = $(formId);
    if (!f) return;
    f.hidden = !on;
    if (on && $(inputId)) $(inputId).focus();
  };
  if ($('showAddIntake')) $('showAddIntake').addEventListener('click', () => toggleForm('addIntakeForm', 'newIntakeLabel', $('addIntakeForm').hidden));
  if ($('cancelAddIntake')) $('cancelAddIntake').addEventListener('click', () => toggleForm('addIntakeForm', null, false));
  if ($('addIntakeForm')) $('addIntakeForm').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('newIntakeLabel');
    const label = input ? input.value.trim() : '';
    if (!label) { rosterTopStatus('Type a label for the new intake, for example JAN26.', 'warn'); return; }
    const added = label.toUpperCase();
    if (await rosterAction('intake_save', { label }, `Intake ${added} added.`, () => {
      if (!rosterCache) rosterCache = { intakes: [], groups: [] };
      if (!rosterCache.intakes.some(i => i.label === added)) rosterCache.intakes.push({ label: added, status: 'active' });
      rosterSel = { intake: added, group: '' };
      traineeCache = [];
    })) {
      if (input) input.value = '';
      toggleForm('addIntakeForm', null, false);
    }
  });

  if ($('showAddGroup')) $('showAddGroup').addEventListener('click', () => toggleForm('addGroupForm', 'newGroupName', $('addGroupForm').hidden));
  if ($('cancelAddGroup')) $('cancelAddGroup').addEventListener('click', () => toggleForm('addGroupForm', null, false));
  if ($('addGroupForm')) $('addGroupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('newGroupName');
    const name = input ? input.value.trim().toUpperCase() : '';
    if (!/^G([1-9]|1[0-9]|20)$/.test(name)) { rosterTopStatus('Group names run from G1 to G20.', 'warn'); return; }
    const intake = rosterSel.intake;
    if (await rosterAction('group_save', { intake, name }, `${name} added to ${intake}.`, () => {
      if (!rosterCache.groups.some(g => g.intake === intake && g.name === name)) {
        rosterCache.groups.push({ intake, name, trainees: 0, withAccount: 0 });
      }
      rosterSel.group = name;
      traineeCache = [];
      selectedIds.clear();
      traineeFilter = 'all';
    })) {
      if (input) input.value = '';
      toggleForm('addGroupForm', null, false);
    }
  });

  if ($('showAddTrainee')) $('showAddTrainee').addEventListener('click', () => toggleForm('addTraineeForm', 'newTraineeId', $('addTraineeForm').hidden));
  if ($('cancelAddTrainee')) $('cancelAddTrainee').addEventListener('click', () => toggleForm('addTraineeForm', null, false));
  if ($('addTraineeForm')) $('addTraineeForm').addEventListener('submit', async e => {
    e.preventDefault();
    const { intake, group } = rosterSel;
    if (!group) { rosterStatus('Open a group first.', 'warn'); return; }
    const id = $('newTraineeId').value.trim();
    const name = $('newTraineeName').value.trim();
    if (!id) { rosterStatus('An EnergyTech ID is required.', 'warn'); return; }
    if (!name) { rosterStatus('Enter the trainee\'s name.', 'warn'); return; }
    if (await traineeAction('trainee_save', { energytechId: id, name, intake, group },
        `${id.toUpperCase()} added to ${intake} / ${group}.`, () => {
          traineeCache.push({ energytechId: id.toUpperCase(), name, intake, group, accountStatus: 'none' });
          bumpGroup(intake, group, 1, 0);
        })) {
      ['newTraineeId', 'newTraineeName'].forEach(k => { if ($(k)) $(k).value = ''; });
      $('newTraineeId').focus();               // stay put, ready for the next one
    }
  });

  /* --- roster: CSV --- */
  if ($('importCsvBtn')) $('importCsvBtn').addEventListener('click', () => {
    if (!rosterSel.intake) { rosterStatus('Pick an intake first.', 'warn'); return; }
    if ($('csvFileInput')) $('csvFileInput').click();
  });
  if ($('csvFileInput')) $('csvFileInput').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';                       // so the same file can be picked twice
    if (file) previewCsv(file);
  });
  if ($('downloadRosterCsvBtn')) $('downloadRosterCsvBtn').addEventListener('click', downloadGroupCsv);

  /* --- roster: filters --- */
  if ($('traineeFilters')) $('traineeFilters').addEventListener('click', e => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    traineeFilter = chip.dataset.filter;
    renderTraineePane();
  });

  /* --- roster: bulk actions --- */
  if ($('bulkClearBtn')) $('bulkClearBtn').addEventListener('click', () => { selectedIds.clear(); renderTraineePane(); });
  if ($('bulkMoveBtn')) $('bulkMoveBtn').addEventListener('click', async () => {
    const target = $('bulkMoveTarget').value;
    if (!target || !selectedIds.size) return;
    const ids = [...selectedIds];
    // Chunked so a long selection cannot overflow the query string.
    let moved = 0;
    for (let i = 0; i < ids.length; i += 25) {
      const slice = ids.slice(i, i + 25);
      const data = await rosterCall('trainee_move',
        { token: authToken, intake: rosterSel.intake, group: target, ids: slice.join(',') }, 'energytechMove');
      if (!data.ok) { rosterStatus(escapeHtml(data.error || 'Move failed.'), 'bad'); break; }
      moved += data.moved || 0;
    }
    selectedIds.clear();
    allTrainees = null;
    await refreshTrainees();
    await loadRoster(true);
    rosterFlash(`Moved ${moved} trainee${moved === 1 ? '' : 's'} to ${escapeHtml(target)}.`, 'good');
  });
  if ($('bulkRevokeBtn')) $('bulkRevokeBtn').addEventListener('click', async () => {
    const ids = [...selectedIds].filter(id => {
      const t = traineeCache.find(x => x.energytechId === id);
      return t && t.accountStatus === 'active';
    });
    if (!ids.length) { rosterStatus('None of the selected trainees has a login to revoke.', 'warn'); return; }
    if (!confirm(`Revoke the login for ${ids.length} trainee${ids.length === 1 ? '' : 's'}? Their results stay on record.`)) return;
    for (const id of ids) {
      await rosterCall('trainee_set_account', { token: authToken, energytechId: id, status: 'revoked' }, 'energytechRevoke');
    }
    selectedIds.clear();
    allTrainees = null;
    await refreshTrainees();
    await loadRoster(true);
    rosterFlash(`Revoked ${ids.length} login${ids.length === 1 ? '' : 's'}.`, 'good');
  });

  /* --- roster: session pickers --- */
  if ($('sessionIntake')) $('sessionIntake').addEventListener('change', populateSessionGroups);

  /* --- roster: everything rendered into the panes --- */
  const ws = $('rosterWorkspace');
  if (ws) {
    ws.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const item = e.target.closest && e.target.closest('.pane-item');
      if (!item) return;
      e.preventDefault();
      item.click();
    });
    ws.addEventListener('click', async e => {
      const t = e.target;
      if (!t || !t.closest) return;

      /* intake actions come before the row itself, so a click on Rename does
       * not also re-select the intake underneath it. */
      const iRename = t.closest('.intake-rename');
      if (iRename) {
        const label = iRename.dataset.label;
        const next = prompt(`Rename intake "${label}" to:`, label);
        if (next && next.trim() && next.trim().toUpperCase() !== label.toUpperCase()) {
          const to = next.trim().toUpperCase();
          await rosterAction('intake_save', { label: next.trim(), previousLabel: label }, `Renamed to ${to}.`, () => {
            rosterCache.intakes.forEach(i => { if (i.label === label) i.label = to; });
            rosterCache.groups.forEach(g => { if (g.intake === label) g.intake = to; });
            traineeCache.forEach(t => { if (t.intake === label) t.intake = to; });
            rosterSel.intake = to;
          });
        }
        return;
      }
      const iDelete = t.closest('.intake-delete');
      if (iDelete) {
        const label = iDelete.dataset.label;
        if (confirm(`Delete intake "${label}"? This only works if it has no groups left.`)) {
          await rosterAction('intake_delete', { label }, `Intake ${label} deleted.`, () => {
            rosterCache.intakes = rosterCache.intakes.filter(i => i.label !== label);
            rosterSel = { intake: '', group: '' };
            traineeCache = [];
          });
        }
        return;
      }
      const gRename = t.closest('.group-rename');
      if (gRename) {
        const name = gRename.dataset.name;
        const next = (prompt(`Rename group "${name}" (G1–G20) to:`, name) || '').trim().toUpperCase();
        if (!next || next === name) return;
        if (!/^G([1-9]|1[0-9]|20)$/.test(next)) { rosterTopStatus('Group names run from G1 to G20.', 'warn'); return; }
        const inIntake = rosterSel.intake;
        await rosterAction('group_save', { intake: inIntake, name: next, previousName: name }, `Renamed to ${next}.`, () => {
          rosterCache.groups.forEach(g => { if (g.intake === inIntake && g.name === name) g.name = next; });
          traineeCache.forEach(t => { if (t.group === name) t.group = next; });
          rosterSel.group = next;
        });
        return;
      }
      const gDelete = t.closest('.group-delete');
      if (gDelete) {
        const name = gDelete.dataset.name;
        if (confirm(`Delete group "${name}" from ${rosterSel.intake}? This only works if it has no trainees left.`)) {
          const from = rosterSel.intake;
          await rosterAction('group_delete', { intake: from, name }, `${name} deleted.`, () => {
            rosterCache.groups = rosterCache.groups.filter(g => !(g.intake === from && g.name === name));
            rosterSel.group = '';
            traineeCache = [];
          });
        }
        return;
      }

      const nameLink = t.closest('.open-profile');
      if (nameLink) { openProfile(nameLink.dataset.id); return; }

      const tEdit = t.closest('.trainee-edit');
      if (tEdit) { editingId = tEdit.dataset.id; renderTraineePane(); return; }
      if (t.closest('.cancel-edit')) { editingId = ''; renderTraineePane(); return; }
      const tSave = t.closest('.save-trainee');
      if (tSave) {
        const row = tSave.closest('tr');
        const previousId = tSave.dataset.id;
        const next = {
          energytechId: row.querySelector('.edit-id').value.trim().toUpperCase(),
          name: row.querySelector('.edit-name').value.trim(),
          group: row.querySelector('.edit-group').value
        };
        const before = traineeCache.find(x => x.energytechId === previousId);
        const ok = await traineeAction('trainee_save', {
          energytechId: next.energytechId, previousId,
          name: next.name,
          intake: rosterSel.intake, group: next.group
        }, 'Saved.', () => {
          editingId = '';
          if (next.group !== rosterSel.group) {
            // They have left the group on screen, so drop them from this list.
            traineeCache = traineeCache.filter(x => x.energytechId !== previousId);
            bumpGroup(rosterSel.intake, rosterSel.group, -1, before && before.accountStatus === 'active' ? -1 : 0);
            bumpGroup(rosterSel.intake, next.group, 1, before && before.accountStatus === 'active' ? 1 : 0);
          } else if (before) {
            Object.assign(before, next, { intake: rosterSel.intake });
          }
        });
        if (ok) { editingId = ''; renderTraineePane(); }
        return;
      }
      const tDelete = t.closest('.trainee-delete');
      if (tDelete) {
        if (confirm(`Delete ${tDelete.dataset.id}? This only works if they have no submitted attempts.`)) {
          const gone = tDelete.dataset.id;
          const was = traineeCache.find(x => x.energytechId === gone);
          traineeAction('trainee_delete', { energytechId: gone }, 'Trainee deleted.', () => {
            traineeCache = traineeCache.filter(x => x.energytechId !== gone);
            selectedIds.delete(gone);
            bumpGroup(rosterSel.intake, rosterSel.group, -1, was && was.accountStatus === 'active' ? -1 : 0);
          });
        }
        return;
      }

      if (t.id === 'pickAll') {
        const shown = visibleTrainees();
        if (shown.every(x => selectedIds.has(x.energytechId))) shown.forEach(x => selectedIds.delete(x.energytechId));
        else shown.forEach(x => selectedIds.add(x.energytechId));
        renderTraineePane();
        return;
      }
      const pick = t.closest('.pick-trainee');
      if (pick) {
        if (pick.checked) selectedIds.add(pick.dataset.id); else selectedIds.delete(pick.dataset.id);
        renderBulkBar();
        return;
      }

      const intakeRow = t.closest('.pane-item[data-intake]');
      if (intakeRow) { selectIntake(intakeRow.dataset.intake); return; }
      const groupRow = t.closest('.pane-item[data-group]');
      if (groupRow) { selectGroup(groupRow.dataset.group); return; }
    });
  }

  /* --- trainee profile: the same three gestures for both audiences --- */
  // A whole row opens the attempt, so it works under a thumb as well as a
  // mouse; the button inside it stays for people who look for one.
  function wireHistoryPane(containerId, view) {
    const pane = $(containerId);
    if (!pane) return;
    const open = t => {
      const row = t.closest('.open-attempt') || t.closest('.attempt-row');
      if (row) { openAttempt(view, row.dataset.attempt); return true; }
      if (t.closest('.back-to-profile')) {
        if (view.data) renderProfile(view);
        return true;
      }
      return false;
    };
    pane.addEventListener('click', e => {
      if (e.target && e.target.closest) open(e.target);
    });
    pane.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target && e.target.closest && e.target.classList.contains('attempt-row')) {
        e.preventDefault();
        open(e.target);
      }
    });
  }

  if ($('profileBackBtn')) $('profileBackBtn').addEventListener('click', showRoster);
  wireHistoryPane('traineeProfileView', INSTRUCTOR_VIEW);
  wireHistoryPane('myHistoryPanel', MY_VIEW);
  if ($('myHistoryRefreshBtn')) $('myHistoryRefreshBtn').addEventListener('click', loadMyHistory);

  /* --- the import preview is rendered outside the workspace grid --- */
  document.addEventListener('click', e => {
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('#confirmImportBtn')) { confirmImport(); return; }
    if (e.target.closest('#cancelImportBtn')) {
      pendingImport = null;
      if ($('csvPreview')) { $('csvPreview').hidden = true; $('csvPreview').innerHTML = ''; }
    }
  });
}
