// RatVault PWA — standalone knowledge vault
// Two modes:
//   FS API mode  (Chrome/Edge): reads/writes real files via showDirectoryPicker
//   IDB mode     (Firefox etc): imports via <input webkitdirectory>, stores in IndexedDB

const HAS_FS_API = typeof window.showDirectoryPicker === 'function';

const BINARY_EXTS = new Set([
  'jpg','jpeg','png','gif','webp','svg','bmp','avif',
  'pdf',
  'mp4','webm','mov','mkv',
  'mp3','wav','ogg','flac','m4a',
  'doc','docx','xls','xlsx','ppt','pptx',
  'txt','csv','json',
]);

// ─── IndexedDB store ────────────────────────────────────────────────────────

const DB_NAME = 'ratvault-pwa';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function dbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = e => reject(e.target.error);
  });
}

async function dbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv', 'readwrite').objectStore('kv').put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  });
}

async function dbGetFile(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('files', 'readonly').objectStore('files').get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = e => reject(e.target.error);
  });
}

async function dbSetFile(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('files', 'readwrite').objectStore('files').put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = e => reject(e.target.error);
  });
}

// ─── Frontmatter ─────────────────────────────────────────────────────────────

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (!k) continue;
    const arr = v.match(/^\[(.*)\]$/);
    meta[k] = arr ? arr[1].split(',').map(t => t.trim()).filter(Boolean) : v;
  }
  return { meta, body: m[2] || '' };
}

function serializeFrontmatter(meta, body) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    lines.push(Array.isArray(v) ? `${k}: [${v.join(', ')}]` : `${k}: ${v}`);
  }
  lines.push('---', '');
  return lines.join('\n') + (body || '');
}

function fileToEntry(name, raw) {
  const { meta, body } = parseFrontmatter(raw);
  return {
    filename: name,
    title: meta.title || name.replace(/\.md$/, ''),
    tags: Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []),
    summary: meta.summary || '',
    created: meta.created || meta.captured || meta.ingested_at || '',
    slug: meta.slug || name.replace(/\.md$/, ''),
    body,
    meta,
  };
}

// ─── FS API mode (Chrome/Edge) ───────────────────────────────────────────────

let dirHandle = null;

async function loadDirHandle() {
  if (!HAS_FS_API) return null;
  try {
    const stored = await dbGet('dirHandle');
    if (!stored) return null;
    const perm = await stored.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') { dirHandle = stored; return dirHandle; }
  } catch (_) {}
  return null;
}

async function pickDirectory() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await dbSet('dirHandle', handle);
  dirHandle = handle;
  return handle;
}

async function listEntriesFS() {
  const out = [];
  const binHandles = new Map();

  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind !== 'file') continue;
    if (name.endsWith('.md')) {
      try {
        const raw = await (await handle.getFile()).text();
        out.push(fileToEntry(name, raw));
      } catch (_) {}
    } else if (!name.startsWith('.') && name !== 'ratvault-pwa.json') {
      const ext = (name.split('.').pop() || '').toLowerCase();
      if (BINARY_EXTS.has(ext)) binHandles.set(name, handle);
    }
  }

  // Auto-create .md wrappers for binary files not yet tracked
  const tracked = new Set(out.map(e => e.meta?.source_file).filter(Boolean));
  for (const [name, handle] of binHandles) {
    if (tracked.has(name)) continue;
    try {
      const file = await handle.getFile();
      const { filename } = await writeFileToVault(file);
      const mdHandle = await dirHandle.getFileHandle(filename);
      const raw = await (await mdHandle.getFile()).text();
      out.push(fileToEntry(filename, raw));
    } catch (_) {}
  }

  return out.sort((a, b) => b.created.localeCompare(a.created));
}

async function writeEntryFS(filename, meta, body) {
  const handle = await dirHandle.getFileHandle(filename, { create: true });
  const w = await handle.createWritable();
  await w.write(serializeFrontmatter(meta, body));
  await w.close();
}

async function isExistingVault() {
  try { await dirHandle.getFileHandle('ratvault-pwa.json'); return true; } catch { return false; }
}

async function initVaultMarker() {
  const h = await dirHandle.getFileHandle('ratvault-pwa.json', { create: true });
  const w = await h.createWritable();
  await w.write(JSON.stringify({ created: new Date().toISOString(), version: 1 }, null, 2));
  await w.close();
}

async function countMdFiles() {
  let n = 0;
  for await (const [name, h] of dirHandle.entries()) {
    if (h.kind === 'file' && name.endsWith('.md')) n++;
  }
  return n;
}

// ─── IDB mode (Firefox / no FS API) ─────────────────────────────────────────
// Entries stored as JSON in IndexedDB. User imports from webkitdirectory input.
// On reinstall user re-imports — files on disk are the source of truth.

const IDB_ENTRIES_KEY = 'idb-entries';

