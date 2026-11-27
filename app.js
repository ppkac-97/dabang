/* 다방 Dabang — đọc báo Naver, ôn TOPIK, kho từ vựng. Dùng 1 mình, dữ liệu nằm trong repo GitHub riêng tư. */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const CATS = ['경제', '사회', '생활/문화'];
const CAT_VI = { '경제': 'Kinh tế', '사회': 'Xã hội', '생활/문화': 'Đời sống – Văn hoá' };

/* ---------------- lưu trữ cục bộ ---------------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('dabang.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('dabang.' + k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem('dabang.' + k); } catch { } },
};
let cfg = Object.assign({ owner: '', repo: 'dabang-data', branch: 'main', token: '', gemini: '', fs: 18 }, store.get('cfg', {}));
let notes = store.get('notes', []);           // [{id,ko,vi,articleId,articleTitle,para,ctx,createdAt,updatedAt,deleted}]
let readSet = new Set(store.get('read', []));
let newsIndex = store.get('index', null);     // {updated, items:[]}
let topik = null;                             // {vocab,grammar,idiom}
const live = () => notes.filter(n => !n.deleted);
const hasRepo = () => cfg.owner && cfg.repo && cfg.token;

function saveCfg() { store.set('cfg', cfg); document.documentElement.style.setProperty('--fs', cfg.fs + 'px'); }
function saveNotes() { store.set('notes', notes); scheduleSync(); }

/* ---------------- toast / sheet ---------------- */
let toastT;
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}
function openSheet(html, onMount) {
  const veil = $('#veil'), sh = $('#sheet');
  sh.innerHTML = '<div class="grab"></div>' + html;
  veil.classList.remove('hidden'); sh.classList.remove('hidden');
  requestAnimationFrame(() => { veil.classList.add('show'); sh.classList.add('show'); });
  onMount && onMount(sh);
}
function closeSheet() {
  const veil = $('#veil'), sh = $('#sheet');
  veil.classList.remove('show'); sh.classList.remove('show');
  setTimeout(() => { veil.classList.add('hidden'); sh.classList.add('hidden'); sh.innerHTML = ''; }, 250);
}

