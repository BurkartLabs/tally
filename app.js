'use strict';
const $ = (s, r = document) => r.querySelector(s);
const COL_W = 110, ROW_H = 26, MAX_ROWS = 2000, MAX_COLS = 702;

/* ---------- state ---------- */
let doc = { version: 1, cells: {} };
let filePath = null;
let dirty = false;
let anchor = { r: 0, c: 0 }, ext = { r: 0, c: 0 };
let editing = null;
let reach = { r: 0, c: 0 };
let dragging = false;
let cfg = { projects: [] };
const expanded = new Set();
const children = {};

/* ---------- helpers ---------- */
const colName = (i) => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '') + String.fromCharCode(65 + (i % 26));
const keyOf = (r, c) => colName(c) + (r + 1);
function parseRef(s) {
  const m = /^([A-Za-z]{1,2})(\d+)$/.exec(s);
  if (!m) return null;
  const L = m[1].toUpperCase();
  const c = L.length === 2 ? (L.charCodeAt(0) - 64) * 26 + (L.charCodeAt(1) - 65) : L.charCodeAt(0) - 65;
  return { r: +m[2] - 1, c };
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const baseName = (p) => p.split(/[\\/]/).pop();
const range = () => ({
  r1: Math.min(anchor.r, ext.r), r2: Math.max(anchor.r, ext.r),
  c1: Math.min(anchor.c, ext.c), c2: Math.max(anchor.c, ext.c),
});

/* ---------- formulas ---------- */
class FErr extends Error {}
let cache = {};

function cellValue(key, stack) {
  if (key in cache) { const v = cache[key]; if (v instanceof FErr) throw v; return v; }
  if (stack.includes(key)) throw new FErr('#CYCLE!');
  const raw = (doc.cells[key] && doc.cells[key].v) || '';
  let out;
  try {
    if (raw.startsWith('=')) out = evalFormula(raw.slice(1), [...stack, key]);
    else if (raw.trim() !== '' && !isNaN(Number(raw))) out = Number(raw);
    else out = raw;
    if (Array.isArray(out)) throw new FErr('#VALUE!');
  } catch (e) {
    if (!(e instanceof FErr)) throw e;
    cache[key] = e;
    throw e;
  }
  cache[key] = out;
  return out;
}

function toNum(v) {
  if (v === '') return 0;
  if (typeof v === 'number') return v;
  const n = Number(v);
  if (String(v).trim() === '' || isNaN(n)) throw new FErr('#VALUE!');
  return n;
}

function evalFormula(src, stack) {
  const re = /\s*(?:([A-Za-z_]+)\s*\(|([A-Za-z]{1,2}\d+)(?:\s*:\s*([A-Za-z]{1,2}\d+))?|(-?\d*\.?\d+)|(,)|(\))|"([^"]*)")/y;
  const toks = [];
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) { if (src.slice(pos).trim() === '') break; throw new FErr('#ERROR!'); }
    toks.push(m);
    pos = re.lastIndex;
  }
  let i = 0;
  const flat = (a) => a.flatMap((x) => (Array.isArray(x) ? x : [x]));
  function expr() {
    const m = toks[i++];
    if (!m) throw new FErr('#ERROR!');
    if (m[1]) {
      const args = [];
      if (toks[i] && toks[i][6]) i++;
      else for (;;) {
        args.push(expr());
        const t = toks[i++];
        if (t && t[5]) continue;
        if (t && t[6]) break;
        throw new FErr('#ERROR!');
      }
      return call(m[1].toUpperCase(), args);
    }
    if (m[2] && m[3]) {
      const a = parseRef(m[2]), b = parseRef(m[3]);
      if (!a || !b) throw new FErr('#REF!');
      const out = [];
      for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++)
        for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) out.push(cellValue(keyOf(r, c), stack));
      return out;
    }
    if (m[2]) { if (!parseRef(m[2])) throw new FErr('#REF!'); return cellValue(m[2].toUpperCase(), stack); }
    if (m[4] !== undefined) return Number(m[4]);
    if (m[7] !== undefined) return m[7];
    throw new FErr('#ERROR!');
  }
  function call(name, args) {
    const nums = flat(args).map(toNum);
    switch (name) {
      case 'ADD': return nums.reduce((a, b) => a + b, 0);
      case 'MULTIPLY': return nums.reduce((a, b) => a * b, 1);
      case 'SUBTRACT':
        if (nums.length !== 2) throw new FErr('#ARGS!');
        return nums[0] - nums[1];
      case 'DIVIDE':
        if (nums.length !== 2) throw new FErr('#ARGS!');
        if (nums[1] === 0) throw new FErr('#DIV/0!');
        return nums[0] / nums[1];
      default: throw new FErr('#NAME?');
    }
  }
  const result = expr();
  if (i < toks.length) throw new FErr('#ERROR!');
  return typeof result === 'number' ? parseFloat(result.toPrecision(12)) : result;
}