async function loadEntriesIDB() {
  return (await dbGet(IDB_ENTRIES_KEY)) || [];
}

async function saveEntriesIDB(entries) {
  await dbSet(IDB_ENTRIES_KEY, entries);
}

async function loadFromFileList(fileList) {
  const existing = await loadEntriesIDB();
  const out = [...existing];
  const trackedSources = new Set(existing.map(e => e.meta?.source_file).filter(Boolean));

  // Process .md files first
  for (const file of fileList) {
    if (!file.name.endsWith('.md')) continue;
    try {
      const raw = await file.text();
      const entry = fileToEntry(file.name, raw);
      const idx = out.findIndex(e => e.filename === file.name);
      if (idx >= 0) out[idx] = entry; else out.push(entry);
    } catch (_) {}
  }
  out.sort((a, b) => b.created.localeCompare(a.created));
  await saveEntriesIDB(out);

  // Process binary files (writeFileToVault handles IDB writes internally)
  for (const file of fileList) {
    if (file.name.endsWith('.md') || file.name.startsWith('.')) continue;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!BINARY_EXTS.has(ext) || trackedSources.has(file.name)) continue;
    try { await writeFileToVault(file); } catch (_) {}
  }

  return loadEntriesIDB();
}

async function writeEntryIDB(filename, meta, body) {
  const entries = await loadEntriesIDB();
  const entry = fileToEntry(filename, serializeFrontmatter(meta, body));
  const idx = entries.findIndex(e => e.filename === filename);
  if (idx >= 0) entries[idx] = entry; else entries.push(entry);
  await saveEntriesIDB(entries);
}

