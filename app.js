'use strict';
/* =====================================================================
   Учебный планер. Весь код работает в браузере, сервера нет.
   Данные: localStorage (кэш) + Google Drive (скрытая папка приложения).
   ===================================================================== */

/* ---------- Конфигурация ---------- */
const CLIENT_ID = '427778180640-n28krbjd59qgqp5nskod3m0b1urqk5d6.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const DATA_NAME = 'planner-data.json';
const MAX_FILE = 100 * 1024 * 1024;
const APP_VERSION = '1.4';

/* ---------- Мелкие помощники ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const isoDow = d => ((d.getDay() + 6) % 7) + 1;
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* хранилище недоступно */ } };

const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const DAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const TYPES = { lecture: 'Лекция', practice: 'Практика', lab: 'Лабораторная', seminar: 'Семинар', other: 'Другое' };
const COLORS = ['#4f6bed', '#e8590c', '#2f9e44', '#ae3ec9', '#d6336c', '#0c8599', '#f08c00', '#5c7cfa', '#868e96'];
const fmtDate = d => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
const fmtDateFull = s => { const d = parseYmd(s), y = d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''; return `${DAYS_SHORT[isoDow(d) - 1]}, ${fmtDate(d)}${y}`; };
const fmtSize = b => b < 1024 ? b + ' Б' : b < 1048576 ? (b / 1024).toFixed(0) + ' КБ' : (b / 1048576).toFixed(1) + ' МБ';
const fmtTime = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const ICONS = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  week: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16M15 4v16"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
  schedule: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  tasks: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  library: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'
};
const TABS = [['today', 'Сегодня'], ['week', 'Неделя'], ['calendar', 'Календарь'], ['schedule', 'Расписание'], ['tasks', 'Задачи'], ['library', 'Материалы'], ['settings', 'Настройки']];
/* Локальные файлы для ссылок в меню хранятся в самом браузере (IndexedDB) — только на этом устройстве */
const idb = (() => {
  let db;
  const open = () => db || (db = new Promise((res, rej) => {
    const r = indexedDB.open('planner-local', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('f');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = (mode, fn) => open().then(d => new Promise((res, rej) => { const t = d.transaction('f', mode), q = fn(t.objectStore('f')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }));
  return { put: (k, v) => tx('readwrite', s => s.put(v, k)), get: k => tx('readonly', s => s.get(k)), del: k => tx('readwrite', s => s.delete(k)) };
})();
const guessMime = f => f.type || ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain', html: 'text/html' })[(f.name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

/* значки для своих ссылок в меню */
const LINK_ICONS = {
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  video: '<rect x="3" y="6" width="12" height="12" rx="2"/><path d="M15 10l6-3v10l-6-3"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5M22 9v6"/>',
  code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/>',
  music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19.5 10 4 4 0 0 1 18 18z"/>',
  heart: '<path d="M12 20s-8-4.9-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6.1-8 11-8 11z"/>'
};
const CHECKS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7l3 3 5-6M4 17l3 3 5-6M15 8h5M15 18h5"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>';

/* ---------- Данные ---------- */
const COLLS = ['subjects', 'classes', 'tasks', 'files', 'library', 'links'];
const emptyState = () => ({ v: 1, settings: { start: '', firstWeek: 1, u: 0 }, subjects: [], classes: [], tasks: [], files: [], library: [], links: [] });
const LS_STATE = 'planner.state.v1', LS_META = 'planner.meta.v1', SS_TOKEN = 'planner.token';

let S = (() => { try { const j = JSON.parse(lsGet(LS_STATE)); if (j && j.v) return Object.assign(emptyState(), j); } catch (e) { /* пусто */ } return emptyState(); })();
let meta = (() => { try { return JSON.parse(lsGet(LS_META)) || {}; } catch (e) { return {}; } })();
const persist = () => lsSet(LS_STATE, JSON.stringify(S));
const saveMeta = () => lsSet(LS_META, JSON.stringify(meta));

const live = c => S[c].filter(x => !x.d);
const byId = (c, id) => S[c].find(x => x.id === id && !x.d);
function upsert(c, obj) { obj.u = Date.now(); const i = S[c].findIndex(x => x.id === obj.id); if (i < 0) S[c].push(obj); else S[c][i] = obj; return obj; }
function tomb(c, id, extra = {}) { const i = S[c].findIndex(x => x.id === id); if (i >= 0) S[c][i] = { id, d: true, u: Date.now(), ...extra }; }

/* Слияние двух состояний: побеждает запись с более поздним временем изменения (u). */
function mergeState(L, R) {
  let pushNeeded = false, pullChanged = false;
  for (const c of COLLS) {
    const lm = new Map((L[c] || []).map(x => [x.id, x]));
    const rm = new Map((R[c] || []).map(x => [x.id, x]));
    for (const [id, rx] of rm) { const lx = lm.get(id); if (!lx || (rx.u || 0) > (lx.u || 0)) { lm.set(id, rx); pullChanged = true; } }
    for (const [id, lx] of lm) { const rx = rm.get(id); if (!rx || (lx.u || 0) > (rx.u || 0)) pushNeeded = true; }
    L[c] = [...lm.values()].filter(x => !(x.d && !x.driveId && Date.now() - (x.u || 0) > 90 * 864e5));
  }
  const ru = (R.settings && R.settings.u) || 0, lu = L.settings.u || 0;
  if (ru > lu) { L.settings = R.settings; pullChanged = true; } else if (lu > ru) pushNeeded = true;
  return { pushNeeded, pullChanged };
}

/* ---------- Недели ---------- */
function weekInfo(date) {
  if (!S.settings.start) return null;
  const diff = Math.round((mondayOf(date) - mondayOf(parseYmd(S.settings.start))) / 604800000);
  const n = Number(S.settings.firstWeek || 1) + diff;
  return { n, odd: ((n % 2) + 2) % 2 === 1, before: diff < 0 };
}
function weekLabel(wi) {
  if (!wi) return 'Укажите дату начала семестра в настройках';
  if (wi.before) return 'До начала семестра';
  return `Неделя ${wi.n} · ${wi.odd ? 'нечётная' : 'чётная'}`;
}
const weekBadge = wi => wi && !wi.before ? `<span class="badge ${wi.odd ? 'odd' : 'even'}">${esc(weekLabel(wi))}</span>` : `<span>${esc(weekLabel(wi))}</span>`;
function classesOn(date) {
  const wi = weekInfo(date), dow = isoDow(date);
  return live('classes')
    .filter(c => c.date ? c.date === ymd(date) : c.day === dow && (!wi || wi.before || c.parity === 'all' || (c.parity === 'odd') === wi.odd))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/* ---------- Состояние интерфейса ---------- */
const ui = {
  tab: lsGet('planner.tab') || 'today', wo: 0, mo: 0, md: null, tf: 'open', lq: '', ls: '',
  /* в расписании сразу показываем недели той же чётности, что и текущая */
  sp: (() => { const w = weekInfo(new Date()); return w && !w.before && !w.odd ? 'even' : 'odd'; })()
};
if (!TABS.some(t => t[0] === ui.tab)) ui.tab = 'today';
let draft = { files: [], pending: [], removed: [] };

/* =====================================================================
   Google: вход и Drive
   ===================================================================== */
let token = null, tokenExp = 0, tokenClient = null, tokenPromise = null, cbRes = null, cbRej = null;
let dataFileId = lsGet('planner.dataFileId') || null;
let syncState = 'idle', syncErr = '', syncing = false, syncAgain = false, syncTimer = null;

try { const t = JSON.parse(sessionStorage.getItem(SS_TOKEN)); if (t && t.exp > Date.now() + 60000) { token = t.t; tokenExp = t.exp; } } catch (e) { /* нет токена */ }

function loadGis() {
  return new Promise((res, rej) => {
    if (window.google && google.accounts && google.accounts.oauth2) return res();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error('Не удалось загрузить вход Google. Проверьте интернет.'));
    document.head.appendChild(s);
  });
}
function getToken() {
  if (token && Date.now() < tokenExp - 60000) return Promise.resolve(token);
  if (tokenPromise) return tokenPromise;
  tokenPromise = (async () => {
    try {
      await loadGis();
      if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID, scope: SCOPE,
          callback: r => {
            if (r.error) return cbRej && cbRej(new Error(r.error));
            token = r.access_token; tokenExp = Date.now() + (+r.expires_in || 3600) * 1000;
            try { sessionStorage.setItem(SS_TOKEN, JSON.stringify({ t: token, exp: tokenExp })); } catch (e) { /* ок */ }
            meta.signedIn = true; saveMeta();
            cbRes && cbRes(token);
          },
          error_callback: e => cbRej && cbRej(new Error((e && e.type) || 'popup_failed_to_open'))
        });
      }
      return await new Promise((res, rej) => { cbRes = res; cbRej = rej; tokenClient.requestAccessToken({ prompt: '' }); });
    } finally { tokenPromise = null; }
  })();
  return tokenPromise;
}
async function gfetch(url, opts = {}) {
  if (!meta.signedIn) throw new Error('auth');
  const t = await getToken();
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t } });
  if (r.status === 401) { token = null; tokenExp = 0; throw new Error('auth'); }
  if (!r.ok) throw new Error('Drive ' + r.status);
  return r;
}
function errText(e) {
  const m = (e && e.message) || String(e);
  if (m === 'auth' || /popup|access_denied|user_logged_out|interaction/i.test(m)) return 'Нужно войти в Google: нажмите «Синхронизировать» в настройках';
  if (m === 'Drive 404') return 'Файл не найден на Google Drive';
  if (m === 'Drive 403') return 'Google Drive отказал в доступе (проверьте разрешения)';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Нет соединения с интернетом';
  return m;
}
async function multipart(metaObj, blob, mime) {
  const b = 'pl' + Math.random().toString(36).slice(2);
  const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metaObj)}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`, blob, `\r\n--${b}--`]);
  const r = await gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body
  });
  return r.json();
}
async function findDataFile() {
  if (dataFileId) return dataFileId;
  const q = encodeURIComponent(`name='${DATA_NAME}' and 'appDataFolder' in parents and trashed=false`);
  const r = await gfetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`);
  const j = await r.json();
  if (j.files && j.files.length) { dataFileId = j.files[0].id; lsSet('planner.dataFileId', dataFileId); }
  return dataFileId;
}

