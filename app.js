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
const APP_VERSION = '1.0';

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
  week: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  schedule: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  tasks: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  library: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'
};
const TABS = [['today', 'Сегодня'], ['week', 'Неделя'], ['schedule', 'Расписание'], ['tasks', 'Задачи'], ['library', 'Материалы'], ['settings', 'Настройки']];
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>';

/* ---------- Данные ---------- */
const COLLS = ['subjects', 'classes', 'tasks', 'files', 'library'];
const emptyState = () => ({ v: 1, settings: { start: '', firstWeek: 1, u: 0 }, subjects: [], classes: [], tasks: [], files: [], library: [] });
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
function classesOn(date) {
  const wi = weekInfo(date), dow = isoDow(date);
  return live('classes')
    .filter(c => c.day === dow && (!wi || wi.before || c.parity === 'all' || (c.parity === 'odd') === wi.odd))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/* ---------- Состояние интерфейса ---------- */
const ui = { tab: lsGet('planner.tab') || 'today', wo: 0, sp: 'all', tf: 'open', lq: '', ls: '' };
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
function render() {
  renderTabs();
  const views = { today: vToday, week: vWeek, schedule: vSchedule, tasks: vTasks, library: vLibrary, settings: vSettings };
  $('#view').innerHTML = views[ui.tab]();
  renderSync();
}

const subj = id => byId('subjects', id);
const byDue = (a, b) => (a.due || '9').localeCompare(b.due || '9') || (b.priority || 0) - (a.priority || 0);

function classHtml(c) {
  const s = subj(c.subjectId);
  const meta2 = [TYPES[c.type], c.room && 'ауд. ' + c.room, c.teacher].filter(Boolean).map(esc).join(' · ');
  return `<div class="item cls" style="--c:${s ? s.color : '#888'}" data-act="editClass" data-id="${c.id}">
    <div class="time">${esc(c.start)}<br><span>${esc(c.end)}</span></div>
    <div class="body"><div class="t">${esc(s ? s.name : 'Без предмета')}</div><div class="m">${meta2}</div></div>
    ${c.parity === 'odd' ? '<span class="badge odd">нечёт.</span>' : c.parity === 'even' ? '<span class="badge even">чёт.</span>' : ''}</div>`;
}
function taskHtml(t, showDue = true) {
  const s = subj(t.subjectId), td = ymd(new Date());
  const od = !t.done && t.due && t.due < td;
  const parts = [];
  parts.push(t.kind === 'extra' ? 'Доп.' : 'Учёба');
  if (s) parts.push(`<span class="dot" style="background:${s.color}"></span>${esc(s.name)}`);
  if (showDue && t.due) parts.push(`<span class="${od ? 'od' : ''}">${esc(fmtDateFull(t.due))}</span>`);
  const nf = (t.files || []).filter(f => byId('files', f)).length;
  if (nf) parts.push(`вложений: ${nf}`);
  return `<div class="item task ${t.done ? 'done' : ''}">
    <button class="chk" data-act="toggleTask" data-id="${t.id}" aria-label="Отметить выполненной">${t.done ? CHECK : ''}</button>
    <div class="body" data-act="editTask" data-id="${t.id}"><div class="t">${t.priority ? '<span class="pri" title="Важно"></span>' : ''}${esc(t.title)}</div><div class="m">${parts.join(' · ')}</div></div></div>`;
}
function onboarding() {
  if (S.settings.start && live('classes').length) return '';
  return `<div class="hint"><b>С чего начать</b>1. В настройках укажите дату начала семестра и номер первой недели.<br>2. Добавьте пары в расписание — укажите, на каких неделях они проходят.<br>3. Добавляйте задачи и учебные материалы.
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" data-act="tab" data-v="settings">Настройки</button><button class="btn small" data-act="newClass">Добавить пару</button></div></div>`;
}

function vToday() {
  const now = new Date(), td = ymd(now), wi = weekInfo(now), cl = classesOn(now);
  const open = live('tasks').filter(t => !t.done);
  const overdue = open.filter(t => t.due && t.due < td).sort(byDue);
  const tod = open.filter(t => t.due === td).sort(byDue);
  const soonEnd = ymd(addDays(now, 7));
  const soon = open.filter(t => t.due > td && t.due <= soonEnd).sort(byDue);
  return `<div class="head"><div><h1>${DAYS[isoDow(now) - 1]}, ${fmtDate(now)}</h1><div class="sub">${esc(weekLabel(wi))}</div></div>
    <div class="actions"><button class="btn primary" data-act="newTask">+ Задача</button></div></div>
    ${onboarding()}
    <div class="card"><h2>Пары сегодня</h2>${cl.length ? cl.map(classHtml).join('') : '<div class="empty">Пар нет.</div>'}</div>
    ${overdue.length ? `<div class="card"><h2>Просрочено</h2>${overdue.map(t => taskHtml(t)).join('')}</div>` : ''}
    <div class="card"><h2>Задачи на сегодня</h2>${tod.length ? tod.map(t => taskHtml(t, false)).join('') : '<div class="empty">На сегодня задач нет.</div>'}</div>
    ${soon.length ? `<div class="card"><h2>Ближайшие 7 дней</h2>${soon.map(t => taskHtml(t)).join('')}</div>` : ''}`;
}

function vWeek() {
  const today = new Date(), td = ymd(today), base = addDays(mondayOf(today), 7 * ui.wo), wi = weekInfo(base);
  const days = [...Array(7)].map((_, i) => addDays(base, i));
  const tasks = live('tasks');
  return `<div class="head"><div><h1>Неделя</h1></div><div class="actions"><button class="btn primary" data-act="newTask">+ Задача</button></div></div>
    <div class="weeknav"><button class="btn" data-act="weekGo" data-v="-1" aria-label="Предыдущая неделя">‹</button>
      <div class="lbl">${esc(fmtDate(base))} – ${esc(fmtDate(days[6]))}<small>${esc(weekLabel(wi))}</small></div>
      <button class="btn" data-act="weekGo" data-v="1" aria-label="Следующая неделя">›</button>
      ${ui.wo ? '<button class="btn" data-act="weekGo" data-v="0">Текущая</button>' : ''}</div>
    <div class="days">${days.map(d => {
      const k = ymd(d), cl = classesOn(d), ts = tasks.filter(t => t.due === k).sort((a, b) => (a.done - b.done) || byDue(a, b));
      return `<section class="day ${k === td ? 'today' : ''}"><h3>${DAYS[isoDow(d) - 1]}<small>${esc(fmtDate(d))}</small></h3>
        ${cl.map(classHtml).join('')}${ts.map(t => taskHtml(t, false)).join('')}
        ${!cl.length && !ts.length ? '<div class="empty">Свободно</div>' : ''}</section>`;
    }).join('')}</div>`;
}

function vSchedule() {
  const all = live('classes');
  const f = ui.sp, shown = all.filter(c => f === 'all' || c.parity === 'all' || c.parity === f);
  const chips = [['all', 'Все'], ['odd', 'Нечётные'], ['even', 'Чётные']].map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-act="setSP" data-v="${k}">${l}</button>`).join('');
  let body = '';
  for (let d = 1; d <= 7; d++) {
    const list = shown.filter(c => c.day === d).sort((a, b) => a.start.localeCompare(b.start));
    if (list.length) body += `<div class="card"><h2>${DAYS[d - 1]}</h2>${list.map(classHtml).join('')}</div>`;
  }
  return `<div class="head"><div><h1>Расписание</h1><div class="sub">${esc(weekLabel(weekInfo(new Date())))}</div></div>
    <div class="actions"><button class="btn" data-act="subjects">Предметы</button><button class="btn primary" data-act="newClass">+ Пара</button></div></div>
    <div class="chips">${chips}</div>
    ${body || '<div class="card"><div class="empty">Пока нет пар. Нажмите «+ Пара», чтобы добавить первую.</div></div>'}`;
}

function vTasks() {
  const f = ui.tf, all = live('tasks');
  let list = all.filter(t => f === 'open' ? !t.done : f === 'done' ? t.done : (!t.done && t.kind === f));
  list = f === 'done' ? list.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)) : list.sort(byDue);
  const chips = [['open', 'Все активные'], ['study', 'Учёба'], ['extra', 'Дополнительные'], ['done', 'Выполненные']]
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
      <button class="btn small" data-act="editLib" data-id="${x.id}">Изменить</button></div>`;
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

function classModal(id) {
  const c = id ? byId('classes', id) : { day: 1, start: '09:00', end: '10:30', type: 'lecture', parity: 'all' };
  if (!c) return;
  openModal(id ? 'Пара' : 'Новая пара', `${subjectSelect(c.subjectId)}
    <div class="row"><label class="f">День<select name="day">${DAYS.map((d, i) => `<option value="${i + 1}" ${c.day === i + 1 ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
    <label class="f">Тип занятия<select name="type">${opts(TYPES, c.type)}</select></label></div>
    <div class="row"><label class="f">Начало<input type="time" name="start" value="${esc(c.start)}" required></label>
    <label class="f">Конец<input type="time" name="end" value="${esc(c.end)}" required></label></div>
    <label class="f">Недели<select name="parity">${opts({ all: 'Каждую неделю', odd: 'Только нечётные', even: 'Только чётные' }, c.parity)}</select></label>
    <div class="row"><label class="f">Аудитория<input name="room" value="${esc(c.room)}" maxlength="40"></label>
    <label class="f">Преподаватель<input name="teacher" value="${esc(c.teacher)}" maxlength="80"></label></div>
    <div class="buttons"><button class="btn primary grow">Сохранить</button>${id ? `<button type="button" class="btn danger" data-act="delClass" data-id="${id}">Удалить</button>` : ''}</div>`,
    fd => {
      if (fd.get('end') <= fd.get('start')) throw new Error('Конец пары должен быть позже начала');
      const subjectId = resolveSubject(fd);
      if (!subjectId) throw new Error('Выберите предмет');
      upsert('classes', { id: id || uid(), subjectId, day: +fd.get('day'), type: fd.get('type'), start: fd.get('start'), end: fd.get('end'),
        parity: fd.get('parity'), room: (fd.get('room') || '').trim(), teacher: (fd.get('teacher') || '').trim() });
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

function taskModal(id, preset = {}) {
  const t = id ? byId('tasks', id) : { kind: 'study', priority: 0, files: [], ...preset };
  if (!t) return;
  draft = { files: (t.files || []).filter(f => byId('files', f)), pending: [], removed: [] };
  openModal(id ? 'Задача' : 'Новая задача', `
    <label class="f">Название<input name="title" value="${esc(t.title)}" required maxlength="200" autocomplete="off"></label>
    <div class="seg"><input type="radio" name="kind" id="k1" value="study" ${t.kind !== 'extra' ? 'checked' : ''} data-change="kindSel"><label for="k1">Учёба</label>
    <input type="radio" name="kind" id="k2" value="extra" ${t.kind === 'extra' ? 'checked' : ''} data-change="kindSel"><label for="k2">Дополнительная</label></div>
    <div id="subjArea" class="${t.kind === 'extra' ? 'hidden' : ''}">${subjectSelect(t.subjectId)}</div>
    <div class="row"><label class="f">Срок<input type="date" name="due" value="${esc(t.due)}"></label>
    <label class="f">Важность<select name="priority"><option value="0">Обычная</option><option value="1" ${t.priority ? 'selected' : ''}>Важная</option></select></label></div>
    <label class="f">Заметка<textarea name="note" maxlength="2000">${esc(t.note)}</textarea></label>
    <div class="files"><label class="f" style="margin-bottom:4px">Вложения</label><div id="att">${attHtml()}</div>
    <label class="btn small" style="display:inline-block;margin:6px 0 14px">Прикрепить файл<input type="file" multiple data-change="pickAtt" hidden></label></div>
    <div class="buttons"><button class="btn primary grow">Сохранить</button>${id ? `<button type="button" class="btn danger" data-act="delTask" data-id="${id}">Удалить</button>` : ''}</div>`,
    async fd => {
      const title = (fd.get('title') || '').trim(); if (!title) throw new Error('Введите название');
      const kind = fd.get('kind');
      const subjectId = kind === 'study' ? resolveSubject(fd) : null;
      const fileIds = [...draft.files];
      for (const f of draft.pending) fileIds.push((await uploadAndRecord(f)).id);
      draft.removed.forEach(removeFile);
      const base = id ? byId('tasks', id) : { id: uid(), done: false, created: Date.now() };
      upsert('tasks', { ...base, title, kind, subjectId, due: fd.get('due') || '', priority: +fd.get('priority') || 0, note: (fd.get('note') || '').trim(), files: fileIds });
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
      : `<div class="files"><div id="att">${attHtml()}</div><label class="btn small" style="display:inline-block;margin:0 0 14px">Выбрать файлы<input type="file" multiple data-change="pickLib" hidden></label></div>`}</div>
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
  weekGo(el) { const v = +el.dataset.v; ui.wo = v === 0 ? 0 : ui.wo + v; render(); },
  setSP(el) { ui.sp = el.dataset.v; render(); },
  setTF(el) { ui.tf = el.dataset.v; render(); },
  libSubj(el) { ui.ls = el.dataset.v; render(); },
  newTask() { taskModal(null); },
  editTask(el) { taskModal(el.dataset.id); },
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
  newClass() { classModal(null); },
  editClass(el) { classModal(el.dataset.id); },
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
  setStart(el) { S.settings = { ...S.settings, start: el.value, u: Date.now() }; commit(); },
  setFirstWeek(el) { const n = parseInt(el.value, 10); S.settings = { ...S.settings, firstWeek: isNaN(n) ? 1 : n, u: Date.now() }; commit(); },
  subjSel(el) {
    const w = $('#newSubjWrap'); w.classList.toggle('hidden', el.value !== '__new');
    if (el.value === '__new') $('input', w).focus();
  },
  kindSel(el) { $('#subjArea').classList.toggle('hidden', el.value !== 'study'); },
  libKind(el) { $('#libFile').classList.toggle('hidden', el.value !== 'file'); $('#libLink').classList.toggle('hidden', el.value !== 'link'); },
  pickAtt(el) { draft.pending.push(...el.files); el.value = ''; refreshAtt(); },
  pickLib(el) { draft.pending = [...el.files]; el.value = ''; refreshAtt(); },
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
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#modal-root').firstChild) closeModal();
  if (e.key === 'Enter' && e.target.id === 'newSubjName') { e.preventDefault(); A.addSubj(); }
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

/* ---------- Запуск ---------- */
render();
if (meta.signedIn && token) syncNow();
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