function downloadEntry(filename, meta, body) {
  const blob = new Blob([serializeFrontmatter(meta, body)], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ─── Unified vault API ────────────────────────────────────────────────────────

async function listEntries() {
  if (HAS_FS_API && dirHandle) return listEntriesFS();
  return loadEntriesIDB();
}

async function writeEntry(filename, meta, body) {
  if (HAS_FS_API && dirHandle) return writeEntryFS(filename, meta, body);
  return writeEntryIDB(filename, meta, body);
}

// ─── Binary file handling ─────────────────────────────────────────────────────

function detectKind(filename, mimeType) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (/^image\//.test(mimeType) || ['jpg','jpeg','png','gif','webp','svg','bmp','avif'].includes(ext)) return 'image';
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (/^video\//.test(mimeType) || ['mp4','webm','mov','mkv'].includes(ext)) return 'video';
  if (/^audio\//.test(mimeType) || ['mp3','wav','ogg','flac','m4a'].includes(ext)) return 'audio';
  if (['doc','docx','xls','xlsx','ppt','pptx'].includes(ext)) return 'document';
  if (['txt','csv','json'].includes(ext)) return 'text';
  return 'file';
}

const MIME_FALLBACK = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
};

function resolveFileMime(file) {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return MIME_FALLBACK[ext] || 'application/octet-stream';
}

async function writeFileToVault(file, titleOverride) {
  const mimeType = resolveFileMime(file);
  const kind = detectKind(file.name, mimeType);
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const titleBase = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  const title = (titleOverride || titleBase || file.name).trim();
  const slug = slugify(title) || slugify(file.name) || 'untitled';
  const mdFilename = `${ts}-${slug}.md`;

  if (HAS_FS_API && dirHandle) {
    const h = await dirHandle.getFileHandle(file.name, { create: true });
    const w = await h.createWritable();
    await w.write(await file.arrayBuffer());
    await w.close();
  } else {
    const buf = await file.arrayBuffer();
    await dbSetFile(file.name, { data: buf, type: mimeType, name: file.name });
  }

  await writeEntry(mdFilename, {
    title,
    source_file: file.name,
    file_type: mimeType,
    kind,
    tags: [kind, 'vault'],
    created: now.toISOString(),
    slug,
  }, `# ${title}\n\n`);

  return { title, kind, filename: mdFilename };
}

// ─── Search ───────────────────────────────────────────────────────────────────

let _index = [];

function buildIndex(entries) {
  _index = entries.map(e => ({
    entry: e,
    text: [e.title, e.summary, ...e.tags, e.body].join(' ').toLowerCase(),
  }));
}

function search(q) {
  if (!q || q.trim().length < 2) return _index.map(i => i.entry);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return _index.filter(i => terms.every(t => i.text.includes(t))).map(i => i.entry);
}

// ─── Provider config ──────────────────────────────────────────────────────────

const PROVIDER_ENDPOINTS = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  openai:     'https://api.openai.com/v1/chat/completions',
  anthropic:  'https://api.anthropic.com/v1/messages',
  custom:     '',
};

const PROVIDER_DEFAULT_MODELS = {
  openrouter: 'openai/gpt-4o-mini',
  openai:     'gpt-4o-mini',
  anthropic:  'claude-sonnet-4-5-20251001',
  custom:     '',
};

async function getProviderConfig() {
  const provider = (await dbGet('provider')) || 'openrouter';
  const apiKey   = (await dbGet('apiKey'))   || '';
  const endpoint = (await dbGet('apiEndpoint')) || PROVIDER_ENDPOINTS[provider] || '';
  const model    = (await dbGet('chatModel'))   || PROVIDER_DEFAULT_MODELS[provider] || '';
  return { provider, apiKey, endpoint, model };
}

// ─── Chat ────────────────────────────────────────────────────────────────────

const chatHistory = [];
let chatMode = 'ai'; // 'ai' | 'local'

function localSearchChat(query) {
  const results = search(query);
  if (!results.length) return `No notes match "${query}".`;
  const lines = [`${results.length} note(s) matching "${query}":\n`];
  results.slice(0, 6).forEach((e, i) => {
    lines.push(`${i + 1}. ${e.title}`);
    const snippet = (e.summary || e.body || '').slice(0, 140).replace(/\n+/g, ' ').trim();
    if (snippet) lines.push(`   ${snippet}…`);
    if (e.tags.length) lines.push(`   [${e.tags.join(', ')}]`);
  });
  return lines.join('\n');
}

async function sendChatMessage(userText, entries) {
  const { provider, apiKey, endpoint, model } = await getProviderConfig();
  if (!apiKey) throw new Error('No API key — add one in Settings');
  if (!endpoint) throw new Error('No endpoint URL — check Settings');

  const context = entries.slice(0, 8)
    .map(e => `[${e.title}] ${e.summary || e.body.slice(0, 300)}`)
    .join('\n\n');

  const system = context
    ? `You are a helpful assistant. Answer using vault notes below when relevant.\n\n${context}`
    : 'You are a helpful assistant.';

  chatHistory.push({ role: 'user', content: userText });

  let resp;
  if (provider === 'anthropic') {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system,
        messages: chatHistory.slice(-12),
      }),
    });
  } else {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(provider === 'openrouter' ? { 'HTTP-Referer': location.origin } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, ...chatHistory.slice(-12)],
      }),
    });
  }

  if (!resp.ok) {
    chatHistory.pop();
    throw new Error(`API ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();
  const reply = provider === 'anthropic'
    ? (data.content?.[0]?.text || '(empty)')
    : (data.choices?.[0]?.message?.content || '(empty)');
  chatHistory.push({ role: 'assistant', content: reply });
  return reply;
}

// ─── URL capture ──────────────────────────────────────────────────────────────

const URL_KINDS = [
  [/arxiv\.org/,                'research'],
  [/github\.com|gitlab\.com/,   'code'],
  [/reddit\.com/,               'discussion'],
  [/news\.ycombinator\.com/,    'discussion'],
  [/twitter\.com|x\.com/,       'social'],
  [/youtube\.com|youtu\.be/,    'video'],
  [/wikipedia\.org/,            'reference'],
  [/medium\.com|substack\.com/, 'article'],
  [/\.pdf(\?|$)/,               'document'],
];

function classifyUrl(url) {
  for (const [pat, kind] of URL_KINDS) {
    if (pat.test(url)) return kind;
  }
  return 'link';
}

async function captureUrl(rawUrl, overrideKind) {
  let url = rawUrl.trim();
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;
  const kind = overrideKind || classifyUrl(url);
  let title = '';

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const html = await resp.text();
    const m = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    if (m) title = m[1].trim().replace(/&amp;/g, '&').replace(/&[a-z]+;/g, '');
  } catch (_) {}

  if (!title) {
    try { title = new URL(url).hostname.replace(/^www\./, ''); } catch { title = url; }
  }

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const slug = slugify(title);
  const filename = `${ts}-${slug}.md`;
  await writeEntry(filename, {
    title, source: url, captured: now.toISOString(), kind, tags: [kind], slug,
  }, `# ${title}\n\n> Source: ${url}\n\n`);
  return { title, kind, filename };
}

// ─── Markdown DOM renderer (no innerHTML) ────────────────────────────────────

function makeLink(href, text) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text || href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

// Appends inline content (bold, italic, code, links, bare URLs) into a parent node.
// Uses matchAll to avoid innerHTML. Safe for user's own local content.
function appendInline(parent, text) {
  const TOKEN = /(`[^`]+`|\[([^\]]*)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|https?:\/\/[^\s<>"]+)/g;
  let pos = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > pos) parent.appendChild(document.createTextNode(text.slice(pos, m.index)));
    const tok = m[0];
    if (tok.startsWith('`')) {
      const c = document.createElement('code'); c.textContent = tok.slice(1, -1); parent.appendChild(c);
    } else if (tok.startsWith('[')) {
      parent.appendChild(makeLink(m[3], m[2]));
    } else if (tok.startsWith('**')) {
      const s = document.createElement('strong'); s.textContent = m[4]; parent.appendChild(s);
    } else if (tok.startsWith('*')) {
      const em = document.createElement('em'); em.textContent = m[5]; parent.appendChild(em);
    } else {
      parent.appendChild(makeLink(tok));
    }
    pos = m.index + tok.length;
  }
  if (pos < text.length) parent.appendChild(document.createTextNode(text.slice(pos)));
}

