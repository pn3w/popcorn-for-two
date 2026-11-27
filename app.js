import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

/* =========================================================
   ดูด้วยกัน — shared watch queue for two
   ========================================================= */

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const modalRoot = $('#modal-root');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const IMG = (p, size = 'w342') => (p ? `https://image.tmdb.org/t/p/${size}${p}` : '');
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const ICON = {
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  mark: '<svg class="mark" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2a2534"/><rect x="10" y="16" width="44" height="30" rx="5" fill="none" stroke="#f2b544" stroke-width="4"/><path d="M27 24l11 7-11 7z" fill="#f2b544"/><path d="M22 52h20" stroke="#f2b544" stroke-width="4" stroke-linecap="round"/></svg>',
};

const TABS = [
  { key: 'watching', label: 'กำลังดู' },
  { key: 'queue', label: 'คิว' },
  { key: 'done', label: 'ดูจบแล้ว' },
  { key: 'dropped', label: 'พักไว้' },
];
const STATUS_LABEL = { watching: 'กำลังดู', queue: 'อยู่ในคิว', done: 'ดูจบแล้ว', dropped: 'พักไว้' };
const AVATAR_COLORS = ['#f2b544', '#7cc4f5', '#f58bb4', '#8fe0a5', '#c3a6ff'];

const S = {
  db: null, user: null, hh: null,
  members: [], titles: [], reviews: [],
  tab: ls.get('wt_tab') || 'watching',
  modal: null, detail: null, results: [],
  pendingShare: null, unsub: null,
};