/* ---------- formatting ---------- */
const CUR = { USD: 'USD', CAD: 'CAD', EUR: 'EUR', GBP: 'GBP' };
const SYMBOL = { USD: '$', CAD: '$', EUR: '€', GBP: '£' };
function parseDate(s) {
  s = String(s).trim();
  let m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s);
  if (m) {
    let h = +m[1];
    if (m[4]) { h = h % 12 + (m[4].toLowerCase() === 'pm' ? 12 : 0); }
    const d = new Date(); d.setHours(h, +m[2], +(m[3] || 0), 0); return d;
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) return new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function formatValue(v, fmt, dec = 2) {
  if (v === '' || !fmt || fmt === 'general') return String(v);
  if (CUR[fmt]) {
    const n = typeof v === 'number' ? v : (v !== '' && !isNaN(Number(v)) ? Number(v) : null);
    if (n === null) return String(v);
    const body = new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(Math.abs(n));
    return (n < 0 ? '-' : '') + SYMBOL[fmt] + body;
  }
  const d = parseDate(v);
  if (!d) return String(v);
  const o = { time: { hour: 'numeric', minute: '2-digit' }, date: { year: 'numeric', month: 'short', day: 'numeric' } };
  if (fmt === 'time') return d.toLocaleTimeString('en-US', o.time);
  if (fmt === 'date') return d.toLocaleDateString('en-US', o.date);
  return d.toLocaleDateString('en-US', o.date) + ', ' + d.toLocaleTimeString('en-US', o.time);
}
function display(key) {
  const cell = doc.cells[key];
  if (!cell || !cell.v) return { text: '', num: false, err: false };
  try {
    const v = cellValue(key, []);
    const dateLike = cell.fmt === 'time' || cell.fmt === 'date' || cell.fmt === 'datetime';
    return { text: formatValue(v, cell.fmt, cell.dec === undefined ? 2 : cell.dec), num: typeof v === 'number' && !dateLike, err: false };
  } catch (e) {
    if (e instanceof FErr) return { text: e.message, num: false, err: true };
    throw e;
  }
}

/* ---------- grid ---------- */
const grid = $('#grid'), wrap = $('#gridWrap');
let dims = { rows: 0, cols: 0 };

function computeDims() {
  let mr = 0, mc = 0;
  for (const k in doc.cells) { const p = parseRef(k); if (p) { mr = Math.max(mr, p.r); mc = Math.max(mc, p.c); } }
  const fillR = Math.ceil(wrap.clientHeight / ROW_H) + 1;
  const fillC = Math.ceil((wrap.clientWidth - 48) / COL_W) + 1;
  dims.rows = Math.min(MAX_ROWS, Math.max(fillR, mr + 8, reach.r + 4));
  dims.cols = Math.min(MAX_COLS, Math.max(fillC, mc + 3, reach.c + 3));
}

function render() {
  cache = {};
  computeDims();
  let h = '<colgroup><col style="width:48px">' + `<col style="width:${COL_W}px">`.repeat(dims.cols) + '</colgroup><thead><tr><th class="rh"></th>';
  for (let c = 0; c < dims.cols; c++) h += `<th data-c="${c}">${colName(c)}</th>`;
  h += '</tr></thead><tbody>';
  for (let r = 0; r < dims.rows; r++) {
    h += `<tr><th class="rh" data-r="${r}">${r + 1}</th>`;
    for (let c = 0; c < dims.cols; c++) {
      const k = keyOf(r, c), cell = doc.cells[k];
      if (!cell) { h += `<td data-r="${r}" data-c="${c}"></td>`; continue; }
      const d = display(k);
      const st = [];
      const al = cell.al || (d.num ? 'right' : 'left');
      st.push(`text-align:${al}`);
      if (cell.sz) st.push(`font-size:${cell.sz}px`);
      if (cell.bg) st.push(`background:${cell.bg}`);
      if (cell.fg) st.push(`color:${cell.fg}`);
      h += `<td data-r="${r}" data-c="${c}" style="${st.join(';')}"${d.err ? ' class="err"' : ''}>${esc(d.text)}</td>`;
    }
    h += '</tr>';
  }
  grid.innerHTML = h + '</tbody>';
  updateSelection();
}