function renderBlock(block) {
  const lines = block.split('\n');
  const first = lines[0];
  const hm = first.match(/^(#{1,4})\s+(.*)/);
  if (hm) {
    const h = document.createElement('h' + Math.min(hm[1].length, 4));
    appendInline(h, hm[2]); return h;
  }
  if (/^---+$/.test(first.trim())) return document.createElement('hr');
  if (/^>\s/.test(first)) {
    const bq = document.createElement('blockquote');
    appendInline(bq, lines.map(l => l.replace(/^>\s?/, '')).join(' ')); return bq;
  }
  if (/^[-*]\s/.test(first)) {
    const ul = document.createElement('ul');
    lines.forEach(l => { const m = l.match(/^[-*]\s+(.*)/); if (m) { const li = document.createElement('li'); appendInline(li, m[1]); ul.appendChild(li); } });
    return ul;
  }
  if (/^\d+\.\s/.test(first)) {
    const ol = document.createElement('ol');
    lines.forEach(l => { const m = l.match(/^\d+\.\s+(.*)/); if (m) { const li = document.createElement('li'); appendInline(li, m[1]); ol.appendChild(li); } });
    return ol;
  }
  const p = document.createElement('p'); appendInline(p, lines.join(' ')); return p;
}

// Renders markdown text into a DocumentFragment using safe DOM methods only.
function renderMarkdown(text) {
  const frag = document.createDocumentFragment();
  const parts = text.split(/(```[\s\S]*?```)/);
  for (const part of parts) {
    if (part.startsWith('```')) {
      const inner = part.slice(3);
      const nl = inner.indexOf('\n');
      const code = (nl >= 0 ? inner.slice(nl + 1) : inner).replace(/```$/, '');
      const pre = document.createElement('pre');
      const ce = document.createElement('code'); ce.textContent = code; pre.appendChild(ce);
      frag.appendChild(pre);
    } else {
      part.split(/\n\n+/).forEach(b => { if (b.trim()) frag.appendChild(renderBlock(b.trim())); });
    }
  }
  return frag;
}

// ─── Rename prompt ────────────────────────────────────────────────────────────

function promptTitle(filename, defaultTitle) {
  return new Promise(resolve => {
    const overlay = document.getElementById('rename-overlay');
    const input   = document.getElementById('rename-input');
    const fnEl    = document.getElementById('rename-filename');
    fnEl.textContent = filename;
    input.value = defaultTitle;
    overlay.classList.add('open');
    setTimeout(() => { input.focus(); input.select(); }, 60);

    function finish(val) {
      overlay.classList.remove('open');
      off();
      resolve(val || defaultTitle);
    }

    const saveBtn = document.getElementById('rename-save');
    const skipBtn = document.getElementById('rename-skip');

    function onSave() { finish(input.value.trim() || defaultTitle); }
    function onSkip() { finish(defaultTitle); }
    function onKey(e) {
      if (e.key === 'Enter') { e.preventDefault(); onSave(); }
      if (e.key === 'Escape') onSkip();
    }

    function off() {
      saveBtn.removeEventListener('click', onSave);
      skipBtn.removeEventListener('click', onSkip);
      input.removeEventListener('keydown', onKey);
    }

    saveBtn.addEventListener('click', onSave);
    skipBtn.addEventListener('click', onSkip);
    input.addEventListener('keydown', onKey);
  });
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
let allEntries = [];

function toast(msg, ms = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), ms);
}

function clearChildren(el) { while (el.firstChild) el.removeChild(el.firstChild); }

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function switchView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === id));
}

function setActiveTab(name) {
  document.querySelectorAll('.tabs button').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name));
}

// ─── Vault view ───────────────────────────────────────────────────────────────

function renderList(entries) {
  const wrap = $('vault-list');
  clearChildren(wrap);
  if (!entries.length) {
    wrap.appendChild(el('div', 'empty',
      'No notes found. Import a directory or add notes via Settings.'));
    return;
  }
  entries.forEach(e => {
    const row = el('div', 'doc-row');
    row.appendChild(el('div', 'doc-title', e.title));
    const meta = el('div', 'doc-meta');
    if (e.created) meta.appendChild(el('span', 'badge', e.created.slice(0, 10)));
    (e.tags || []).slice(0, 4).forEach(t => meta.appendChild(el('span', 'badge', t)));
    row.appendChild(meta);
    row.addEventListener('click', () => openEntry(e));
    wrap.appendChild(row);
  });
}

async function loadVault() {
  $('vault-refresh').disabled = true;
  try {
    allEntries = await listEntries();
    buildIndex(allEntries);
    renderList(allEntries);
  } catch (e) {
    toast('Load error: ' + e.message);
  } finally {
    $('vault-refresh').disabled = false;
  }
}

// ─── Entry view ───────────────────────────────────────────────────────────────

function openEntry(entry, pushHistory = true) {
  _currentEntry = entry;
  if (pushHistory) history.pushState({ view: 'entry', filename: entry.filename }, '');
  switchView('v-entry');
  const body = $('entry-body');
  clearChildren(body);

  const titleEl = el('div', 'entry-title editable-title', entry.title);
  titleEl.title = 'Click to rename';
  titleEl.addEventListener('click', () => openEditor(entry));
  body.appendChild(titleEl);

  const tags = entry.tags.length ? entry.tags : [];
  if (tags.length) {
    const meta = el('div', 'doc-meta');
    meta.style.marginBottom = '8px';
    tags.forEach(t => meta.appendChild(el('span', 'badge', t)));
    body.appendChild(meta);
  }

  if (entry.meta?.source) {
    const src = el('div', 'entry-source');
    src.appendChild(document.createTextNode('Source: '));
    src.appendChild(makeLink(entry.meta.source, entry.meta.source));
    body.appendChild(src);
  }

  const kind = entry.meta?.kind || '';
  const sourceFile = entry.meta?.source_file;
  const binaryKinds = ['image', 'pdf', 'video', 'audio'];

  if (sourceFile && binaryKinds.includes(kind)) {
    renderBinaryPreview(body, entry, kind, sourceFile);
  } else {
    const content = el('div', 'entry-content md-body');
    const raw = entry.body || entry.summary || '';
    content.appendChild(raw ? renderMarkdown(raw) : document.createTextNode('(empty)'));
    body.appendChild(content);
  }
}

async function renderBinaryPreview(container, entry, kind, sourceFile) {
  let objectUrl = null;
  let stored = null;
  try {
    if (HAS_FS_API && dirHandle) {
      const fh = await dirHandle.getFileHandle(sourceFile);
      objectUrl = URL.createObjectURL(await fh.getFile());
    } else {
      stored = await dbGetFile(sourceFile);
      if (stored) {
        objectUrl = URL.createObjectURL(new Blob([stored.data], { type: stored.type }));
      }
    }
  } catch (_) {}

  if (!objectUrl) {
    container.appendChild(el('div', 'preview-missing', `File "${sourceFile}" not found in vault.`));
    return;
  }

  if (kind === 'image') {
    const img = document.createElement('img');
    img.src = objectUrl;
    img.className = 'preview-img';
    img.alt = entry.title;
    container.appendChild(img);
  } else if (kind === 'pdf') {
    const btn = el('button', 'btn primary preview-pdf-btn', 'Open PDF ↗');
    btn.addEventListener('click', () => window.open(objectUrl, '_blank'));
    container.appendChild(btn);
  } else if (kind === 'video') {
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.className = 'preview-video';
    const vsrc = document.createElement('source');
    vsrc.src = objectUrl;
    const vtype = stored?.type || entry.meta?.file_type || '';
    if (vtype) vsrc.type = vtype;
    video.appendChild(vsrc);
    container.appendChild(video);
  } else if (kind === 'audio') {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.className = 'preview-audio';
    const asrc = document.createElement('source');
    asrc.src = objectUrl;
    const atype = stored?.type || entry.meta?.file_type || '';
    if (atype) asrc.type = atype;
    audio.appendChild(asrc);
    container.appendChild(audio);
  }

  // Show any extra markdown notes below the preview
  const bodyText = (entry.body || '').trim();
  const headingOnly = bodyText === `# ${entry.title}` || bodyText === '';
  if (!headingOnly) {
    const content = el('div', 'entry-content md-body');
    content.style.marginTop = '12px';
    content.appendChild(renderMarkdown(bodyText));
    container.appendChild(content);
  }
}

// ─── Entry editor ─────────────────────────────────────────────────────────────

let _editEntry = null;
let _currentEntry = null;

function openEditor(entry) {
  _editEntry = entry;
  $('edit-title').value = entry.title || '';
  $('edit-tags').value = (entry.tags || []).join(', ');
  $('edit-body').value = entry.body || '';
  $('edit-overlay').classList.add('open');
  setTimeout(() => { $('edit-title').focus(); $('edit-title').select(); }, 60);
}

async function saveEditorEntry() {
  if (!_editEntry) return;
  const title = $('edit-title').value.trim() || _editEntry.title;
  const tags  = $('edit-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const body  = $('edit-body').value;
  const meta  = { ..._editEntry.meta, title, tags, slug: slugify(title) };
  if (!meta.created) meta.created = new Date().toISOString();
  try {
    await writeEntry(_editEntry.filename, meta, body);
    $('edit-overlay').classList.remove('open');
    const updated = { ..._editEntry, title, tags, body, meta };
    const idx = allEntries.findIndex(e => e.filename === _editEntry.filename);
    if (idx >= 0) allEntries[idx] = updated; else allEntries.push(updated);
    buildIndex(allEntries);
    openEntry(updated);
    toast('Saved');
    _editEntry = null;
  } catch (e) { toast('Save failed: ' + e.message); }
}

// ─── Settings view ────────────────────────────────────────────────────────────

async function loadSettings() {
  const cfg = await getProviderConfig();
  $('provider-select').value = cfg.provider;
  $('api-key-input').value   = cfg.apiKey;
  $('api-endpoint').value    = cfg.endpoint;
  $('model-input').value     = cfg.model;

  const theme = (await dbGet('theme')) || 'green';
  document.querySelectorAll('.swatch').forEach(s =>
    s.classList.toggle('active', s.dataset.t === theme));

  if (HAS_FS_API) {
    $('vault-dir-name').textContent = dirHandle ? dirHandle.name : '(none selected)';
    $('change-vault-dir').classList.remove('hidden');
    $('import-dir-btn').classList.add('hidden');
  } else {
    const count = allEntries.length;
    $('vault-dir-name').textContent = count ? `${count} notes in browser storage` : '(no notes imported)';
    $('change-vault-dir').classList.add('hidden');
    $('import-dir-btn').classList.remove('hidden');
  }
}

async function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  await dbSet('theme', t);
}

// ─── Chat ────────────────────────────────────────────────────────────────────

function appendMsg(role, text, sources = []) {
  const wrap = $('chat-msgs');
  const div = el('div', `msg ${role}`);
  div.appendChild(el('div', 'who', role === 'user' ? 'you' : role === 'error' ? 'error' : 'vault'));
  const body = el('div', 'body');
  if (role === 'assistant') {
    appendInline(body, text);
  } else {
    body.textContent = text;
  }
  div.appendChild(body);

  if (role === 'assistant' && sources.length) {
    const srcRow = el('div', 'msg-sources');
    srcRow.appendChild(el('span', 'sources-label', 'sources:'));
    sources.forEach(e => {
      const btn = el('button', 'btn sm source-chip', '↗ ' + e.title);
      btn.addEventListener('click', () => openEntry(e));
      srcRow.appendChild(btn);
    });
    div.appendChild(srcRow);
  }

  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function appendLocalResults(query, results) {
  const wrap = $('chat-msgs');

  const qDiv = el('div', 'msg user');
  qDiv.appendChild(el('div', 'who', 'you'));
  qDiv.appendChild(el('div', 'body', query));
  wrap.appendChild(qDiv);

  const rDiv = el('div', 'msg assistant');
  rDiv.appendChild(el('div', 'who', 'vault'));
  const body = el('div', 'body search-results');

  if (!results.length) {
    body.appendChild(document.createTextNode(`No notes match "${query}".`));
  } else {
    body.appendChild(el('div', 'search-count', `${results.length} result${results.length > 1 ? 's' : ''}`));
    results.slice(0, 6).forEach(e => {
      const card = el('div', 'search-card');
      const titleRow = el('div', 'search-card-title');
      titleRow.appendChild(document.createTextNode(e.title));
      const openBtn = el('button', 'btn sm open-btn', 'Open →');
      openBtn.addEventListener('click', () => openEntry(e));
      titleRow.appendChild(openBtn);
      card.appendChild(titleRow);
      const snippet = (e.summary || e.body || '').slice(0, 120).replace(/\n+/g, ' ').trim();
      if (snippet) card.appendChild(el('div', 'search-snippet', snippet + '…'));
      if (e.tags.length) {
        const tags = el('div', 'doc-meta');
        tags.style.marginTop = '4px';
        e.tags.forEach(t => tags.appendChild(el('span', 'badge', t)));
        card.appendChild(tags);
      }
      body.appendChild(card);
    });
  }

  rDiv.appendChild(body);
  wrap.appendChild(rDiv);
  wrap.scrollTop = wrap.scrollHeight;
}

function clearChatHistory() {
  chatHistory.length = 0;
  clearChildren($('chat-msgs'));
  toast('Chat cleared');
}

function appendThinking() {
  const wrap = $('chat-msgs');
  const div = el('div', 'msg assistant thinking-msg');
  div.appendChild(el('div', 'who', 'vault'));
  const body = el('div', 'body thinking-dots');
  for (let i = 0; i < 3; i++) body.appendChild(el('span', null, '●'));
  div.appendChild(body);
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

async function doSendChat() {
  const inp = $('chat-input');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  inp.style.height = 'auto';

  if (chatMode === 'local') {
    appendLocalResults(text, search(text));
    return;
  }

  $('chat-send').disabled = true;
  appendMsg('user', text);
  const thinking = appendThinking();
  const contextEntries = allEntries.slice(0, 8);
  try {
    const reply = await sendChatMessage(text, allEntries);
    thinking.remove();
    appendMsg('assistant', reply, contextEntries);
  } catch (e) {
    thinking.remove();
    appendMsg('error', e.message);
  } finally {
    $('chat-send').disabled = false;
  }
}

// ─── Tab routing ─────────────────────────────────────────────────────────────

async function switchTab(name) {
  history.replaceState({ view: name }, '');
  setActiveTab(name);
  if (name === 'vault') { switchView('v-vault'); await loadVault(); }
  else if (name === 'chat') switchView('v-chat');
  else if (name === 'settings') { switchView('v-settings'); await loadSettings(); }
}

// ─── New entry ────────────────────────────────────────────────────────────────

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled';
}

async function createEntry(title) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const filename = `${ts}-${slugify(title)}.md`;
  await writeEntry(filename, {
    title,
    slug: slugify(title),
    created: now.toISOString(),
    tags: [],
  }, `# ${title}\n\n`);
  return filename;
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

function enterApp() {
  $('tabs').classList.add('visible');
  setActiveTab('vault');
  document.querySelectorAll('.tabs button').forEach(b =>
    b.addEventListener('click', () => switchTab(b.dataset.tab)));
  history.replaceState({ view: 'vault' }, '');
  switchView('v-vault');
  loadVault();
}

async function runOnboarding() {
  switchView('v-onboard');

  // Populate onboarding note based on browser capability
  const note = $('onboard-note');
  if (!HAS_FS_API) {
    note.textContent =
      'Your browser does not support the File System Access API. ' +
      'RatVault will import your notes and store them in browser storage. ' +
      'To restore after reinstalling, re-import the same folder. ' +
      'Chrome/Edge offer full persistent access.';
  }

  if (HAS_FS_API) {
    // Full mode — directory picker
    $('pick-dir-btn').addEventListener('click', async () => {
      try {
        await pickDirectory();
      } catch (e) {
        if (e.name !== 'AbortError') toast('Could not open directory: ' + e.message);
        return;
      }
      const existing = await isExistingVault();
      if (existing) {
        const count = await countMdFiles();
        toast(`Existing vault — ${count} notes`, 3000);
      } else {
        await initVaultMarker();
        toast('New vault created');
      }
      enterApp();
    });
    $('import-dir-btn-onboard').classList.add('hidden');
  } else {
    // IDB mode — webkitdirectory input
    $('pick-dir-btn').classList.add('hidden');
    $('import-dir-btn-onboard').classList.remove('hidden');
    $('import-dir-btn-onboard').addEventListener('click', () => $('dir-input-onboard').click());
    $('dir-input-onboard').addEventListener('change', async e => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      try {
        const entries = await loadFromFileList(files);
        toast(`Imported ${entries.length} notes`, 3000);
        enterApp();
      } catch (err) {
        toast('Import error: ' + err.message);
      }
      e.target.value = '';
    });
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const theme = (await dbGet('theme')) || 'green';
  document.documentElement.setAttribute('data-theme', theme);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Entry back
  $('entry-back').addEventListener('click', () => history.back());

  // Back gesture / hardware back — stay inside the PWA
  window.addEventListener('popstate', async (e) => {
    const state = e.state;
    if (state?.view === 'entry') {
      const entry = allEntries.find(en => en.filename === state.filename);
      if (entry) { openEntry(entry, false); return; }
    }
    // Anything else (vault/chat/settings/null) → vault
    setActiveTab('vault');
    switchView('v-vault');
    history.replaceState({ view: 'vault' }, '');
  });

  // Entry edit
  $('entry-edit').addEventListener('click', () => {
    if (_currentEntry) openEditor(_currentEntry);
  });

  // Editor save/cancel
  $('edit-save-btn').addEventListener('click', saveEditorEntry);
  $('edit-cancel').addEventListener('click', () => {
    $('edit-overlay').classList.remove('open');
    _editEntry = null;
  });
  $('edit-overlay').addEventListener('keydown', e => {
    if (e.key === 'Escape') { $('edit-overlay').classList.remove('open'); _editEntry = null; }
  });

  // Vault toolbar
  $('vault-search').addEventListener('input', () => renderList(search($('vault-search').value)));
  $('vault-refresh').addEventListener('click', loadVault);
  $('vault-new').addEventListener('click', async () => {
    const title = prompt('Entry title:');
    if (!title?.trim()) return;
    try {
      const filename = await createEntry(title.trim());
      await loadVault();
      const entry = allEntries.find(e => e.filename === filename);
      if (entry) { switchView('v-entry'); openEntry(entry); openEditor(entry); }
    } catch (e) { toast('Error: ' + e.message); }
  });

  // Upload
  $('vault-upload').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', async e => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const mdFiles = files.filter(f => f.name.endsWith('.md'));
    const binFiles = files.filter(f => !f.name.endsWith('.md'));
    let count = 0;
    if (mdFiles.length) {
      if (HAS_FS_API && dirHandle) {
        for (const file of mdFiles) {
          try {
            const h = await dirHandle.getFileHandle(file.name, { create: true });
            const w = await h.createWritable();
            await w.write(await file.arrayBuffer());
            await w.close();
            count++;
          } catch (err) { toast('Upload failed: ' + err.message); }
        }
      } else {
        await loadFromFileList(mdFiles);
        count += mdFiles.length;
      }
    }
    for (const file of binFiles) {
      try {
        const defaultTitle = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
        const title = await promptTitle(file.name, defaultTitle);
        await writeFileToVault(file, title);
        count++;
      } catch (err) { toast('Upload failed: ' + err.message); }
    }
    await loadVault();
    if (count) toast(`Uploaded ${count} file(s)`);
    e.target.value = '';
  });

  // Chat
  $('chat-send').addEventListener('click', doSendChat);
  $('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSendChat(); }
  });
  $('chat-input').addEventListener('input', () => {
    const inp = $('chat-input');
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
  });

  $('chat-clear').addEventListener('click', clearChatHistory);

  // Chat mode toggle
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      chatMode = btn.dataset.mode;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b === btn));
      $('chat-input').placeholder = chatMode === 'local'
        ? 'Search vault by keyword…'
        : 'Ask your vault…';
    });
  });

  // URL capture
  $('capture-toggle').addEventListener('click', () => {
    const row = $('capture-row');
    const visible = row.classList.toggle('open');
    if (visible) $('capture-url').focus();
  });
  $('capture-submit').addEventListener('click', async () => {
    const url = $('capture-url').value.trim();
    if (!url) return;
    const kind = $('capture-kind').value;
    $('capture-submit').disabled = true;
    $('capture-submit').textContent = '…';
    try {
      const { title, kind: detected } = await captureUrl(url, kind);
      $('capture-url').value = '';
      $('capture-kind').value = '';
      $('capture-row').classList.remove('open');
      await loadVault();
      toast(`Saved: ${title} [${kind || detected}]`);
    } catch (e) {
      toast('Capture failed: ' + e.message);
    } finally {
      $('capture-submit').disabled = false;
      $('capture-submit').textContent = 'Save';
    }
  });
  $('capture-url').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('capture-submit').click();
    if (e.key === 'Escape') $('capture-row').classList.remove('open');
  });

  // Settings
  $('provider-select').addEventListener('change', () => {
    const p = $('provider-select').value;
    $('api-endpoint').value = PROVIDER_ENDPOINTS[p] || '';
    $('model-input').value  = PROVIDER_DEFAULT_MODELS[p] || '';
  });
  $('save-settings').addEventListener('click', async () => {
    const ep = $('api-endpoint').value.trim();
    if (ep.startsWith('http://') && !ep.includes('localhost') && !ep.includes('127.0.0.1') && !ep.includes('0.0.0.0')) {
      toast('Warning: HTTP endpoint — API key sent in cleartext', 5000);
    }
    await dbSet('provider',     $('provider-select').value);
    await dbSet('apiKey',       $('api-key-input').value.trim());
    await dbSet('apiEndpoint',  ep);
    await dbSet('chatModel',    $('model-input').value.trim());
    toast('Settings saved');
  });
  $('change-vault-dir').addEventListener('click', async () => {
    try {
      await pickDirectory();
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message);
      return;
    }
    if (!(await isExistingVault())) await initVaultMarker();
    toast('Vault directory updated');
    await loadSettings();
    await switchTab('vault');
  });
  $('import-dir-btn').addEventListener('click', () => $('dir-input-settings').click());
  $('dir-input-settings').addEventListener('change', async e => {
    const files = Array.from(e.target.files).filter(f => f.name.endsWith('.md'));
    if (!files.length) return;
    await loadFromFileList(files);
    await loadVault();
    await loadSettings();
    toast(`Re-imported ${files.length} notes`);
    e.target.value = '';
  });
  document.querySelectorAll('.swatch').forEach(s => {
    s.addEventListener('click', async () => {
      document.querySelectorAll('.swatch').forEach(x => x.classList.remove('active'));
      s.classList.add('active');
      await applyTheme(s.dataset.t);
    });
  });

  $('header-refresh').addEventListener('click', () => location.reload());

  // Restore session
  if (HAS_FS_API) {
    const handle = await loadDirHandle();
    if (handle) { enterApp(); return; }
  } else {
    const stored = await loadEntriesIDB();
    if (stored.length) { enterApp(); return; }
  }

  await runOnboarding();
}

init();