async function syncNow() {
  if (!meta.signedIn) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true; syncState = 'busy'; renderSync();
  try {
    let id = await findDataFile(), remote = null;
    if (id) {
      try { remote = await (await gfetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).json(); }
      catch (e) { if (e.message === 'Drive 404') { dataFileId = null; id = null; lsSet('planner.dataFileId', ''); } else throw e; }
    }
    if (remote && !remote.v) remote = null;
    let pull = false, push = !remote || meta.dirty;
    if (remote && remote.v) { const r = mergeState(S, remote); pull = r.pullChanged; push = push || r.pushNeeded; }
    if (push) {
      const json = JSON.stringify(S);
      if (id) await gfetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json });
      else { const c = await multipart({ name: DATA_NAME, parents: ['appDataFolder'] }, new Blob([json], { type: 'application/json' }), 'application/json'); dataFileId = c.id; lsSet('planner.dataFileId', dataFileId); }
    }
    meta.dirty = false; meta.lastSync = Date.now(); saveMeta();
    persist();
    syncState = 'ok'; syncErr = '';
    await purgeDeletedFiles();
    if (pull) render();
  } catch (e) {
    syncState = 'err'; syncErr = errText(e);
  } finally {
    syncing = false; renderSync();
    if (ui.tab === 'settings') render();
    if (syncAgain) { syncAgain = false; scheduleSync(); }
  }
}
async function purgeDeletedFiles() {
  let changed = false;
  for (const f of S.files) {
    if (f.d && f.driveId) {
      try { await gfetch(`https://www.googleapis.com/drive/v3/files/${f.driveId}`, { method: 'DELETE' }); delete f.driveId; changed = true; }
      catch (e) { if (e.message === 'Drive 404') { delete f.driveId; changed = true; } }
    }
  }
  if (changed) persist();
}
function scheduleSync() {
  if (!meta.signedIn) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 1200);
}
function commit() { meta.dirty = true; saveMeta(); persist(); render(); scheduleSync(); }

async function uploadAndRecord(file) {
  if (!meta.signedIn) throw new Error('Чтобы прикреплять файлы, войдите в Google (Настройки → Google Drive)');
  if (file.size > MAX_FILE) throw new Error(`Файл «${file.name}» больше ${fmtSize(MAX_FILE)}`);
  const c = await multipart({ name: file.name, parents: ['appDataFolder'] }, file, file.type || 'application/octet-stream');
  const rec = { id: uid(), name: file.name, mime: file.type || '', size: file.size, driveId: c.id };
  upsert('files', rec);
  return rec;
}
function removeFile(fid) { const f = S.files.find(x => x.id === fid); if (f) tomb('files', fid, { driveId: f.driveId }); }