const tdAt = (r, c) => { const row = grid.rows[r + 1]; return row && row.cells[c + 1]; };

function updateSelection() {
  grid.querySelectorAll('.sel,.cur,.hl').forEach((e) => e.classList.remove('sel', 'cur', 'hl'));
  const { r1, r2, c1, c2 } = range();
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const t = tdAt(r, c); if (t) t.classList.add('sel'); }
  const cur = tdAt(anchor.r, anchor.c);
  if (cur) { cur.classList.remove('sel'); cur.classList.add('cur'); }
  for (let c = c1; c <= c2; c++) { const t = grid.rows[0].cells[c + 1]; if (t) t.classList.add('hl'); }
  for (let r = r1; r <= r2; r++) { const t = grid.rows[r + 1]; if (t) t.cells[0].classList.add('hl'); }
  syncToolbar();
}

function syncToolbar() {
  const k = keyOf(anchor.r, anchor.c), cell = doc.cells[k] || {};
  $('#cellname').textContent = k;
  if (!editing) $('#formula').value = cell.v || '';
  $('#fmt').value = cell.fmt || 'general';
  $('#dec').value = String(cell.dec === undefined ? 2 : cell.dec);
  $('#dec').disabled = !CUR[cell.fmt];
  $('#size').value = String(cell.sz || 13);
  $('#bg').value = cell.bg || '#14161b';
  $('#fg').value = cell.fg || '#e6e8ee';
  document.querySelectorAll('[data-al]').forEach((b) => b.classList.toggle('on', b.dataset.al === cell.al));
}

function moveTo(r, c, extend) {
  r = Math.max(0, Math.min(MAX_ROWS - 1, r)); c = Math.max(0, Math.min(MAX_COLS - 1, c));
  ext = { r, c };
  if (!extend) anchor = { r, c };
  const grew = r + 3 > reach.r || c + 2 > reach.c;
  reach.r = Math.max(reach.r, r); reach.c = Math.max(reach.c, c);
  if (grew && (r + 4 > dims.rows || c + 3 > dims.cols)) render(); else updateSelection();
  const t = tdAt(r, c);
  if (t) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* ---------- editing ---------- */
function setRaw(r, c, v) {
  const k = keyOf(r, c);
  const cell = doc.cells[k] || (doc.cells[k] = {});
  if (v === '') delete cell.v; else cell.v = v;
  prune(k);
  setDirty(true);
}
function prune(k) {
  const c = doc.cells[k];
  if (c && !Object.keys(c).length) delete doc.cells[k];
}

function startEdit(initial) {
  if (editing) return;
  const { r, c } = anchor;
  const td = tdAt(r, c);
  if (!td) return;
  const cell = doc.cells[keyOf(r, c)] || {};
  editing = { r, c };
  td.classList.add('editing');
  td.innerHTML = '<input spellcheck="false">';
  const inp = td.firstChild;
  inp.value = initial !== undefined ? initial : (cell.v || '');
  inp.focus();
  if (initial === undefined) inp.select(); else inp.setSelectionRange(inp.value.length, inp.value.length);
  inp.addEventListener('input', () => { $('#formula').value = inp.value; });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(e.shiftKey ? -1 : 1, 0); }
    else if (e.key === 'Tab') { e.preventDefault(); commit(0, e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); editing = null; render(); wrap.focus(); }
    e.stopPropagation();
  });
  inp.addEventListener('blur', () => commit(0, 0));
}

function commit(dr, dc) {
  if (!editing) return;
  const { r, c } = editing;
  const inp = tdAt(r, c) && tdAt(r, c).querySelector('input');
  const val = inp ? inp.value : null;
  editing = null;
  if (val !== null && val !== ((doc.cells[keyOf(r, c)] || {}).v || '')) setRaw(r, c, val);
  render();
  if (dr || dc) moveTo(r + dr, c + dc, false);
}

$('#formula').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { setRaw(anchor.r, anchor.c, e.target.value); render(); e.target.blur(); }
  else if (e.key === 'Escape') { syncToolbar(); e.target.blur(); }
  e.stopPropagation();
});