/* ---------------- GitHub API ---------------- */
const b64enc = s => { const b = new TextEncoder().encode(s); let r = ''; for (let i = 0; i < b.length; i += 0x8000) r += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(r); };
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
async function gh(path, { raw = true, method = 'GET', body, fresh = false } = {}) {
  const url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}` +
    (method === 'GET' ? `?ref=${encodeURIComponent(cfg.branch)}${fresh ? '&t=' + Date.now() : ''}` : '');
  const r = await fetch(url, {
    method, cache: fresh ? 'no-store' : 'default',
    headers: { Authorization: 'Bearer ' + cfg.token, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) { const e = new Error('GitHub ' + r.status); e.status = r.status; throw e; }
  return raw && method === 'GET' ? r.text() : r.json();
}

/* ---- đồng bộ kho từ ↔ notes.json (gộp theo id, bản mới hơn thắng) ---- */
let syncT, syncing = false, syncAgain = false;
function scheduleSync() { if (!hasRepo()) return; clearTimeout(syncT); syncT = setTimeout(syncNotes, 1500); }
function mergeNotes(a, b) {
  const m = new Map();
  for (const n of [...a, ...b]) { const o = m.get(n.id); if (!o || (n.updatedAt || 0) > (o.updatedAt || 0)) m.set(n.id, n); }
  return [...m.values()].sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
}
async function syncNotes(quiet = true) {
  if (!hasRepo()) return false;
  if (syncing) { syncAgain = true; return; }
  syncing = true; setSyncDot('busy');
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      let sha, remote = [];
      try {
        const meta = await gh('notes.json', { raw: false, fresh: true });
        sha = meta.sha;
        const txt = meta.content ? b64dec(meta.content) : await gh('notes.json', { fresh: true });
        remote = (JSON.parse(txt || '{}').notes) || [];
      } catch (e) { if (e.status !== 404) throw e; }
      const merged = mergeNotes(remote, notes);
      const same = JSON.stringify(mergeNotes(remote, [])) === JSON.stringify(merged);
      notes = merged; store.set('notes', notes);
      if (same && sha) break;
      try {
        await gh('notes.json', {
          method: 'PUT', raw: false,
          body: { message: 'notes ' + new Date().toISOString().slice(0, 16), content: b64enc(JSON.stringify({ updated: Date.now(), notes }, null, 0)), sha, branch: cfg.branch },
        });
        break;
      } catch (e) { if (e.status !== 409 && e.status !== 422) throw e; }
    }
    store.set('lastSync', Date.now()); setSyncDot('ok');
    if (!quiet) toast('Đã đồng bộ kho từ ✓');
    if (route.name === 'vault') renderVault();
    return true;
  } catch (e) {
    setSyncDot('bad'); if (!quiet) toast('Đồng bộ lỗi: ' + e.message); return false;
  } finally {
    syncing = false; if (syncAgain) { syncAgain = false; scheduleSync(); }
  }
}
function setSyncDot(s) { const d = $('#syncdot'); if (d) d.dataset.s = s; }

/* ---------------- Gemini (tuỳ chọn, chạy trên máy) ---------------- */
async function gemini(prompt, json = false) {
  const models = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-flash-lite-latest'];
  let last;
  for (const m of models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.gemini },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: json ? { responseMimeType: 'application/json', temperature: .2 } : { temperature: .2 } }),
      });
      if (!r.ok) { last = new Error('Gemini ' + r.status); if (r.status === 404 || r.status === 429 || r.status >= 500) continue; throw last; }
      const d = await r.json();
      return d.candidates[0].content.parts.map(p => p.text || '').join('');
    } catch (e) { last = e; }
  }
  throw last;
}

/* ---------------- dữ liệu TOPIK ---------------- */
async function loadTopik() {
  if (topik) return topik;
  const r = await fetch('topik.json');
  topik = await r.json();
  return topik;
}

/* ---------------- router ---------------- */
let route = { name: 'news' };
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [p, q] = h.split('?'); const parts = p.split('/').filter(Boolean);
  const params = new URLSearchParams(q || '');
  if (parts[0] === 'a' && parts[1]) return { name: 'article', id: parts[1], params };
  if (parts[0] === 'topik') return { name: 'topik', tab: parts[1] || 'vocab', params };
  if (parts[0] === 'vault') return { name: 'vault', params };
  if (parts[0] === 'settings') return { name: 'settings', params };
  return { name: 'news', cat: params.get('cat') || '', params };
}
const SUB = { news: 'Đọc báo · 신문 읽기', article: 'Đọc báo · 신문 읽기', topik: 'Ôn thi TOPIK', vault: 'Kho từ của tôi', settings: 'Cài đặt' };
function go(h) { if (location.hash === h) render(); else location.hash = h; }
async function render() {
  route = parseHash();
  $('#sub').textContent = SUB[route.name];
  $$('.nav button').forEach(b => b.classList.toggle('on', b.dataset.go === (route.name === 'article' ? 'news' : route.name)));
  hideNoteBar();
  const main = $('#main');
  if (route.name !== 'article') window.scrollTo(0, 0);
  if (route.name === 'news') return renderNews(main);
  if (route.name === 'article') return renderArticle(main, route.id);
  if (route.name === 'topik') return renderTopik(main);
  if (route.name === 'vault') return renderVault(main);
  if (route.name === 'settings') return renderSettings(main);
}

/* ---------------- minh hoạ ---------------- */
const CAT_SVG = `<svg viewBox="0 0 200 130" fill="none" stroke="#6e4129" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
<path d="M18 112h164" stroke="#c8955c"/><rect x="30" y="86" width="74" height="26" rx="3" fill="#fffaf3"/><path d="M38 95h40M38 103h56" stroke="#c8955c"/>
<path d="M120 112c-4-18 2-36 16-42 2-10 0-18 4-22l6 12c6-2 10-2 16 0l6-12c4 4 2 12 4 22 12 6 18 24 14 42" fill="#fffaf3"/>
<path d="M146 82c2 2 4 2 6 0M160 82c2 2 4 2 6 0" /><path d="M154 90l2 2 2-2"/>
<path d="M190 104c8-4 8-16-2-18" /><path d="M60 78c0-8 6-8 6-16M72 78c0-8 6-8 6-16" stroke="#c8955c"/></svg>`;
const CUP_CAT = `<svg viewBox="0 0 92 60" fill="none" stroke="#8b5a3c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
<path d="M14 26h34v10a17 17 0 0 1-34 0z" fill="#fffaf3"/><path d="M48 30h4a6 6 0 0 1 0 12h-6"/><path d="M8 56h48"/>
<path d="M62 56c-2-10 0-18 6-22 0-6-1-9 1-12l4 6h4l4-6c2 3 1 6 1 12 6 4 6 14 4 22" fill="#fffaf3"/><path d="M22 20c0-5 4-5 4-10M32 20c0-5 4-5 4-10" stroke="#c8955c"/></svg>`;

/* =========================================================== ĐỌC BÁO */
function relTime(d) {
  if (!d) return '';
  const t = new Date(d.replace(' ', 'T') + '+09:00'); const s = (Date.now() - t) / 1000;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' phút trước';
  if (s < 86400) return Math.round(s / 3600) + ' giờ trước';
  return t.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}
async function refreshIndex(force) {
  if (!hasRepo()) return;
  const txt = await gh('news/index.json', { fresh: true });
  newsIndex = JSON.parse(txt); store.set('index', newsIndex); store.set('indexAt', Date.now());
  prefetch();
}
async function prefetch() {
  const ids = (newsIndex?.items || []).slice(0, 18).map(x => x.id).filter(id => !store.get('art.' + id));
  for (const id of ids) { try { await getArticle(id); } catch { break; } }
}
async function getArticle(id) {
  let a = store.get('art.' + id);
  if (a) return a;
  a = JSON.parse(await gh(`news/a/${id}.json`));
  if (!store.set('art.' + id, a)) { pruneCache(); store.set('art.' + id, a); }
  return a;
}
function pruneCache() {
  const keepIds = new Set([...(newsIndex?.items || []).slice(0, 40).map(x => x.id), ...live().map(n => n.articleId)]);
  try { Object.keys(localStorage).filter(k => k.startsWith('dabang.art.') && !keepIds.has(k.slice(11))).forEach(k => localStorage.removeItem(k)); } catch { }
}

function renderNews(main) {
  if (!hasRepo()) {
    main.innerHTML = `<div class="empty">${CAT_SVG}<h3>Quán chưa mở cửa</h3><p>Vào <b>Cài đặt</b> nhập tài khoản GitHub và mã truy cập để mèo mang báo tới mỗi sáng.</p>
      <button class="btn" onclick="go('#/settings')">Mở Cài đặt</button></div>`;
    return;
  }
  const cat = route.cat;
  const draw = () => {
    const items = (newsIndex?.items || []).filter(x => !cat || x.cat === cat);
    const counts = Object.fromEntries(CATS.map(c => [c, (newsIndex?.items || []).filter(x => x.cat === c).length]));
    const noteCount = id => live().filter(n => n.articleId === id).length;
    main.innerHTML = `
      <div class="chips">${['', ...CATS].map(c => `<button class="chip ${c === cat ? 'on' : ''}" onclick="go('#/news${c ? '?cat=' + encodeURIComponent(c) : ''}')">${c ? esc(CAT_VI[c]) + ` <span class="muted" style="color:inherit;opacity:.7">${counts[c] || 0}</span>` : 'Tất cả'}</button>`).join('')}</div>
      <div class="updated"><span>${newsIndex ? 'Cập nhật ' + esc(new Date(newsIndex.updated).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })) : ''}</span><span id="idxstate"></span></div>
      ${items.length ? items.map(x => `
        <button class="card ${readSet.has(x.id) ? 'read' : ''}" onclick="go('#/a/${x.id}')">
          <div class="txt"><h3>${esc(x.title)}</h3>${x.title_vi ? `<div class="vi">${esc(x.title_vi)}</div>` : ''}
          <div class="meta"><span class="tag">${esc(CAT_VI[x.cat] || x.cat)}</span><span>${esc(x.press)}</span><span>· ${esc(relTime(x.date))}</span>
          ${noteCount(x.id) ? `<span class="badge">· ✎ ${noteCount(x.id)}</span>` : ''}${x.tr ? '' : '<span class="badge">· chưa dịch</span>'}</div></div>
          ${x.img ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(x.img)}" alt="" onerror="this.remove()">` : ''}
        </button>`).join('') : `<div class="empty">${CAT_SVG}<p>${newsIndex ? 'Chưa có bài ở mục này.' : 'Đang lấy báo…'}</p></div>`}`;
  };
  draw();
  const age = Date.now() - store.get('indexAt', 0);
  if (!newsIndex || age > 5 * 60e3) {
    const st = $('#idxstate'); if (st) st.innerHTML = '<span class="spin"></span>';
    refreshIndex().then(() => { if (route.name === 'news') draw(); }).catch(e => {
      const st = $('#idxstate'); if (st) st.textContent = e.status === 404 ? 'Chưa có báo — chờ GitHub chạy lần đầu' : 'Không tải được (' + e.message + ')';
    });
  }
}