async function openFile(fid) {
  const f = byId('files', fid);
  if (!f) return toast('Файл не найден');
  const preview = /^(image\/|application\/pdf|text\/)/.test(f.mime || '');
  const w = preview ? window.open('', '_blank') : null;
  try {
    toast('Загрузка файла…');
    if (!meta.signedIn) throw new Error('auth');
    const blob = await (await gfetch(`https://www.googleapis.com/drive/v3/files/${f.driveId}?alt=media`)).blob();
    let type = f.mime || blob.type || 'application/octet-stream';
    if (/^text\//.test(type) && !/charset/i.test(type)) type += '; charset=utf-8';
    const url = URL.createObjectURL(new Blob([blob], { type }));
    if (w) w.location.href = url;
    else { const a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (e) { if (w) w.close(); toast(errText(e)); }
}

/* =====================================================================
   Отрисовка
   ===================================================================== */
let toastTimer = null;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}
function syncInfo() {
  if (!meta.signedIn) return { cls: '', text: 'Данные только на этом устройстве' };
  if (syncState === 'busy') return { cls: 'st-busy', text: 'Синхронизация…' };
  if (syncState === 'err') return { cls: 'st-err', text: syncErr || 'Ошибка синхронизации' };
  if (meta.lastSync) return { cls: 'st-ok', text: 'Синхронизировано в ' + fmtTime(meta.lastSync) };
  return { cls: '', text: 'Вход выполнен' };
}
function renderSync() {
  const i = syncInfo();
  $('#sync').innerHTML = `<div class="${i.cls}">${esc(i.text)}</div>` +
    (meta.signedIn ? `<button class="btn small" style="margin-top:8px" data-act="syncNow">Синхронизировать</button>`
      : `<button class="btn small primary" style="margin-top:8px" data-act="signIn">Войти через Google</button>`);
}
function renderTabs() {
  $('#tabs').innerHTML = TABS.map(([k, l]) =>
    `<button class="tab ${ui.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}" ${ui.tab === k ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg><span>${l}</span></button>`).join('');
}
function linkIcon(l) {
  return l.glyph ? `<span class="gl">${esc(l.glyph)}</span>` : `<svg viewBox="0 0 24 24" aria-hidden="true">${LINK_ICONS[l.icon] || LINK_ICONS.link}</svg>`;
}
function renderLinks() {
  const ls = live('links').filter(l => !l.hidden).sort((x, y) => (x.n || 0) - (y.n || 0));
  const box = $('#navlinks');
  box.innerHTML = ls.map(l => `<a class="navlink" ${l.kind === 'file' ? `href="#" data-act="openLocal" data-id="${l.id}"` : `href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"`} style="--c:${esc(l.color || '#4f63ec')}" title="${esc(l.title)}"><i class="lk">${linkIcon(l)}</i><span>${esc(l.title)}</span></a>`).join('');
  document.documentElement.classList.toggle('has-links', ls.length > 0);
}
function render() {
  renderTabs(); renderLinks();
  const views = { today: vToday, week: vWeek, calendar: vMonth, schedule: vSchedule, tasks: vTasks, library: vLibrary, settings: vSettings };
  $('#view').innerHTML = views[ui.tab]();
  renderSync();
}

const subj = id => byId('subjects', id);
const taskColor = t => t.kind === 'extra' ? (t.color || null) : (subj(t.subjectId) || {}).color || null;
const byDue = (a, b) => (a.due || '9').localeCompare(b.due || '9') || (b.priority || 0) - (a.priority || 0);

const CAL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>';
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.5 7.5A17 17 0 0 0 2 12s3.5 6 10 6c1.5 0 2.8-.3 4-.8"/><path d="M9.9 10a3 3 0 0 0 4.1 4.1"/></svg>';
const PEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg>';
const CLIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/></svg>';
const CLOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>';
const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return n + ' ' + (m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c); };
const isNow = c => { const n = new Date(), t = pad(n.getHours()) + ':' + pad(n.getMinutes()); return (c.date ? c.date === ymd(n) : isoDow(n) === c.day) && c.start <= t && t < c.end; };

/* Карточка пары. o.now — подсветить «идёт сейчас», o.hideParity — не показывать чётность */
function classHtml(c, o = {}) {
  const s = subj(c.subjectId);
  const tags = [`<span class="pill ty">${esc(TYPES[c.type] || 'Занятие')}</span>`];
  if (c.room) tags.push(`<span class="pill rm">${PIN}${esc(c.room)}</span>`);
  const badge = o.now ? '<span class="badge now">идёт сейчас</span>'
    : c.date ? `<span class="badge once">${o.showDate ? esc(fmtDate(parseYmd(c.date))) : 'разово'}</span>`
    : !o.hideParity && c.parity === 'odd' ? '<span class="badge odd">нечёт.</span>'
    : !o.hideParity && c.parity === 'even' ? '<span class="badge even">чёт.</span>' : '';
  if (o.date && c.subjectId) {
    const n = live('tasks').filter(t => !t.done && t.subjectId === c.subjectId && t.due === o.date).length;
    if (n) tags.push(`<span class="pill tk">${CHECK}${n}</span>`);
  }
  return `<div class="item cls ty-${esc(c.type)} ${o.now ? 'now' : ''} ${o.past ? 'past' : ''}" style="--c:${s ? esc(s.color) : '#888'}" data-act="${o.date ? 'classMenu' : 'editClass'}" data-id="${c.id}" ${o.date ? `data-date="${esc(o.date)}"` : ''}>
    <div class="time"><b>${esc(c.start)}</b><span>${esc(c.end)}</span></div>
    <div class="body"><div class="t">${esc(s ? s.name : 'Без предмета')}</div>
      <div class="tags">${tags.join('')}${badge}</div>${c.teacher ? `<div class="m">${esc(c.teacher)}</div>` : ''}</div></div>`;
}
function taskHtml(t, showDue = true) {
  const s = subj(t.subjectId), td = ymd(new Date());
  const od = !t.done && t.due && t.due < td;
  const parts = [];
  const tc = taskColor(t);
  parts.push(t.kind === 'extra' ? `<span class="mi sj">${tc ? `<span class="dot" style="background:${esc(tc)}"></span>` : ''}<span>Доп. задача</span></span>`
    : s ? `<span class="mi sj"><span class="dot" style="background:${esc(s.color)}"></span><span>${esc(s.name)}</span></span>`
    : `<span class="mi">Учёба</span>`);
  const subs = t.subs || [], sd = subs.filter(x => x.done).length;
  if (showDue && !t.due && !t.done) parts.push('<span class="mi nodate">Без срока</span>');
  if (subs.length) parts.push(`<span class="mi ${sd === subs.length ? 'ok' : ''}">${CHECKS}${sd}/${subs.length}</span>`);
  if (showDue && t.due) parts.push(`<span class="mi due ${od ? 'od' : !t.done && t.due === td ? 'td' : ''}">${CAL}${t.due === td ? 'Сегодня' : esc(fmtDateFull(t.due))}</span>`);
  const nf = (t.files || []).filter(f => byId('files', f)).length;
  if (nf) parts.push(`<span class="mi">${CLIP}${nf}</span>`);
  if (t.priority && !t.done) parts.push('<span class="mi imp">Важно</span>');
  return `<div class="item task ${t.done ? 'done' : ''} ${t.priority && !t.done ? 'imp' : ''} ${tc ? 'tc' : ''}" ${tc ? `style="--c:${esc(tc)}"` : ''}>
    <button class="chk" data-act="toggleTask" data-id="${t.id}" aria-label="${t.done ? 'Вернуть в работу' : 'Отметить выполненной'}">${t.done ? CHECK : ''}</button>
    <div class="body" data-act="editTask" data-id="${t.id}"><div class="t">${esc(t.title)}</div><div class="meta">${parts.join('')}</div>
    ${subs.length && !t.done ? `<div class="subs">${subs.map(x => `<div class="sub ${x.done ? 'done' : ''}"><button type="button" class="chk sm" data-act="toggleSub" data-id="${t.id}" data-sid="${x.id}" aria-label="${x.done ? 'Вернуть в работу' : 'Отметить выполненной'}">${x.done ? CHECK : ''}</button><span>${esc(x.text)}</span></div>`).join('')}</div>` : ''}</div></div>`;
}
function onboarding() {
  if (S.settings.start && live('classes').length) return '';
  return `<div class="hint"><b>С чего начать</b>1. В настройках укажите дату начала семестра и номер первой недели.<br>2. Добавьте пары в расписание — укажите, на каких неделях они проходят.<br>3. Добавляйте задачи и учебные материалы.
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" data-act="tab" data-v="settings">Настройки</button><button class="btn small" data-act="newClass">Добавить пару</button></div></div>`;
}

const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const fmtDur = m => m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч${m % 60 ? ' ' + (m % 60) + ' мин' : ''}`;
function heroHtml(cl, now) {
  const nm = now.getHours() * 60 + now.getMinutes(), td = ymd(now);
  if (!S.settings.start) return '';
  if (!cl.length) return `<div class="hero calm"><div class="hero-k">Сегодня</div><div class="hero-t">Пар нет — свободный день</div></div>`;
  const cur = cl.find(c => toMin(c.start) <= nm && nm < toMin(c.end)), nxt = cl.find(c => toMin(c.start) > nm);
  if (!cur && !nxt) return `<div class="hero calm"><div class="hero-k">Сегодня</div><div class="hero-t">Пары закончились</div>
    <div class="hero-m"><span>${plural(cl.length, 'пара', 'пары', 'пар')} позади · ${esc(cl[0].start)}–${esc(cl[cl.length - 1].end)}</span></div></div>`;
  const c = cur || nxt, s = subj(c.subjectId), name = s ? s.name : 'Пара';
  const k = cur ? `<i class="pulse"></i>Идёт сейчас · ещё ${fmtDur(toMin(c.end) - nm)}` : `Следующая · через ${fmtDur(toMin(c.start) - nm)}`;
  const pr = cur ? Math.round((nm - toMin(c.start)) / (toMin(c.end) - toMin(c.start)) * 100) : 0;
  const after = cur && nxt ? (() => { const ns = subj(nxt.subjectId); return `<div class="hero-n">Дальше в ${esc(nxt.start)} — ${esc(ns ? ns.name : 'пара')}${nxt.room ? ', ' + esc(nxt.room) : ''}</div>`; })() : '';
  return `<div class="hero" style="--c:${s ? esc(s.color) : '#4f63ec'}" data-act="classMenu" data-id="${c.id}" data-date="${td}">
    <div class="hero-k">${k}</div><div class="hero-t">${esc(name)}</div>
    <div class="hero-m"><span>${CLOCK}${esc(c.start)}–${esc(c.end)}</span><span>${esc(TYPES[c.type] || 'Занятие')}</span>${c.room ? `<span>${PIN}${esc(c.room)}</span>` : ''}</div>
    ${cur ? `<div class="bar"><i style="width:${pr}%"></i></div>` : ''}${after}</div>`;
}
/* С какого времени «Сегодня» показывает пары завтра ('' — выключено, по умолчанию 20:00) */
const tomorrowAfter = () => S.settings.tomorrowAfter === undefined ? '20:00' : (S.settings.tomorrowAfter || '');
function heroTomorrow(cl, tm) {
  const d = ymd(tm), title = `${DAYS[isoDow(tm) - 1]}, ${fmtDate(tm)}`;
  if (!cl.length) return `<div class="hero calm"><div class="hero-k">Завтра · ${esc(title)}</div><div class="hero-t">Пар нет — свободный день</div></div>`;
  const c = cl[0], s = subj(c.subjectId);
  return `<div class="hero" style="--c:${s ? esc(s.color) : '#4f63ec'}" data-act="classMenu" data-id="${c.id}" data-date="${d}">
    <div class="hero-k">Завтра · первая пара в ${esc(c.start)}</div><div class="hero-t">${esc(s ? s.name : 'Пара')}</div>
    <div class="hero-m"><span>${CLOCK}${esc(c.start)}–${esc(c.end)}</span><span>${esc(TYPES[c.type] || 'Занятие')}</span>${c.room ? `<span>${PIN}${esc(c.room)}</span>` : ''}</div>
    <div class="hero-n">Всего завтра: ${plural(cl.length, 'пара', 'пары', 'пар')} · до ${esc(cl[cl.length - 1].end)}</div></div>`;
}
function vToday() {
  const now = new Date(), td = ymd(now), wi = weekInfo(now), cl = classesOn(now), nm = now.getHours() * 60 + now.getMinutes();
  const open = live('tasks').filter(t => !t.done);
  const overdue = open.filter(t => t.due && t.due < td).sort(byDue);
  const tod = live('tasks').filter(t => t.due === td).sort((a, b) => (a.done - b.done) || byDue(a, b));
  const nodate = open.filter(t => !t.due).sort((a, b) => (b.priority || 0) - (a.priority || 0) || (a.created || 0) - (b.created || 0));
  const soonEnd = ymd(addDays(now, 7));
  const soon = open.filter(t => t.due > td && t.due <= soonEnd).sort(byDue);
  const left = cl.filter(c => toMin(c.end) > nm).length, todOpen = tod.filter(t => !t.done).length;
  const ta = tomorrowAfter(), tm = addDays(now, 1), useTom = !!ta && nm >= toMin(ta) && !!S.settings.start, clT = useTom ? classesOn(tm) : [];
  return `<div class="head"><div><h1>${DAYS[isoDow(now) - 1]}, ${fmtDate(now)}</h1><div class="sub">${weekBadge(wi)}</div></div>
    <div class="actions"><button class="btn primary" data-act="newTask">+ Задача</button></div></div>
    ${onboarding()}
    ${useTom ? heroTomorrow(clT, tm) : heroHtml(cl, now)}
    <div class="stats"><div class="stat"><b>${useTom ? clT.length : cl.length ? left : 0}</b><span>${useTom ? plural(clT.length, 'пара', 'пары', 'пар').replace(/^\d+ /, '') + ' завтра' : cl.length ? 'пар осталось' : 'пар нет'}</span></div>
      <div class="stat"><b>${todOpen}</b><span>задач на сегодня</span></div>
      <div class="stat ${overdue.length ? 'bad' : ''}"><b>${overdue.length}</b><span>просрочено</span></div></div>
    <div class="today-grid"><div>
    ${useTom ? `<div class="card"><h2>Пары завтра · ${esc(DAYS[isoDow(tm) - 1])}, ${esc(fmtDate(tm))}</h2>${clT.length ? clT.map(c => classHtml(c, { date: ymd(tm) })).join('') : '<div class="empty">Завтра пар нет.</div>'}</div>`
    : `<div class="card"><h2>Пары сегодня</h2>${cl.length ? cl.map(c => classHtml(c, { now: isNow(c), past: toMin(c.end) <= nm, date: td })).join('') : '<div class="empty">Пар нет.</div>'}</div>`}</div><div>
    ${overdue.length ? `<div class="card"><h2>Просрочено</h2>${overdue.map(t => taskHtml(t)).join('')}</div>` : ''}
    <div class="card"><h2>Задачи на сегодня</h2>${tod.length ? tod.map(t => taskHtml(t, false)).join('') : '<div class="empty">На сегодня задач нет.</div>'}</div>
    ${soon.length ? `<div class="card"><h2>Ближайшие 7 дней</h2>${soon.map(t => taskHtml(t)).join('')}</div>` : ''}
    ${nodate.length ? `<div class="card"><h2>Без срока</h2>${nodate.slice(0, 6).map(t => taskHtml(t, false)).join('')}${nodate.length > 6 ? `<button type="button" class="btn small more" data-act="allNoDate">Все задачи без срока (${nodate.length})</button>` : ''}</div>` : ''}</div></div>`;
}

function vMonth() {
  const today = new Date(), td = ymd(today);
  const first = new Date(today.getFullYear(), today.getMonth() + ui.mo, 1), mi = first.getMonth();
  const gridStart = mondayOf(first), last = new Date(first.getFullYear(), mi + 1, 0);
  const weeks = Math.ceil(((last - gridStart) / 864e5 + 1) / 7);
  const sel = ui.md && parseYmd(ui.md).getMonth() === mi && parseYmd(ui.md).getFullYear() === first.getFullYear() ? ui.md
    : (td.slice(0, 7) === ymd(first).slice(0, 7) ? td : ymd(first));
  const tasks = live('tasks'), byDay = {};
  tasks.forEach(t => { if (t.due) (byDay[t.due] = byDay[t.due] || []).push(t); });
  const onceBy = {};
  live('classes').filter(c => c.date).sort((x, y) => x.start.localeCompare(y.start)).forEach(c => (onceBy[c.date] = onceBy[c.date] || []).push(c));
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(gridStart, i), k = ymd(d), all = (byDay[k] || []).sort((x, y) => (x.done - y.done) || byDue(x, y));
    const oc = onceBy[k] || [], open = all.filter(t => !t.done), n = open.length + oc.length, over = open.length && k < td;
    const items = [...oc.map(c => { const s = subj(c.subjectId);
      return { cls: 'once', c: s ? s.color : '#868e96', html: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>${esc(c.start)} ${esc(s ? s.name : 'Пара')}`, dot: true }; }),
      ...all.map(t => ({ cls: t.done ? 'done' : '', c: taskColor(t) || '#868e96', html: esc(t.title), dot: !t.done }))];
    const chips = items.slice(0, 3).map(x => `<span class="cal-t ${x.cls}" style="--c:${esc(x.c)}">${x.html}</span>`).join('');
    const more = items.length > 3 ? `<span class="cal-more">+${items.length - 3}</span>` : '';
    const dots = items.filter(x => x.dot).slice(0, 4).map(x => `<i class="${x.cls}" style="--c:${esc(x.c)}"></i>`).join('');
    cells.push(`<button type="button" class="cal-c ${d.getMonth() !== mi ? 'out' : ''} ${k === td ? 'today' : ''} ${k === sel ? 'sel' : ''} ${over ? 'over' : ''}" data-lv="${Math.min(n, 4)}" data-act="calDay" data-date="${k}" aria-label="${esc(fmtDate(d))}${n ? ', событий: ' + n : ''}">
      <span class="cal-n">${d.getDate()}</span>${n ? `<span class="cal-cnt">${n}</span>` : ''}
      <span class="cal-dots">${dots}</span><span class="cal-list">${chips}${more}</span></button>`);
  }
  const sd = parseYmd(sel), wi = weekInfo(sd), cl = classesOn(sd);
  const sts = (byDay[sel] || []).sort((x, y) => (x.done - y.done) || byDue(x, y));
  const openAll = tasks.filter(t => !t.done && t.due && t.due.slice(0, 7) === ymd(first).slice(0, 7)).length;
  return `<div class="head"><div><h1>Календарь</h1></div><div class="actions"><button class="btn primary" data-act="newTaskOn" data-date="${sel}">+ Задача</button></div></div>
    <div class="weeknav"><div class="lbl">${MONTHS_NOM[mi]} ${first.getFullYear()}<small>${openAll ? 'невыполненных задач: ' + openAll : 'задач на месяц нет'}</small></div>
      <div class="pager"><button class="btn" data-act="monthGo" data-v="-1" aria-label="Предыдущий месяц">‹</button>
      <label class="btn datebtn" data-act="pickDate" title="Перейти к дате" aria-label="Перейти к дате">${CAL}<input type="date" data-change="monthDate" value="${sel}"></label>
      <button class="btn" data-act="monthGo" data-v="1" aria-label="Следующий месяц">›</button></div>
      ${ui.mo ? '<button class="btn go-now" data-act="monthGo" data-v="0">Сегодня</button>' : ''}</div>
    <div class="cal"><div class="cal-h">${DAYS_SHORT.map(x => `<span>${x}</span>`).join('')}</div><div class="cal-g">${cells.join('')}</div></div>
    <div class="cal-legend"><span>Событий в день:</span><i data-lv="1"></i>1<i data-lv="2"></i>2<i data-lv="3"></i>3<i data-lv="4"></i>4+<i class="ov"></i>просрочено<span class="lg-once"><i class="ring"></i>разовое занятие</span></div>
    <div class="card cal-day"><div class="cal-dh"><div><h2 style="margin:0">${DAYS[isoDow(sd) - 1]}, ${esc(fmtDate(sd))}</h2><div class="m" style="color:var(--muted);font-size:13px">${esc(weekLabel(wi))}</div></div>
      <div class="btnrow" style="margin:0"><button class="btn small" data-act="newClassOn" data-date="${sel}">+ Пара</button><button class="btn small primary" data-act="newTaskOn" data-date="${sel}">+ Задача</button></div></div>
      ${cl.length ? cl.map(c => classHtml(c, { date: sel })).join('') : ''}
      ${sts.length ? sts.map(t => taskHtml(t, false)).join('') : ''}
      ${!cl.length && !sts.length ? '<div class="empty">В этот день пар и задач нет.</div>' : ''}</div>`;
}