/* ---------- mouse ---------- */
grid.addEventListener('mousedown', (e) => {
  const td = e.target.closest('td');
  const th = e.target.closest('th');
  if (editing && e.target.tagName === 'INPUT') return;
  if (editing) commit(0, 0);
  if (td) {
    const r = +td.dataset.r, c = +td.dataset.c;
    if (e.shiftKey) ext = { r, c }; else { anchor = { r, c }; ext = { r, c }; }
    dragging = true;
    updateSelection();
    e.preventDefault();
  } else if (th && th.dataset.c !== undefined) {
    const c = +th.dataset.c;
    anchor = { r: 0, c }; ext = { r: dims.rows - 1, c }; updateSelection();
  } else if (th && th.dataset.r !== undefined) {
    const r = +th.dataset.r;
    anchor = { r, c: 0 }; ext = { r, c: dims.cols - 1 }; updateSelection();
  }
});
grid.addEventListener('mouseover', (e) => {
  if (!dragging) return;
  const td = e.target.closest('td');
  if (td) { ext = { r: +td.dataset.r, c: +td.dataset.c }; updateSelection(); }
});
window.addEventListener('mouseup', () => { dragging = false; });
grid.addEventListener('dblclick', (e) => { if (e.target.closest('td') && !editing) startEdit(); });

/* ---------- keyboard ---------- */
async function copySel(cut) {
  const { r1, r2, c1, c2 } = range();
  const rows = [];
  for (let r = r1; r <= r2; r++) {
    const row = [];
    for (let c = c1; c <= c2; c++) row.push((doc.cells[keyOf(r, c)] || {}).v || '');
    rows.push(row.join('\t'));
  }
  try { await navigator.clipboard.writeText(rows.join('\n')); } catch {}
  if (cut) clearSel();
}
async function pasteSel() {
  let t = '';
  try { t = await navigator.clipboard.readText(); } catch { return; }
  if (!t) return;
  const rows = t.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
  rows.forEach((row, i) => row.forEach((v, j) => setRaw(anchor.r + i, anchor.c + j, v)));
  ext = { r: anchor.r + rows.length - 1, c: anchor.c + rows[0].length - 1 };
  reach.r = Math.max(reach.r, ext.r); reach.c = Math.max(reach.c, ext.c);
  render();
}
function clearSel() {
  const { r1, r2, c1, c2 } = range();
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (doc.cells[keyOf(r, c)]) setRaw(r, c, '');
  render();
}

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (!$('#modal').classList.contains('hidden')) return;
  if (mod) {
    const k = e.key.toLowerCase();
    const acts = { n: e.shiftKey ? 'newProject' : 'newSheet', o: e.shiftKey ? 'openProject' : 'openSheet', s: e.shiftKey ? 'saveAs' : 'save', q: 'quit' };
    if (acts[k]) { e.preventDefault(); actions[acts[k]](); return; }
  }
  if (editing || document.activeElement.matches('input,select')) return;
  if (mod && 'cxv'.includes(e.key.toLowerCase())) {
    e.preventDefault();
    const k = e.key.toLowerCase();
    if (k === 'v') pasteSel(); else copySel(k === 'x');
    return;
  }
  if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); anchor = { r: 0, c: 0 }; ext = { r: dims.rows - 1, c: dims.cols - 1 }; updateSelection(); return; }
  const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  if (arrows[e.key]) {
    e.preventDefault();
    const [dr, dc] = arrows[e.key];
    const from = e.shiftKey ? ext : anchor;
    moveTo(from.r + dr, from.c + dc, e.shiftKey);
  } else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(); }
  else if (e.key === 'Tab') { e.preventDefault(); moveTo(anchor.r, anchor.c + (e.shiftKey ? -1 : 1), false); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearSel(); }
  else if (e.key === 'Home') { e.preventDefault(); moveTo(anchor.r, 0, false); }
  else if (e.key.length === 1 && !mod && !e.altKey) { e.preventDefault(); startEdit(e.key); }
});

/* ---------- formatting toolbar ---------- */
function applyStyle(prop, val) {
  const { r1, r2, c1, c2 } = range();
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
    const k = keyOf(r, c);
    if (val === null || val === undefined) {
      if (doc.cells[k]) { delete doc.cells[k][prop]; prune(k); }
    } else (doc.cells[k] || (doc.cells[k] = {}))[prop] = val;
  }
  setDirty(true);
  render();
}
const sizeSel = $('#size');
[8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48].forEach((s) => sizeSel.add(new Option(s, s)));
$('#fmt').addEventListener('change', (e) => { applyStyle('fmt', e.target.value === 'general' ? null : e.target.value); e.target.blur(); });
$('#dec').addEventListener('change', (e) => { applyStyle('dec', e.target.value === '2' ? null : +e.target.value); e.target.blur(); });
sizeSel.addEventListener('change', (e) => { applyStyle('sz', e.target.value === '13' ? null : +e.target.value); e.target.blur(); });
document.querySelectorAll('[data-al]').forEach((b) => b.addEventListener('click', () => {
  const cur = (doc.cells[keyOf(anchor.r, anchor.c)] || {}).al;
  applyStyle('al', cur === b.dataset.al ? null : b.dataset.al);
}));
$('#bg').addEventListener('input', (e) => applyStyle('bg', e.target.value));
$('#fg').addEventListener('input', (e) => applyStyle('fg', e.target.value));
$('#bgReset').addEventListener('click', () => applyStyle('bg', null));
$('#fgReset').addEventListener('click', () => applyStyle('fg', null));