let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function errMsg(e) {
  const m = e?.message || String(e);
  if (e?.code === '23505') return 'มีเรื่องนี้อยู่ในลิสต์แล้ว';
  if (m === 'NO_TMDB') return 'ยังไม่ได้ใส่ TMDb API key (ตั้งค่า ⚙)';
  if (/invite code not found/i.test(m)) return 'ไม่พบรหัสเชิญนี้';
  if (/Invalid login credentials/i.test(m)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (/Email not confirmed/i.test(m)) return 'ยังไม่ได้ยืนยันอีเมล เช็คกล่องจดหมายก่อนนะ';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'เชื่อมต่อไม่ได้ ลองเช็คเน็ตหรือค่า Supabase';
  return m;
}

/* =========================================================
   Backends
   ========================================================= */

function supabaseBackend(sb) {
  const must = (r) => { if (r.error) throw r.error; return r.data; };
  return {
    kind: 'supabase',
    sb,
    async myHousehold() {
      const rows = must(await sb.from('members').select('household_id, households(*)').eq('user_id', S.user.id).limit(1));
      return rows[0]?.households || null;
    },
    async getHousehold(id) { return must(await sb.from('households').select('*').eq('id', id).single()); },
    createHousehold: async (name, display) => must(await sb.rpc('create_household', { p_name: name, p_display: display })),
    joinHousehold: async (code, display) => must(await sb.rpc('join_household', { p_code: code, p_display: display })),
    async loadAll(hid) {
      const [m, t, r] = await Promise.all([
        sb.from('members').select('*').eq('household_id', hid).order('joined_at'),
        sb.from('titles').select('*').eq('household_id', hid),
        sb.from('reviews').select('*').eq('household_id', hid),
      ]);
      return { members: must(m), titles: must(t), reviews: must(r) };
    },
    insertTitle: async (row) => must(await sb.from('titles').insert(row).select().single()),
    updateTitle: async (id, patch) => must(await sb.from('titles').update(patch).eq('id', id).select().single()),
    async deleteTitle(id) { must(await sb.from('titles').delete().eq('id', id)); },
    upsertReview: async (row) => must(await sb.from('reviews').upsert(row, { onConflict: 'title_id,user_id' }).select().single()),
    updateHousehold: async (id, patch) => must(await sb.from('households').update(patch).eq('id', id).select().single()),
    async updateMember(hid, patch) { must(await sb.from('members').update(patch).eq('household_id', hid).eq('user_id', S.user.id)); },
    subscribe(hid, onChange) {
      const ch = sb.channel(`wt-${hid}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'titles' }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, onChange)
        .subscribe();
      return () => sb.removeChannel(ch);
    },
    async signOut() { await sb.auth.signOut(); location.reload(); },
  };
}

// Single-device mode: same API, stored in this browser only (no sync).
function localBackend() {
  const KEY = 'wt_local_db';
  const load = () => ls.get(KEY) || { households: [], members: [], titles: [], reviews: [] };
  const save = (db) => ls.set(KEY, db);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
  const now = () => new Date().toISOString();
  return {
    kind: 'local',
    async myHousehold() {
      const db = load();
      const m = db.members.find((x) => x.user_id === S.user.id);
      return m ? db.households.find((h) => h.id === m.household_id) : null;
    },
    async getHousehold(id) { return load().households.find((h) => h.id === id); },
    async createHousehold(name, display) {
      const db = load();
      const h = { id: uid(), name: name || 'บ้านเรา', invite_code: '—', tmdb_key: null, omdb_key: null, created_at: now() };
      db.households.push(h);
      db.members.push({ household_id: h.id, user_id: S.user.id, display_name: display || 'ฉัน', joined_at: now() });
      save(db);
      return h.id;
    },
    async joinHousehold() { throw new Error('โหมดเครื่องเดียวใช้รหัสเชิญไม่ได้'); },
    async loadAll(hid) {
      const db = load();
      return {
        members: db.members.filter((x) => x.household_id === hid),
        titles: db.titles.filter((x) => x.household_id === hid),
        reviews: db.reviews.filter((x) => x.household_id === hid),
      };
    },
    async insertTitle(row) {
      const db = load();
      if (db.titles.some((t) => t.household_id === row.household_id && t.media_type === row.media_type && t.tmdb_id === row.tmdb_id)) {
        throw Object.assign(new Error('dup'), { code: '23505' });
      }
      const r = { id: uid(), note: null, added_by: S.user.id, created_at: now(), updated_at: now(), ...row };
      db.titles.push(r); save(db); return r;
    },
    async updateTitle(id, patch) {
      const db = load(); const t = db.titles.find((x) => x.id === id);
      Object.assign(t, patch, { updated_at: now() }); save(db); return t;
    },
    async deleteTitle(id) {
      const db = load();
      db.titles = db.titles.filter((x) => x.id !== id);
      db.reviews = db.reviews.filter((x) => x.title_id !== id);
      save(db);
    },
    async upsertReview(row) {
      const db = load();
      let r = db.reviews.find((x) => x.title_id === row.title_id && x.user_id === S.user.id);
      if (r) Object.assign(r, row, { updated_at: now() });
      else { r = { ...row, user_id: S.user.id, updated_at: now() }; db.reviews.push(r); }
      save(db); return r;
    },
    async updateHousehold(id, patch) {
      const db = load(); const h = db.households.find((x) => x.id === id);
      Object.assign(h, patch); save(db); return h;
    },
    async updateMember(hid, patch) {
      const db = load(); const m = db.members.find((x) => x.household_id === hid && x.user_id === S.user.id);
      Object.assign(m, patch); save(db);
    },
    subscribe() { return () => {}; },
    async signOut() { ls.del('wt_mode'); location.reload(); },
  };
}

function getSupabaseConfig() {
  const c = window.WT_CONFIG || {};
  if (c.supabaseUrl && c.supabaseAnonKey) return { url: c.supabaseUrl, key: c.supabaseAnonKey, from: 'file' };
  const l = ls.get('wt_sb');
  return l?.url && l?.key ? { ...l, from: 'local' } : null;
}

/* =========================================================
   External data: TMDb + OMDb
   ========================================================= */

const memCache = new Map();
async function cachedJSON(cacheKey, url, init) {
  if (memCache.has(cacheKey)) return memCache.get(cacheKey);
  try {
    const hit = sessionStorage.getItem(cacheKey);
    if (hit) { const v = JSON.parse(hit); memCache.set(cacheKey, v); return v; }
  } catch { /* ignore */ }
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.status_message || j.Error || msg; } catch { /* ignore */ }
    if (res.status === 401) msg = 'API key ไม่ถูกต้อง: ' + msg;
    throw new Error(msg);
  }
  const v = await res.json();
  memCache.set(cacheKey, v);
  try { sessionStorage.setItem(cacheKey, JSON.stringify(v)); } catch { /* quota */ }
  return v;
}

async function tmdb(path, params = {}) {
  const key = S.hh?.tmdb_key?.trim();
  if (!key) throw new Error('NO_TMDB');
  const u = new URL('https://api.themoviedb.org/3' + path);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  const cacheKey = 'tmdb:' + u.pathname + u.search;
  const init = {};
  if (key.startsWith('eyJ')) init.headers = { Authorization: 'Bearer ' + key, accept: 'application/json' };
  else u.searchParams.set('api_key', key);
  return cachedJSON(cacheKey, u.toString(), init);
}

async function omdb(params) {
  const key = S.hh?.omdb_key?.trim();
  if (!key) return null;
  const u = new URL('https://www.omdbapi.com/');
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  const cacheKey = 'omdb:' + u.search;
  u.searchParams.set('apikey', key);
  const j = await cachedJSON(cacheKey, u.toString());
  return j && j.Response !== 'False' ? j : null;
}

const DETAIL_APPEND = 'credits,external_ids,watch/providers,videos,translations';
const tmdbDetail = (type, id) => tmdb(`/${type}/${id}`, { language: 'en-US', append_to_response: DETAIL_APPEND });

function yearOf(x) { return (x.release_date || x.first_air_date || '').slice(0, 4); }
function nameOf(x) { return x.title || x.name || x.original_title || x.original_name || ''; }

function thaiOverview(d) {
  const th = d.translations?.translations?.find((t) => t.iso_639_1 === 'th');
  return th?.data?.overview || d.overview || '';
}

const usd = (n) => {
  if (!n) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return '$' + n.toLocaleString('en-US');
};
const parseUsd = (s) => (s && s !== 'N/A' ? Number(String(s).replace(/[^0-9]/g, '')) || 0 : 0);

/* =========================================================
   Data helpers
   ========================================================= */

const memberIndex = (uid) => Math.max(0, S.members.findIndex((m) => m.user_id === uid));
const memberName = (uid) => S.members.find((m) => m.user_id === uid)?.display_name || '—';
const avatar = (uid) => {
  const n = memberName(uid);
  const c = AVATAR_COLORS[memberIndex(uid) % AVATAR_COLORS.length];
  return `<span class="avatar" style="background:${c};color:#16131b" title="${esc(n)}">${esc([...n][0] || '?')}</span>`;
};
const reviewsFor = (tid) => S.reviews.filter((r) => r.title_id === tid);
const myReview = (tid) => S.reviews.find((r) => r.title_id === tid && r.user_id === S.user.id);
const findTitle = (type, id) => S.titles.find((t) => t.media_type === type && Number(t.tmdb_id) === Number(id));
const maxPriority = () => S.titles.reduce((m, t) => Math.max(m, t.priority || 0), 0);
const fmtScore = (s) => (s == null ? '—' : Number(s) % 1 ? Number(s).toFixed(1) : String(Number(s)));

async function reload() {
  const d = await S.db.loadAll(S.hh.id);
  S.members = d.members; S.titles = d.titles; S.reviews = d.reviews;
}

function replaceLocal(row) {
  const i = S.titles.findIndex((t) => t.id === row.id);
  if (i >= 0) S.titles[i] = row; else S.titles.push(row);
}

async function addTitle(item, status) {
  const type = item.media_type;
  const row = {
    household_id: S.hh.id,
    tmdb_id: item.id,
    media_type: type,
    title: nameOf(item),
    year: yearOf(item) || null,
    poster_path: item.poster_path || null,
    status,
    priority: maxPriority() + 1,
    season: type === 'tv' ? 1 : null,
    episode: 0,
  };
  try {
    const saved = await S.db.insertTitle(row);
    replaceLocal(saved);
    toast(status === 'watching' ? `เริ่มดู “${row.title}”` : `เพิ่ม “${row.title}” ลงคิวแล้ว`);
    renderMain();
    return saved;
  } catch (e) { toast(errMsg(e)); return null; }
}

async function patchTitle(t, patch, msg) {
  const before = { ...t };
  Object.assign(t, patch);
  renderMain();
  try {
    const saved = await S.db.updateTitle(t.id, patch);
    replaceLocal(saved);
    if (msg) toast(msg);
  } catch (e) {
    Object.assign(t, before);
    toast(errMsg(e));
  }
  renderMain();
}

async function setStatus(t, status) {
  const patch = { status };
  if (status === 'queue') patch.priority = maxPriority() + 1;
  await patchTitle(t, patch, `ย้ายไป “${STATUS_LABEL[status]}”`);
  if (status === 'done' && !myReview(t.id)?.score) openDetail(t.media_type, t.tmdb_id, { focusReview: true });
}

async function moveInQueue(t, dir) {
  const q = S.titles.filter((x) => x.status === 'queue').sort(byPriority);
  const i = q.findIndex((x) => x.id === t.id);
  const j = i + dir;
  if (j < 0 || j >= q.length) return;
  const other = q[j];
  // normalise priorities so swaps are always meaningful
  q.forEach((x, k) => { x.priority = k + 1; });
  [t.priority, other.priority] = [other.priority, t.priority];
  renderMain();
  try {
    const changed = q.filter((x) => x.priority !== undefined);
    await Promise.all(changed.map((x) => S.db.updateTitle(x.id, { priority: x.priority })));
  } catch (e) { toast(errMsg(e)); await reload(); renderMain(); }
}

function airedSeasons(d) {
  return (d.seasons || []).filter((s) => s.season_number > 0 && s.episode_count > 0);
}

async function nextEpisode(t) {
  let season = t.season || 1;
  let ep = (t.episode || 0) + 1;
  try {
    const d = await tmdbDetail('tv', t.tmdb_id);
    const seasons = airedSeasons(d);
    const cur = seasons.find((s) => s.season_number === season);
    if (cur && ep > cur.episode_count) {
      const nxt = seasons.find((s) => s.season_number > season);
      if (nxt) { season = nxt.season_number; ep = 1; }
      else {
        if (confirm('ดูครบทุกตอนที่มีแล้ว ย้ายไป “ดูจบแล้ว” เลยไหม?')) return setStatus(t, 'done');
        return;
      }
    }
  } catch { /* no TMDb: just count up */ }
  await patchTitle(t, { season, episode: ep, status: 'watching' }, `ดูถึง S${season}E${ep} แล้ว`);
}

const byPriority = (a, b) => (a.priority || 0) - (b.priority || 0) || String(a.created_at).localeCompare(String(b.created_at));
const byUpdated = (a, b) => String(b.updated_at).localeCompare(String(a.updated_at));

/* =========================================================
   Screens: setup, auth, onboarding
   ========================================================= */

function renderSetup() {
  app.innerHTML = `
  <div class="center-wrap"><div class="panel">
    <div class="hero-mark">${ICON.mark}</div>
    <h1>ดูด้วยกัน</h1>
    <p class="muted">เชื่อมฐานข้อมูล Supabase เพื่อให้สองเครื่องเห็นคิวเดียวกัน</p>
    <ol>
      <li>สร้างโปรเจกต์ฟรีที่ <a href="https://supabase.com/dashboard" target="_blank" rel="noopener">supabase.com</a></li>
      <li>SQL Editor → วางไฟล์ <code>supabase/schema.sql</code> → Run</li>
      <li>Project Settings → API → คัดลอก URL และ anon key มาใส่ข้างล่าง</li>
    </ol>
    <form id="f-setup">
      <label class="field"><span>Project URL</span><input type="url" name="url" placeholder="https://xxxx.supabase.co" required></label>
      <label class="field"><span>anon public key</span><input type="text" name="key" placeholder="eyJhbGciOi…" required autocomplete="off"></label>
      <button class="btn primary block">เชื่อมต่อ</button>
    </form>
    <div class="divider">หรือ</div>
    <button class="btn block ghost" id="btn-local">ลองใช้แบบเครื่องเดียว (ไม่ sync)</button>
  </div></div>`;
  $('#f-setup').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    ls.set('wt_sb', { url: f.get('url').trim().replace(/\/$/, ''), key: f.get('key').trim() });
    location.reload();
  };
  $('#btn-local').onclick = () => { ls.set('wt_mode', 'local'); location.reload(); };
}

function renderAuth(note = '') {
  app.innerHTML = `
  <div class="center-wrap"><div class="panel">
    <div class="hero-mark">${ICON.mark}</div>
    <h1>ดูด้วยกัน</h1>
    <p class="muted">คิวหนังและซีรีส์ของเราสองคน</p>
    <form id="f-auth">
      <label class="field"><span>อีเมล</span><input type="email" name="email" required autocomplete="email"></label>
      <label class="field"><span>รหัสผ่าน</span><input type="password" name="password" required minlength="6" autocomplete="current-password"></label>
      <div id="auth-msg" class="${note ? 'muted' : ''}" style="margin-bottom:12px">${esc(note)}</div>
      <div class="row">
        <button class="btn primary grow" name="mode" value="in">เข้าสู่ระบบ</button>
        <button class="btn grow" name="mode" value="up">สมัครใหม่</button>
      </div>
    </form>
  </div></div>`;
  const form = $('#f-auth');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const mode = e.submitter?.value || 'in';
    const f = new FormData(form);
    const email = f.get('email').trim();
    const password = f.get('password');
    const msg = $('#auth-msg');
    msg.className = 'muted'; msg.textContent = 'กำลังดำเนินการ…';
    form.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const sb = S.db.sb;
    try {
      if (mode === 'up') {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        if (!data.session) {
          msg.textContent = 'ส่งอีเมลยืนยันไปแล้ว กดลิงก์ในอีเมลแล้วกลับมาเข้าสู่ระบบ';
          form.querySelectorAll('button').forEach((b) => { b.disabled = false; });
          return;
        }
        S.user = data.session.user;
      } else {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        S.user = data.user;
      }
      await afterLogin();
    } catch (err) {
      msg.className = 'err'; msg.textContent = errMsg(err);
      form.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  };
}

function renderOnboard() {
  const code = ls.get('wt_join') || '';
  const local = S.db.kind === 'local';
  app.innerHTML = `
  <div class="center-wrap"><div class="two-col" ${local ? 'style="max-width:440px;grid-template-columns:1fr"' : ''}>
    <div class="panel">
      <h1>สร้างลิสต์ใหม่</h1>
      <p class="muted">แล้วส่งรหัสเชิญให้แฟน</p>
      <form id="f-create">
        <label class="field"><span>ชื่อลิสต์</span><input type="text" name="name" placeholder="เช่น บ้านเรา" maxlength="40"></label>
        <label class="field"><span>ชื่อของคุณ</span><input type="text" name="display" required maxlength="20" placeholder="เช่น จอม"></label>
        <button class="btn primary block">สร้าง</button>
      </form>
    </div>
    <div class="panel" ${local ? 'hidden' : ''}>
      <h1>เข้าร่วมลิสต์</h1>
      <p class="muted">ใส่รหัสเชิญ 6 ตัวที่ได้จากแฟน</p>
      <form id="f-join">
        <label class="field"><span>รหัสเชิญ</span><input type="text" name="code" required maxlength="6" value="${esc(code)}" style="text-transform:uppercase;letter-spacing:.2em"></label>
        <label class="field"><span>ชื่อของคุณ</span><input type="text" name="display" required maxlength="20"></label>
        <button class="btn primary block">เข้าร่วม</button>
      </form>
    </div>
    <div id="onb-msg" class="err" style="grid-column:1/-1;text-align:center"></div>
  </div></div>`;
  const run = async (fn) => {
    try { await fn(); ls.del('wt_join'); await afterLogin(); } catch (e) { $('#onb-msg').textContent = errMsg(e); }
  };
  $('#f-create').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    run(() => S.db.createHousehold(f.get('name').trim(), f.get('display').trim()));
  };
  $('#f-join').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    run(() => S.db.joinHousehold(f.get('code').trim(), f.get('display').trim()));
  };
}

/* =========================================================
   Main list
   ========================================================= */

function renderMain() {
  if (!S.hh) return;
  const counts = Object.fromEntries(TABS.map((t) => [t.key, S.titles.filter((x) => x.status === t.key).length]));
  let list = S.titles.filter((t) => t.status === S.tab);
  list.sort(S.tab === 'queue' ? byPriority : byUpdated);
  const focusQ = document.activeElement?.id === 'q';
  const qVal = $('#q')?.value || '';
  app.innerHTML = `
  <div class="shell">
    <header class="top">
      <div class="top-row">
        <div class="brand">${ICON.mark}<div style="min-width:0"><b>ดูด้วยกัน</b><small>${esc(S.hh.name)}${S.db.kind === 'local' ? ' · เครื่องเดียว' : ''}</small></div></div>
        <div class="avatars">${S.members.map((m) => avatar(m.user_id)).join('')}</div>
        <button class="icon-btn" data-act="settings" aria-label="ตั้งค่า">${ICON.gear}</button>
      </div>
      <form class="search" id="f-search">
        <input type="search" id="q" placeholder="ค้นหาหนัง/ซีรีส์ หรือวางลิงก์ IMDb" autocomplete="off" value="${esc(qVal)}">
        <button class="btn primary">ค้นหา</button>
      </form>
      <nav class="tabs">${TABS.map((t) => `<button class="tab ${S.tab === t.key ? 'on' : ''}" data-act="tab" data-tab="${t.key}">${t.label}<span class="n">${counts[t.key]}</span></button>`).join('')}</nav>
    </header>
    <main class="list">${list.length ? list.map((t, i) => card(t, i, list.length)).join('') : emptyState()}</main>
  </div>`;
  $('#f-search').onsubmit = (e) => {
    e.preventDefault();
    const q = $('#q').value.trim();
    $('#q').value = '';
    if (q) openSearch(q);
  };
  if (focusQ) $('#q').focus();
}

function emptyState() {
  const m = {
    watching: ['ยังไม่มีเรื่องที่กำลังดู', 'ค้นหาเรื่องแล้วกด “เริ่มดู” หรือหยิบจากคิว'],
    queue: ['คิวว่าง', 'เจอเรื่องน่าดูในแชท ก็ค้นหาแล้วเพิ่มลงคิวที่นี่แทน'],
    done: ['ยังไม่มีเรื่องที่ดูจบ', 'ดูจบแล้วอย่าลืมให้คะแนนกันนะ'],
    dropped: ['ไม่มีเรื่องที่พักไว้', 'เรื่องที่ดูค้างหรือเลิกดูจะมาอยู่ตรงนี้'],
  }[S.tab];
  return `<div class="empty"><b>${m[0]}</b>${m[1]}</div>`;
}

function posterHTML(path, alt) {
  return path ? `<img class="poster" src="${IMG(path, 'w185')}" alt="${esc(alt)}" loading="lazy">` : `<div class="poster">ไม่มีภาพ</div>`;
}

function card(t, i, n) {
  const revs = reviewsFor(t.id).filter((r) => r.score != null);
  const tv = t.media_type === 'tv';
  let progress = '';
  if (tv && (t.status === 'watching' || t.status === 'dropped')) {
    progress = t.episode > 0
      ? `<div class="progress">ดูถึง <b>S${t.season || 1}E${t.episode}</b></div>`
      : `<div class="progress faint">ยังไม่เริ่มตอนแรก</div>`;
  }
  let actions = '';
  if (t.status === 'queue') {
    actions = `
      <button class="btn sm" data-act="up" data-id="${t.id}" ${i === 0 ? 'disabled' : ''} aria-label="เลื่อนขึ้น">▲</button>
      <button class="btn sm" data-act="down" data-id="${t.id}" ${i === n - 1 ? 'disabled' : ''} aria-label="เลื่อนลง">▼</button>
      <button class="btn sm primary" data-act="status" data-status="watching" data-id="${t.id}">เริ่มดู</button>`;
  } else if (t.status === 'watching') {
    actions = `${tv ? `<button class="btn sm primary" data-act="ep" data-id="${t.id}">+1 ตอน</button>` : ''}
      <button class="btn sm" data-act="status" data-status="done" data-id="${t.id}">ดูจบแล้ว</button>`;
  } else if (t.status === 'dropped') {
    actions = `<button class="btn sm" data-act="status" data-status="watching" data-id="${t.id}">กลับมาดูต่อ</button>`;
  }
  const avg = revs.length ? revs.reduce((s, r) => s + Number(r.score), 0) / revs.length : null;
  return `
  <article class="card" data-act="open" data-id="${t.id}">
    ${posterHTML(t.poster_path, t.title)}
    <div class="card-body">
      <h3>${esc(t.title)}<span class="yr">${esc(t.year || '')}</span></h3>
      <div class="meta">
        <span class="chip">${tv ? 'ซีรีส์' : 'หนัง'}</span>
        ${t.status === 'queue' ? `<span>#${i + 1}</span>` : ''}
        ${t.added_by ? `<span>เพิ่มโดย ${esc(memberName(t.added_by))}</span>` : ''}
      </div>
      ${progress}
      ${revs.length ? `<div class="scores">${revs.map((r) => `<span class="chip gold">${esc(memberName(r.user_id))} ${fmtScore(r.score)}</span>`).join('')}${revs.length > 1 ? `<span class="chip">เฉลี่ย ${avg.toFixed(1)}</span>` : ''}</div>` : ''}
      ${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}
      ${actions ? `<div class="card-actions">${actions}</div>` : ''}
    </div>
  </article>`;
}

/* =========================================================
   Modal plumbing
   ========================================================= */

function openModal(html, cls = '') {
  modalRoot.innerHTML = `<div class="overlay"><div class="sheet ${cls}" role="dialog" aria-modal="true"><button class="close" data-act="close" aria-label="ปิด">×</button><div class="sheet-body">${html}</div></div></div>`;
  document.body.classList.add('modal-open');
  return $('.sheet-body', modalRoot);
}
function closeModal() {
  modalRoot.innerHTML = '';
  document.body.classList.remove('modal-open');
  S.modal = null; S.detail = null;
}

/* =========================================================
   Search
   ========================================================= */

async function resolveQuery(q) {
  const tt = q.match(/tt\d{5,10}/);
  if (tt) {
    const r = await tmdb(`/find/${tt[0]}`, { external_source: 'imdb_id' });
    return [...r.movie_results.map((x) => ({ ...x, media_type: 'movie' })), ...r.tv_results.map((x) => ({ ...x, media_type: 'tv' }))];
  }
  const tm = q.match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
  if (tm) {
    const d = await tmdbDetail(tm[1], tm[2]);
    return [{ ...d, media_type: tm[1] }];
  }
  const text = q.replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const r = await tmdb('/search/multi', { query: text, include_adult: 'false', language: 'en-US', page: '1' });
  return r.results.filter((x) => x.media_type === 'movie' || x.media_type === 'tv');
}

async function openSearch(q) {
  if (!S.hh.tmdb_key) { toast('ใส่ TMDb API key ในตั้งค่าก่อนนะ'); return openSettings(); }
  S.modal = { kind: 'search', q };
  const body = openModal(`
    <h2 style="margin-bottom:12px">ผลการค้นหา</h2>
    <form class="search" id="f-search2"><input type="search" id="q2" value="${esc(q)}" autocomplete="off"><button class="btn primary">ค้นหา</button></form>
    <div id="results" class="results"><div class="loading">กำลังค้นหา…</div></div>`);
  $('#f-search2', body).onsubmit = (e) => {
    e.preventDefault();
    const v = $('#q2').value.trim();
    if (v) openSearch(v);
  };
  try {
    S.results = await resolveQuery(q);
    renderResults();
  } catch (e) {
    $('#results').innerHTML = `<div class="err">${esc(errMsg(e))}</div>`;
  }
}

function renderResults() {
  const el = $('#results');
  if (!el) return;
  if (!S.results.length) { el.innerHTML = '<div class="empty"><b>ไม่พบเรื่องนี้</b>ลองพิมพ์ชื่อภาษาอังกฤษ หรือวางลิงก์ IMDb</div>'; return; }
  el.innerHTML = S.results.map((x, i) => {
    const have = findTitle(x.media_type, x.id);
    return `
    <div class="result">
      ${posterHTML(x.poster_path, nameOf(x))}
      <div style="min-width:0">
        <h3 style="font-size:15px">${esc(nameOf(x))} <span class="faint" style="font-weight:400">${esc(yearOf(x))}</span></h3>
        <div class="meta"><span class="chip">${x.media_type === 'tv' ? 'ซีรีส์' : 'หนัง'}</span>${x.vote_average ? `<span>TMDb ${x.vote_average.toFixed(1)}</span>` : ''}${have ? `<span class="chip gold">${STATUS_LABEL[have.status]}</span>` : ''}</div>
        <p>${esc(x.overview || '')}</p>
        <div class="row">
          ${have ? '' : `<button class="btn sm primary" data-act="r-add" data-i="${i}" data-status="queue">+ คิว</button>
          <button class="btn sm" data-act="r-add" data-i="${i}" data-status="watching">เริ่มดูเลย</button>`}
          <button class="btn sm ghost" data-act="r-detail" data-i="${i}">รายละเอียด</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* =========================================================
   Detail
   ========================================================= */

async function openDetail(type, id, opts = {}) {
  id = Number(id);
  S.modal = { kind: 'detail', type, id };
  const row = findTitle(type, id);
  const body = openModal(`<div class="loading">กำลังโหลด${row ? ` “${esc(row.title)}”` : ''}…</div>`, 'wide');
  if (!S.hh.tmdb_key) {
    S.detail = { type, id, d: null };
    body.innerHTML = `<h2>${esc(row?.title || '')}</h2><p class="muted">ใส่ TMDb API key ในตั้งค่าเพื่อดูข้อมูลเรื่อง</p><div id="d-ours" class="section"></div>`;
    renderOurs(opts);
    return;
  }
  let d;
  try { d = await tmdbDetail(type, id); } catch (e) {
    body.innerHTML = `<div class="err">${esc(errMsg(e))}</div><div id="d-ours" class="section"></div>`;
    S.detail = { type, id, d: null };
    renderOurs(opts);
    return;
  }
  if (S.modal?.id !== id) return;
  const imdbId = type === 'movie' ? d.imdb_id : d.external_ids?.imdb_id;
  S.detail = { type, id, d, imdbId, omdb: undefined };
  body.innerHTML = detailHTML();
  renderOurs(opts);
  renderRatings();
  if (imdbId && S.hh.omdb_key) {
    omdb({ i: imdbId, plot: 'short' })
      .then((o) => { if (S.detail?.id === id) { S.detail.omdb = o; renderRatings(); } })
      .catch(() => { if (S.detail?.id === id) { S.detail.omdb = null; renderRatings(); } });
  } else S.detail.omdb = null;
}

function detailHTML() {
  const { d, type } = S.detail;
  const tv = type === 'tv';
  const genres = (d.genres || []).map((g) => g.name).join(', ');
  const runtime = tv
    ? `${d.number_of_seasons || '?'} ซีซัน · ${d.number_of_episodes || '?'} ตอน`
    : d.runtime ? `${Math.floor(d.runtime / 60)} ชม. ${d.runtime % 60} นาที` : '';
  const crew = d.credits?.crew || [];
  const directors = tv ? (d.created_by || []).map((p) => p.name) : crew.filter((c) => c.job === 'Director').map((c) => c.name);
  const writers = [...new Set(crew.filter((c) => ['Screenplay', 'Writer', 'Story', 'Novel'].includes(c.job)).map((c) => c.name))].slice(0, 4);
  const producers = [...new Set(crew.filter((c) => c.job === 'Executive Producer' || c.job === 'Producer').map((c) => c.name))].slice(0, 3);
  const studios = (d.production_companies || []).slice(0, 3).map((c) => c.name).join(', ');
  const networks = tv ? (d.networks || []).map((n) => n.name).join(', ') : '';
  const cast = (d.credits?.cast || []).slice(0, 14);
  const trailer = (d.videos?.results || []).find((v) => v.site === 'YouTube' && v.type === 'Trailer') || (d.videos?.results || []).find((v) => v.site === 'YouTube');
  const prov = d['watch/providers']?.results?.TH;
  const provList = prov ? [...new Map([...(prov.flatrate || []), ...(prov.free || []), ...(prov.ads || []), ...(prov.rent || []), ...(prov.buy || [])].map((p) => [p.provider_id, p])).values()] : [];
  const date = d.release_date || d.first_air_date || '';
  const facts = [
    [tv ? 'ผู้สร้าง' : 'ผู้กำกับ', directors.join(', ')],
    ['ผู้เขียนบท', writers.join(', ')],
    ['โปรดิวเซอร์', producers.join(', ')],
    ['เครือข่าย', networks],
    ['บริษัท', studios],
    ['ฉาย', date + (tv && d.last_air_date ? ` → ${d.last_air_date}` : '')],
    ['สถานะ', tv ? ({ 'Returning Series': 'ยังมีซีซันต่อ', Ended: 'จบแล้ว', Canceled: 'ถูกยกเลิก', 'In Production': 'กำลังสร้าง' }[d.status] || d.status) : ''],
    ['ภาษา', (d.spoken_languages || []).map((l) => l.english_name).join(', ')],
  ].filter(([, v]) => v);

  return `
  <div class="d-hero">
    ${d.backdrop_path ? `<div class="bd" style="background-image:url('${IMG(d.backdrop_path, 'w780')}')"></div>` : ''}
    <div class="d-head">
      ${posterHTML(d.poster_path, nameOf(d))}
      <div style="min-width:0">
        <h2>${esc(nameOf(d))}</h2>
        ${d.original_title && d.original_title !== d.title || d.original_name && d.original_name !== d.name ? `<div class="orig">${esc(d.original_title || d.original_name)}</div>` : ''}
        <div class="meta" style="margin-top:6px"><span class="chip">${tv ? 'ซีรีส์' : 'หนัง'}</span><span>${esc(yearOf(d))}</span>${runtime ? `<span>${esc(runtime)}</span>` : ''}</div>
        ${genres ? `<div class="meta">${esc(genres)}</div>` : ''}
      </div>
    </div>
  </div>
  <div id="d-ours" class="section"></div>
  <div class="section"><h4>คะแนนรีวิว</h4><div id="d-ratings" class="ratings"></div></div>
  <div id="d-money"></div>
  ${thaiOverview(d) ? `<div class="section"><h4>เรื่องย่อ</h4><p class="overview">${esc(thaiOverview(d))}</p></div>` : ''}
  <div class="section"><h4>ข้อมูลเบื้องต้น</h4><dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <div class="row" style="margin-top:12px">
      ${trailer ? `<a class="btn sm" href="https://www.youtube.com/watch?v=${esc(trailer.key)}" target="_blank" rel="noopener">▶ ตัวอย่าง</a>` : ''}
      ${S.detail.imdbId ? `<a class="btn sm ghost" href="https://www.imdb.com/title/${esc(S.detail.imdbId)}/" target="_blank" rel="noopener">IMDb</a>` : ''}
      <a class="btn sm ghost" href="https://www.rottentomatoes.com/search?search=${encodeURIComponent(nameOf(d))}" target="_blank" rel="noopener">Rotten Tomatoes</a>
      <a class="btn sm ghost" href="https://www.themoviedb.org/${type}/${d.id}" target="_blank" rel="noopener">TMDb</a>
    </div>
  </div>
  ${cast.length ? `<div class="section"><h4>นักแสดง</h4><div class="cast">${cast.map((c) => `
    <div class="person">${c.profile_path ? `<img src="${IMG(c.profile_path, 'w185')}" alt="" loading="lazy">` : '<div class="ph"></div>'}<b>${esc(c.name)}</b><span>${esc(c.character || '')}</span></div>`).join('')}</div></div>` : ''}
  ${provList.length ? `<div class="section"><h4>ดูได้ที่ (ไทย)</h4><div class="providers">${provList.map((p) => `<img src="${IMG(p.logo_path, 'w92')}" alt="${esc(p.provider_name)}" title="${esc(p.provider_name)}">`).join('')}${prov.link ? `<a class="btn sm ghost" href="${esc(prov.link)}" target="_blank" rel="noopener">ดูทั้งหมด</a>` : ''}</div></div>` : ''}
  ${tv ? `<div class="section"><h4>กราฟคะแนนรายตอน</h4><div id="d-graph"><button class="btn" data-act="graph">โหลดกราฟ (${airedSeasons(d).length} ซีซัน)</button></div></div>` : ''}
  <p class="faint" style="font-size:12px;margin-top:24px">ข้อมูลจาก TMDb${S.hh.omdb_key ? ' และ OMDb' : ''} · This product uses the TMDB API but is not endorsed or certified by TMDB.</p>`;
}

function ratingBox(src, val, sub, href) {
  const tag = href ? 'a' : 'div';
  return `<${tag} class="rating" ${href ? `href="${esc(href)}" target="_blank" rel="noopener"` : ''}><div class="src">${src}</div><div class="val">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</${tag}>`;
}

function renderRatings() {
  const el = $('#d-ratings');
  if (!el || !S.detail?.d) return;
  const { d, omdb: o, imdbId, type } = S.detail;
  const boxes = [ratingBox('TMDb', d.vote_average ? d.vote_average.toFixed(1) : '—', d.vote_count ? `${d.vote_count.toLocaleString()} โหวต` : '')];
  if (!S.hh.omdb_key) {
    boxes.push(`<div class="rating"><div class="src">IMDb · RT · Metacritic</div><div class="sub" style="margin-top:4px">ใส่ OMDb key ในตั้งค่าเพื่อแสดง</div></div>`);
  } else if (o === undefined) {
    boxes.push(`<div class="rating"><div class="src">IMDb · RT</div><div class="sub" style="margin-top:4px">กำลังโหลด…</div></div>`);
  } else if (o) {
    const rt = o.Ratings?.find((r) => r.Source === 'Rotten Tomatoes')?.Value;
    const mc = o.Ratings?.find((r) => r.Source === 'Metacritic')?.Value;
    if (o.imdbRating && o.imdbRating !== 'N/A') boxes.push(ratingBox('IMDb', o.imdbRating, o.imdbVotes !== 'N/A' ? `${o.imdbVotes} โหวต` : '', `https://www.imdb.com/title/${imdbId}/`));
    if (rt) boxes.push(ratingBox('Rotten Tomatoes', rt, 'Tomatometer', `https://www.rottentomatoes.com/search?search=${encodeURIComponent(nameOf(d))}`));
    if (mc) boxes.push(ratingBox('Metacritic', mc.split('/')[0], 'Metascore'));
    if (o.Rated && o.Rated !== 'N/A') boxes.push(ratingBox('เรต', esc(o.Rated), ''));
    if (o.Awards && o.Awards !== 'N/A') boxes.push(`<div class="rating" style="grid-column:1/-1"><div class="src">รางวัล</div><div style="font-size:14px">${esc(o.Awards)}</div></div>`);
  } else {
    boxes.push(`<div class="rating"><div class="src">IMDb · RT</div><div class="sub" style="margin-top:4px">ไม่พบข้อมูล</div></div>`);
  }
  el.innerHTML = boxes.join('');

  // money (movies have budget/revenue on TMDb; OMDb gives US box office)
  const m = $('#d-money');
  if (!m) return;
  const budget = d.budget || 0;
  const revenue = d.revenue || 0;
  const usBox = parseUsd(o?.BoxOffice);
  if (type !== 'movie' || (!budget && !revenue && !usBox)) { m.innerHTML = ''; return; }
  const items = [ratingBox('ทุนสร้าง', usd(budget), 'ประมาณการ'), ratingBox('รายได้ทั่วโลก', usd(revenue), 'Box office')];
  if (usBox) items.push(ratingBox('รายได้ในสหรัฐฯ', usd(usBox), 'Domestic'));
  if (budget && revenue) {
    const ratio = revenue / budget;
    items.push(ratingBox('รายได้ ÷ ทุน', `<span class="${ratio >= 2.5 ? 'pos' : ratio < 1 ? 'neg' : ''}">${ratio.toFixed(1)}×</span>`, ratio >= 2.5 ? 'น่าจะกำไร' : ratio < 1 ? 'ขาดทุน' : 'พอคืนทุน (ต้องหักการตลาด)'));
  }
  m.innerHTML = `<div class="section"><h4>ต้นทุนและรายได้</h4><div class="money">${items.join('')}</div>
    <p class="faint" style="font-size:12px;margin:6px 0 0">กฎคร่าวๆ: หนังต้องทำรายได้ราว 2.5 เท่าของทุนจึงจะกำไร เพราะโรงหนังแบ่งรายได้และยังมีค่าการตลาด</p></div>`;
}

function renderOurs(opts = {}) {
  const el = $('#d-ours');
  if (!el || !S.detail) return;
  const { type, id, d } = S.detail;
  const t = findTitle(type, id);
  if (!t) {
    el.innerHTML = `<div class="ours row"><span class="grow muted">ยังไม่อยู่ในลิสต์</span>
      <button class="btn primary" data-act="d-add" data-status="queue">+ เพิ่มลงคิว</button>
      <button class="btn" data-act="d-add" data-status="watching">เริ่มดูเลย</button></div>`;
    return;
  }
  const tv = type === 'tv';
  const seasons = d ? airedSeasons(d) : [];
  const curSeason = seasons.find((s) => s.season_number === (t.season || 1));
  const mine = myReview(t.id);
  const others = reviewsFor(t.id).filter((r) => r.user_id !== S.user.id);
  const partnerSlots = S.members.filter((m) => m.user_id !== S.user.id);
  const score = mine?.score ?? null;

  el.innerHTML = `
  <div class="ours">
    <div class="seg">${['queue', 'watching', 'done', 'dropped'].map((s) => `<button class="btn sm ${t.status === s ? 'on' : ''}" data-act="d-status" data-status="${s}">${STATUS_LABEL[s]}</button>`).join('')}</div>
    ${tv ? `
    <div class="row" style="margin-top:12px">
      <span class="muted">ดูถึง</span>
      ${seasons.length ? `<select id="d-season" style="width:auto">${seasons.map((s) => `<option value="${s.season_number}" ${s.season_number === (t.season || 1) ? 'selected' : ''}>ซีซัน ${s.season_number}</option>`).join('')}</select>`
        : `<input type="number" id="d-season" min="1" value="${t.season || 1}" style="width:80px">`}
      <span class="muted">ตอน</span>
      <input type="number" id="d-episode" min="0" ${curSeason ? `max="${curSeason.episode_count}"` : ''} value="${t.episode || 0}" style="width:80px">
      ${curSeason ? `<span class="faint">/ ${curSeason.episode_count}</span>` : ''}
      <button class="btn sm primary" data-act="d-ep">+1 ตอน</button>
    </div>` : ''}
    <label class="field" style="margin:12px 0 0"><span>โน้ต (เช่น ใครแนะนำ, ดูที่ไหน)</span>
      <textarea id="d-note" rows="2" maxlength="500" placeholder="—">${esc(t.note || '')}</textarea></label>
    <div class="section" style="margin-top:16px"><h4>รีวิวของเรา</h4>
      <div class="rev-grid">
        <div class="rev" id="my-rev">
          <div class="who">${avatar(S.user.id)}<b>${esc(memberName(S.user.id))} (ฉัน)</b></div>
          <div class="range-row"><input type="range" id="r-score" min="0" max="10" step="0.5" value="${score ?? 7}"><output id="r-out">${score == null ? '—' : fmtScore(score)}</output></div>
          <textarea id="r-body" rows="3" maxlength="2000" placeholder="ชอบ/ไม่ชอบตรงไหน" style="margin-top:8px">${esc(mine?.body || '')}</textarea>
          <div class="row" style="margin-top:8px"><button class="btn sm primary" data-act="d-review">บันทึกรีวิว</button><span class="faint" id="r-state" style="font-size:12.5px">${mine ? 'บันทึกแล้ว' : ''}</span></div>
        </div>
        ${partnerSlots.map((m) => {
          const r = others.find((x) => x.user_id === m.user_id);
          return `<div class="rev"><div class="who">${avatar(m.user_id)}<b>${esc(m.display_name)}</b><span class="score">${r?.score != null ? fmtScore(r.score) : ''}</span></div>
            <p class="${r?.body ? '' : 'faint'}">${r?.body ? esc(r.body) : r?.score != null ? 'ให้คะแนนแล้ว ยังไม่เขียนรีวิว' : 'ยังไม่ได้รีวิว'}</p></div>`;
        }).join('')}
        ${!partnerSlots.length && S.db.kind !== 'local' ? `<div class="rev"><p class="faint">ชวนแฟนเข้าลิสต์จาก ⚙ ตั้งค่า แล้วรีวิวของเขาจะขึ้นตรงนี้</p></div>` : ''}
      </div>
    </div>
    <div class="row" style="margin-top:14px"><span class="grow faint" style="font-size:12.5px">เพิ่มโดย ${esc(memberName(t.added_by))}</span><button class="btn sm danger" data-act="d-delete">ลบออกจากลิสต์</button></div>
  </div>`;

  const range = $('#r-score');
  range.oninput = () => { $('#r-out').textContent = fmtScore(range.value); range.dataset.touched = '1'; };
  $('#d-note').onchange = (e) => patchTitle(t, { note: e.target.value.trim() || null }, 'บันทึกโน้ตแล้ว');
  if (tv) {
    const saveProg = () => {
      const season = Math.max(1, parseInt($('#d-season').value, 10) || 1);
      const episode = Math.max(0, parseInt($('#d-episode').value, 10) || 0);
      patchTitle(t, { season, episode }, `ดูถึง S${season}E${episode}`).then(() => renderOurs());
    };
    $('#d-season').onchange = () => { $('#d-episode').value = 0; saveProg(); };
    $('#d-episode').onchange = saveProg;
  }
  if (opts.focusReview) setTimeout(() => { $('#my-rev')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50);
}

async function saveReview() {
  const t = findTitle(S.detail.type, S.detail.id);
  if (!t) return;
  const range = $('#r-score');
  const mine = myReview(t.id);
  const score = range.dataset.touched || mine?.score != null ? Number(range.value) : null;
  const body = $('#r-body').value.trim() || null;
  const row = { title_id: t.id, household_id: S.hh.id, user_id: S.user.id, score, body };
  try {
    const saved = await S.db.upsertReview(row);
    const i = S.reviews.findIndex((r) => r.title_id === t.id && r.user_id === S.user.id);
    if (i >= 0) S.reviews[i] = saved; else S.reviews.push(saved);
    $('#r-state').textContent = 'บันทึกแล้ว';
    toast('บันทึกรีวิวแล้ว');
    renderMain();
  } catch (e) { toast(errMsg(e)); }
}

/* ---------- series graph ---------- */

function rClass(v) {
  if (v == null) return 'na';
  if (v >= 9) return 'r9';
  if (v >= 8) return 'r8';
  if (v >= 7) return 'r7';
  if (v >= 6) return 'r6';
  if (v >= 5) return 'r5';
  return 'r4';
}

async function loadGraph() {
  const el = $('#d-graph');
  const { d, id, imdbId } = S.detail;
  const seasons = airedSeasons(d).slice(0, 40);
  const useOmdb = !!(imdbId && S.hh.omdb_key);
  el.innerHTML = `<div class="loading">กำลังโหลด ${seasons.length} ซีซัน…</div>`;
  const today = new Date().toISOString().slice(0, 10);
  const data = await Promise.all(seasons.map(async (s) => {
    const [tm, om] = await Promise.all([
      tmdb(`/tv/${id}/season/${s.season_number}`, { language: 'en-US' }).catch(() => null),
      useOmdb ? omdb({ i: imdbId, Season: s.season_number }).catch(() => null) : null,
    ]);
    const map = new Map();
    (tm?.episodes || []).forEach((e) => {
      if (e.air_date && e.air_date > today) return;
      map.set(e.episode_number, { n: e.episode_number, name: e.name, tmdb: e.vote_count > 0 ? e.vote_average : null, imdb: null });
    });
    (om?.Episodes || []).forEach((e) => {
      const n = Number(e.Episode);
      const v = parseFloat(e.imdbRating);
      const cur = map.get(n) || { n, name: e.Title, tmdb: null, imdb: null };
      cur.imdb = Number.isFinite(v) ? v : null;
      map.set(n, cur);
    });
    const eps = [...map.values()].sort((a, b) => a.n - b.n).map((e) => ({ ...e, r: e.imdb ?? e.tmdb }));
    return { season: s.season_number, eps };
  }));
  if (S.detail?.id !== id) return;
  const nImdb = data.reduce((c, s) => c + s.eps.filter((e) => e.imdb != null).length, 0);
  const nAll = data.reduce((c, s) => c + s.eps.filter((e) => e.r != null).length, 0);
  if (!nAll) { el.innerHTML = '<p class="muted">ยังไม่มีคะแนนรายตอน</p>'; return; }
  const maxEp = Math.max(...data.map((s) => s.eps.length ? s.eps[s.eps.length - 1].n : 0));
  const t = findTitle('tv', id);
  const isCurrent = (s, n) => t && t.season === s && t.episode === n;

  let rows = '';
  for (let n = 1; n <= maxEp; n++) {
    rows += `<tr><th>E${n}</th>${data.map((s) => {
      const e = s.eps.find((x) => x.n === n);
      if (!e) return '<td class="na"></td>';
      const label = `S${s.season}E${n} · ${e.name || ''} · ${e.r != null ? e.r.toFixed(1) : 'N/A'}${e.imdb != null ? ' (IMDb)' : e.tmdb != null ? ' (TMDb)' : ''}`;
      return `<td class="${rClass(e.r)}" title="${esc(label)}" ${isCurrent(s.season, n) ? 'style="box-shadow:0 0 0 2px #fff inset"' : ''}>${e.r != null ? e.r.toFixed(1) : '—'}</td>`;
    }).join('')}</tr>`;
  }
  const avgs = data.map((s) => {
    const v = s.eps.filter((e) => e.r != null);
    return v.length ? v.reduce((a, e) => a + e.r, 0) / v.length : null;
  });
  rows += `<tr class="avg"><th>เฉลี่ย</th>${avgs.map((a) => `<td class="${rClass(a)}">${a != null ? a.toFixed(1) : '—'}</td>`).join('')}</tr>`;

  el.innerHTML = `
    <div class="graph-wrap"><table class="heat"><thead><tr><th></th>${data.map((s) => `<th>S${s.season}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
    <div class="legend">
      <span><i class="r9"></i>9+</span><span><i class="r8"></i>8–9</span><span><i class="r7"></i>7–8</span><span><i class="r6"></i>6–7</span><span><i class="r5"></i>5–6</span><span><i class="r4"></i>&lt;5</span>
      <span style="margin-left:auto">${nImdb ? `คะแนน IMDb ${nImdb}/${nAll} ตอน` : 'คะแนน TMDb'}${!useOmdb ? ' · ใส่ OMDb key เพื่อใช้คะแนน IMDb' : ''}</span>
    </div>
    <div class="graph-wrap" style="margin-top:10px">${lineChart(data)}</div>
    ${t ? '<p class="faint" style="font-size:12px;margin:6px 0 0">กรอบขาว = ตอนที่ดูถึงล่าสุด</p>' : ''}`;
}

function lineChart(data) {
  const pts = [];
  data.forEach((s, si) => s.eps.forEach((e) => { if (e.r != null) pts.push({ si, s: s.season, n: e.n, r: e.r, name: e.name }); }));
  if (pts.length < 2) return '';
  const W = 760, H = 220, L = 30, R = 10, T = 12, B = 24;
  const lo = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.r)) - 0.5));
  const hi = 10;
  const x = (i) => L + (i * (W - L - R)) / (pts.length - 1);
  const y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const colors = ['#f2b544', '#7cc4f5'];
  let grid = '';
  for (let v = Math.ceil(lo); v <= hi; v++) grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#352f41" stroke-width="1"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#6f6880">${v}</text>`;
  let lines = '';
  let labels = '';
  data.forEach((s, si) => {
    const idx = pts.map((p, i) => (p.si === si ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return;
    const c = colors[si % 2];
    lines += `<polyline fill="none" stroke="${c}" stroke-width="2" points="${idx.map((i) => `${x(i).toFixed(1)},${y(pts[i].r).toFixed(1)}`).join(' ')}"/>`;
    lines += idx.map((i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(pts[i].r).toFixed(1)}" r="3" fill="${c}"><title>S${pts[i].s}E${pts[i].n} ${esc(pts[i].name || '')} · ${pts[i].r.toFixed(1)}</title></circle>`).join('');
    const mid = (x(idx[0]) + x(idx[idx.length - 1])) / 2;
    labels += `<text x="${mid.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#a49cb3">S${s.season}</text>`;
  });
  return `<svg class="line-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟคะแนนรายตอน">${grid}${lines}${labels}</svg>`;
}

/* =========================================================
   Settings
   ========================================================= */

async function openSettings() {
  S.modal = { kind: 'settings' };
  try { S.hh = await S.db.getHousehold(S.hh.id) || S.hh; } catch { /* keep cached */ }
  const local = S.db.kind === 'local';
  const joinLink = `${location.origin}${location.pathname}?join=${S.hh.invite_code}`;
  const me = S.members.find((m) => m.user_id === S.user.id);
  const cfg = getSupabaseConfig();
  const body = openModal(`
    <h2 style="margin-bottom:16px">ตั้งค่า</h2>
    <form id="f-settings">
      <label class="field"><span>ชื่อลิสต์</span><input type="text" name="name" value="${esc(S.hh.name)}" maxlength="40"></label>
      <label class="field"><span>ชื่อของฉัน</span><input type="text" name="display" value="${esc(me?.display_name || '')}" maxlength="20"></label>
      ${local ? '' : `
      <div class="field"><span>ชวนแฟนเข้าลิสต์</span>
        <div class="row"><span class="chip gold" style="font-size:16px;letter-spacing:.2em;padding:4px 12px">${esc(S.hh.invite_code)}</span>
        <button type="button" class="btn sm" data-act="copy-invite" data-link="${esc(joinLink)}">คัดลอกลิงก์ชวน</button></div>
        <small>แฟนเปิดลิงก์ → สมัคร → รหัสจะถูกใส่ให้อัตโนมัติ</small></div>
      <div class="field"><span>สมาชิก</span><div class="row">${S.members.map((m) => `<span class="row" style="gap:6px">${avatar(m.user_id)}${esc(m.display_name)}</span>`).join('')}</div></div>`}
      <label class="field"><span>TMDb API key (v3) หรือ Read Access Token</span>
        <input type="password" name="tmdb" value="${esc(S.hh.tmdb_key || '')}" autocomplete="off" placeholder="จำเป็น: ค้นหา โปสเตอร์ นักแสดง ทุน/รายได้">
        <small>สมัครฟรีที่ <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">themoviedb.org/settings/api</a> ${local ? '' : '· ใส่ครั้งเดียว ใช้ได้ทั้งสองคน'}</small></label>
      <label class="field"><span>OMDb API key</span>
        <input type="password" name="omdb" value="${esc(S.hh.omdb_key || '')}" autocomplete="off" placeholder="ไม่บังคับ: คะแนน IMDb, Rotten Tomatoes, Metacritic">
        <small>ฟรี 1,000 ครั้ง/วันที่ <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noopener">omdbapi.com/apikey.aspx</a></small></label>
      <button class="btn primary block">บันทึก</button>
    </form>
    <div class="row" style="margin-top:20px">
      <button class="btn ghost grow" data-act="signout">${local ? 'ออกจากโหมดเครื่องเดียว' : 'ออกจากระบบ'}</button>
      ${cfg?.from === 'local' ? '<button class="btn ghost grow" data-act="reset-sb">เปลี่ยนฐานข้อมูล</button>' : ''}
    </div>
    <p class="faint" style="font-size:12px;margin-top:14px">${local ? 'โหมดเครื่องเดียว: ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น' : `เข้าสู่ระบบเป็น ${esc(S.user.email || '')}`}</p>`);
  $('#f-settings', body).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const keysChanged = (f.get('tmdb').trim() || null) !== (S.hh.tmdb_key || null) || (f.get('omdb').trim() || null) !== (S.hh.omdb_key || null);
      S.hh = await S.db.updateHousehold(S.hh.id, { name: f.get('name').trim() || 'บ้านเรา', tmdb_key: f.get('tmdb').trim() || null, omdb_key: f.get('omdb').trim() || null });
      const display = f.get('display').trim();
      if (display && display !== me?.display_name) await S.db.updateMember(S.hh.id, { display_name: display });
      if (keysChanged) { memCache.clear(); try { sessionStorage.clear(); } catch { /* ignore */ } }
      await reload();
      closeModal();
      renderMain();
      toast('บันทึกแล้ว');
    } catch (err) { toast(errMsg(err)); }
  };
}

/* =========================================================
   Global events
   ========================================================= */

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const t = el.dataset.id ? S.titles.find((x) => x.id === el.dataset.id) : null;
  if (act !== 'open') e.stopPropagation();
  switch (act) {
    case 'settings': openSettings(); break;
    case 'tab': S.tab = el.dataset.tab; ls.set('wt_tab', S.tab); renderMain(); break;
    case 'open': if (t) openDetail(t.media_type, t.tmdb_id); break;
    case 'up': if (t) moveInQueue(t, -1); break;
    case 'down': if (t) moveInQueue(t, 1); break;
    case 'status': if (t) setStatus(t, el.dataset.status); break;
    case 'ep': if (t) nextEpisode(t); break;
    default: break;
  }
});

modalRoot.addEventListener('click', async (e) => {
  if (e.target.classList.contains('overlay')) return closeModal();
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const cur = S.detail ? findTitle(S.detail.type, S.detail.id) : null;
  switch (act) {
    case 'close': closeModal(); break;
    case 'r-add': {
      el.disabled = true;
      await addTitle(S.results[el.dataset.i], el.dataset.status);
      renderResults();
      break;
    }
    case 'r-detail': { const x = S.results[el.dataset.i]; openDetail(x.media_type, x.id); break; }
    case 'd-add': {
      const d = S.detail.d || { id: S.detail.id };
      await addTitle({ ...d, media_type: S.detail.type }, el.dataset.status);
      renderOurs();
      break;
    }
    case 'd-status': if (cur) { await setStatus(cur, el.dataset.status); if (S.modal?.kind === 'detail') renderOurs(); } break;
    case 'd-ep': if (cur) { await nextEpisode(cur); renderOurs(); } break;
    case 'd-review': saveReview(); break;
    case 'd-delete':
      if (cur && confirm(`ลบ “${cur.title}” ออกจากลิสต์? (รีวิวของทั้งคู่จะหายไปด้วย)`)) {
        try {
          await S.db.deleteTitle(cur.id);
          S.titles = S.titles.filter((x) => x.id !== cur.id);
          S.reviews = S.reviews.filter((x) => x.title_id !== cur.id);
          closeModal(); renderMain(); toast('ลบแล้ว');
        } catch (err) { toast(errMsg(err)); }
      }
      break;
    case 'graph': loadGraph().catch((err) => { $('#d-graph').innerHTML = `<div class="err">${esc(errMsg(err))}</div>`; }); break;
    case 'copy-invite': {
      const link = el.dataset.link;
      if (navigator.share) { try { await navigator.share({ title: 'ดูด้วยกัน', text: `มาใช้ลิสต์ดูหนังด้วยกัน รหัสเชิญ ${S.hh.invite_code}`, url: link }); break; } catch { /* fall through to copy */ } }
      try { await navigator.clipboard.writeText(link); toast('คัดลอกลิงก์แล้ว'); } catch { prompt('คัดลอกลิงก์นี้', link); }
      break;
    }
    case 'signout': S.db.signOut(); break;
    case 'reset-sb': if (confirm('ลืมการเชื่อมต่อ Supabase ในเครื่องนี้?')) { ls.del('wt_sb'); await S.db.signOut(); } break;
    default: break;
  }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.modal) closeModal(); });

/* =========================================================
   Boot
   ========================================================= */

function captureParams() {
  const p = new URLSearchParams(location.search);
  if (p.get('join')) ls.set('wt_join', p.get('join').toUpperCase());
  const shared = [p.get('url'), p.get('text'), p.get('title')].filter(Boolean);
  if (shared.length) {
    const withId = shared.find((s) => /tt\d{5,}|themoviedb\.org\/(movie|tv)\/\d+/.test(s));
    S.pendingShare = withId || p.get('title') || p.get('text') || p.get('url');
  }
  if (p.get('add')) S.pendingShare = p.get('add');
  if ([...p.keys()].length && !location.hash.includes('access_token')) history.replaceState(null, '', location.pathname);
}

let reloadTimer;
function onRemoteChange() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    try { await reload(); } catch { return; }
    renderMain();
    if (S.modal?.kind === 'detail' && !$('#d-ours')?.contains(document.activeElement)) renderOurs();
    if (S.modal?.kind === 'search') renderResults();
  }, 400);
}

async function afterLogin() {
  try {
    S.hh = await S.db.myHousehold();
    if (!S.hh) return renderOnboard();
    await reload();
  } catch (e) {
    app.innerHTML = `<div class="center-wrap"><div class="panel"><h1>เชื่อมต่อไม่ได้</h1><p class="err">${esc(errMsg(e))}</p>
      <p class="muted">ถ้าเพิ่งสร้างโปรเจกต์ ตรวจว่ารัน supabase/schema.sql แล้ว</p>
      <div class="row"><button class="btn primary" onclick="location.reload()">ลองใหม่</button>
      <button class="btn ghost" id="btn-reset">เปลี่ยนการเชื่อมต่อ</button></div></div></div>`;
    $('#btn-reset').onclick = () => { ls.del('wt_sb'); ls.del('wt_mode'); location.reload(); };
    return;
  }
  S.unsub?.();
  S.unsub = S.db.subscribe(S.hh.id, onRemoteChange);
  renderMain();
  if (S.pendingShare) { const q = S.pendingShare; S.pendingShare = null; openSearch(q); }
}

async function boot() {
  captureParams();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (ls.get('wt_mode') === 'local') {
    S.db = localBackend();
    S.user = { id: 'local-user', email: '' };
    return afterLogin();
  }
  const cfg = getSupabaseConfig();
  if (!cfg) return renderSetup();
  const sb = createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  S.db = supabaseBackend(sb);
  const { data: { session } } = await sb.auth.getSession();
  sb.auth.onAuthStateChange((ev, sess) => {
    if (ev === 'SIGNED_OUT') { S.user = null; S.hh = null; renderAuth(); }
    if (ev === 'SIGNED_IN' && sess && !S.user) { S.user = sess.user; afterLogin(); }
  });
  if (!session) return renderAuth();
  S.user = session.user;
  await afterLogin();
}

boot().catch((e) => {
  app.innerHTML = `<div class="center-wrap"><div class="panel"><h1>เกิดข้อผิดพลาด</h1><p class="err">${esc(errMsg(e))}</p></div></div>`;
});