function vWeek() {
  const today = new Date(), td = ymd(today), base = addDays(mondayOf(today), 7 * ui.wo), wi = weekInfo(base);
  const days = [...Array(7)].map((_, i) => addDays(base, i));
  const tasks = live('tasks');
  return `<div class="head"><div><h1>Неделя</h1></div><div class="actions"><button class="btn primary" data-act="newTask">+ Задача</button></div></div>
    <div class="weeknav"><div class="lbl">${esc(fmtDate(base))} – ${esc(fmtDate(days[6]))}<small>${weekBadge(wi)}</small></div>
      <div class="pager"><button class="btn" data-act="weekGo" data-v="-1" aria-label="Предыдущая неделя">‹</button>
      <label class="btn datebtn" data-act="pickDate" title="Перейти к дате" aria-label="Перейти к дате">${CAL}<input type="date" data-change="weekDate" value="${ymd(base)}"></label>
      <button class="btn" data-act="weekGo" data-v="1" aria-label="Следующая неделя">›</button></div>
      ${ui.wo ? '<button class="btn go-now" data-act="weekGo" data-v="0">Текущая</button>' : ''}</div>
    <div class="days">${days.map(d => {
      const k = ymd(d), cl = classesOn(d), ts = tasks.filter(t => t.due === k).sort((a, b) => (a.done - b.done) || byDue(a, b));
      return `<section class="day ${k === td ? 'today' : ''}"><h3>${DAYS[isoDow(d) - 1]}<small>${esc(fmtDate(d))}</small></h3>
        ${cl.map(c => classHtml(c, { date: k })).join('')}${ts.map(t => taskHtml(t, false)).join('')}
        ${!cl.length && !ts.length ? '<div class="empty">Свободно</div>' : ''}</section>`;
    }).join('')}</div>`;
}

function vSchedule() {
  const cur = weekInfo(new Date()), curP = cur && !cur.before ? (cur.odd ? 'odd' : 'even') : null;
  const f = ui.sp, shown = live('classes').filter(c => !c.date && (c.parity === 'all' || c.parity === f));
  const seg = [['odd', 'Нечётные недели'], ['even', 'Чётные недели']].map(([k, l]) =>
    `<button class="segb ${f === k ? 'on' : ''}" data-act="setSP" data-v="${k}">${l}${curP === k ? '<i class="now-dot" title="Сейчас эта неделя"></i>' : ''}</button>`).join('');
  const todayDow = isoDow(new Date());
  let body = '';
  for (let d = 1; d <= 7; d++) {
    const list = shown.filter(c => c.day === d).sort((a, b) => a.start.localeCompare(b.start));
    if (d === 7 && !list.length) continue;
    body += `<section class="dayc ${d === todayDow ? 'is-today' : ''} ${list.length ? '' : 'is-free'}">
      <h3><span>${DAYS[d - 1]}${d === todayDow ? '<em class="badge">сегодня</em>' : ''}</span><small>${list.length ? plural(list.length, 'пара', 'пары', 'пар') : ''}</small></h3>
      ${list.length ? list.map(c => classHtml(c, { hideParity: true })).join('') : '<div class="free">Занятий нет</div>'}</section>`;
  }
  const total = shown.length, td = ymd(new Date());
  const once = live('classes').filter(c => c.date).sort((x, y) => x.date.localeCompare(y.date) || x.start.localeCompare(y.start));
  const upc = once.filter(c => c.date >= td), old = once.filter(c => c.date < td).slice(-6);
  const grp = list => { const m = {}; list.forEach(c => (m[c.date] = m[c.date] || []).push(c)); return Object.entries(m).map(([d, cs]) => { const dd = parseYmd(d);
    return `<section class="dayc ${d === td ? 'is-today' : ''}"><h3><span>${DAYS[isoDow(dd) - 1]}, ${esc(fmtDate(dd))}${d === td ? '<em class="badge">сегодня</em>' : ''}</span></h3>${cs.map(c => classHtml(c, { hideParity: true, past: d < td })).join('')}</section>`; }).join(''); };
  const onceHtml = once.length ? `<h2 class="sec">Разовые занятия</h2>${upc.length ? `<div class="sched">${grp(upc)}</div>` : '<div class="empty" style="margin-bottom:12px">Ближайших разовых занятий нет.</div>'}
    ${old.length ? `<details class="old"><summary>Прошедшие (${old.length})</summary><div class="sched">${grp(old)}</div></details>` : ''}` : '';
  return `<div class="head"><div><h1>Расписание</h1><div class="sub">${weekBadge(cur)}${total ? '<span>' + plural(total, 'пара', 'пары', 'пар') + ' на ' + (f === 'odd' ? 'нечётной' : 'чётной') + ' неделе</span>' : ''}</div></div>
    <div class="actions"><button class="btn" data-act="subjects">Предметы</button><button class="btn primary" data-act="newClass">+ Пара</button></div></div>
    <div class="seg2" role="tablist">${seg}</div>
    ${total ? `<div class="sched">${body}</div>` : '<div class="card"><div class="empty">Регулярных пар на этой неделе нет. Нажмите «+ Пара», чтобы добавить.</div></div>'}
    ${onceHtml}`;
}