/* ---------- document / files ---------- */
function setDirty(v) {
  dirty = v;
  api.setDirty(v);
  updateTitle();
}
function updateTitle() {
  $('#title').textContent = (filePath ? baseName(filePath) : 'Untitled') + (dirty ? ' •' : '') + ' — Tally';
  document.title = $('#title').textContent;
  document.querySelectorAll('.node.file').forEach((n) => n.classList.toggle('active', n.dataset.path === filePath));
}
function loadDoc(d, path) {
  doc = d; filePath = path; dirty = false; api.setDirty(false);
  anchor = ext = { r: 0, c: 0 }; reach = { r: 0, c: 0 }; editing = null;
  wrap.scrollTo(0, 0);
  render(); updateTitle();
}
async function confirmUnsaved() {
  if (!dirty) return true;
  const a = await api.askUnsaved();
  if (a === 'cancel') return false;
  if (a === 'save') return await actions.save();
  return true;
}
async function openPath(p) {
  if (!(await confirmUnsaved())) return;
  try {
    const d = JSON.parse(await api.read(p));
    if (!d || typeof d.cells !== 'object') throw 0;
    loadDoc(d, p);
  } catch { toast('Could not open that file.'); }
}
async function writeTo(p) {
  commit(0, 0);
  await api.write(p, JSON.stringify(doc));
  filePath = p; setDirty(false);
  refreshAround(p);
  return true;
}

const actions = {
  async newSheet() { if (await confirmUnsaved()) loadDoc({ version: 1, cells: {} }, null); },
  async openSheet() { const p = await api.pickSheet(); if (p) openPath(p); },
  async save() { return filePath ? writeTo(filePath) : actions.saveAs(); },
  async saveAs() {
    const dir = selectedDir || (filePath ? filePath.replace(/[\\/][^\\/]*$/, '') : null);
    const p = await api.saveAsDialog(dir, filePath ? baseName(filePath) : 'Untitled.sheet');
    return p ? writeTo(p) : false;
  },
  async newProject() {
    const parent = await api.pickDir(true);
    if (!parent) return;
    const name = await promptName('New project name');
    if (!name) return;
    const r = await api.mkdir(parent, name);
    if (r.error) return toast(r.error);
    await addProject(r.path);
  },
  async openProject() { const p = await api.pickDir(false); if (p) await addProject(p); },
  async quit() { if (await confirmUnsaved()) api.quit(); },
};
api.onRequestClose(() => actions.quit());

/* menu */
const fileBtn = $('#fileBtn'), fileMenu = $('#fileMenu');
const closeMenu = () => { fileMenu.classList.add('hidden'); fileBtn.classList.remove('open'); };
fileBtn.addEventListener('click', (e) => { e.stopPropagation(); fileMenu.classList.toggle('hidden'); fileBtn.classList.toggle('open'); });
fileMenu.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { closeMenu(); actions[b.dataset.act](); } });
document.addEventListener('click', closeMenu);