/* ---- tô sáng ghi chú trong đoạn văn ---- */
function markup(text, own, others) {
  const terms = [...own.map(n => ({ t: n.ko, n, c: 'hl' })), ...others.map(n => ({ t: n.ko, n, c: 'hl2' }))]
    .filter(x => x.t && x.t.length >= 1).sort((a, b) => b.t.length - a.t.length);
  const taken = []; const hits = [];
  for (const x of terms) {
    let i = 0;
    while ((i = text.indexOf(x.t, i)) !== -1) {
      const j = i + x.t.length;
      if (!taken.some(([a, b]) => i < b && j > a)) { taken.push([i, j]); hits.push({ i, j, x }); }
      i = j;
    }
  }
  hits.sort((a, b) => a.i - b.i);
  let out = '', p = 0;
  for (const h of hits) { out += esc(text.slice(p, h.i)) + `<mark class="${h.x.c}" data-n="${h.x.n.id}">${esc(text.slice(h.i, h.j))}</mark>`; p = h.j; }
  return out + esc(text.slice(p));
}

let curArt = null;
async function renderArticle(main, id) {
  main.innerHTML = `<button class="back" onclick="history.length>1?history.back():go('#/news')">‹ Danh sách</button><div class="empty"><span class="spin"></span></div>`;
  let a;
  try { a = await getArticle(id); } catch (e) {
    main.innerHTML = `<button class="back" onclick="go('#/news')">‹ Danh sách</button><div class="empty">${CAT_SVG}<p>Không mở được bài (${esc(e.message)}).</p></div>`; return;
  }
  if (route.name !== 'article' || route.id !== id) return;
  curArt = a; readSet.add(id); store.set('read', [...readSet].slice(-600));
  const isSub = (p, i) => i < 3 && p.length < 70 && !/[.다]$/.test(p.trim());
  main.innerHTML = `
    <button class="back" onclick="history.length>1?history.back():go('#/news')">‹ Danh sách</button>
    <article class="art">
      <div class="meta"><span class="tag">${esc(CAT_VI[a.cat] || a.cat)}</span><span>${esc(a.press)}</span><span>· ${esc(a.date.slice(0, 16))}</span></div>
      <h2>${esc(a.title)}</h2>
      ${a.img ? `<img class="hero" referrerpolicy="no-referrer" src="${esc(a.img)}" alt="" onerror="this.remove()">` : ''}
      ${live().length ? '' : '<div class="hint">Mẹo: bôi đen một từ / cụm từ rồi bấm <b>＋ Ghi chú</b>. Từ đã ghi sẽ có nền vàng — chạm vào để xem nghĩa.</div>'}
      <div class="art-body" id="artBody">${a.paras.map((p, i) => `<p data-p="${i}" class="${isSub(p, i) ? 'sub' : ''}"></p>`).join('')}</div>
      <div class="tr-box" id="trBox">
        <button class="tr-head" onclick="toggleTr()"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 5h9M8.5 3v2M6 5c.8 3.6 3.2 6.2 6 7.5M11 5c-.8 3.2-3.4 6.6-7 8"/><path d="M13 21l4-10 4 10M14.5 17.5h5"/></svg>
          <span class="t">Xem bản dịch tiếng Việt</span><svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></button>
        <div class="tr-body" id="trBody"></div>
      </div>
      <p class="muted" style="font-size:12.5px;margin-top:16px">Nguồn: <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.press)} · Naver News</a></p>
    </article>`;
  paintArticle();
}
let interleave = store.get('interleave', false);
function paintArticle() {
  const a = curArt; if (!a) return;
  const own = live().filter(n => n.articleId === a.id);
  const others = live().filter(n => n.articleId !== a.id && n.ko.length >= 2);
  $$('#artBody p').forEach(p => {
    const i = +p.dataset.p;
    p.innerHTML = markup(a.paras[i], own, others) + (interleave && a.paras_vi?.[i] ? `<span class="pvi">${esc(a.paras_vi[i])}</span>` : '');
  });
  const body = $('#trBody');
  if (body) {
    if (a.paras_vi?.length && a.paras_vi.some(Boolean)) {
      body.innerHTML = `<div class="tr-opts"><button class="btn small ghost" onclick="toggleInterleave()">${interleave ? 'Tắt song ngữ từng đoạn' : 'Hiện song ngữ từng đoạn'}</button></div>
        <h4>${esc(a.title_vi)}</h4>${a.paras_vi.map(t => `<p>${esc(t)}</p>`).join('')}
        <p class="muted" style="font-size:12px">Dịch tự động bằng Gemini — có thể chưa sát nghĩa từng chữ.</p>`;
    } else {
      body.innerHTML = `<p class="muted">Bài này chưa có bản dịch.</p><div class="row">
        ${cfg.gemini ? '<button class="btn small" id="trNow" onclick="translateNow()">Dịch ngay bằng Gemini</button>' : ''}
        <a class="btn small ghost" target="_blank" rel="noopener" href="https://papago.naver.com/?sk=ko&tk=vi&st=${encodeURIComponent(a.title + '\n' + a.paras.slice(0, 6).join('\n')).slice(0, 4500)}">Mở Papago</a></div>`;
    }
  }
}
function toggleTr() { $('#trBox').classList.toggle('open'); }
function toggleInterleave() { interleave = !interleave; store.set('interleave', interleave); paintArticle(); $('#trBox').classList.add('open'); }
async function translateNow() {
  const a = curArt; const b = $('#trNow'); if (b) { b.disabled = true; b.innerHTML = '<span class="spin"></span> Đang dịch…'; }
  try {
    const src = `TIÊU ĐỀ: ${a.title}\n\n` + a.paras.map((p, i) => `[${i}] ${p}`).join('\n\n');
    const out = JSON.parse(await gemini(`Dịch bài báo tiếng Hàn sau sang tiếng Việt tự nhiên, chính xác. Trả JSON {"title_vi":string,"paras_vi":string[]} với paras_vi có đúng ${a.paras.length} phần tử theo thứ tự đoạn.\n\n${src}`, true));
    a.title_vi = out.title_vi || ''; a.paras_vi = (out.paras_vi || []).map(String);
    store.set('art.' + a.id, a); paintArticle(); $('#trBox').classList.add('open');
  } catch (e) { toast('Dịch lỗi: ' + e.message); if (b) { b.disabled = false; b.textContent = 'Thử lại'; } }
}