function vTasks() {
  const f = ui.tf, all = live('tasks');
  let list = all.filter(t => f === 'open' ? !t.done : f === 'done' ? t.done : f === 'nodate' ? (!t.done && !t.due) : (!t.done && t.kind === f));
  list = f === 'done' ? list.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)) : list.sort(byDue);
  const chips = [['open', 'Все активные'], ['study', 'Учёба'], ['extra', 'Дополнительные'], ['nodate', 'Без срока'], ['done', 'Выполненные']]
    .map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-act="setTF" data-v="${k}">${l}</button>`).join('');
  return `<div class="head"><div><h1>Задачи</h1></div><div class="actions"><button class="btn primary" data-act="newTask">+ Задача</button></div></div>
    <div class="chips">${chips}</div>
    <div class="card">${list.length ? list.map(t => taskHtml(t)).join('') : '<div class="empty">Здесь пока пусто.</div>'}</div>`;
}

function libList() {
  const q = ui.lq.trim().toLowerCase();
  const list = live('library').filter(x => (!ui.ls || x.subjectId === ui.ls) &&
    (!q || (x.title + ' ' + (x.note || '') + ' ' + (x.url || '')).toLowerCase().includes(q))).sort((a, b) => (b.u || 0) - (a.u || 0));
  if (!list.length) return '<div class="card"><div class="empty">Материалов нет. Добавьте файл или ссылку.</div></div>';
  return '<div class="card">' + list.map(x => {
    const s = subj(x.subjectId), f = x.kind === 'file' ? byId('files', x.fileId) : null;
    const ext = x.kind === 'link' ? 'URL' : ((f && f.name.split('.').pop()) || 'файл').slice(0, 4).toUpperCase();
    const m = [s && `<span class="dot" style="background:${s.color}"></span>${esc(s.name)}`, f && fmtSize(f.size), x.kind === 'link' && esc(x.url.replace(/^https?:\/\//, '').slice(0, 40)), x.note && esc(x.note.slice(0, 60))].filter(Boolean).join(' · ');
    return `<div class="item"><div class="ico">${esc(ext)}</div><div class="body" data-act="openLib" data-id="${x.id}"><div class="t">${esc(x.title)}</div><div class="m">${m}</div></div>
      <button class="ib" data-act="editLib" data-id="${x.id}" aria-label="Изменить" title="Изменить">${PEN}</button></div>`;
  }).join('') + '</div>';
}
function vLibrary() {
  return `<div class="head"><div><h1>Учебные материалы</h1><div class="sub">Файлы хранятся в вашем Google Drive</div></div>
    <div class="actions"><button class="btn primary" data-act="newLib">+ Добавить</button></div></div>
    <input class="search" id="lq" type="search" placeholder="Поиск по названию и заметкам" value="${esc(ui.lq)}">
    <div class="chips"><button class="chip ${!ui.ls ? 'on' : ''}" data-act="libSubj" data-v="">Все предметы</button>${live('subjects').map(s => `<button class="chip ${ui.ls === s.id ? 'on' : ''}" data-act="libSubj" data-v="${s.id}">${esc(s.name)}</button>`).join('')}</div>
    <div id="lib-list">${libList()}</div>`;
}

function vSettings() {
  const now = new Date(), wi = weekInfo(now), nx = weekInfo(addDays(now, 7)), i = syncInfo();
  return `<div class="head"><div><h1>Настройки</h1></div></div>
  <div class="card"><h2>Семестр и нумерация недель</h2>
    <label class="f">Дата начала семестра (любой день первой недели)<input type="date" value="${esc(S.settings.start)}" data-change="setStart"></label>
    <label class="f">Номер этой недели<input type="number" inputmode="numeric" min="-20" max="60" value="${esc(S.settings.firstWeek)}" data-change="setFirstWeek"></label>
    <div class="note">Неделя, в которую попадает указанная дата, получит этот номер; дальше нумерация идёт по порядку. Нечётные и чётные недели определяются по номеру.</div>
    ${wi ? `<div class="kv" style="margin-top:8px"><span>Сегодня</span><span>${esc(weekLabel(wi))}</span></div>` : ''}
    ${nx ? `<div class="kv"><span>Через неделю</span><span>${esc(weekLabel(nx))}</span></div>` : ''}</div>
  <div class="card"><h2>Вкладка «Сегодня»</h2>
    <label class="f">Показывать пары завтра, начиная с<input type="time" value="${esc(tomorrowAfter())}" data-change="setTomorrow"></label>
    <div class="note">После этого времени вместо «Пары сегодня» появится «Пары завтра». Очистите поле, чтобы всегда показывать только сегодняшние пары. Сейчас: ${tomorrowAfter() ? 'с ' + esc(tomorrowAfter()) : 'выключено'}.</div></div>
  <div class="card"><h2>Предметы</h2><div class="kv"><span>Всего предметов</span><span>${live('subjects').length}</span></div>
    <button class="btn" data-act="subjects">Управление предметами</button></div>
  <div class="card"><h2>Google Drive</h2>
    <div class="kv"><span>Состояние</span><span class="${i.cls}">${esc(i.text)}</span></div>
    ${meta.signedIn ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px"><button class="btn primary" data-act="syncNow">Синхронизировать</button><button class="btn" data-act="signOut">Выйти</button></div>`
      : `<button class="btn primary" data-act="signIn">Войти через Google</button>`}
    <div class="note">Данные и файлы хранятся в скрытой папке приложения на вашем Google Drive. Другие файлы Drive планеру недоступны.</div></div>
  <div class="card"><h2>Резервная копия</h2><div style="display:flex;gap:8px;flex-wrap:wrap">
    <button class="btn" data-act="exportData">Скачать копию данных</button>
    <label class="btn" style="margin:0">Загрузить копию<input type="file" accept="application/json,.json" data-change="importData" hidden></label></div>
    <div class="note">В копию входят расписание, задачи и список материалов (сами файлы остаются на Drive).</div></div>
  <div class="card"><h2>Ссылки в меню</h2>
    ${live('links').length ? live('links').sort((x, y) => (x.n || 0) - (y.n || 0)).map(l => `<div class="item ${l.hidden ? 'dim' : ''}"><i class="lk" style="--c:${esc(l.color || '#4f63ec')}">${linkIcon(l)}</i>
      <div class="body" data-act="editLink" data-id="${l.id}"><div class="t">${esc(l.title)}${l.hidden ? ' <span class="badge">скрыта</span>' : ''}</div><div class="m">${l.kind === 'file' ? 'Файл: ' + esc(l.fileName || '') : esc(l.url.replace(/^https?:\/\//, '').slice(0, 48))}</div></div>
      <button class="ib" data-act="toggleLink" data-id="${l.id}" aria-label="${l.hidden ? 'Показать в меню' : 'Скрыть из меню'}" title="${l.hidden ? 'Показать в меню' : 'Скрыть из меню'}">${l.hidden ? EYE_OFF : EYE}</button>
      <button class="ib" data-act="editLink" data-id="${l.id}" aria-label="Изменить" title="Изменить">${PEN}</button></div>`).join('') : '<div class="empty">Своих значков пока нет.</div>'}
    <div class="btnrow"><button class="btn" data-act="newLink">+ Добавить ссылку</button></div>
    <div class="note">Значок появится в главном меню и будет открывать ссылку в новой вкладке. Можно добавить и файл с устройства (например, PDF с расписанием): он хранится только в этом браузере и на других устройствах не появится.</div></div>
  <div class="card"><h2>О приложении</h2><div class="kv"><span>Версия</span><span>${APP_VERSION}</span></div>
    <div class="note"><a href="privacy.html" style="color:var(--brand)">Политика конфиденциальности</a></div></div>`;
}

/* =====================================================================
   Диалоги
   ===================================================================== */
function openModal(title, html, onSubmit) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="overlay" data-act="overlay"><form class="sheet" novalidate><header><h2>${esc(title)}</h2><button type="button" class="x" data-act="closeModal" aria-label="Закрыть">×</button></header>${html}</form></div>`;
  const f = $('form', root);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    if (!f.reportValidity()) return;
    const btn = $('button.primary', f);
    if (btn) btn.disabled = true;
    try { await onSubmit(new FormData(f), f); }
    catch (err) { toast(errText(err)); if (btn) btn.disabled = false; }
  });
  return f;
}
const closeModal = () => { $('#modal-root').innerHTML = ''; draft = { files: [], pending: [], removed: [] }; };

function subjectSelect(sel) {
  const subs = live('subjects'), none = !subs.length;
  return `<div id="subjWrap"><label class="f">Предмет<select name="subject" data-change="subjSel"><option value="">— не выбран —</option>
    ${subs.map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
    <option value="__new" ${none ? 'selected' : ''}>＋ Новый предмет…</option></select></label>
    <label class="f ${none ? '' : 'hidden'}" id="newSubjWrap">Название нового предмета<input name="newSubject" maxlength="80" autocomplete="off"></label></div>`;
}
function addSubject(name) {
  const s = { id: uid(), name, color: COLORS[live('subjects').length % COLORS.length] };
  upsert('subjects', s); return s;
}
function resolveSubject(fd) {
  const v = fd.get('subject');
  if (v === '__new') { const n = (fd.get('newSubject') || '').trim(); if (!n) throw new Error('Введите название предмета'); return addSubject(n).id; }
  return v || null;
}
const opts = (obj, sel) => Object.entries(obj).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${l}</option>`).join('');

function classModal(id, preset = {}) {
  const c = id ? byId('classes', id) : { day: 1, start: '09:00', end: '10:30', type: 'lecture', parity: 'all', ...preset };
  if (!c) return;
  const once = !!c.date, dval = c.date || ymd(new Date());
  openModal(id ? 'Пара' : 'Новая пара', `${subjectSelect(c.subjectId)}
    <div class="seg"><input type="radio" name="repeat" id="r1" value="weekly" ${once ? '' : 'checked'} data-change="repeatSel"><label for="r1">Каждую неделю</label>
    <input type="radio" name="repeat" id="r2" value="once" ${once ? 'checked' : ''} data-change="repeatSel"><label for="r2">Один раз</label></div>
    <div id="onceArea" class="${once ? '' : 'hidden'}"><label class="f">Дата занятия<input type="date" name="date" value="${esc(dval)}" ${once ? 'required' : ''}></label></div>
    <div class="row"><label class="f ${once ? 'hidden' : ''}" id="dayWrap">День<select name="day">${DAYS.map((d, i) => `<option value="${i + 1}" ${c.day === i + 1 ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
    <label class="f">Тип занятия<select name="type">${opts(TYPES, c.type)}</select></label></div>
    <div class="row"><label class="f">Начало<input type="time" name="start" value="${esc(c.start)}" required></label>
    <label class="f">Конец<input type="time" name="end" value="${esc(c.end)}" required></label></div>
    <label class="f ${once ? 'hidden' : ''}" id="parityWrap">Недели<select name="parity">${opts({ all: 'Каждую неделю', odd: 'Только нечётные', even: 'Только чётные' }, c.parity)}</select></label>
    <div class="row"><label class="f">Аудитория<input name="room" value="${esc(c.room)}" maxlength="40"></label>
    <label class="f">Преподаватель<input name="teacher" value="${esc(c.teacher)}" maxlength="80"></label></div>
    <div class="buttons"><button class="btn primary grow">Сохранить</button>${id ? `<button type="button" class="btn danger" data-act="delClass" data-id="${id}">Удалить</button>` : ''}</div>`,
    fd => {
      if (fd.get('end') <= fd.get('start')) throw new Error('Конец пары должен быть позже начала');
      const subjectId = resolveSubject(fd);
      if (!subjectId) throw new Error('Выберите предмет');
      const isOnce = fd.get('repeat') === 'once', date = isOnce ? fd.get('date') : '';
      if (isOnce && !date) throw new Error('Выберите дату занятия');
      upsert('classes', { id: id || uid(), subjectId, date, day: isOnce ? isoDow(parseYmd(date)) : +fd.get('day'), type: fd.get('type'), start: fd.get('start'), end: fd.get('end'),
        parity: isOnce ? 'all' : fd.get('parity'), room: (fd.get('room') || '').trim(), teacher: (fd.get('teacher') || '').trim() });
      closeModal(); commit();
    });
}