/* ---------- modal + toast ---------- */
function promptName(title, suggestion = '') {
  return new Promise((resolve) => {
    const m = $('#modal'), inp = $('#modalInput');
    $('#modalTitle').textContent = title;
    inp.value = suggestion;
    m.classList.remove('hidden');
    inp.focus(); inp.select();
    const done = (v) => {
      m.classList.add('hidden');
      $('#modalBox').onsubmit = null; $('#modalCancel').onclick = null; m.onkeydown = null;
      resolve(v);
    };
    $('#modalBox').onsubmit = (e) => { e.preventDefault(); done(inp.value.replace(/[\\/:*?"<>|]/g, '').trim() || null); };
    $('#modalCancel').onclick = () => done(null);
    m.onkeydown = (e) => { if (e.key === 'Escape') done(null); };
  });
}
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

/* ---------- sidebar ---------- */
const ICON = {
  folder: '<svg viewBox="0 0 16 16"><path d="M1.5 4.5a1 1 0 0 1 1-1h3.2l1.5 1.5h6.3a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/></svg>',
  sheet: '<svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M2.5 6.5h11M2.5 10h11M7 2.5v11"/></svg>',
  addFolder: '<svg viewBox="0 0 16 16"><path d="M1.5 4.5a1 1 0 0 1 1-1h3.2l1.5 1.5h6.3a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1zM8 7v4M6 9h4"/></svg>',
  addSheet: '<svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M8 5.5v5M5.5 8h5"/></svg>',
  remove: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
};
let selectedDir = null;

async function loadDir(p) { children[p] = await api.list(p); }
async function refreshAround(p) {
  const parent = p.replace(/[\\/][^\\/]*$/, '');
  if (parent in children) { await loadDir(parent); renderTree(); }
  updateTitle();
}
async function addProject(p) {
  if (!cfg.projects.includes(p)) cfg.projects.push(p);
  await api.saveCfg(cfg);
  expanded.add(p); selectedDir = p;
  await loadDir(p); renderTree();
}
async function toggle(p) {
  if (expanded.has(p)) expanded.delete(p); else { expanded.add(p); await loadDir(p); }
  selectedDir = p;
  renderTree();
}

function nodeEl(entry, depth, root) {
  const frag = document.createDocumentFragment();
  const n = document.createElement('div');
  n.className = 'node ' + (entry.dir ? 'dir' : 'file') + (root ? ' root' : '');
  n.style.paddingLeft = 6 + depth * 14 + 'px';
  n.dataset.path = entry.path;
  const open = expanded.has(entry.path);
  n.innerHTML = (entry.dir ? `<span class="chev">${open ? '▼' : '▶'}</span>` : '<span class="chev"></span>') +
    (entry.dir ? ICON.folder : ICON.sheet) + `<span class="label">${esc(entry.name.replace(/\.sheet$/, ''))}</span>` +
    (entry.dir ? `<span class="acts"><button data-a="folder" title="New subfolder">${ICON.addFolder}</button><button data-a="sheet" title="New sheet">${ICON.addSheet}</button>${root ? `<button data-a="remove" title="Remove from sidebar">${ICON.remove}</button>` : ''}</span>` : '');
  if (!entry.dir && entry.path === filePath) n.classList.add('active');
  n.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (b) {
      e.stopPropagation();
      await sidebarAction(b.dataset.a, entry);
    } else if (entry.dir) toggle(entry.path);
    else openPath(entry.path);
  });
  frag.appendChild(n);
  if (entry.dir && open) {
    const kids = children[entry.path] || [];
    kids.forEach((k) => frag.appendChild(nodeEl(k, depth + 1, false)));
    if (!kids.length) {
      const em = document.createElement('div');
      em.className = 'empty'; em.style.paddingLeft = 26 + (depth + 1) * 14 + 'px'; em.textContent = 'Empty';
      frag.appendChild(em);
    }
  }
  return frag;
}

async function sidebarAction(a, entry) {
  if (a === 'remove') {
    cfg.projects = cfg.projects.filter((p) => p !== entry.path);
    await api.saveCfg(cfg); renderTree(); return;
  }
  const name = await promptName(a === 'folder' ? 'New folder name' : 'New sheet name');
  if (!name) return;
  const r = a === 'folder' ? await api.mkdir(entry.path, name) : await api.newSheet(entry.path, /\.sheet$/.test(name) ? name : name + '.sheet');
  if (r.error) return toast(r.error);
  expanded.add(entry.path);
  await loadDir(entry.path); renderTree();
  if (a === 'sheet') openPath(r.path);
}

function renderTree() {
  const t = $('#tree');
  t.innerHTML = '';
  if (!cfg.projects.length) {
    t.innerHTML = '<div class="empty">No projects yet.<br>Use File → New Project or Open Project.</div>';
    return;
  }
  cfg.projects.forEach((p) => t.appendChild(nodeEl({ name: baseName(p) || p, path: p, dir: true }, 0, true)));
}

/* ---------- boot ---------- */
window.addEventListener('resize', () => { if (!editing) render(); });
(async function init() {
  cfg = (await api.loadCfg()) || { projects: [] };
  cfg.projects = cfg.projects || [];
  for (const p of cfg.projects) { expanded.add(p); await loadDir(p); }
  renderTree();
  render(); updateTitle();
})();