/* ---- bôi đen → ghi chú ---- */
let pendingSel = null;
function onSelChange() {
  if (route.name !== 'article') return;
  const s = document.getSelection();
  const txt = s ? s.toString().replace(/\s+/g, ' ').trim() : '';
  if (!txt || txt.length > 80 || !s.anchorNode) { if (!txt) setTimeout(() => { if (!document.getSelection().toString().trim()) hideNoteBar(); }, 250); return; }
  const el = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement;
  const p = el && el.closest('#artBody p');
  if (!p) return;
  pendingSel = { text: txt, para: +p.dataset.p };
  const bar = $('#notebar'); bar.querySelector('span').textContent = txt; bar.classList.remove('hidden');
}
function hideNoteBar() { $('#notebar')?.classList.add('hidden'); }
function sentenceOf(text, term) {
  const i = text.indexOf(term); if (i < 0) return text.slice(0, 160);
  let a = i, b = i + term.length;
  while (a > 0 && !/[.?!。…"”]\s/.test(text.slice(a - 2, a))) a--;
  while (b < text.length && !/[.?!。]/.test(text[b - 1] || '')) b++;
  return text.slice(a, b).trim();
}
function suggestions(ko) {
  const stem = w => w.replace(/(하다|되다|이다|다)$/, '').replace(/\s+/g, ' ');
  const s = stem(ko); if (s.length < 1) return [];
  const pool = [...live(), ...(topik ? [...topik.vocab, ...topik.idiom, ...topik.grammar] : [])];
  const out = []; const seen = new Set();
  for (const x of pool) {
    const k = x.ko || ''; const ks = stem(k);
    if (!ks) continue;
    if ((ks.length >= 2 && ko.includes(ks)) || (s.length >= 2 && k.includes(s))) {
      const key = k + '|' + x.vi; if (seen.has(key)) continue; seen.add(key); out.push(x);
      if (out.length >= 4) break;
    }
  }
  return out;
}
async function openNoteEditor(n, fromSel) {
  await loadTopik().catch(() => { });
  const a = curArt;
  const isNew = !n;
  n = n || { id: uid(), ko: fromSel.text, vi: '', articleId: a?.id, articleTitle: a?.title, para: fromSel.para, createdAt: Date.now() };
  const paraKo = a && a.id === n.articleId ? a.paras[n.para] : '';
  const paraVi = a && a.id === n.articleId ? (a.paras_vi?.[n.para] || '') : '';
  const ctx = n.ctx || (paraKo ? sentenceOf(paraKo, n.ko) : '');
  const sugg = suggestions(n.ko);
  openSheet(`
    <h3>${isNew ? 'Ghi chú từ mới' : 'Sửa ghi chú'}</h3>
    <div class="field"><label>Từ / cụm từ</label><input class="ko" id="nKo" value="${esc(n.ko)}" autocomplete="off"></div>
    <div class="field"><label>Nghĩa / ghi chú của tôi</label><textarea id="nVi" placeholder="Nghĩa tiếng Việt, cách dùng…">${esc(n.vi)}</textarea></div>
    ${sugg.length ? `<label style="font-size:12.5px;color:var(--ink2);font-weight:600">Gợi ý từ kho & TOPIK (chạm để điền)</label><div class="sugg">${sugg.map((x, i) => `<button data-i="${i}"><b>${esc(x.ko)}</b>${esc(x.vi)}</button>`).join('')}</div>` : ''}
    <div class="row" style="margin-bottom:12px">
      ${cfg.gemini ? '<button class="btn small ghost" id="nAi">✨ Gemini gợi ý nghĩa</button>' : ''}
      <a class="btn small ghost" target="_blank" rel="noopener" href="https://dict.naver.com/vikodict/#/search?query=${encodeURIComponent(n.ko)}">Từ điển Naver</a>
      <a class="btn small ghost" target="_blank" rel="noopener" href="https://papago.naver.com/?sk=ko&tk=vi&st=${encodeURIComponent(n.ko)}">Papago</a>
    </div>
    ${ctx ? `<div class="ctx"><div class="ko">${markup(ctx, [n], [])}</div>${paraVi ? `<details style="margin-top:6px"><summary class="muted" style="font-size:12.5px">Dịch cả đoạn</summary>${esc(paraVi)}</details>` : ''}</div>` : ''}
    <div class="row" style="justify-content:space-between">
      ${isNew ? '<span></span>' : '<button class="btn danger small" id="nDel">Xoá</button>'}
      <div class="row"><button class="btn ghost" onclick="closeSheet()">Huỷ</button><button class="btn" id="nSave">Lưu vào kho</button></div>
    </div>`, sh => {
    $$('.sugg button', sh).forEach(b => b.onclick = () => { const x = sugg[+b.dataset.i]; const t = $('#nVi'); t.value = (t.value ? t.value + '\n' : '') + x.vi + (x.ko !== $('#nKo').value ? ` (${x.ko})` : ''); });
    const ai = $('#nAi', sh);
    if (ai) ai.onclick = async () => {
      ai.disabled = true; ai.innerHTML = '<span class="spin"></span>';
      try {
        const t = await gemini(`Người học tiếng Hàn (TOPIK 5-6) muốn biết nghĩa của "${$('#nKo').value}" trong câu: "${ctx}". Trả lời bằng tiếng Việt, ngắn gọn tối đa 3 dòng: (1) nghĩa trong câu này, (2) dạng gốc/từ điển + Hán Việt nếu có, (3) 1 cách dùng/cụm hay đi kèm. Không mở đầu, không markdown.`);
        const v = $('#nVi'); v.value = (v.value ? v.value + '\n' : '') + t.trim();
      } catch (e) { toast('Gemini lỗi: ' + e.message); }
      ai.disabled = false; ai.textContent = '✨ Gemini gợi ý nghĩa';
    };
    $('#nSave', sh).onclick = () => {
      const ko = $('#nKo').value.trim(); if (!ko) return toast('Chưa có từ');
      Object.assign(n, { ko, vi: $('#nVi').value.trim(), ctx: ctx && ctx.includes(ko) ? ctx : (paraKo ? sentenceOf(paraKo, ko) : ctx), updatedAt: Date.now(), deleted: false });
      notes = notes.filter(x => x.id !== n.id); notes.unshift(n); saveNotes();
      closeSheet(); document.getSelection()?.removeAllRanges(); hideNoteBar();
      toast(isNew ? 'Đã lưu vào kho từ ✓' : 'Đã cập nhật ✓');
      if (route.name === 'article') paintArticle(); else if (route.name === 'vault') renderVault();
    };
    const del = $('#nDel', sh);
    if (del) del.onclick = () => {
      if (!confirm('Xoá ghi chú "' + n.ko + '"?')) return;
      n.deleted = true; n.updatedAt = Date.now(); saveNotes(); closeSheet(); toast('Đã xoá');
      if (route.name === 'article') paintArticle(); else if (route.name === 'vault') renderVault();
    };
    if (isNew) setTimeout(() => $('#nVi')?.focus(), 300);
  });
}
function showNote(id) {
  const n = notes.find(x => x.id === id); if (!n) return;
  openSheet(`<p class="pop-ko">${esc(n.ko)}</p><p class="pop-vi">${n.vi ? esc(n.vi) : '<span class="muted">(chưa ghi nghĩa)</span>'}</p>
    ${n.ctx ? `<div class="ctx ko">${markup(n.ctx, [n], [])}</div>` : ''}
    ${curArt && n.articleId !== curArt.id && n.articleTitle ? `<p class="muted" style="font-size:12.5px">Đã ghi ở bài: <a href="#/a/${esc(n.articleId)}" onclick="closeSheet()">${esc(n.articleTitle)}</a></p>` : ''}
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" onclick="closeSheet()">Đóng</button><button class="btn" id="pEdit">Sửa</button></div>`,
    sh => { $('#pEdit', sh).onclick = () => { closeSheet(); setTimeout(() => openNoteEditor(n), 260); }; });
}

/* =========================================================== ÔN TOPIK */
const TABS = { vocab: 'Từ vựng', grammar: 'Ngữ pháp', idiom: 'Quán dụng ngữ' };
let topikLimit = 60;
function matchItem(x, q, qf) {
  if (!q) return true;
  return [x.ko, x.ex].some(s => (s || '').includes(q)) || [x.vi, x.hv, x.exvi, x.note, x.g, x.t].some(s => fold(s).includes(qf));
}
async function renderTopik(main) {
  main = main || $('#main');
  main.innerHTML = '<div class="empty"><span class="spin"></span></div>';
  try { await loadTopik(); } catch { main.innerHTML = '<div class="empty">Không tải được dữ liệu TOPIK.</div>'; return; }
  const tab = TABS[route.tab] ? route.tab : 'vocab';
  const q = route.params.get('q') || '';
  main.innerHTML = `
    <div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <input id="tq" type="search" placeholder="Tìm tiếng Hàn, nghĩa, Hán Việt…" value="${esc(q)}" autocomplete="off"><button class="clear ${q ? '' : 'hidden'}" id="tqx">×</button></div>
    <div class="seg" id="tseg"></div><div id="tlist"></div>`;
  const draw = () => {
    const qv = $('#tq').value.trim(), qf = fold(qv);
    $('#tqx').classList.toggle('hidden', !qv);
    const res = {}; for (const k in TABS) res[k] = topik[k].filter(x => matchItem(x, qv, qf));
    $('#tseg').innerHTML = Object.entries(TABS).map(([k, v]) => `<button class="${k === tab ? 'on' : ''}" data-k="${k}">${v}<b>${res[k].length}</b></button>`).join('');
    $$('#tseg button').forEach(b => b.onclick = () => { topikLimit = 60; location.replace(`#/topik/${b.dataset.k}${qv ? '?q=' + encodeURIComponent(qv) : ''}`); });
    const list = res[tab]; const shown = list.slice(0, topikLimit);
    let html = '', lastT = '', lastG = '';
    for (const x of shown) {
      if (x.t !== lastT) { html += `<div class="topic-h">${esc(x.t)}</div>`; lastT = x.t; lastG = ''; }
      if (x.g && x.g !== lastG) { html += `<div class="group-h">${esc(x.g)}</div>`; lastG = x.g; }
      // ví dụ: câu đề TOPIK thật (có nhãn nguồn) trước, câu tự soạn sau
      const exs = (x.src ? `<div class="src">📝 ${esc(x.src)}</div>` : '')
        + (x.ex ? `<div class="ex">${esc(x.ex)}</div>` : '') + (x.exvi ? `<div class="exvi">${esc(x.exvi)}</div>` : '')
        + (x.ex2 ? `<div class="src alt">Ví dụ khác</div><div class="ex">${esc(x.ex2)}</div>${x.exvi2 ? `<div class="exvi">${esc(x.exvi2)}</div>` : ''}` : '')
        + (x.ex0 ? `<div class="ex">${esc(x.ex0)}</div>` : '');
      html += tab === 'grammar'
        ? `<div class="item"><div class="k">${esc(x.ko)}</div><div class="v">${esc(x.vi)}</div>${exs}${x.note ? `<div class="note"><b>Cách dùng:</b> ${esc(x.note)}</div>` : ''}</div>`
        : `<div class="item"><div class="k">${esc(x.ko)}${x.hv ? `<span class="hv">${esc(x.hv)}</span>` : ''}</div><div class="v">${esc(x.vi)}</div>${exs}</div>`;
    }
    if (!list.length) html = `<div class="empty"><p>Không tìm thấy “${esc(qv)}” trong ${TABS[tab].toLowerCase()}.</p></div>`;
    if (list.length > shown.length) html += `<button class="btn ghost more" id="tmore">Xem thêm (${list.length - shown.length})</button>`;
    $('#tlist').innerHTML = html;
    const m = $('#tmore'); if (m) m.onclick = () => { topikLimit += 120; draw(); };
  };
  let t; $('#tq').oninput = () => { clearTimeout(t); t = setTimeout(() => { topikLimit = 60; history.replaceState(null, '', `#/topik/${tab}${$('#tq').value.trim() ? '?q=' + encodeURIComponent($('#tq').value.trim()) : ''}`); draw(); }, 160); };
  $('#tqx').onclick = () => { $('#tq').value = ''; $('#tq').oninput(); };
  draw();
}

/* =========================================================== KHO TỪ */
let reviewItem = null, reviewShown = false;
function pickReview() {
  const pool = live();
  const t = topik;
  const r = Math.random();
  if (pool.length && (r < .55 || !t)) { const n = pool[Math.floor(Math.random() * pool.length)]; return { lbl: 'Từ tôi đã ghi', ko: n.ko, vi: n.vi, id: n.id }; }
  if (!t) return null;
  const k = r < .78 ? 'vocab' : r < .9 ? 'grammar' : 'idiom';
  const real = t[k].filter(y => y.src), arr = real.length && Math.random() < .6 ? real : t[k];  // ưu tiên câu đề thật
  const x = arr[Math.floor(Math.random() * arr.length)];
  return { lbl: TABS[k], ko: x.ko, vi: x.vi + (x.hv ? ' · ' + x.hv : ''), ex: x.ex, exvi: x.exvi, src: x.src };
}
async function renderVault(main) {
  main = main || $('#main');
  if (route.name !== 'vault') return;
  loadTopik().then(() => { if (!reviewItem) { reviewItem = pickReview(); drawReview(); } }).catch(() => { });
  const q = route.params.get('q') || '';
  const all = live();
  const week = all.filter(n => Date.now() - n.createdAt < 7 * 864e5).length;
  main.innerHTML = `
    <div class="review" id="review"></div>
    <div class="stats"><div class="stat"><b>${all.length}</b><span>từ trong kho</span></div><div class="stat"><b>${week}</b><span>ghi tuần này</span></div>
      <div class="stat"><b>${new Set(all.map(n => n.articleId)).size}</b><span>bài đã ghi</span></div></div>
    <div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <input id="vq" type="search" placeholder="Tìm trong kho từ…" value="${esc(q)}" autocomplete="off"><button class="clear ${q ? '' : 'hidden'}" id="vqx">×</button></div>
    <div id="vlist"></div>`;
  drawReview();
  const draw = () => {
    const qv = $('#vq').value.trim(), qf = fold(qv);
    $('#vqx').classList.toggle('hidden', !qv);
    const list = all.filter(n => !qv || n.ko.includes(qv) || (n.ctx || '').includes(qv) || fold(n.vi).includes(qf) || fold(n.articleTitle).includes(qf));
    $('#vlist').innerHTML = list.length ? list.map(n => `
      <div class="item vault" data-id="${n.id}"><div class="k">${esc(n.ko)}</div><div class="v">${n.vi ? esc(n.vi).replace(/\n/g, '<br>') : '<span class="muted">(chưa ghi nghĩa)</span>'}</div>
        ${n.ctx ? `<div class="ex">${markup(n.ctx, [n], [])}</div>` : ''}
        ${n.articleId ? `<div class="src">📰 <a href="#/a/${esc(n.articleId)}" onclick="event.stopPropagation()">${esc((n.articleTitle || '').slice(0, 60))}</a><span>· ${new Date(n.createdAt).toLocaleDateString('vi-VN')}</span></div>` : ''}
      </div>`).join('') : `<div class="empty">${all.length ? `<p>Không có “${esc(qv)}” trong kho.</p>` : CAT_SVG + '<h3>Kho còn trống</h3><p>Bôi đen từ khi đọc báo rồi bấm “＋ Ghi chú” — từ sẽ tự về đây.</p>'}</div>`;
    $$('#vlist .item').forEach(el => el.onclick = () => openNoteEditor(notes.find(x => x.id === el.dataset.id)));
  };
  let t; $('#vq').oninput = () => { clearTimeout(t); t = setTimeout(() => { history.replaceState(null, '', '#/vault' + ($('#vq').value.trim() ? '?q=' + encodeURIComponent($('#vq').value.trim()) : '')); draw(); }, 150); };
  $('#vqx').onclick = () => { $('#vq').value = ''; $('#vq').oninput(); };
  draw();
}
function drawReview() {
  const el = $('#review'); if (!el) return;
  const r = reviewItem;
  el.innerHTML = r ? `<div class="lbl">Ôn nhanh · ${esc(r.lbl)}</div><div class="k">${esc(r.ko)}</div>
      <div class="v ${reviewShown ? '' : 'blur'}" id="rv">${esc(r.vi || '…')}</div>
      ${r.ex ? `<div class="ex ko" style="margin-top:6px;font-size:15px">${esc(r.ex)}</div>${r.exvi ? `<div class="exvi ${reviewShown ? '' : 'blur'}" style="font-size:13px">${esc(r.exvi)}</div>` : ''}` : ''}${r.src ? `<div style="font-size:11px;color:var(--ink3);margin-top:3px">📝 ${esc(r.src)}</div>` : ''}
      <div class="row"><button class="btn small" id="rShow">${reviewShown ? 'Ẩn nghĩa' : 'Xem nghĩa'}</button><button class="btn small ghost" id="rNext">Câu khác ↻</button></div>${CUP_CAT.replace('<svg', '<svg class="cat"')}`
    : `<div class="lbl">Ôn nhanh</div><div class="k">…</div>${CUP_CAT.replace('<svg', '<svg class="cat"')}`;
  const s = $('#rShow'); if (s) s.onclick = () => { reviewShown = !reviewShown; drawReview(); };
  const n = $('#rNext'); if (n) n.onclick = () => { reviewItem = pickReview(); reviewShown = false; drawReview(); };
  const v = $('#rv'); if (v) v.onclick = () => { reviewShown = true; drawReview(); };
}

/* =========================================================== CÀI ĐẶT */
function renderSettings(main) {
  const last = store.get('lastSync', 0);
  main.innerHTML = `
    <div class="set-sec"><h3>Kết nối GitHub</h3><p class="d">Báo và kho từ nằm trong repo riêng tư của bạn. Mã truy cập chỉ lưu trên máy này.</p>
      <div class="field"><label>Tên tài khoản GitHub</label><input id="sOwner" value="${esc(cfg.owner)}" autocapitalize="off" autocomplete="off" placeholder="vd: meo-doc-bao"></div>
      <div class="field"><label>Tên repo dữ liệu</label><input id="sRepo" value="${esc(cfg.repo)}" autocapitalize="off" autocomplete="off"></div>
      <div class="field"><label>Mã truy cập (Fine-grained token)</label><input id="sTok" type="password" value="${esc(cfg.token)}" autocomplete="off" placeholder="github_pat_…"></div>
      <div class="row"><button class="btn" id="sSave">Lưu & kiểm tra</button><button class="btn ghost" id="sSync">Đồng bộ kho từ</button></div>
      <div class="status" id="sStat">${last ? 'Đồng bộ lần cuối: ' + new Date(last).toLocaleString('vi-VN') : ''}</div></div>
    <div class="set-sec"><h3>Gemini (tuỳ chọn)</h3><p class="d">Khoá miễn phí ở aistudio.google.com → dùng cho “✨ gợi ý nghĩa” và dịch bài chưa có bản dịch.</p>
      <div class="field"><input id="sGem" type="password" value="${esc(cfg.gemini)}" autocomplete="off" placeholder="AIza…"></div>
      <button class="btn ghost" id="sGemSave">Lưu khoá Gemini</button></div>
    <div class="set-sec"><h3>Cỡ chữ bài báo</h3><input type="range" min="15" max="24" step="1" id="sFs" value="${cfg.fs}"><p class="ko" id="sFsDemo" style="font-size:${cfg.fs}px;margin:8px 0 0">한국은행이 기준금리를 인상했다.</p></div>
    <div class="set-sec"><h3>Widget màn hình khoá (iPhone)</h3><p class="d">Cài app miễn phí <b>Scriptable</b> → tạo script mới → dán mã này → thêm widget Scriptable vào màn hình khoá. Mã đã kèm sẵn thông tin kết nối của bạn.</p>
      <button class="btn" id="sWidget">Sao chép mã widget</button></div>
    <div class="set-sec"><h3>Sao lưu</h3><p class="d">Xuất / nhập kho từ dạng file JSON.</p>
      <div class="row"><button class="btn ghost" id="sExp">Xuất file</button><label class="btn ghost">Nhập file<input type="file" id="sImp" accept=".json,application/json" hidden></label></div></div>
    <p class="muted" style="font-size:12px;text-align:center">다방 Dabang · ${live().length} từ · bản ${APP_VER}</p>
    <button class="btn ghost" id="sUpd" style="display:block;margin:0 auto 12px">⟳ Tải bản mới nhất</button>`;
  $('#sSave').onclick = async () => {
    cfg.owner = $('#sOwner').value.trim(); cfg.repo = $('#sRepo').value.trim() || 'dabang-data'; cfg.token = $('#sTok').value.trim(); saveCfg();
    const st = $('#sStat'); st.className = 'status'; st.innerHTML = '<span class="spin"></span> Đang kiểm tra…';
    try {
      await refreshIndex(true).catch(e => { if (e.status !== 404) throw e; });
      const ok = await syncNotes(true);
      st.className = 'status ok'; st.textContent = `Kết nối được ✓ · ${newsIndex?.items?.length || 0} bài · ${live().length} từ` + (ok ? '' : ' (chưa ghi được kho từ — kiểm tra quyền Contents: Read and write)');
    } catch (e) {
      st.className = 'status bad';
      st.textContent = e.status === 401 ? 'Mã truy cập sai hoặc hết hạn.' : e.status === 404 ? 'Không thấy repo — kiểm tra tên tài khoản/repo và quyền của token.' : 'Lỗi: ' + e.message;
    }
  };
  $('#sSync').onclick = () => syncNotes(false);
  $('#sGemSave').onclick = () => { cfg.gemini = $('#sGem').value.trim(); saveCfg(); toast('Đã lưu khoá Gemini'); };
  $('#sFs').oninput = e => { cfg.fs = +e.target.value; saveCfg(); $('#sFsDemo').style.fontSize = cfg.fs + 'px'; };
  // iOS chỉ cho chép khi gọi NGAY trong lúc bấm (không được chờ tải mạng trước) → tải sẵn mã khi mở Cài đặt.
  let widgetSrc = null;
  const widgetLoad = fetch('widget.js', { cache: 'no-store' }).then(r => r.text()).then(t => (widgetSrc = t)).catch(() => null);
  const widgetCode = src => {
    const appUrl = location.href.split('#')[0].replace(/index\.html$/, '');
    const head = `const CONFIG = ${JSON.stringify({ owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, token: cfg.token, appUrl }, null, 2)};\n`;
    const code = src.replace(/\r\n/g, '\n').replace(/^const CONFIG = [\s\S]*?\};\n/m, head);
    return code.includes(head) ? code : head + code.replace(/^const CONFIG = [\s\S]*?\};/m, '');
  };
  const showWidgetCode = code => openSheet(`<h3 style="margin:0 0 6px">Mã widget</h3>
      <p class="d" style="margin:0 0 8px">Chạm vào ô dưới → giữ tay → <b>Chọn tất cả</b> → <b>Sao chép</b>, rồi dán vào Scriptable.</p>
      <textarea id="wCode" readonly style="width:100%;height:46vh;font:12px/1.4 ui-monospace,Menlo,monospace;border:1px solid #d9c9b4;border-radius:10px;padding:8px;background:#fffdf9"></textarea>
      <button class="btn" id="wCopy" style="margin-top:10px;width:100%">Thử sao chép lại</button>`, sh => {
    const ta = sh.querySelector('#wCode'); ta.value = code;
    const sel = () => { ta.focus(); ta.setSelectionRange(0, ta.value.length); };
    ta.onclick = sel;
    sh.querySelector('#wCopy').onclick = () => {
      sel(); let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) {}
      if (ok) { toast('Đã sao chép — mở Scriptable và dán vào script mới', 3500); closeSheet(); }
      else navigator.clipboard?.writeText(code).then(() => { toast('Đã sao chép', 2500); closeSheet(); }, () => toast('Chọn tất cả rồi bấm Sao chép bằng tay nhé'));
    };
  });
  $('#sWidget').onclick = () => {
    if (!cfg.owner || !cfg.token) toast('Lưu tài khoản + mã truy cập trước để widget đọc được kho từ', 3500);
    if (widgetSrc == null) { widgetLoad.then(s => s ? showWidgetCode(widgetCode(s)) : toast('Không tải được mã widget — kiểm tra mạng')); return; }
    const code = widgetCode(widgetSrc);
    const fail = () => showWidgetCode(code);
    try {
      if (!navigator.clipboard) return fail();
      navigator.clipboard.writeText(code).then(() => toast('Đã sao chép — mở Scriptable và dán vào script mới', 3500), fail);
    } catch (_) { fail(); }
  };
  // xoá bộ nhớ đệm vỏ app (không đụng kho từ / cài đặt trong localStorage) rồi tải lại
  $('#sUpd').onclick = async () => {
    toast('Đang tải bản mới…');
    try {
      const rs = await navigator.serviceWorker?.getRegistrations?.() || [];
      await Promise.all(rs.map(r => r.unregister()));
      const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k)));
    } catch (_) {}
    location.replace(location.pathname + '?v=' + Date.now() + '#/settings');
  };
  $('#sExp').onclick = async () => {
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), notes }, null, 1)], { type: 'application/json' });
    const name = `dabang-kho-tu-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch { } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  };
  $('#sImp').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const d = JSON.parse(await f.text()); const arr = Array.isArray(d) ? d : d.notes; if (!Array.isArray(arr)) throw new Error('sai định dạng'); notes = mergeNotes(notes, arr); saveNotes(); toast(`Đã nhập ✓ (${live().length} từ)`); renderSettings(main); }
    catch (err) { toast('File không hợp lệ: ' + err.message); }
  };
}

/* =========================================================== khởi động */
const APP_VER = '1.6';
function init() {
  saveCfg();
  $$('.nav button').forEach(b => b.onclick = () => go(b.dataset.go === 'news' ? '#/news' : b.dataset.go === 'topik' ? '#/topik' : '#/' + b.dataset.go));
  $('#gear').onclick = () => go('#/settings');
  $('#veil').onclick = closeSheet;
  document.addEventListener('selectionchange', onSelChange);
  const bar = $('#notebar');
  bar.addEventListener('pointerdown', e => e.preventDefault());
  bar.addEventListener('click', () => { if (pendingSel) openNoteEditor(null, pendingSel); });
  $('#main').addEventListener('click', e => {
    const m = e.target.closest('mark[data-n]');
    if (m && !document.getSelection().toString().trim()) showNote(m.dataset.n);
  });
  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && hasRepo()) syncNotes(true); });
  if (!location.hash) history.replaceState(null, '', hasRepo() ? '#/news' : '#/settings');
  render();
  if (hasRepo()) syncNotes(true);
  loadTopik().catch(() => { });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
}
document.addEventListener('DOMContentLoaded', init);