function classMenu(id, date) {
  const c = byId('classes', id); if (!c) return;
  const s = subj(c.subjectId), d = parseYmd(date);
  const tasks = c.subjectId ? live('tasks').filter(t => t.subjectId === c.subjectId && !t.done).sort(byDue).slice(0, 8) : [];
  const meta2 = [`${c.start}–${c.end}`, TYPES[c.type] || 'Занятие', c.room, c.teacher].filter(Boolean).map(esc).join(' · ');
  openModal(s ? s.name : 'Пара', `
    <div class="cm-info"><b>${esc(DAYS[isoDow(d) - 1])}, ${esc(fmtDate(d))}</b><div class="m">${meta2}</div></div>
    <div class="buttons"><button type="button" class="btn primary grow" data-act="subjTask" data-sid="${esc(c.subjectId || '')}" data-date="${esc(date)}">+ Задача по предмету</button></div>
    ${tasks.length ? `<div class="card cm-tasks"><h2>Открытые задачи по предмету</h2>${tasks.map(t => `<div class="item task"><button type="button" class="chk" data-act="toggleTask" data-id="${t.id}" aria-label="Отметить выполненной"></button>
      <div class="body" data-act="editTask" data-id="${t.id}"><div class="t">${esc(t.title)}</div><div class="m">${t.due ? `<span class="${t.due < ymd(new Date()) ? 'od' : ''}">${esc(fmtDateFull(t.due))}</span>` : 'без срока'}</div></div></div>`).join('')}</div>` : ''}
    <div class="buttons"><button type="button" class="btn grow" data-act="editClass" data-id="${c.id}">Изменить пару</button></div>`, () => closeModal());
}

const UPL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';
const dropHtml = kind => `<label class="drop"><input type="file" multiple data-change="${kind}" hidden>${UPL}
  <b>Перетащите файлы сюда</b><span>или нажмите, чтобы выбрать · Ctrl+V — вставить из буфера</span></label>`;
let linkFilePick = null;
function linkModal(id) {
  const l = id ? byId('links', id) : { icon: 'link', color: COLORS[0] };
  if (!l) return;
  linkFilePick = null;
  openModal(id ? 'Ссылка в меню' : 'Новая ссылка', `
    <label class="f">Название (подпись в меню)<input name="title" value="${esc(l.title)}" required maxlength="24" autocomplete="off" placeholder="Например, ЛКС"></label>
    <div class="seg"><input type="radio" name="kind" id="lk1" value="url" ${l.kind === 'file' ? '' : 'checked'} data-change="linkKind"><label for="lk1">Адрес в интернете</label>
    <input type="radio" name="kind" id="lk2" value="file" ${l.kind === 'file' ? 'checked' : ''} data-change="linkKind"><label for="lk2">Файл с устройства</label></div>
    <div id="lkUrl" class="${l.kind === 'file' ? 'hidden' : ''}"><label class="f">Адрес<input name="url" type="text" inputmode="url" autocapitalize="off" spellcheck="false" value="${esc(l.url)}" ${l.kind === 'file' ? '' : 'required'} placeholder="https://" autocomplete="off"></label></div>
    <div id="lkFile" class="${l.kind === 'file' ? '' : 'hidden'}"><label class="drop" id="lkDrop"><input type="file" name="lfile" data-change="linkFile" hidden>${UPL}
      <b id="lkName">${l.fileName ? esc(l.fileName) : 'Выберите файл (например, PDF)'}</b><span>${l.fileName ? 'нажмите, чтобы заменить' : 'или перетащите сюда'} · файл останется только в этом браузере</span></label></div>
    <div class="f" style="margin-bottom:14px">Значок<div class="sw icg">${Object.entries(LINK_ICONS).map(([k, p]) =>
      `<span><input type="radio" name="icon" id="ic-${k}" value="${k}" ${(l.icon || 'link') === k ? 'checked' : ''}><label for="ic-${k}" class="ic" aria-label="${k}"><svg viewBox="0 0 24 24">${p}</svg></label></span>`).join('')}</div></div>
    <label class="f">Или свой символ (буква или эмодзи, заменит значок)<input name="glyph" value="${esc(l.glyph)}" maxlength="4" autocomplete="off" placeholder="Например, 📚 или Л"></label>
    <div class="f" style="margin-bottom:14px">Цвет<div class="sw">${COLORS.map((c, i) =>
      `<span><input type="radio" name="color" id="lc${i}" value="${c}" ${(l.color || COLORS[0]) === c ? 'checked' : ''}><label for="lc${i}" style="--c:${c}" aria-label="${c}"></label></span>`).join('')}</div></div>
    <label class="chkrow"><input type="checkbox" name="show" ${l.hidden ? '' : 'checked'}><span>Показывать в меню</span></label>
    <div class="buttons"><button class="btn primary grow">Сохранить</button>${id ? `<button type="button" class="btn danger" data-act="delLink" data-id="${id}">Удалить</button>` : ''}</div>`,
    async fd => {
      const title = (fd.get('title') || '').trim(); if (!title) throw new Error('Введите название');
      const base = id ? byId('links', id) : { id: uid(), n: Date.now() };
      if (!id && live('links').length >= 10) throw new Error('Можно добавить не больше 10 ссылок');
      let extra;
      if (fd.get('kind') === 'file') {
        const f = linkFilePick, key = base.fileKey || uid();
        if (!f && !(base.kind === 'file' && base.fileName)) throw new Error('Выберите файл');
        if (f) { if (f.size > 200 * 1024 * 1024) throw new Error('Файл больше 200 МБ'); await idb.put(key, { blob: f, type: guessMime(f), name: f.name }); }
        extra = { kind: 'file', url: '', fileKey: key, fileName: f ? f.name : base.fileName };
      } else {
        let url = (fd.get('url') || '').trim(); if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
        let u; try { u = new URL(url); } catch (e) { throw new Error('Некорректный адрес'); }
        if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) throw new Error('Адрес должен начинаться с http:// или https://');
        extra = { kind: 'url', url: u.href, fileName: '' };
      }
      upsert('links', { ...base, ...extra, title, hidden: !fd.get('show'), icon: fd.get('icon') || 'link', glyph: (fd.get('glyph') || '').trim(), color: fd.get('color') || COLORS[0] });
      closeModal(); commit();
    });
}

function attHtml() {
  const rows = [];
  draft.files.forEach(fid => { const f = byId('files', fid); if (f) rows.push(`<div class="item"><div class="body"><div class="t" data-act="openFile" data-id="${fid}" style="cursor:pointer">${esc(f.name)}</div><div class="m">${fmtSize(f.size)}</div></div><button type="button" class="btn small danger" data-act="rmAtt" data-v="${fid}">Убрать</button></div>`); });
  draft.pending.forEach((f, i) => rows.push(`<div class="item"><div class="body"><div class="t">${esc(f.name)}</div><div class="m">${fmtSize(f.size)} · будет загружен при сохранении</div></div><button type="button" class="btn small danger" data-act="rmPend" data-v="${i}">Убрать</button></div>`));
  return rows.join('');
}
const refreshAtt = () => { const a = $('#att'); if (a) a.innerHTML = attHtml(); };

const subRow = x => `<div class="subrow ${x.done ? 'done' : ''}" data-sid="${x.id}"><button type="button" class="chk sm" data-act="subTick" aria-label="Отметить">${x.done ? CHECK : ''}</button><input class="subt" value="${esc(x.text)}" maxlength="200" placeholder="Что нужно сделать" autocomplete="off"><button type="button" class="ib" data-act="subRm" aria-label="Удалить подзадачу">×</button></div>`;
function taskModal(id, preset = {}) {
  const t = id ? byId('tasks', id) : { kind: 'study', priority: 0, files: [], ...preset };
  if (!t) return;
  draft = { files: (t.files || []).filter(f => byId('files', f)), pending: [], removed: [] };
  openModal(id ? 'Задача' : 'Новая задача', `
    <label class="f">Название<input name="title" value="${esc(t.title)}" required maxlength="200" autocomplete="off"></label>
    <div class="seg"><input type="radio" name="kind" id="k1" value="study" ${t.kind !== 'extra' ? 'checked' : ''} data-change="kindSel"><label for="k1">Учёба</label>
    <input type="radio" name="kind" id="k2" value="extra" ${t.kind === 'extra' ? 'checked' : ''} data-change="kindSel"><label for="k2">Дополнительная</label></div>
    <div id="subjArea" class="${t.kind === 'extra' ? 'hidden' : ''}">${subjectSelect(t.subjectId)}</div>
    <div id="colorArea" class="${t.kind === 'extra' ? '' : 'hidden'}"><div class="f" style="margin-bottom:14px">Цвет задачи
      <div class="sw">${['', ...COLORS].map((c, i) => `<span><input type="radio" name="color" id="cl${i}" value="${c}" ${(t.color || '') === c ? 'checked' : ''}><label for="cl${i}" style="--c:${c || 'transparent'}" class="${c ? '' : 'none'}" aria-label="${c || 'Без цвета'}"></label></span>`).join('')}</div></div></div>
    <div class="f" style="margin-bottom:14px">Подзадачи<div id="subList">${(t.subs || []).map(subRow).join('')}</div>
      <button type="button" class="btn small" data-act="addSub" style="margin-top:6px;align-self:flex-start">+ Подзадача</button></div>
    <label class="f">Срок <span class="opt">(можно без даты)</span><span class="dwrap"><input type="date" name="due" value="${esc(t.due)}"><button type="button" class="btn small" data-act="clearDue" title="Убрать дату">Без даты</button></span></label>
    <label class="f">Важность<select name="priority"><option value="0">Обычная</option><option value="1" ${t.priority ? 'selected' : ''}>Важная</option></select></label>
    <label class="f">Заметка<textarea name="note" maxlength="2000">${esc(t.note)}</textarea></label>
    <div class="files"><label class="f" style="margin-bottom:4px">Вложения</label><div id="att">${attHtml()}</div>
    ${dropHtml('pickAtt')}</div>
    <div class="buttons"><button class="btn primary grow">Сохранить</button>${id ? `<button type="button" class="btn danger" data-act="delTask" data-id="${id}">Удалить</button>` : ''}</div>`,
    async fd => {
      const title = (fd.get('title') || '').trim(); if (!title) throw new Error('Введите название');
      const kind = fd.get('kind');
      const subjectId = kind === 'study' ? resolveSubject(fd) : null;
      const fileIds = [...draft.files];
      for (const f of draft.pending) fileIds.push((await uploadAndRecord(f)).id);
      draft.removed.forEach(removeFile);
      const base = id ? byId('tasks', id) : { id: uid(), done: false, created: Date.now() };
      upsert('tasks', { ...base, title, kind, subjectId, color: kind === 'extra' ? (fd.get('color') || '') : '', due: fd.get('due') || '', subs: $$('#subList .subrow').map(r => ({ id: r.dataset.sid, text: $('.subt', r).value.trim(), done: r.classList.contains('done') })).filter(x => x.text), priority: +fd.get('priority') || 0, note: (fd.get('note') || '').trim(), files: fileIds });
      closeModal(); commit();
    });
}

function libModal(id) {
  const x = id ? byId('library', id) : { kind: 'file' };
  if (!x) return;
  const f = x.kind === 'file' && x.fileId ? byId('files', x.fileId) : null;
  draft = { files: [], pending: [], removed: [] };
  openModal(id ? 'Материал' : 'Новый материал', `
    ${id ? '' : `<div class="seg"><input type="radio" name="kind" id="m1" value="file" checked data-change="libKind"><label for="m1">Файл</label><input type="radio" name="kind" id="m2" value="link" data-change="libKind"><label for="m2">Ссылка</label></div>`}
    <div id="libFile" class="${x.kind === 'link' ? 'hidden' : ''}">${id ? `<div class="item"><div class="body"><div class="t">${f ? esc(f.name) : 'Файл удалён'}</div><div class="m">${f ? fmtSize(f.size) : ''}</div></div>${f ? `<button type="button" class="btn small" data-act="openFile" data-id="${f.id}">Открыть</button>` : ''}</div>`
      : `<div class="files"><div id="att">${attHtml()}</div>${dropHtml('pickLib')}</div>`}</div>
    <div id="libLink" class="${x.kind === 'link' ? '' : 'hidden'}"><label class="f">Адрес ссылки<input name="url" type="url" value="${esc(x.url)}" placeholder="https://"></label></div>
    <label class="f">Название<input name="title" value="${esc(x.title)}" maxlength="200" autocomplete="off" placeholder="Если не указано — имя файла"></label>
    ${subjectSelect(x.subjectId)}
    <label class="f">Заметка<textarea name="note" maxlength="2000">${esc(x.note)}</textarea></label>
    <div class="buttons"><button class="btn primary grow">Сохранить</button>${id ? `<button type="button" class="btn danger" data-act="delLib" data-id="${id}">Удалить</button>` : ''}</div>`,
    async fd => {
      const kind = id ? x.kind : fd.get('kind'), subjectId = resolveSubject(fd);
      const title = (fd.get('title') || '').trim(), note = (fd.get('note') || '').trim();
      if (id) {
        if (!title) throw new Error('Введите название');
        if (kind === 'link') { const url = (fd.get('url') || '').trim(); if (!/^https?:\/\//i.test(url)) throw new Error('Адрес должен начинаться с http:// или https://'); x.url = url; }
        upsert('library', { ...x, title, subjectId, note });
      } else if (kind === 'link') {
        const url = (fd.get('url') || '').trim();
        if (!/^https?:\/\//i.test(url)) throw new Error('Адрес должен начинаться с http:// или https://');
        if (!title) throw new Error('Введите название');
        upsert('library', { id: uid(), kind: 'link', title, url, subjectId, note });
      } else {
        if (!draft.pending.length) throw new Error('Выберите файл');
        const many = draft.pending.length > 1;
        for (const file of draft.pending) {
          const rec = await uploadAndRecord(file);
          upsert('library', { id: uid(), kind: 'file', title: many || !title ? file.name : title, fileId: rec.id, subjectId, note });
        }
      }
      closeModal(); commit();
    });
}

function subjectsModal() {
  const rows = () => live('subjects').map(s => `<div class="subj-row"><input type="color" value="${esc(s.color)}" data-change="subjColor" data-id="${s.id}" aria-label="Цвет">
    <input type="text" value="${esc(s.name)}" maxlength="80" data-change="subjName" data-id="${s.id}" aria-label="Название">
    <button type="button" class="btn small danger" data-act="delSubject" data-id="${s.id}">Удалить</button></div>`).join('') || '<div class="empty">Предметов пока нет.</div>';
  const f = openModal('Предметы', `<div id="subjList">${rows()}</div>
    <div class="subj-row" style="margin-top:12px"><input type="text" id="newSubjName" placeholder="Новый предмет" maxlength="80"><button type="button" class="btn primary small" data-act="addSubj">Добавить</button></div>
    <div class="note">Цвет помогает отличать предметы в расписании и неделе.</div>`, () => closeModal());
  f.refresh = () => { $('#subjList').innerHTML = rows(); };
  subjectsModal.form = f;
}

/* =====================================================================
   Действия (клики) и изменения полей
   ===================================================================== */
const A = {
  tab(el) { ui.tab = el.dataset.v; lsSet('planner.tab', ui.tab); window.scrollTo(0, 0); render(); },
  monthGo(el) { const v = +el.dataset.v; ui.mo = v === 0 ? 0 : ui.mo + v; ui.md = null; render(); },
  calDay(el) { ui.md = el.dataset.date; render(); const c = $('.cal-day'); if (c && window.matchMedia('(max-width:859px)').matches) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); },
  newTaskOn(el) { taskModal(null, { due: el.dataset.date }); },
  weekGo(el) { const v = +el.dataset.v; ui.wo = v === 0 ? 0 : ui.wo + v; render(); },
  setSP(el) { ui.sp = el.dataset.v; render(); },
  allNoDate() { ui.tf = 'nodate'; ui.tab = 'tasks'; render(); },
  setTF(el) { ui.tf = el.dataset.v; render(); },
  libSubj(el) { ui.ls = el.dataset.v; render(); },
  newTask() { taskModal(null); },
  editTask(el) { taskModal(el.dataset.id); },
  toggleSub(el) {
    const t = byId('tasks', el.dataset.id); if (!t) return;
    upsert('tasks', { ...t, subs: (t.subs || []).map(x => x.id === el.dataset.sid ? { ...x, done: !x.done } : x) }); commit();
  },
  addSub() {
    const l = $('#subList'); if (!l) return;
    l.insertAdjacentHTML('beforeend', subRow({ id: uid(), text: '', done: false }));
    l.lastElementChild.querySelector('.subt').focus();
  },
  subRm(el) { el.closest('.subrow').remove(); },
  subTick(el) { const r = el.closest('.subrow'); const on = r.classList.toggle('done'); el.innerHTML = on ? CHECK : ''; },
  clearDue() { const i = $('input[name=due]'); if (i) i.value = ''; },
  toggleTask(el) {
    const t = byId('tasks', el.dataset.id); if (!t) return;
    upsert('tasks', { ...t, done: !t.done, doneAt: t.done ? 0 : Date.now() }); commit();
  },
  delTask(el) {
    if (!confirm('Удалить задачу вместе с вложениями?')) return;
    const t = byId('tasks', el.dataset.id);
    if (t) { (t.files || []).forEach(removeFile); tomb('tasks', t.id); }
    closeModal(); commit();
  },
  newLink() { linkModal(null); },
  async openLocal(el, e) {
    e.preventDefault();
    const l = byId('links', el.dataset.id); if (!l) return;
    const w = window.open('about:blank', '_blank');
    try {
      const rec = await idb.get(l.fileKey);
      if (!rec) { if (w) w.close(); toast('Этого файла нет на этом устройстве — выберите его заново'); linkModal(l.id); return; }
      const url = URL.createObjectURL(new Blob([rec.blob], { type: rec.type }));
      if (w) w.location.href = url; else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (err) { if (w) w.close(); toast('Не удалось открыть файл'); }
  },
  toggleLink(el) { const l = byId('links', el.dataset.id); if (l) { upsert('links', { ...l, hidden: !l.hidden }); commit(); } },
  editLink(el) { linkModal(el.dataset.id); },
  delLink(el) { if (!confirm('Удалить ссылку из меню?')) return; const l = byId('links', el.dataset.id); if (l && l.fileKey) idb.del(l.fileKey).catch(() => {}); tomb('links', el.dataset.id); closeModal(); commit(); },
  newClass() { classModal(null); },
  newClassOn(el) { classModal(null, { date: el.dataset.date }); },
  editClass(el) { classModal(el.dataset.id); },
  classMenu(el) { classMenu(el.dataset.id, el.dataset.date); },
  subjTask(el) { closeModal(); taskModal(null, { kind: 'study', subjectId: el.dataset.sid || undefined, due: el.dataset.date }); },
  pickDate(el, e) { const i = $('input', el); if (e.target !== i) { try { i.showPicker(); } catch (x) { i.focus(); } } },
  delClass(el) { if (!confirm('Удалить эту пару?')) return; tomb('classes', el.dataset.id); closeModal(); commit(); },
  newLib() { libModal(null); },
  editLib(el) { libModal(el.dataset.id); },
  openLib(el) {
    const x = byId('library', el.dataset.id); if (!x) return;
    if (x.kind === 'link') window.open(x.url, '_blank', 'noopener'); else openFile(x.fileId);
  },
  delLib(el) {
    if (!confirm('Удалить материал (и файл с Google Drive)?')) return;
    const x = byId('library', el.dataset.id);
    if (x) { if (x.fileId) removeFile(x.fileId); tomb('library', x.id); }
    closeModal(); commit();
  },
  openFile(el) { openFile(el.dataset.id); },
  rmAtt(el) { draft.files = draft.files.filter(f => f !== el.dataset.v); draft.removed.push(el.dataset.v); refreshAtt(); },
  rmPend(el) { draft.pending.splice(+el.dataset.v, 1); refreshAtt(); },
  subjects() { subjectsModal(); },
  addSubj() {
    const i = $('#newSubjName'), n = i.value.trim(); if (!n) return;
    addSubject(n); persist(); meta.dirty = true; saveMeta(); subjectsModal.form.refresh(); i.value = ''; scheduleSync();
  },
  delSubject(el) {
    const id = el.dataset.id, s = subj(id); if (!s) return;
    if (!confirm(`Удалить предмет «${s.name}» и все его пары из расписания?`)) return;
    live('classes').filter(c => c.subjectId === id).forEach(c => tomb('classes', c.id));
    live('tasks').filter(t => t.subjectId === id).forEach(t => upsert('tasks', { ...t, subjectId: null }));
    live('library').filter(x => x.subjectId === id).forEach(x => upsert('library', { ...x, subjectId: null }));
    tomb('subjects', id); persist(); meta.dirty = true; saveMeta(); subjectsModal.form.refresh(); scheduleSync();
  },
  async signIn() {
    try { await getToken(); syncNow(); render(); } catch (e) { toast(errText(e)); }
  },
  syncNow() { syncNow(); },
  signOut() {
    if (!confirm('Выйти из Google? Данные останутся на этом устройстве и на вашем Drive.')) return;
    try { if (token && window.google) google.accounts.oauth2.revoke(token, () => {}); } catch (e) { /* ок */ }
    token = null; tokenExp = 0; meta.signedIn = false; saveMeta();
    try { sessionStorage.removeItem(SS_TOKEN); } catch (e) { /* ок */ }
    syncState = 'idle'; render();
  },
  exportData() {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `planner-${ymd(new Date())}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  overlay(el, e) { if (e.target === el) closeModal(); },
  closeModal
};
const C = {
  monthDate(el) {
    if (!el.value) return;
    const d = parseYmd(el.value), n = new Date();
    ui.mo = (d.getFullYear() - n.getFullYear()) * 12 + d.getMonth() - n.getMonth(); ui.md = el.value; render();
  },
  weekDate(el) {
    if (!el.value) return;
    ui.wo = Math.round((mondayOf(parseYmd(el.value)) - mondayOf(new Date())) / (7 * 864e5)); render();
  },
  setTomorrow(el) { S.settings = { ...S.settings, tomorrowAfter: el.value, u: Date.now() }; commit(); },
  setStart(el) { S.settings = { ...S.settings, start: el.value, u: Date.now() }; commit(); },
  setFirstWeek(el) { const n = parseInt(el.value, 10); S.settings = { ...S.settings, firstWeek: isNaN(n) ? 1 : n, u: Date.now() }; commit(); },
  subjSel(el) {
    const w = $('#newSubjWrap'); w.classList.toggle('hidden', el.value !== '__new');
    if (el.value === '__new') $('input', w).focus();
  },
  linkKind(el) { $('#lkUrl').classList.toggle('hidden', el.value !== 'url'); $('#lkFile').classList.toggle('hidden', el.value !== 'file'); $('input[name=url]').required = el.value === 'url'; },
  linkFile(el) { const f = el.files[0]; if (!f) return; linkFilePick = f; $('#lkName').textContent = f.name; const t = $('input[name=title]'); if (!t.value.trim()) t.value = f.name.replace(/\.[^.]+$/, '').slice(0, 24); },
  repeatSel(el) {
    const once = el.value === 'once';
    $('#onceArea').classList.toggle('hidden', !once); $('#dayWrap').classList.toggle('hidden', once); $('#parityWrap').classList.toggle('hidden', once);
    $('input[name=date]').required = once;
  },
  kindSel(el) { $('#subjArea').classList.toggle('hidden', el.value !== 'study'); $('#colorArea').classList.toggle('hidden', el.value !== 'extra'); },
  libKind(el) { $('#libFile').classList.toggle('hidden', el.value !== 'file'); $('#libLink').classList.toggle('hidden', el.value !== 'link'); },
  pickAtt(el) { draft.pending.push(...el.files); el.value = ''; refreshAtt(); },
  pickLib(el) { draft.pending.push(...el.files); el.value = ''; refreshAtt(); },
  subjName(el) { const s = subj(el.dataset.id); const n = el.value.trim(); if (s && n) { upsert('subjects', { ...s, name: n }); persist(); meta.dirty = true; saveMeta(); scheduleSync(); } },
  subjColor(el) { const s = subj(el.dataset.id); if (s) { upsert('subjects', { ...s, color: el.value }); persist(); meta.dirty = true; saveMeta(); scheduleSync(); } },
  async importData(el) {
    const file = el.files[0]; el.value = ''; if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      if (!j || !j.v || !j.settings) throw new Error('bad');
      mergeState(S, j); commit(); toast('Копия загружена и объединена с текущими данными');
    } catch (e) { toast('Не удалось прочитать файл копии'); }
  }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && A[el.dataset.act]) { A[el.dataset.act](el, e); }
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (el && C[el.dataset.change]) C[el.dataset.change](el, e);
});
document.addEventListener('input', e => {
  if (e.target.id === 'lq') { ui.lq = e.target.value; $('#lib-list').innerHTML = libList(); }
});
/* Перетаскивание и вставка файлов в поля вложений */
const dropZone = () => { const z = $('#modal-root .drop'); return z && z.offsetParent !== null ? z : null; };
function addFiles(files) {
  const list = [...files].filter(f => f && f.size >= 0);
  if (!list.length) return;
  const stamp = () => { const d = new Date(); return `${ymd(d)} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`; };
  list.forEach((f, i) => {
    const generic = /^image\.(png|jpe?g|gif|webp)$/i.test(f.name);
    draft.pending.push(generic ? new File([f], `Снимок ${stamp()}${list.length > 1 ? '-' + (i + 1) : ''}.${f.name.split('.').pop().toLowerCase()}`, { type: f.type }) : f);
  });
  refreshAtt(); toast(`Добавлено файлов: ${list.length}`);
}
const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  const z = dropZone(); if (z) { e.dataTransfer.dropEffect = 'copy'; z.classList.add('over'); }
}));
document.addEventListener('dragleave', e => {
  if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('#modal-root')) return;
  const z = $('#modal-root .drop'); if (z) z.classList.remove('over');
});
document.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();           // иначе браузер откроет файл вместо планера
  const z = $('#modal-root .drop'); if (z) z.classList.remove('over');
  if (dropZone()) addFiles(e.dataTransfer.files);
});
document.addEventListener('paste', e => {
  const fs = e.clipboardData && e.clipboardData.files;
  if (!fs || !fs.length || !dropZone()) return;
  e.preventDefault(); addFiles(fs);
});

let swipe = null;
document.addEventListener('touchstart', e => {
  swipe = (ui.tab === 'week' || ui.tab === 'calendar') && !$('#modal-root').firstChild && e.touches.length === 1 && !(e.target.closest && e.target.closest('input,select,textarea'))
    ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
}, { passive: true });
document.addEventListener('touchend', e => {
  if (!swipe) return;
  const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y; swipe = null;
  if (Math.abs(dx) > 80 && Math.abs(dy) < 45) { if (ui.tab === 'calendar') { ui.mo += dx < 0 ? 1 : -1; ui.md = null; } else ui.wo += dx < 0 ? 1 : -1; render(); }
}, { passive: true });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#modal-root').firstChild) closeModal();
  if (e.key === 'Enter' && e.target.id === 'newSubjName') { e.preventDefault(); A.addSubj(); }
  if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('subt')) { e.preventDefault(); if (e.target.value.trim()) A.addSub(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && meta.signedIn && token && Date.now() - (meta.lastSync || 0) > 30000) syncNow();
});
window.addEventListener('online', () => { if (meta.signedIn && meta.dirty) scheduleSync(); });
/* Если вход уже выполнялся раньше, Google можно обновить тихо — но браузер разрешает
   всплывающее окно только после действия пользователя. Поэтому ждём первого касания. */
document.addEventListener('pointerdown', function once() {
  document.removeEventListener('pointerdown', once);
  if (meta.signedIn && !(token && Date.now() < tokenExp - 60000)) getToken().then(syncNow).catch(() => { syncState = 'err'; syncErr = 'Нужен вход: нажмите «Синхронизировать»'; renderSync(); });
}, { once: true });

/* «Сегодня» обновляется раз в минуту: таймер до конца пары, прошедшие пары */
setInterval(() => {
  if (ui.tab === 'today' && document.visibilityState === 'visible' && !$('#modal-root').firstChild && !document.activeElement.closest?.('#view input')) render();
}, 60000);

/* ---------- Запуск ---------- */
render();
if (meta.signedIn && token) syncNow();
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
