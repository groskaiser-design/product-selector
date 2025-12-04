// BLOCK 0: TMA boot (FIXED & DARK)

(function initTMA() {
  try {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    tg.ready();
    tg.expand();

    // 1. Принудительно красим шапку в черный (#050505)
    try {
      tg.setHeaderColor('#050505'); 
      if (tg.setBackgroundColor) {
        tg.setBackgroundColor('#050505');
      }
    } catch (e) {
      console.log('Error setting color:', e);
    }

    // 2. Безопасная настройка кнопки "Назад"
    try {
      if (tg.BackButton) {
        tg.BackButton.show();
        // Сбрасываем старые клики перед установкой нового
        tg.BackButton.offClick(); 
        
        tg.BackButton.onClick(function() {
          try {
            window.location.href = 'router.html';
          } catch (_) {
            window.history.back();
          }
        });
      }
    } catch (e) {
      console.log('Error setting back button:', e);
    }

    // 3. Отключаем свайпы (чтобы не сворачивалось случайно)
    try {
      if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    } catch (e) {}

  } catch (globalErr) {
    console.error('Critical TMA Init Error:', globalErr);
  }
})();
function isAdmin(){
  try{ return Number(window.Telegram?.WebApp?.initDataUnsafe?.user?.id) === 196047220; }catch(_){ return false; }
}

/* ============================================================
 *  BLOCK A: UI utils
 * ============================================================ */
const ROW_VAR = getComputedStyle(document.documentElement).getPropertyValue('--row').trim();
const rowH = ROW_VAR.endsWith('px') ? parseFloat(ROW_VAR) : (parseFloat(ROW_VAR) || 36);
const pad = 4;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

/** Универсальная нормализация чисел из бэка/локального стейта */
function numOrNull(v){
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string'){
    const s = v.trim();
    if (!s || /^null$/i.test(s)) return null;
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

  
/* ============================================================
 *  BLOCK A1: Wheels + ensureWheel
 * ============================================================ */
function buildWheel(fieldEl, initial){
  const min = +fieldEl.dataset.min;
  const max = +fieldEl.dataset.max;
  const minInt = Math.floor(min);
  const maxInt = Math.floor(max);
  const intRange = maxInt - minInt;
  const key = fieldEl.dataset.key;
  const onlyInt = fieldEl.dataset.onlyInt === '1' || fieldEl.dataset.onlyInt === 'true';

  const intCol = fieldEl.querySelector('.col-int');
  const fracCol = fieldEl.querySelector('.col-frac');
  const duo = fieldEl.querySelector('.duo');

  const opt = t => { const d=document.createElement('div'); d.className='option'; d.textContent=t; return d; };
  function fillCol(col, from, to){
    const frag=document.createDocumentFragment();
    for(let i=0;i<pad;i++) frag.appendChild(opt(''));
    for(let i=from;i<=to;i++) frag.appendChild(opt(i));
    for(let i=0;i<pad;i++) frag.appendChild(opt(''));
    col.innerHTML=''; col.appendChild(frag);
  }
  fillCol(intCol, minInt, maxInt);
  fillCol(fracCol, 0, onlyInt ? 0 : 9);

  const nearestIndex = col =>
    Math.round((col.scrollTop + (col.clientHeight - rowH)/2)/rowH) - pad;

  const lastActiveIdx = new WeakMap();
  function markActive(col){
    const idx = nearestIndex(col) + pad;
    const prev = lastActiveIdx.get(col);
    if (typeof prev === 'number' && prev !== idx && !isProgrammatic) {
      try { window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.(); } catch(_){}
    }
    if (typeof prev === 'number' && col.children[prev]) col.children[prev].classList.remove('active');
    const el = col.children[idx];
    if (el) el.classList.add('active');
    lastActiveIdx.set(col, idx);
  }

  const setScrollInstant = (col, idx) => {
    const ch = col.clientHeight || rowH * 5;
    const top = (idx + pad) * rowH - (ch - rowH)/2;
    col.scrollTop = top;
    requestAnimationFrame(()=> markActive(col));
  };

  function withNoSnap(fn){
    const prevInt = intCol.style.scrollSnapType;
    const prevFrac = fracCol.style.scrollSnapType;
    intCol.style.scrollSnapType = 'none';
    fracCol.style.scrollSnapType = 'none';
    try { fn(); }
    finally {
      requestAnimationFrame(()=>{
        intCol.style.scrollSnapType = prevInt || '';
        fracCol.style.scrollSnapType = prevFrac || '';
        markActive(intCol); markActive(fracCol);
      });
    }
  }

  let isProgrammatic = false;
  let rafInt = 0, rafFrac = 0;
  let snapTimer=null;
  const supportsScrollEnd = ('onscrollend' in window);
  let disabled = false;

  // Модельное значение — держим здесь, даже если визуально не выставляли
  let modelValue = (typeof initial === 'number')
    ? clamp(+initial, min, max)
    : clamp(min + (max - min) / 2, min, max);

  function applyFracLock(iVal){
    if (disabled) return;
    const lock = onlyInt || (iVal === maxInt);
    fracCol.style.pointerEvents = lock ? 'none' : 'auto';
    fracCol.style.opacity = lock ? 0.5 : 1;
  }

  function dispatchChange(){
    const v = api.value;
    document.dispatchEvent(new CustomEvent('wheelchange', {
      detail:{ key, value: v, programmatic: isProgrammatic }
    }));
  }

  function setValue(v){
    const clamped = clamp(+v, min, max);
    const rounded = onlyInt ? Math.round(clamped) : Math.round(clamped * 10) / 10;
    modelValue = rounded;

    const iVal = Math.trunc(rounded);
    let f = onlyInt ? 0 : Math.round((rounded - iVal) * 10);
    if (iVal === maxInt) f = 0;
    const iIdx = iVal - minInt;

    const prev = isProgrammatic; isProgrammatic = true;
    withNoSnap(()=>{
      setScrollInstant(intCol, iIdx);
      setScrollInstant(fracCol, f);
    });
    applyFracLock(iVal);
    markActive(intCol); markActive(fracCol);
    requestAnimationFrame(()=>{ isProgrammatic = prev; dispatchChange(); });
  }

  function snapNow(){
    if (isProgrammatic) return;
    let iIdx = clamp(nearestIndex(intCol), 0, intRange);
    let f = onlyInt ? 0 : clamp(nearestIndex(fracCol), 0, 9);
    const iVal = minInt + iIdx;
    if (iVal === maxInt) f = 0;

    modelValue = onlyInt ? (iVal) : +(iVal + f/10).toFixed(1);

    const prev = isProgrammatic; isProgrammatic = true;
    setScrollInstant(intCol, iIdx);
    setScrollInstant(fracCol, f);
    applyFracLock(iVal);
    markActive(intCol); markActive(fracCol);
    requestAnimationFrame(()=>{ isProgrammatic = prev; dispatchChange(); });
  }

  function onScrollInt(){
    if (isProgrammatic) return;
    if (rafInt) cancelAnimationFrame(rafInt);
    rafInt = requestAnimationFrame(()=>markActive(intCol));
    scheduleSnap();
  }
  function onScrollFrac(){
    if (isProgrammatic || onlyInt) return;
    if (rafFrac) cancelAnimationFrame(rafFrac);
    rafFrac = requestAnimationFrame(()=>markActive(fracCol));
    scheduleSnap();
  }

  function scheduleSnap(){
    clearTimeout(snapTimer);
    snapTimer = setTimeout(snapNow, 80);
  }

  intCol.addEventListener('scroll', onScrollInt, {passive:true});
  fracCol.addEventListener('scroll', onScrollFrac, {passive:true});
  if (supportsScrollEnd){
    intCol.addEventListener('scrollend', snapNow, {passive:true});
    if (!onlyInt) fracCol.addEventListener('scrollend', snapNow, {passive:true});
  }

  function setDisabled(dis, programmatic=false){
    const prev = isProgrammatic; if (programmatic) isProgrammatic = true;
    disabled = dis;
    duo.classList.toggle('disabled', dis);
    duo.setAttribute('aria-disabled', String(dis));
    [intCol, fracCol].forEach(c=>c.style.pointerEvents = dis ? 'none' : 'auto');
    if (!dis){
      const iIdx = clamp(nearestIndex(intCol), 0, intRange);
      const iVal = minInt + iIdx;
      applyFracLock(iVal);
    }
    dispatchChange();
    isProgrammatic = prev;
  }

  // ⚠️ КРИТИЧНО: не выставляем визуальное значение, если поле скрыто (аккордеон свернут),
  // чтобы не перетирать данные, пришедшие из бэка.
  const initVal = (typeof initial==='number') ? initial : (min + (max - min) / 2);
  if (fieldEl.offsetParent !== null) {
    setValue(initVal);
  }

  const api = {
    setValue,
    get value(){
      const iIdx = clamp(nearestIndex(intCol), 0, intRange);
      let f = onlyInt ? 0 : clamp(nearestIndex(fracCol), 0, 9);
      const iVal = minInt + iIdx;
      if (iVal === maxInt) f = 0;
      return onlyInt ? iVal : +(iVal + f/10).toFixed(1);
    },
    getModelValue(){ return modelValue; },
    setDisabled,
    destroy(){
      clearTimeout(snapTimer);
      intCol.removeEventListener('scroll', onScrollInt);
      fracCol.removeEventListener('scroll', onScrollFrac);
      if (supportsScrollEnd){
        intCol.removeEventListener('scrollend', snapNow);
        if (!onlyInt) fracCol.removeEventListener('scrollend', snapNow);
      }
    }
  };
  return api;
}
const wheels = {};
const wheelMap = new WeakMap();
function ensureWheel(fieldEl, cfg){
  let w = wheelMap.get(fieldEl);
  if (w) return w;

  const pend = (window.__pendingInputs || {});
  const hasPend = Object.prototype.hasOwnProperty.call(pend, cfg.key);
  const pendVal = hasPend ? pend[cfg.key] : undefined;
  const parsed  = numOrNull(pendVal);
  const initVal = (parsed != null) ? parsed : cfg.initial;

  w = buildWheel(fieldEl, initVal);
  wheelMap.set(fieldEl, w);
  wheels[cfg.key] = w;

  if (cfg.optional){
    let cb = fieldEl.querySelector('#opt_'+cfg.key);
    if (!cb){
      const opt = document.createElement('div');
      opt.className = 'optline';
      opt.innerHTML = `<label style="display:flex;align-items:center;gap:8px;opacity:.95">
          <input type="checkbox" id="opt_${cfg.key}"> нет данных
        </label>`;
      fieldEl.appendChild(opt);
      cb = opt.querySelector('input');
    }
    if (!cb._bound){
      cb.addEventListener('change', ()=>{ w.setDisabled(cb.checked); }, {passive:true});
      cb._bound = true;
    }
    if (hasPend && pendVal == null){
      cb.checked = true;
      w.setDisabled(true, /*programmatic*/true);
    }
  }

  if (hasPend && parsed != null){
    delete pend[cfg.key];
  }
  return w;
}

/* ============================================================
 *  BLOCK B: Fields + render + hard init
 * ============================================================ */
const FIELDS = [
  { key:'age',    label:'Возраст', unit:'лет', min:14, max:90, initial:30, onlyInt:true },
  { key:'weight', label:'Вес', unit:'кг', min:40, max:250, initial:70.0 },
  { key:'height', label:'Рост', unit:'см', min:120, max:230, initial:175.0 },
  { key:'fat',    label:'% жира', unit:'%', min:3,  max:60,  initial:18.0, optional:true }
];
const CFG = Object.fromEntries(FIELDS.map(f=>[f.key, f]));
const fieldsWrap = document.getElementById('fields');
const fieldByKey = Object.create(null);
window.__pendingInputs = window.__pendingInputs || {};
for (const cfg of FIELDS){
  const f = document.createElement('div');
  f.className = 'field';
  f.dataset.key = cfg.key;
  f.dataset.min = cfg.min;
  f.dataset.max = cfg.max;
  if (cfg.onlyInt) f.dataset.onlyInt = '1';
  f.innerHTML = `
    <div class="row"><div class="label">${cfg.label}</div><div class="unit">${cfg.unit}</div></div>
    <div class="duo"><div class="col col-int"></div><div class="sep">,</div><div class="col col-frac"></div></div>
  `;
  const h = document.createElement('div');
  h.className = 'help';
  h.textContent = cfg.onlyInt ? 'целые годы' :
                  (cfg.unit==='кг' ? 'кг: целые и десятые' :
                  cfg.unit==='см' ? 'см: целые и десятые (1 десятая = 1 мм)' :
                  'проценты: целые и десятые');
  f.appendChild(h);
  fieldsWrap.appendChild(f);
  fieldByKey[cfg.key] = f;
}
function ensureAllWheelsOnce(){
  if (window.__wheelsInitDone) return;
  const t0 = performance?.now ? performance.now() : Date.now();
  for (const cfg of FIELDS){
    const el = fieldByKey[cfg.key];
    if (el) ensureWheel(el, cfg);
  }
  const t1 = performance?.now ? performance.now() : Date.now();
  window.__wheelsInitMs = +(t1 - t0).toFixed(1);
  window.__wheelsInitDone = true;
  if (isAdmin() && typeof window.__pageLaunchToUpdateWheel !== 'number') {

    window.__pageLaunchToWheelsInit = performance.now() - window.__pageLoadTime;
    if (typeof window.updatePerfUI === 'function') window.updatePerfUI();
  }
  try { if (typeof updatePerfUI === 'function') updatePerfUI(); } catch(_){}
}
ensureAllWheelsOnce();
window.forceInitAllWheels = ensureAllWheelsOnce;

/* ===========================
 * BLOCK C — SAVE (Apps Script)
 * =========================== */
  
const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbzA3cgov2npW-Yws5X6v1qnqe4H7Cg38zkikPJW5GPH5PLlfIsjeWGwRRyOUZZaVwINZw/exec';
const APP_VERSION  = 'frontend-2025-10-21';
const REQUEST_TIMEOUT_MS = 30000;
function nowIso(){ return new Date().toISOString(); }
function todayLocalISO(tz){
  try{
    const d = new Date();
    const y  = new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric'}).format(d);
    const m  = new Intl.DateTimeFormat('en-CA',{timeZone:tz,month:'2-digit'}).format(d);
    const da = new Intl.DateTimeFormat('en-CA',{timeZone:tz,day:'2-digit'}).format(d);
    return `${y}-${m}-${da}`;
  }catch{ return new Date().toISOString().slice(0,10); }
}
function clientTZ(){ try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch{ return 'UTC'; } }
function genSaveId(){ return Date.now() + '_' + Math.random().toString(36).slice(2,10); }

async function saveMeasurementsToDB(values, saveId){
  if (!values || typeof values !== 'object') throw new Error('Нет данных для сохранения.');
  const tg       = window.Telegram?.WebApp;
  const tz       = clientTZ();
  const dayLocal = todayLocalISO(tz);
  const payload = {
    action: 'save',
    init_data: String(tg?.initData || ''),
    tz, client_day_local: dayLocal,
    locale: tg?.initDataUnsafe?.user?.language_code || '',
    source: 'webapp', app_version: APP_VERSION,
    t_client: nowIso(), save_id: saveId || genSaveId(),
    data: values // ← тут ВСЯ АНКЕТА (колёса + все выборы)
  };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let resp, raw, json = null;
  try {
    resp = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, // simple request, без preflight
      body: JSON.stringify(payload),
      redirect: 'follow', cache: 'no-store', credentials: 'omit', mode: 'cors',
      signal: controller.signal
    });
    raw = await resp.text();
    try { json = raw ? JSON.parse(raw) : null; } catch {}
  } catch (err) {
    if (err && err.name === 'AbortError') { const e = new Error('Сервер не ответил вовремя'); e.code = 408; throw e; }
    throw err;
  } finally { clearTimeout(t); }

  const isRateLimited =
    resp?.status === 429 ||
    (json && (json.code === 429 || json.status === 429)) ||
    /(?:too\s*many\s*requests|rate[-_\s]*limit|429|слишком\s+часто)/i.test(String(json?.error || resp?.statusText || ''));

  if (!resp?.ok || !json || json.ok !== true) {
    const msg = (json && json.error) ? json.error : `HTTP ${resp?.status ?? '0'} ${resp?.statusText ?? ''}`.trim();
    if (isRateLimited) { const e = new Error('Too many requests'); e.code = 429; throw e; }
    if (msg === 'timeout' || /timeout|network/i.test(String(msg))) { const e = new Error('Сервер не ответил вовремя'); e.code = 408; throw e; }
    const e = new Error(msg || 'Save failed'); e.code = resp?.status ?? 0; throw e;
  }
  return {
    ok: true,
    day_local: json.day_local,
    ts_iso:    json.ts_iso,
    row_all:   Number(json.row_all),
    row_calc:  Number(json.row_calc)
  };
}

// ← безопасный пост-чек факта сохранения при таймауте
async function fetchUserRow(){
  const tg = window.Telegram?.WebApp;
  try{
    const resp = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ action:'user_row', init_data:String(tg?.initData || '') }),
      cache:'no-store', credentials:'omit', mode:'cors'
    });
    const raw = await resp.text();
    const json = raw ? JSON.parse(raw) : null;
    if (!resp.ok || !json || json.ok !== true) return null;
    return json;
  } catch { return null; }
}

async function confirmSavedAfterTimeout(prevRowCalc){
  const row = await fetchUserRow().catch(()=>null);
  if (row && row.found && Number(row.row_calc) && Number(row.row_calc) !== Number(prevRowCalc || 0)) {
    return Number(row.row_calc);
  }
  return null;
}

// --- Ждем, пока новые данные появятся на сервере (ДОЛЖНА БЫТЬ ВНЕ других функций!) ---
async function waitForFreshData(rowCalcAfterSave, fastMs = 10000, slowMs = 60000) {
  const api = (window && typeof window.apiFrontBootstrap === 'function')
    ? window.apiFrontBootstrap
    : (typeof apiFrontBootstrap === 'function' ? apiFrontBootstrap : null);

  if (!api) return null;

  let seenFront = false, seenMacros = false, seenChart = false;
  const t0 = Date.now();

  // Фаза A — быстрая
  while (Date.now() - t0 < fastMs) {
    try {
      const b = await api(rowCalcAfterSave);
      const sameRow = Number(b?.row) === Number(rowCalcAfterSave);

      if (b?.front)  seenFront  = seenFront  || !!(b.front.ready  || b.front.html);
      if (b?.macros) seenMacros = seenMacros || !!b.macros.ready;
      if (b?.chart)  seenChart  = seenChart  || !!b.chart.ready;

      if ((seenFront && seenMacros && seenChart) || sameRow) return b;
    } catch(_) {}
    await new Promise(res => setTimeout(res, 200));
  }

  // Фаза B — медленная
  const t1 = Date.now();
  while (Date.now() - t1 < slowMs) {
    try {
      const b = await api(rowCalcAfterSave);
      const sameRow = Number(b?.row) === Number(rowCalcAfterSave);
      const allReady = !!(b?.front?.ready) && !!(b?.macros?.ready) && !!(b?.chart?.ready);
      if (allReady || sameRow) return b;
    } catch(_) {}
    await new Promise(res => setTimeout(res, 750));
  }
  return null;
}

/* ============================================================
 *  BLOCK D — Кулдаун, попапы, сохранение
 * ============================================================ */
var SAVE_IN_PROGRESS = false;
var COOLDOWN_MS = 60000;
var COOLDOWN_KEY = 'save_unlock_time';
function getUnlockTime(){ try { return Number(localStorage.getItem(COOLDOWN_KEY)) || 0; } catch(_) { return 0; } }
function setUnlockTime(time){ try { localStorage.setItem(COOLDOWN_KEY, String(time)); } catch(_){} }
function canSaveNow(){ if (SAVE_IN_PROGRESS) return false; var now = Date.now(); return !(getUnlockTime() > now); }

var ROWCALC_KEY_PREFIX = 'macros:last_row_calc:';
function currentUserId(){ try { return window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 'anon'; } catch(_){ return 'anon'; } }
function rowCalcKey(uid){ return ROWCALC_KEY_PREFIX + String(uid); }
function setRowCalcForUser(rowCalc, uid){
  if (typeof uid === 'undefined') uid = currentUserId();
  try { localStorage.setItem(rowCalcKey(uid), String(rowCalc)); }
  catch(_) { try { sessionStorage.setItem(rowCalcKey(uid), String(rowCalc)); } catch(_){ } }
  if (!window.__rowCalcByUid) window.__rowCalcByUid = {};
  window.__rowCalcByUid[String(uid)] = Number(rowCalc);
}
function getRowCalcForUser(uid){
  if (typeof uid === 'undefined') uid = currentUserId();
  if (window.__rowCalcByUid && (String(uid) in window.__rowCalcByUid)) return window.__rowCalcByUid[String(uid)];
  var v = null; 
  try { v = localStorage.getItem(rowCalcKey(uid)); } 
  catch(_) { try { v = sessionStorage.getItem(rowCalcKey(uid)); } catch(_){ } }
  var n = (v == null) ? null : Number(v);
  if (!window.__rowCalcByUid) window.__rowCalcByUid = {};
  window.__rowCalcByUid[String(uid)] = isNaN(n) ? null : n;
  return window.__rowCalcByUid[String(uid)];
}
window.getRowCalcForUser = getRowCalcForUser;
window.setRowCalcForUser = setRowCalcForUser;

var LASTTIME_KEY_PREFIX = 'macros:last_measurement_time:';
function lastTimeKey(uid){ return LASTTIME_KEY_PREFIX + String(uid); }
function setLastMeasurementTime(timestamp, uid){
  if (typeof uid === 'undefined') uid = currentUserId();
  try { localStorage.setItem(lastTimeKey(uid), String(timestamp)); } 
  catch(_) { try { sessionStorage.setItem(lastTimeKey(uid), String(timestamp)); } catch(_){ } }
  if (!window.__lastTimeByUid) window.__lastTimeByUid = {};
  window.__lastTimeByUid[String(uid)] = Number(timestamp);
  updateLastTimeDisplay(timestamp);
}
function getLastMeasurementTime(uid){
  if (typeof uid === 'undefined') uid = currentUserId();
  if (window.__lastTimeByUid && (String(uid) in window.__lastTimeByUid)) return window.__lastTimeByUid[String(uid)];
  var v = null; 
  try { v = localStorage.getItem(lastTimeKey(uid)); } 
  catch(_) { try { v = sessionStorage.getItem(lastTimeKey(uid)); } catch(_){ } }
  var n = (v == null) ? null : Number(v);
  if (!window.__lastTimeByUid) window.__lastTimeByUid = {};
  window.__lastTimeByUid[String(uid)] = isNaN(n) ? null : n;
  return window.__lastTimeByUid[String(uid)];
}
function updateLastTimeDisplay(timestamp){
  var el = document.getElementById('lastTime');
  if (!el) return;
  if (!timestamp) { el.textContent = 'Последний замер: нет данных'; return; }
  var date = new Date(timestamp);
  var dateStr = date.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' });
  var timeStr = date.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
  el.textContent = 'Последний замер: ' + dateStr + ' ' + timeStr;
}
window.setLastMeasurementTime = setLastMeasurementTime;
window.getLastMeasurementTime = getLastMeasurementTime;

// === Row lock: держим целевой row после сохранения, чтобы не откатываться
var __desiredRow = null, __desiredRowUntil = 0;
function lockDesiredRow(row, ms){ __desiredRow = Number(row)||null; __desiredRowUntil = Date.now() + (ms||60000); }
function desiredRow(){ return (Date.now() < __desiredRowUntil) ? __desiredRow : null; }

function getSaveBtn(){ return document.getElementById('saveBtn'); }
function setSavingState(isSaving){
  var btn = getSaveBtn(); if (!btn) return;
  var label = btn.querySelector('.btn-label');
  var sp = btn.querySelector('.spinner');
  btn.classList.toggle('loading', !!isSaving);
  btn.setAttribute('aria-busy', String(!!isSaving));
  if (sp) sp.hidden = !isSaving;
  if (label) label.textContent = isSaving ? 'Обработка…' : 'Сохранить';
}
function showPopup(title, message, haptic){
  var tg = window.Telegram?.WebApp;
  if (haptic && tg?.HapticFeedback?.notificationOccurred) { try { tg.HapticFeedback.notificationOccurred(haptic); } catch(_){ } }
  if (tg?.showPopup) { tg.showPopup({ title, message, buttons: [{type:'ok'}] }); }
  else { alert(title + '\n\n' + message); }
}
function collapseAccordionSafe(){
  var act = function(){
    try{
      var section = document.getElementById('sec-measures');
      if (section){ section.classList.add('collapsed'); section.setAttribute('aria-hidden','true'); }
      document.querySelectorAll('[data-toggle="sec-measures"]').forEach(function(h){
        h.setAttribute('aria-expanded','false');
      });
    }catch(_){}
  };
  try { requestAnimationFrame(function(){ requestAnimationFrame(act); }); } catch(_){ act(); }
}
function scrollTopNoJump(){
  try{ document.activeElement?.blur?.(); }catch(_){}
  try{
    const html = document.documentElement, body = document.body;
    const prev = html.style.scrollBehavior; html.style.scrollBehavior = 'auto';
    window.scrollTo(0,0); html.scrollTop = 0; body.scrollTop = 0;
    html.style.scrollBehavior = prev || '';
  }catch(_){}
}

/* === СБОР КОЛЁС === */
function collectWheelValues(){
  var out = {};
  for (var i=0; i<FIELDS.length; i++){
    var cfg = FIELDS[i];
    var fieldEl = fieldByKey[cfg.key];
    var w = (wheels[cfg.key] || ensureWheel(fieldEl, cfg));
    var cb = fieldEl ? fieldEl.querySelector('#opt_' + cfg.key) : null;
    out[cfg.key] = (cfg.optional && cb && cb.checked) ? null : w.value;
  }
  if (typeof out.age === 'number') out.age = Math.round(out.age);
  return out;
}

/* === СБОР АНКЕТЫ (все селекторы) === */
function collectSurveyValues(){
  const out = {};
  const isHidden = (node) => {
    if (!node) return true;
    const field = node.closest?.('.field') || node;
    const cs = field && getComputedStyle(field);
    return !field || cs.display === 'none' || cs.visibility === 'hidden';
  };

  const g = document.querySelector('.binary-btn.active[data-field="gender"]');
  out.gender = g ? g.dataset.value : null;

  const single = (field) => {
    const list = document.querySelector(`.choice-list[data-type="single"][data-field="${field}"]`);
    if (!list || isHidden(list)) return null;
    const sel = list.querySelector('.choice-item.selected');
    return sel ? sel.dataset.value : null;
  };
  const multiple = (field) => {
    const list = document.querySelector(`.choice-list[data-type="multiple"][data-field="${field}"]`);
    if (!list || isHidden(list)) return null;
    const vals = [...list.querySelectorAll('.choice-item.selected')].map(i=>i.dataset.value);
    if (!vals.length) return null;
    if (vals.includes('none')) return ['none'];
    return vals;
  };

  out.body_comp           = single('body_comp');
  out.ethnicity           = single('ethnicity');
  out.job_type            = single('job_type');
  out.steps_per_day       = single('steps_per_day');
  out.workouts_per_week   = single('workouts_per_week');
  out.workout_duration    = single('workout_duration');
  out.workout_intensity   = single('workout_intensity');
  out.neat_level          = single('neat_level');
  out.sleep_hours         = single('sleep_hours');
  out.weight_history      = single('weight_history');
  out.main_goal           = single('main_goal');
  out.goal_pace           = single('goal_pace');
  out.chronic_conditions  = multiple('chronic_conditions');
  out.pregnancy_lactation = single('pregnancy_lactation');
  out.cycle_regular       = single('cycle_regular');

  if (out.gender === 'male'){ out.pregnancy_lactation = null; out.cycle_regular = null; }

  try{
    const bf = document.getElementById('bf-none');
    const sys = document.getElementById('opt_fat');
    const noFat = (bf && bf.checked) || (sys && sys.checked);
    if (!noFat) out.body_comp = null;
  }catch(_){}

  return out;
}

/* === CACHE: inputs (анкета) === */
const INPUTS_KEY_PREFIX = 'inputs:vals:';
if (typeof currentUserId !== 'function') {
  function currentUserId(){
    try { return window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 'anon'; }
    catch(_) { return 'anon'; }
  }
}
function inputsKey(uid){ return INPUTS_KEY_PREFIX + String(uid ?? currentUserId()); }
function saveInputsCache(obj, uid){ try { localStorage.setItem(inputsKey(uid), JSON.stringify(obj)); } catch(_){} }
function loadInputsCache(uid){
  try { const raw = localStorage.getItem(inputsKey(uid)); return raw ? JSON.parse(raw) : null; }
  catch(_) { return null; }
}

// ===== ВАЛИДАЦИЯ (как было) =====
function isFormValid() {
  try {
    const wheels = collectWheelValues();
    const survey = collectSurveyValues();
    if (!wheels.age || wheels.age === 0) return false;
    if (!wheels.weight || wheels.weight === 0) return false;
    if (!wheels.height || wheels.height === 0) return false;
    if (!survey.gender) return false;
    const hasFat = wheels.fat !== null && wheels.fat !== 0;
    const hasBodyComp = survey.body_comp !== null;
    if (!hasFat && !hasBodyComp) return false;
    const required = [
      'ethnicity', 'job_type', 'steps_per_day', 'workouts_per_week',
      'workout_duration', 'workout_intensity', 'neat_level', 'sleep_hours',
      'weight_history', 'main_goal', 'goal_pace', 'chronic_conditions'
    ];
    for (const field of required) {
      if (!survey[field]) return false;
    }
    if (survey.gender === 'female') {
      if (!survey.pregnancy_lactation) return false;
      if (survey.pregnancy_lactation === 'none' && !survey.cycle_regular) return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}
function updateSaveButton() {
  const btn = document.getElementById('saveBtn');
  if (!btn) return;
  const isValid = isFormValid();
  btn.disabled = !isValid;
  if (!isValid) {
    btn.classList.add('disabled');
    btn.style.cursor = 'not-allowed';
  } else {
    btn.classList.remove('disabled');
    btn.style.cursor = 'pointer';
  }
}
(function setupValidation() {
  setTimeout(updateSaveButton, 100);
  document.addEventListener('wheelchange', () => {
    requestAnimationFrame(updateSaveButton);
  });
  document.addEventListener('click', (e) => {
    if (e.target?.closest?.('.binary-btn') || e.target?.closest?.('.choice-item')) {
      setTimeout(updateSaveButton, 50);
    }
  }, { passive: true });
  const bfNone = document.getElementById('bf-none');
  const optFat = document.getElementById('opt_fat');
  if (bfNone) bfNone.addEventListener('change', updateSaveButton);
  if (optFat) optFat.addEventListener('change', updateSaveButton);
  setInterval(updateSaveButton, 1000);
})();

/* === КНОПКА СОХРАНЕНИЯ: Сохраняем ВЕСЬ ПАКЕТ === */
function handleSaveClick(e){
  if (e && e.preventDefault) { try { e.preventDefault(); } catch(_){} }
  if (!canSaveNow()) {
    showPopup('Too many requests','Не нужно так часто нажимать эту кнопку','error');
    return;
  }

  if (!isFormValid()) {
    const tg = window.Telegram?.WebApp;
    try { tg?.HapticFeedback?.notificationOccurred?.('error'); } catch(_){}
    showPopup('Не все поля заполнены', 'Заполните все обязательные поля анкеты.', 'error');
    return;
  }

  const tg = window.Telegram?.WebApp;
  const prevRowCalc = getRowCalcForUser();

  // 🔒 Пинним «ожидаемый новый» row: не показываем старые данные
  const minNewRow = (Number(prevRowCalc) || 0) + 1;
  try { lockDesiredRow(minNewRow, 60000); } catch(_) {}

  const saveId = genSaveId();

  SAVE_IN_PROGRESS = true;
  setUnlockTime(Date.now() + COOLDOWN_MS);
  setSavingState(true);
  try { tg?.HapticFeedback?.impactOccurred?.('light'); } catch(_){}

  const values = { ...collectWheelValues(), ...collectSurveyValues() };

  try {
    const uid = (typeof currentUserId === 'function') ? currentUserId() : 'anon';
    localStorage.removeItem('macros:vals:' + String(uid));
    localStorage.removeItem('chart:data:' + String(uid));
  } catch(_){}

  const saveTask = saveMeasurementsToDB(values, saveId);

  collapseAccordionSafe();
  requestAnimationFrame(()=>requestAnimationFrame(scrollTopNoJump));
  setTimeout(()=>{
    try { startFrontDataFlow(); } catch(_){}
    try { window.startFrontDataFlow(); } catch(_){}  // ← AI комментарий
    try { window.startMacrosFlow(); } catch(_){}
    try { window.startChartFlow(); } catch(_){}
  }, 0);

  try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch(_){}
  showPopup('Готово','Данные отправлены. Обновляем…','success');

  saveTask
    .then(async (res)=>{
      const rowCalc = Number(res?.row_calc);
      if (Number.isFinite(rowCalc)) setRowCalcForUser(rowCalc);
      const ts = res?.ts_iso ? Date.parse(res.ts_iso) : Date.now();
      setLastMeasurementTime(ts);

      // 🔒 Перелочим уже на фактический row (ещё на 10с)
      try { lockDesiredRow(Number(rowCalc) || minNewRow, 10000); } catch(_){}

      try { window.startMacrosFlow(); } catch(_){}
      try { window.startChartFlow(); } catch(_){}
      
      try {
        const uid = (typeof currentUserId === 'function') ? currentUserId() : 'anon';
        saveInputsCache({ row: rowCalc || null, inputs: values, updated_at: new Date().toISOString() }, uid);
      } catch(_){}

      void waitForFreshData(rowCalc).catch(()=>{});
    })
    .catch(async (err)=>{
      const msg = String((err && err.message) || err || '');

      if ((err && err.code === 408) || /timeout|network/i.test(msg)) {
        const confirmed = await confirmSavedAfterTimeout(prevRowCalc).catch(()=>null);
        if (confirmed != null) {
          setRowCalcForUser(Number(confirmed));
          setLastMeasurementTime(Date.now());
          setUnlockTime(Date.now() + 4000);

          // 🔒 На всякий случай удержим minNewRow ещё немного
          try { lockDesiredRow(Number(confirmed) || minNewRow, 10000); } catch(_){}

          try { window.startMacrosFlow(); } catch(_){}
          try { window.startChartFlow(); } catch(_){}
          void waitForFreshData(confirmed, 10000, 60000).catch(()=>{});
          return;
        }
        setUnlockTime(Date.now() + 2000);
        showPopup('Не подтверждено', 'Сервер не успел ответить. Проверьте «Последний замер».', 'error');
        try { startFrontDataFlow(); } catch(_){}
        return;
      }

      if ((err && err.code === 429) || /too\s*many\s*requests|rate[-_\s]*limit|слишком\s+часто|429/i.test(msg)) {
        setUnlockTime(Date.now() + 4000);
        showPopup('Too many requests','Не нужно так часто нажимать эту кнопку','error');
        return;
      }

      setUnlockTime(Date.now() + 2000);
      showPopup('Не сохранено','Произошла ошибка при сохранении. Попробуйте позже.','error');
    })
    .finally(()=>{
      setSavingState(false);
      SAVE_IN_PROGRESS = false;
    });
}

(function bindSave(){
  var btn = document.getElementById('saveBtn');
  if (!btn) return;
  var newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', handleSaveClick, false);
})();

/* ============================================================
 *  BLOCK E: Front data flow (AI + last inputs)
 * ============================================================ */
(function frontDataFlowInit(){
  const tg = window.Telegram?.WebApp;
  const BACKEND = (typeof BACKEND_URL !== 'undefined' && BACKEND_URL) ? BACKEND_URL : '';

  const elAI = ()=>document.getElementById('ai-comment');
  const elAnalytics = ()=>document.getElementById('analytics');

  function setAIStatus(text){
    const host = elAI(); if (!host) return;
    host.innerHTML = `<div class="field"><div class="help">${text}</div></div>`;
  }
  function setAnalyticsPlaceholder(){
    const host = elAnalytics(); if (!host) return;
    host.innerHTML = `<div class="field"><div class="help">После сохранения появятся графики.</div></div>`;
  }

  // === 0) API: единый бутстрап-пакет
  async function apiFrontBootstrap(requestedRow){
    const payload = {
      action: 'front_bootstrap',
      init_data: String(tg?.initData || ''),
      row: Number(requestedRow || 0) || undefined
    }
    window.apiFrontBootstrap = apiFrontBootstrap;

    const t0 = performance?.now ? performance.now() : Date.now();
    const resp = await fetch(BACKEND, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors'
    });

    const raw = await resp.text();
    let json = null; try { json = raw ? JSON.parse(raw) : null; } catch(_){}

    const t1 = performance?.now ? performance.now() : Date.now();
    window.__frontBootstrapLastMs = +(t1 - t0).toFixed(1);
    try { updatePerfUI && updatePerfUI(); } catch(_){}

    if (!resp.ok || !json || json.ok !== true) {
      const reason = json?.error || `HTTP ${resp.status}`;
      throw new Error(reason);
    }
    return json;
  }
  window.apiFrontBootstrap = apiFrontBootstrap;

  async function apiFrontWait(timeoutSec){
    const payload = {
      action:'front_wait',
      init_data:String(tg?.initData || ''),
      timeout_sec: Math.max(0, Math.min(25, Number(timeoutSec)||25))
    };
    const t0 = performance?.now ? performance.now() : Date.now();
    const resp = await fetch(BACKEND, {
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=UTF-8'},
      body:JSON.stringify(payload),
      cache:'no-store', credentials:'omit', mode:'cors'
    });
    const raw = await resp.text();
    let json = null; try{ json = raw ? JSON.parse(raw) : null; }catch(_){}
    const t1 = performance?.now ? performance.now() : Date.now();
    window.__frontWaitLastMs = +(t1 - t0).toFixed(1);
    try { updatePerfUI && updatePerfUI(); } catch(_){}
    if (!resp.ok || !json) throw new Error(`HTTP ${resp.status}`);
    return json;
  }

  async function apiLastInputs(){
    if (isAdmin() && typeof window.__pageLaunchToRequestSent !== 'number') {
      window.__pageLaunchToRequestSent = performance.now() - window.__pageLoadTime;
      if (typeof window.updatePerfUI === 'function') window.updatePerfUI();
    }
    const payload = { action:'user_last_inputs', init_data: String(tg?.initData || '') };
    const t0 = performance?.now ? performance.now() : Date.now();
    const resp = await fetch(BACKEND, {
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=UTF-8'},
      body:JSON.stringify(payload),
      cache:'no-store', credentials:'omit', mode:'cors'
    });
    const raw = await resp.text();
    let json = null; try{ json = raw ? JSON.parse(raw) : null; }catch(_){}
    const t1 = performance?.now ? performance.now() : Date.now();
    window.__lastInputsFetchMs = +(t1 - t0).toFixed(1);

    if (isAdmin() && typeof window.__pageLaunchToResponseReceived !== 'number') {
      window.__pageLaunchToResponseReceived = performance.now() - window.__pageLoadTime;
      if (typeof window.updatePerfUI === 'function') window.updatePerfUI();
    }

    try { updatePerfUI && updatePerfUI(); } catch(_){}
    if (!resp.ok || !json || json.ok !== true) throw new Error(json?.error || `HTTP ${resp.status}`);
    return json;
  }

  function renderAIComment(html){
    if (isAdmin() && typeof window.__pageLaunchToUpdateComment !== 'number') {
      window.__pageLaunchToUpdateComment = performance.now() - window.__pageLoadTime;
      if (typeof window.updatePerfUI === 'function') window.updatePerfUI();
    }
    const host = elAI(); if (!host) return;
    host.innerHTML = html
      ? `<div class="field">${html}</div>`
      : `<div class="field"><div class="help">Комментарий пока не готов…</div></div>`;
  }

  function applyInputsToWheels(inputs){
    if (!inputs || typeof inputs !== 'object') return;
    ensureAllWheelsOnce();

    for (const [k, vRaw] of Object.entries(inputs)){
      const cfg = CFG[k]; if (!cfg) continue;
      const el  = fieldByKey[k];
      const w   = wheels[k];

      const v = numOrNull(vRaw);

      if (v == null){
        window.__pendingInputs = window.__pendingInputs || {};
        window.__pendingInputs[k] = null;
        if (cfg.optional && el){
          let cb = el.querySelector('#opt_'+k);
          if (!cb){
            const opt = document.createElement('div');
            opt.className = 'optline';
            opt.innerHTML = `<label style="display:flex;align-items:center;gap:8px;opacity:.95">
                <input type="checkbox" id="opt_${k}"> нет данных
              </label>`;
            el.appendChild(opt);
            cb = opt.querySelector('input');
          }
          cb.checked = true;
          if (w && w.setDisabled) w.setDisabled(true, /*programmatic*/true);
        }
        continue;
      }

      if (cfg.optional && el){
        const cb = el.querySelector('#opt_'+k);
        if (cb){ cb.checked = false; }
        if (w && w.setDisabled) w.setDisabled(false, /*programmatic*/true);
      }

      const target = (k === 'age') ? Math.round(v) : v;
      const cur = (w && typeof w.getModelValue === 'function') ? w.getModelValue() : (w ? w.value : null);
      const changed = (cur == null) || Math.abs(Number(cur) - Number(target)) > 0.001;

      if (changed){
        if (w) {
          w.setValue(target);
        } else {
          window.__pendingInputs = window.__pendingInputs || {};
          window.__pendingInputs[k] = target;
        }
      }
    }

    if (isAdmin() && typeof window.__pageLaunchToUpdateWheel === 'number') {
      try { updatePerfUI && updatePerfUI(); } catch(_){}
    } else if (isAdmin()) {
      window.__pageLaunchToUpdateWheel = performance.now() - window.__pageLoadTime;
      try { updatePerfUI && updatePerfUI(); } catch(_){}
    }
  }

  function applyInputsToSurvey(inputs){
    if (!inputs || typeof inputs !== 'object') return;

    if (typeof inputs.gender === 'string'){
      document.querySelectorAll('.binary-btn[data-field="gender"]').forEach(b=>{
        const on = b.dataset.value === inputs.gender;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true':'false');
      });
    }

    const selectSingle = (field, val) => {
      const list = document.querySelector(`.choice-list[data-field="${field}"][data-type="single"]`);
      if (!list) return;
      list.querySelectorAll('.choice-item').forEach(i=>{
        const on = String(i.dataset.value) === String(val);
        i.classList.toggle('selected', on);
        i.setAttribute('aria-checked', on ? 'true':'false');
      });
    };
    const selectMultiple = (field, arr) => {
      const list = document.querySelector(`.choice-list[data-field="${field}"][data-type="multiple"]`);
      if (!list) return;
      const set = new Set(Array.isArray(arr) ? arr : []);
      if (set.has('none')){
        list.querySelectorAll('.choice-item').forEach(i=>{
          const on = i.dataset.value === 'none';
          i.classList.toggle('selected', on);
          i.setAttribute('aria-checked', on ? 'true':'false');
        });
        return;
      }
      list.querySelectorAll('.choice-item').forEach(i=>{
        const on = set.has(i.dataset.value);
        i.classList.toggle('selected', on);
        i.setAttribute('aria-checked', on ? 'true':'false');
      });
    };

    [
      'body_comp','ethnicity','job_type','steps_per_day','workouts_per_week','workout_duration',
      'workout_intensity','neat_level','sleep_hours','weight_history','main_goal','goal_pace',
      'pregnancy_lactation','cycle_regular'
    ].forEach(k=>{ if (inputs[k] != null) selectSingle(k, inputs[k]); });

    if (inputs.chronic_conditions) selectMultiple('chronic_conditions', inputs.chronic_conditions);

    try{
      const sys = document.getElementById('opt_fat');
      const bfn = document.getElementById('bf-none');
      const duo = document.querySelector('.field[data-key="fat"] .duo');
      if (sys && bfn){
        bfn.checked = !!sys.checked;
        if (duo) duo.classList.toggle('disabled', bfn.checked);
      }
    }catch(_){}

    try { updateCycleVisibility(); updateBodyCompVisibility(); } catch(_){}
  }

  let _pollTimer = 0;
  async function pollOnce(){
    try{
      const res = await apiFrontWait(25);
      if (res?.ready){
        renderAIComment(res.html || '');
        try {
          fetch(BACKEND, {
            method:'POST',
            headers:{'Content-Type':'text/plain;charset=UTF-8'},
            body: JSON.stringify({ action:'front_ack', init_data:String(tg?.initData || '') }),
            cache:'no-store', credentials:'omit', mode:'cors'
          }).catch(()=>{});
        } catch(_){}
        return {done:true};
      }
      setAIStatus('Обрабатываем… (ждём комментарий)');
      const wait = Math.max(300, Math.min(2000, Number(res?.retry_after_ms) || 1000));
      return {done:false, wait};
    } catch(_){
      setAIStatus('Не удалось загрузить данные. Попробуйте позже.');
      return {done:false, wait:1500};
    }
  }
  async function pollLoop(){
    clearTimeout(_pollTimer);
    const r = await pollOnce();
    if (r.done) return;
    _pollTimer = setTimeout(()=>pollLoop(), r.wait);
  }
  window.startFrontDataFlow = function(){ pollLoop(); };

  setAIStatus('Ждём данные…');
  setAnalyticsPlaceholder();
  (async function bootstrapThenHydrate(){
    try {
      const seed = (typeof loadInputsCache === 'function') ? loadInputsCache() : null;
      if (seed && seed.inputs) {
        applyInputsToWheels(seed.inputs);
        applyInputsToSurvey(seed.inputs);
      } else {
        ensureAllWheelsOnce();
      }
    } catch(_) { ensureAllWheelsOnce(); }

    // ✅ ВАЖНО: минимальный row — по desiredRow()
    const reqRow =
      (typeof desiredRow === 'function' && desiredRow() != null)
        ? desiredRow()
        : ((typeof getRowCalcForUser === 'function') ? getRowCalcForUser() : null);

    try{
      const b = await apiFrontBootstrap(reqRow);
      if (!b || b.ok !== true) throw new Error('bootstrap_failed');

      if (b.row) { try { setRowCalcForUser(b.row); } catch(_){ } }

      if (b.inputs && b.inputs.found && b.inputs.inputs){
        applyInputsToWheels(b.inputs.inputs);
        applyInputsToSurvey(b.inputs.inputs);
        try {
          const uid = (typeof currentUserId === 'function') ? currentUserId() : 'anon';
          saveInputsCache({ row: b.row || null, inputs: b.inputs.inputs, updated_at: b.updated_at || new Date().toISOString() }, uid);
        } catch(_){}
      } else {
        try{
          const r = await apiLastInputs();
          if (r && r.found && r.inputs){
            applyInputsToWheels(r.inputs);
            applyInputsToSurvey(r.inputs);
            try {
              const uid = (typeof currentUserId === 'function') ? currentUserId() : 'anon';
              saveInputsCache({ row: b?.row || null, inputs: r.inputs, updated_at: new Date().toISOString() }, uid);
            } catch(_){}
          } else {
            ensureAllWheelsOnce();
          }
        } catch { ensureAllWheelsOnce(); }
      }

      if (b.front && b.front.html){
        renderAIComment(b.front.html || '');
      } else {
        setAIStatus('Обрабатываем… (ждём комментарий)');
        window.startFrontDataFlow();
      }

      try{
        const uid = (typeof currentUserId === 'function') ? currentUserId() : 'anon';
        if (b.macros){
          const macrosRow = Number(b.macros.row || b.row || 0);
          // ✅ не кладём старее reqRow
          if (b.macros.ready && b.macros.macros && !(reqRow && macrosRow < Number(reqRow))) {
            const seed = { row: b.macros.row || b.row || null, macros: b.macros.macros, updated_at: b.macros.updated_at };
            localStorage.setItem('macros:vals:' + String(uid), JSON.stringify(seed));
          }
          try { window.startMacrosFlow(); } catch(_){}
        } else { try { window.startMacrosFlow(); } catch(_){} }
      } catch(_){}

      try{
        const uid = (typeof currentUserId === 'function') ? currentUserId() : 'anon';
        if (b.chart){
          const chartRow = Number(b.chart.row || b.row || 0);
          // ✅ не кладём старее reqRow
          if (b.chart.ready && Array.isArray(b.chart.data) && !(reqRow && chartRow < Number(reqRow))) {
            const seed = { row: b.chart.row || b.row || null, data: b.chart.data, updated_at: b.chart.updated_at };
            localStorage.setItem('chart:data:' + String(uid), JSON.stringify(seed));
          }
          try { window.startChartFlow(); } catch(_){}
      } else { try { window.startChartFlow(); } catch(_){ } }
      } catch(_){}

    } catch {
      window.startFrontDataFlow();
      try{
        const r = await apiLastInputs();
        if (r && r.found && r.inputs){
          applyInputsToWheels(r.inputs);
          applyInputsToSurvey(r.inputs);
        } else {
          ensureAllWheelsOnce();
        }
      } catch { ensureAllWheelsOnce(); }
      try { window.startMacrosFlow(); } catch(_){}
      try { window.startChartFlow(); } catch(_){}
    }
  })();
})();

/* ============================================================
 *  BLOCK EAI: Front data flow (AI comment) — АДАПТИРОВАНО ПОД БЭКЕНД
 * ============================================================ */
(function frontDataFlowInit(){
  const tg = window.Telegram?.WebApp;
  const BACKEND = (typeof BACKEND_URL !== 'undefined' && BACKEND_URL) ? BACKEND_URL : '';

  const elAI = ()=>document.getElementById('ai-comment');

  /* ---------- Кэш комментария ---------- */
  const COMMENT_KEY_PREFIX = 'comment:html:';
  function currentUserId(){ 
    try { return window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 'anon'; } 
    catch(_){ return 'anon'; } 
  }
  function commentKey(uid){ return COMMENT_KEY_PREFIX + String(uid ?? currentUserId()); }
  function saveCommentCache(obj, uid){ 
    try { localStorage.setItem(commentKey(uid), JSON.stringify(obj)); } 
    catch(_){} 
  }
  function loadCommentCache(uid){ 
    try { 
      const raw = localStorage.getItem(commentKey(uid)); 
      return raw ? JSON.parse(raw) : null; 
    } catch(_) { return null; } 
  }

  /* ---------- Render helpers ---------- */
  function setAIStatus(text){
    const host = elAI(); if (!host) return;
    host.innerHTML = `<div class="field"><div class="help">${text}</div></div>`;
  }

  // Сигнатура для анти-дублирования
  function sigOf(html, row){
    if (!html) return 'empty';
    return `${row || 0}|${html.length}|${html.slice(0,50)}`;
  }

  let _commentLastSig = '';
  let _commentTimer = 0;
  let _commentRunId = 0;
  let _commentAbort = null;
  let _commentStatus = 'INIT';
  const STATUS_RANK = { INIT:0, NO_ROW:1, WAITING:2, READY:3 };

  function renderAIComment(html, rowCalc, status){
    if (isAdmin() && typeof window.__pageLaunchToUpdateComment !== 'number' && status === 'READY') {
      window.__pageLaunchToUpdateComment = performance.now() - window.__pageLoadTime;
      if (typeof window.updatePerfUI === 'function') window.updatePerfUI();
    }

    const host = elAI(); if (!host) return;
    
    if (status === 'READY' && html){
      host.innerHTML = `<div class="field">${html}</div>`;
      return;
    }
    if (status === 'WAITING'){
      host.innerHTML = `<div class="field"><div class="help">Обрабатываем… (ждём комментарий)</div></div>`;
      return;
    }
    if (status === 'NO_ROW'){
      host.innerHTML = `<div class="field"><div class="help">Сначала заполните анкету и сохраните.</div></div>`;
      return;
    }
    host.innerHTML = `<div class="field"><div class="help">—</div></div>`;
  }

  function renderAICommentSafe(html, rowCalc, nextStatus){
    const cur = STATUS_RANK[_commentStatus] ?? 0;
    const nxt = STATUS_RANK[nextStatus] ?? 0;
    if (nxt < cur) return; // не откатываем статус

    const nextSig = `${nextStatus}|${sigOf(html, rowCalc)}`;
    if (nextSig === _commentLastSig) return; // дедупликация

    renderAIComment(html, rowCalc, nextStatus);
    _commentStatus = nextStatus;
    _commentLastSig = nextSig;
  }

  /* ---------- API: используем front_bootstrap ---------- */
  async function apiFrontBootstrap(requestedRow, signal){
    const payload = {
      action: 'front_bootstrap',
      init_data: String(tg?.initData || ''),
      row: Number(requestedRow || 0) || undefined
    };

    const resp = await fetch(BACKEND, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
      signal
    });

    const raw = await resp.text();
    let json = null; 
    try { json = raw ? JSON.parse(raw) : null; } 
    catch(_){}

    if (!resp.ok || !json) throw new Error(`HTTP ${resp.status}`);
    return json;
  }

  function targetRow(){
    return (typeof desiredRow === 'function' && desiredRow() != null)
      ? desiredRow()
      : (typeof getRowCalcForUser === 'function' ? getRowCalcForUser() : null);
  }

  /* ---------- Polling ---------- */
  async function pollOnce(runId){
    if (runId !== _commentRunId) return { done:true };

    const reqRow = targetRow();

    if (_commentAbort) { 
      try{ _commentAbort.abort(); }
      catch(_){ } 
    }
    const controller = new AbortController();
    _commentAbort = controller;

    try{
      const res = await apiFrontBootstrap(reqRow, controller.signal);
      if (runId !== _commentRunId) return { done:true };

      // ✅ Извлекаем данные из структуры front_bootstrap
      const frontBlock = res?.front || {};
      const serverRow = Number(res?.row || 0);
      const html = frontBlock.html || '';
      const ready = frontBlock.ready || false;
      const status = frontBlock.status || 'WAITING';

      // Не показываем старый ответ
      if (serverRow && reqRow && serverRow < reqRow) {
        renderAICommentSafe('', null, 'WAITING');
        const waitOld = 500;
        return { done:false, wait: waitOld };
      }

      // Обновляем row_calc если сервер знает больше
      if (Number.isFinite(serverRow) && (reqRow == null || serverRow > reqRow)) {
        if (typeof setRowCalcForUser === 'function') {
          setRowCalcForUser(serverRow);
        }
      }

      if (!ready){
        const mappedStatus = mapBackendStatus(status);
        renderAICommentSafe('', null, mappedStatus);
        const wait = 500;
        return { done:false, wait };
      }

      // READY
      renderAICommentSafe(html, serverRow, 'READY');

      // Сохраняем в кэш (если не старее reqRow)
      if (html && !(reqRow && serverRow < reqRow)) {
        saveCommentCache({ 
          row: serverRow, 
          html, 
          updated_at: frontBlock.delivered_at || res.updated_at || new Date().toISOString() 
        });
      }

      // Отправляем ACK серверу
      try {
        fetch(BACKEND, {
          method:'POST',
          headers:{'Content-Type':'text/plain;charset=UTF-8'},
          body: JSON.stringify({ 
            action:'front_ack', 
            init_data:String(tg?.initData || '') 
          }),
          cache:'no-store', 
          credentials:'omit', 
          mode:'cors'
        }).catch(()=>{});
      } catch(_){}

      return { done:true };

    } catch(err){
      if (err?.name === 'AbortError') return { done:true };
      if (runId !== _commentRunId) return { done:true };
      renderAICommentSafe('', null, 'WAITING');
      return { done:false, wait: 1000 };
    }
  }

  // Маппинг статусов бэкенда в фронтовые
  function mapBackendStatus(backendStatus){
    const map = {
      'NO_ROW': 'NO_ROW',
      'WAITING': 'WAITING',
      'WAIT_HTML': 'WAITING',
      'SERVED': 'READY',
      'ALREADY': 'READY',
      'READY': 'READY'
    };
    return map[backendStatus] || 'WAITING';
  }

  async function pollLoop(runId){
    if (runId !== _commentRunId) return;
    clearTimeout(_commentTimer);
    const r = await pollOnce(runId);
    if (r.done || runId !== _commentRunId) return;
    _commentTimer = setTimeout(()=>pollLoop(runId), r.wait);
  }

  /* ---------- Public start ---------- */
  window.startFrontDataFlow = function(){
    _commentRunId += 1;
    const runId = _commentRunId;
    _commentStatus = 'INIT';
    _commentLastSig = ''; // обнуляем сигнатуру

    // Показываем кэш (если не старее desiredRow)
    const target = targetRow();
    const cached = loadCommentCache();
    if (cached?.html && !(target && Number(cached.row || 0) < Number(target))) {
      renderAICommentSafe(cached.html, cached.row, 'READY');
    } else {
      setAIStatus('Ждём данные…');
    }

    clearTimeout(_commentTimer);
    if (_commentAbort){ 
      try{ _commentAbort.abort(); }
      catch(_){ } 
      _commentAbort = null; 
    }

    pollLoop(runId);
  };

  /* ---------- Visibility change ---------- */
  document.addEventListener('visibilitychange', ()=>{
    if (document.visibilityState === 'hidden'){
      clearTimeout(_commentTimer);
      if (_commentAbort){ 
        try{ _commentAbort.abort(); }
        catch(_){ } 
        _commentAbort = null; 
      }
    } else {
      window.startFrontDataFlow();
    }
  });

  /* ---------- Initial start ---------- */
  window.startFrontDataFlow();
})();
  
/* ============================================================
 *  BLOCK E1 — Analytics Macros (poll + cache)
 * ============================================================ */
(function macrosAnalyticsInit(){
  const tg = window.Telegram?.WebApp;
  const BACKEND = (typeof BACKEND_URL !== 'undefined' && BACKEND_URL) ? BACKEND_URL : '';
  const host = () => document.getElementById('analytics');

  const MACROS_KEY_PREFIX = 'macros:vals:';
  function currentUserId(){ try { return window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 'anon'; } catch(_){ return 'anon'; } }
  function macrosKey(uid){ return MACROS_KEY_PREFIX + String(uid); }
  function saveMacrosCache(obj, uid){ try { localStorage.setItem(macrosKey(uid ?? currentUserId()), JSON.stringify(obj)); } catch(_){} }
  function loadMacrosCache(uid){ try { const raw = localStorage.getItem(macrosKey(uid ?? currentUserId())); return raw ? JSON.parse(raw) : null; } catch(_) { return null; } }

  function fmtInt(v){ return (v==null || isNaN(v)) ? '—' : String(Math.round(Number(v))); }
  function renderSkeleton(){
    const el = host(); if (!el) return;
    el.innerHTML = `
      <div class="field">
        <div class="macros-grid" id="macros-cards">
          <div class="macro-card"><div class="m-label">Калории</div><div class="m-value" id="m_kcal">—</div><div class="m-unit">ккал</div></div>
          <div class="macro-card"><div class="m-label">Белки</div><div class="m-value" id="m_protein">—</div><div class="m-unit">г</div></div>
          <div class="macro-card"><div class="m-label">Жиры</div><div class="m-value" id="m_fat">—</div><div class="m-unit">г</div></div>
          <div class="macro-card"><div class="m-label">Углеводы</div><div class="m-value" id="m_carbs">—</div><div class="m-unit">г</div></div>
        </div>
        <div class="macro-hint" id="macros-hint">После сохранения появятся расчёты.</div>
      </div>`;
  }
  function renderValues(macros, opts){
    const o = opts || {};
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = fmtInt(val); };
    set('m_kcal',   macros?.kcal);
    set('m_protein',macros?.protein_g);
    set('m_fat',    macros?.fat_g);
    set('m_carbs',  macros?.carbs_g);

    const hint = document.getElementById('macros-hint');
    if (!hint) return;
    if (o.status === 'READY'){ hint.textContent = 'Ваша норма в день'; }
    else if (o.status === 'PARTIAL'){ hint.textContent = 'Обновляем… часть значений уже готова.'; }
    else if (o.status === 'WAITING'){ hint.textContent = 'Считаем…'; }
    else if (o.status === 'NO_ROW'){ hint.textContent = 'Сначала заполните анкету и сохраните.'; }
    else { hint.textContent = '—'; }
  }

  let _macrosTimer = 0;
  let _macrosRunId = 0;
  let _macrosAbort = null;
  let _macrosStatus = 'INIT';
  const STATUS_RANK = { INIT:0, NO_ROW:1, WAITING:2, PARTIAL:3, READY:4 };

  function renderValuesSafe(macros, nextStatus){
    const cur = STATUS_RANK[_macrosStatus] ?? 0;
    const nxt = STATUS_RANK[nextStatus] ?? 0;
    if (nxt < cur) return;
    renderValues(macros, { status: nextStatus });
    _macrosStatus = nextStatus;
  }

  async function apiFrontMacros(requestedRow, signal){
    const payload = {
      action: 'front_macros',
      init_data: String(tg?.initData || ''),
      row: Number(requestedRow || 0) || undefined
    };
    const resp = await fetch(BACKEND, {
      method:'POST',
      headers:{ 'Content-Type':'text/plain;charset=UTF-8' },
      body: JSON.stringify(payload),
      cache:'no-store', credentials:'omit', mode:'cors',
      signal
    });
    const raw = await resp.text();
    let json = null; try { json = raw ? JSON.parse(raw) : null; } catch(_){}
    if (!resp.ok || !json) throw new Error(`HTTP ${resp.status}`);
    return json;
  }

  async function pollOnce(runId){
    if (runId !== _macrosRunId) return { done:true };

    const reqRow =
      (typeof desiredRow === 'function' && desiredRow() != null)
        ? desiredRow()
        : getRowCalcForUser();

    if (_macrosAbort) { try{ _macrosAbort.abort(); }catch(_){ } }
    const controller = new AbortController();
    _macrosAbort = controller;

    try{
      const res = await apiFrontMacros(reqRow, controller.signal);
      if (res?.row && reqRow && Number(res.row) < Number(reqRow)) {
        const wait = Math.max(200, Math.min(1000, Number(res?.retry_after_ms) || 500));
        return { done:false, wait };
      }
      if (runId !== _macrosRunId) return { done:true };

      const serverRow = Number(res?.row);
      if (Number.isFinite(serverRow) && (reqRow == null || serverRow > reqRow)) {
        setRowCalcForUser(serverRow);
      }

      renderValuesSafe(res?.macros || {}, res?.status || 'WAITING');

      if (res?.ready){
        // не кэшируем, если внезапно старее (на всякий)
        if (!(reqRow && Number(res.row || 0) < Number(reqRow))) {
          saveMacrosCache({ row: res.row, macros: res.macros, updated_at: res.updated_at });
        }
        return { done:true };
      }
      const wait = Math.max(200, Math.min(1000, Number(res?.retry_after_ms) || 500));
      return { done:false, wait };
    } catch(err){
      if (err?.name === 'AbortError') return { done:true };
      if (runId !== _macrosRunId) return { done:true };
      return { done:false, wait: 1000 };
    }
  }

  async function pollLoop(runId){
    if (runId !== _macrosRunId) return;
    clearTimeout(_macrosTimer);
    const r = await pollOnce(runId);
    if (r.done || runId !== _macrosRunId) return;
    _macrosTimer = setTimeout(()=>pollLoop(runId), r.wait);
  }

  window.startMacrosFlow = function forceStart(){
    _macrosRunId += 1;
    const runId = _macrosRunId;
    _macrosStatus = 'INIT';

    renderSkeleton();

    // ✅ Показываем кэш только если он не старее desiredRow()
    const target =
      (typeof desiredRow === 'function' && desiredRow() != null)
        ? desiredRow()
        : getRowCalcForUser();

    const cached = loadMacrosCache();
    if (cached?.macros && !(target && Number(cached.row || 0) < Number(target))) {
      renderValuesSafe(cached.macros, 'READY');
    }

    clearTimeout(_macrosTimer);
    if (_macrosAbort){ try{ _macrosAbort.abort(); }catch(_){ } _macrosAbort = null; }

    pollLoop(runId);
  };

  document.addEventListener('visibilitychange', ()=>{
    if (document.visibilityState === 'hidden'){
      clearTimeout(_macrosTimer);
      if (_macrosAbort){ try{ _macrosAbort.abort(); }catch(_){ } _macrosAbort = null; }
    } else {
      window.startMacrosFlow();
    }
  });

  window.startMacrosFlow();
})();


//============================================================
//  BLOCK E2 — Analytics Chart (KBJU7, SVG + легенда)
//============================================================

(function chartKBJUInit(){
  const tg = window.Telegram?.WebApp;
  const BACKEND = (typeof BACKEND_URL !== 'undefined' && BACKEND_URL) ? BACKEND_URL : '';
  const host = () => document.getElementById('analytics');

  /* ---------- Styles once ---------- 
  function injectKBJUStylesOnce(){
    if (document.getElementById('kbju7-styles')) return;
    const css = `
    .kbju7{ --h:160; --gap:8; --ink:#fff; --c-carb:#34d399; --c-prot:#60a5fa; --c-fat:#f59e0b; position:relative }
    .kbju7-card{
      background:linear-gradient(180deg, var(--cardA), var(--cardB));
      border:1px solid var(--border); border-radius:18px;
      backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
      box-shadow:var(--shadow); color:var(--ink)
    }
    .kbju7-viewport{position:relative;padding:6px 8px 4px}
    .kbju7-scroll{position:relative;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none;touch-action: pan-x}
    .kbju7-scroll::-webkit-scrollbar{display:none}
    .kbju7-info{
      display:flex; align-items:center; justify-content:center;
      gap:8px; flex-wrap:nowrap;
      padding:10px 12px; min-height:42px;
      font-size:clamp(12px, 3.4vw, 14px);
      font-variant-numeric:tabular-nums;
    }
    .kbju7-info .v{display:inline-block; min-width:0; text-align:center}
    .legend-tap{
      display:inline-flex; align-items:center; justify-content:center;
      flex:1 1 0; min-width:0;
      gap:6px; padding:8px 10px;
      white-space:nowrap; line-height:1;
      border:1px solid rgba(255,255,255,.9); background:transparent; color:inherit; font:inherit;
      border-radius:12px; min-height:36px; cursor:pointer;
    }
    .legend-tap:focus-visible{outline:2px solid rgba(255,255,255,.7); outline-offset:2px}
    .legend-tap .dot{width:6px; height:6px; border-radius:50%; flex:0 0 6px; min-width:6px; min-height:6px}
    .legend-tap[data-key="prot"] .dot{background: var(--c-prot)}
    .legend-tap[data-key="fat"]  .dot{background: var(--c-fat)}
    .legend-tap[data-key="carb"] .dot{background: var(--c-carb)}
    .legend-tap.active{background:rgba(255,255,255,.12); border-color:transparent}
    .bar-anim{transform:scaleY(0); transform-origin:bottom; transform-box:fill-box; transition:transform .35s ease;}
    .bar-anim.show{transform:scaleY(1)}
    .sel-outline{fill:none;stroke:#fff;stroke-width:2;rx:18;ry:18}
    .kbju7[data-filter="prot"] .legend-tap:not([data-key="prot"]),
    .kbju7[data-filter="fat"]  .legend-tap:not([data-key="fat"]),
    .kbju7[data-filter="carb"] .legend-tap:not([data-key="carb"]) {opacity:.7}
    .kbju7, .kbju7 * { -webkit-tap-highlight-color: transparent; }
    .kbju7 svg, .kbju7 svg * { -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; user-select: none; -webkit-user-select: none; }
    @media (max-width: 340px){
      .kbju7-info{ gap:6px; }
      .legend-tap{ padding:6px 8px; }
    }`;
    const s = document.createElement('style');
    s.id = 'kbju7-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }*/

/* ---------- Styles once ---------- */
function injectKBJUStylesOnce(){
  if (document.getElementById('kbju7-styles')) return;
  const css = `
  /* === БАЗОВЫЕ ЦВЕТА КБЖУ === */
  .kbju7 { 
    --h:160; 
    --gap:8; 
    --ink:#fff; 
    --c-carb:#34d399; 
    --c-prot:#60a5fa; 
    --c-fat:#f59e0b; 
    position:relative;
    -webkit-font-smoothing: antialiased;
  }

  /* === 1. ФОН И КАРТОЧКА (Стиль как в анкете/macro-card) === */
  .kbju7-card {
    /* Легкий градиент: от 5% до 2% белого (как у .choice-list и .macro-card) */
    background: linear-gradient(165deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%) !important;
    
    /* Тонкая рамка (как var(--surface-border)) */
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
    
    /* 🔥 Блик сверху (как var(--surface-highlight) в .macro-card) */
    border-top: 1px solid rgba(255, 255, 255, 0.25) !important;
    
    /* Радиус и Блюр */
    border-radius: 28px;
    backdrop-filter: blur(12px); 
    -webkit-backdrop-filter: blur(12px);
    
    /* Тень */
    box-shadow: 0 12px 32px rgba(0,0,0,0.3);
    
    color: var(--ink);
    overflow: hidden;
  }

  .kbju7-viewport { position:relative; padding:6px 8px 4px; }
  .kbju7-scroll { 
    position:relative; overflow-x:auto; overflow-y:hidden; 
    -webkit-overflow-scrolling:touch; scrollbar-width:none; touch-action: pan-x; 
  }
  .kbju7-scroll::-webkit-scrollbar { display:none; }

  /* === 2. ЛЕГЕНДА === */
  .kbju7-info {
    display: flex; 
    align-items: center; 
    justify-content: space-between;
    gap: 4px; 
    padding: 12px 4px; 
    min-height: 42px;
    
    /* Тонкая линия-разделитель (под стиль border) */
    border-top: 1px solid rgba(255,255,255,0.1); 
    
    font-variant-numeric: tabular-nums;
  }

  /* === 3. КНОПКИ (В стиле .binary-btn но компактнее) === */
  .legend-tap {
    display: flex; 
    align-items: center; 
    justify-content: center;
    flex: 1; 
    min-width: 0;
    padding: 8px 0;
    
    /* Фон как у неактивных кнопок в анкете */
    background: rgba(255,255,255,0.03); 
    border: 1px solid rgba(255,255,255,0.1); 
    
    border-radius: 12px; 
    min-height: 36px;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
    
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
    font-size: 13px;       
    font-weight: 600;      
    line-height: 1;
    color: rgba(255,255,255,0.9);
    letter-spacing: -0.3px;
    white-space: nowrap;
  }

  .legend-tap:focus-visible { outline:2px solid rgba(255,255,255,.7); outline-offset:2px; }

  /* Активное состояние (чуть светлее) */
  .legend-tap:active, .legend-tap.active { 
    background: rgba(255,255,255,0.08); 
    border-color: rgba(255,255,255,0.2); 
  }

  .legend-tap .dot { 
    width: 6px; height: 6px; 
    border-radius: 50%; 
    flex-shrink: 0; 
    margin-right: 6px;
  }
  .legend-tap[data-key="prot"] .dot { background: var(--c-prot); box-shadow: 0 0 6px var(--c-prot); }
  .legend-tap[data-key="fat"]  .dot { background: var(--c-fat);  box-shadow: 0 0 6px var(--c-fat); }
  .legend-tap[data-key="carb"] .dot { background: var(--c-carb); box-shadow: 0 0 6px var(--c-carb); }

  .legend-tap .v { margin-left: 3px; font-weight: 600; }

  /* Анимации и прочее */
  .bar-anim { transform: scaleY(0); transform-origin: bottom; transform-box: fill-box; transition: transform .35s ease; }
  .bar-anim.show { transform: scaleY(1); }
  .sel-outline { fill:none; stroke:#fff; stroke-width:2; }

  .kbju7[data-filter="prot"] .legend-tap:not([data-key="prot"]),
  .kbju7[data-filter="fat"]  .legend-tap:not([data-key="fat"]),
  .kbju7[data-filter="carb"] .legend-tap:not([data-key="carb"]) { opacity: .7; }
  
  .kbju7, .kbju7 * { -webkit-tap-highlight-color: transparent; }
  .kbju7 svg, .kbju7 svg * { -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; user-select: none; -webkit-user-select: none; }
  `;
  const s = document.createElement('style');
  s.id = 'kbju7-styles';
  s.textContent = css;
  document.head.appendChild(s);
}

  /* ---------- Renderer (idempotent) ---------- */
  (function exposeRenderKBJU7(){
    if (window.renderKBJU7) return;

    window.renderKBJU7 = function renderKBJU7(hostEl, data, opts = {}){
      const root = (typeof hostEl === 'string')
        ? document.getElementById(hostEl)
        : (hostEl && hostEl.nodeType === 1 ? hostEl : document.getElementById('kbju7-host'));
      if (!root) return;

      const scr  = root.querySelector('#kbju7-scroll');
      let svg = root.querySelector('#kbju7-svg');
      if (!svg) {
        const s = document.createElementNS('http://www.w3.org/2000/svg','svg');
        s.setAttribute('id','kbju7-svg');
        (scr || root).appendChild(s); svg = s;
      }
      const infP = root.querySelector('#kbju7-p');
      const infF = root.querySelector('#kbju7-f');
      const infC = root.querySelector('#kbju7-c');

      const list = (data || []).slice().sort((a,b)=> new Date(a.date) - new Date(b.date));
      if (!list.length){
        svg.innerHTML = '<text x="8" y="20" fill="#fff" opacity=".8">Нет данных</text>';
        return;
      }

      const H = 160, DATE_PAD = 18, LIFT = 8, TOP_PAD = 14;
      const visible = Number(opts.visible || 7);
      const shape   = opts.shape || 'clip-capsule';
      const animateOnce = !!opts.animate; // ← только при первом READY

      function computeBarW(){
        const W = (scr && scr.clientWidth) || root.clientWidth || 320;
        const gap = 8;
        const bar = Math.max(12, Math.floor((W - gap*(visible+1)) / visible));
        return { bar, gap };
      }
      const fmtD = d => { try { return new Date(d).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}); } catch { return d; } };

      function draw(doAnim = animateOnce){
        const { bar:BAR, gap:GAP } = computeBarW();
        /*const outerR = parseFloat(getComputedStyle(root).getPropertyValue('--r')) || 18;*/
        const outerR = 6; // Жестко ставим 6, как в Breath
        const contentW = list.length * (BAR + GAP) + GAP;
        const filter = root.getAttribute('data-filter') || 'all';

        let gramsMax;
        if (filter==='prot') gramsMax = Math.max(50, ...list.map(d => (d.protein_g||0)));
        else if (filter==='fat') gramsMax = Math.max(50, ...list.map(d => (d.fat_g||0)));
        else if (filter==='carb') gramsMax = Math.max(50, ...list.map(d => (d.carbs_g||0)));
        else gramsMax = Math.max(50, ...list.map(d => (d.protein_g||0)+(d.fat_g||0)+(d.carbs_g||0)));

        const yG = v => (H - TOP_PAD - DATE_PAD - 4) * (v/gramsMax);

        svg.setAttribute('viewBox', `0 0 ${contentW} ${H}`);
        svg.setAttribute('width', contentW);
        svg.setAttribute('height', H);

        const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
        const gBars = document.createElementNS('http://www.w3.org/2000/svg','g');
        const gSel  = document.createElementNS('http://www.w3.org/2000/svg','g');
        const gHit  = document.createElementNS('http://www.w3.org/2000/svg','g');
        const groups=[]; const dates=[]; const outlines=[];

        const yBase = H-2-DATE_PAD;
        const yDate = H-6;

        list.forEach((d, i)=>{
          const x = GAP + i*(BAR + GAP);
          let gC = (d.carbs_g||0), gP = (d.protein_g||0), gF = (d.fat_g||0);
          if (filter==='prot'){ gC = 0; gF = 0; }
          else if (filter==='fat'){ gC = 0; gP = 0; }
          else if (filter==='carb'){ gP = 0; gF = 0; }

          const hC = yG(gC), hP = yG(gP), hF = yG(gF);
          const sum = hC+hP+hF;
          const topY = yBase - Math.max(sum, 0);

          // capsule clipping per bar
          let clipId = null;
          if (shape === 'clip-capsule'){
            clipId = `clip_${i}`;
            const cp = document.createElementNS('http://www.w3.org/2000/svg','clipPath');
            cp.setAttribute('id', clipId);
            const pill = rect(x, Math.max(TOP_PAD, topY), BAR, Math.max(sum, 0.0001), outerR);
            cp.appendChild(pill); defs.appendChild(cp);
          }

          const group = document.createElementNS('http://www.w3.org/2000/svg','g');
          if (clipId) group.setAttribute('clip-path', `url(#${clipId})`);
          group.style.transition = 'transform .2s ease';

          const rc = rect(x, yBase - hC, BAR, hC, 0);
          const rp = rect(x, yBase - (hC + hP), BAR, hP, 0);
          const rf = rect(x, yBase - (hC + hP + hF), BAR, hF, 0);
          rc.setAttribute('fill', 'rgba(52,211,153,.85)');
          rp.setAttribute('fill', 'rgba(96,165,250,.85)');
          rf.setAttribute('fill', 'rgba(245,158,11,.85)');

          // анимируем только когда нужно
          rc.classList.add('seg','carb'); rp.classList.add('seg','prot'); rf.classList.add('seg','fat');
          if (doAnim){ rc.classList.add('bar-anim'); rp.classList.add('bar-anim'); rf.classList.add('bar-anim'); }

          group.appendChild(rc); group.appendChild(rp); group.appendChild(rf);
          gBars.appendChild(group); groups.push(group);

          if (filter !== 'all'){
            const gSelVal = filter==='prot' ? (d.protein_g||0) : filter==='fat' ? (d.fat_g||0) : (d.carbs_g||0);
            const hSel = filter==='prot' ? hP : filter==='fat' ? hF : hC;
            if (hSel > 22){
              const tx = document.createElementNS('http://www.w3.org/2000/svg','text');
              tx.textContent = String(Math.round(gSelVal));
              tx.setAttribute('x', x + BAR/2);
              tx.setAttribute('y', yBase - (hSel * 0.75));
              tx.setAttribute('text-anchor','middle');
              tx.setAttribute('font-size','14');
              tx.setAttribute('font-weight','900');
              tx.setAttribute('fill','#fff');
              tx.setAttribute('opacity','0.98');
              tx.style.pointerEvents = 'none';
              tx.style.dominantBaseline = 'middle';
              group.appendChild(tx);
            }
          }

          const tDate = document.createElementNS('http://www.w3.org/2000/svg','text');
          tDate.textContent = fmtD(d.date);
          tDate.setAttribute('x', x + BAR/2);
          tDate.setAttribute('y', yDate);
          tDate.setAttribute('text-anchor','middle');
          tDate.setAttribute('font-size','12');
          tDate.setAttribute('font-weight','700');
          tDate.setAttribute('fill','rgba(255,255,255,.9)');
          tDate.style.opacity = '0';
          tDate.style.transition = 'opacity .18s ease';
          tDate.style.pointerEvents = 'none';
          gBars.appendChild(tDate); dates.push(tDate);

         //const selOutline = rect(x-1, topY, BAR+2, Math.max(sum,2), outerR);
          // Делаем обводку чуть выше (-1) и выше (+2), а радиус больше (+2)
          const selOutline = rect(x-1, topY - 1, BAR+2, Math.max(sum,2) + 2, outerR + 2);
          
          selOutline.setAttribute('class','sel-outline'); selOutline.style.opacity = '0';
          selOutline.style.transition = 'transform .2s ease, opacity .12s ease';
          gSel.appendChild(selOutline); outlines.push(selOutline);

          const hit = rect(x, 0, BAR, H, outerR); hit.setAttribute('fill','transparent'); hit.style.cursor='pointer';
          hit.addEventListener('click', ()=> select(i, d)); gHit.appendChild(hit);
        });

        svg.innerHTML = '';
        svg.appendChild(defs); svg.appendChild(gBars); svg.appendChild(gSel); svg.appendChild(gHit);

        // включаем анимацию только если doAnim === true
        if (doAnim){
          requestAnimationFrame(()=>{ svg.querySelectorAll('.bar-anim').forEach(el=> el.classList.add('show')); });
        }

        select(list.length-1, list[list.length-1]);
        if (scr){ scr.scrollLeft = scr.scrollWidth; }

        function select(idx, d){
          if (infP) infP.textContent = Math.round(d.protein_g||0);
          if (infF) infF.textContent = Math.round(d.fat_g||0);
          if (infC) infC.textContent = Math.round(d.carbs_g||0);

          outlines.forEach((o,i)=>{ o.style.opacity = (i===idx ? '1' : '0'); o.style.transform = (i===idx ? `translateY(-${LIFT}px)` : 'translateY(0)'); });
          groups.forEach((g,i)=>{ g.style.transform = (i===idx ? `translateY(-${LIFT}px)` : 'translateY(0)'); });
          dates.forEach((t,i)=>{ t.style.opacity = (i===idx ? '1' : '0'); });

          try{ window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.(); }catch(_){}
        }

        function rect(x,y,w,h,r=0){
          const e = document.createElementNS('http://www.w3.org/2000/svg','rect');
          e.setAttribute('x', x); e.setAttribute('y', Math.max(0,y));
          e.setAttribute('width', w); e.setAttribute('height', Math.max(0,h));
          if (r){ e.setAttribute('rx', r); e.setAttribute('ry', r); }
          return e;
        }
      }

      draw(/* doAnim from opts.animate */);

      // уникальный resize handler, без анимации
      if (root.__kbjuResizeHandler){
        try{ window.removeEventListener('resize', root.__kbjuResizeHandler); }catch(_){}
      }
      let __kbjuRaf = 0;
      root.__kbjuResizeHandler = function(){
        cancelAnimationFrame(__kbjuRaf);
        __kbjuRaf = requestAnimationFrame(()=> draw(false)); // ← без анимации
      };
      window.addEventListener('resize', root.__kbjuResizeHandler, { passive:true });

      // легенда: перерисовка без анимации
      (function bindLegend(){
        if (!root || root.__legendBound) return;
        const info = root.querySelector('#kbju7-info'); if (!info) return;
        info.addEventListener('click', (e)=>{
          const btn = e.target.closest('.legend-tap'); if (!btn) return;
          const key = btn.dataset.key;
          const cur = root.getAttribute('data-filter') || 'all';
          const next = (cur === key) ? 'all' : key;
          root.setAttribute('data-filter', next);
          info.querySelectorAll('.legend-tap').forEach(b=>{
            const on = (next === b.dataset.key);
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
          });
          // IMPORTANT: передаём сам root и отключаем анимацию
          window.renderKBJU7(root, data, { ...opts, animate:false });
        }, { passive: true });
        root.__legendBound = true;
      })();
    };
  })();

  /* ---------- Host scaffold ---------- */
  function ensureKBJUHost(){
    const el = host(); if (!el) return null;
    let box = el.querySelector('#chart-kbju7-box');
    if (box) return box;

    const html = `
      <div class="field" id="chart-kbju7-box" style="margin-top:0; border-top:0; padding-top:4px;">
        <div class="kbju7 kbju7-card" id="kbju7-host" style="--r:18">
          <div class="kbju7-viewport">
            <div class="kbju7-scroll" id="kbju7-scroll">
              <svg id="kbju7-svg" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="График БЖУ"></svg>
            </div>
          </div>
          <div class="kbju7-info" id="kbju7-info" role="tablist" aria-label="Выбор нутриента">
            <button type="button" class="legend-tap" data-key="prot" aria-label="Показать только белки (вкл/выкл)" aria-pressed="false"><span class="dot" aria-hidden="true"></span><span>Б</span> <b class="v" id="kbju7-p">—</b> г</button>
            <button type="button" class="legend-tap" data-key="fat"  aria-label="Показать только жиры (вкл/выкл)"  aria-pressed="false"><span class="dot" aria-hidden="true"></span><span>Ж</span> <b class="v" id="kbju7-f">—</b> г</button>
            <button type="button" class="legend-tap" data-key="carb" aria-label="Показать только углеводы (вкл/выкл)" aria-pressed="false"><span class="dot" aria-hidden="true"></span><span>У</span> <b class="v" id="kbju7-c">—</b> г</button>
          </div>
        </div>
        <div class="help" id="chart-hint" style="text-align:center;margin-top:6px">Загружаем график…</div>
      </div>`;
    el.insertAdjacentHTML('beforeend', html);
    return el.querySelector('#chart-kbju7-box');
  }

  /* ---------- Render helpers ---------- */
  function normalizeChartData(arr){
    if (!Array.isArray(arr)) return [];
    return arr.map(d=>{
      const date = d.date || d.day || d.ds || '';
      const protein_g = d.protein_g ?? d.protein ?? 0;
      const fat_g     = d.fat_g     ?? d.fat     ?? 0;
      const carbs_g   = d.carbs_g   ?? d.carbs   ?? 0;
      return { date, protein_g: Number(protein_g) || 0, fat_g: Number(fat_g) || 0, carbs_g: Number(carbs_g) || 0 };
    }).filter(x=>x.date);
  }

  // сигнатура данных для анти-дублирования рендера
  function sigOf(arr){
    const a = normalizeChartData(arr || []);
    if (!a.length) return '0';
    const last = a[a.length-1];
    const sum = a.reduce((s,x)=> s + x.protein_g + x.fat_g + x.carbs_g, 0);
    return `${a.length}|${last.date}|${Math.round(sum)}`;
  }

  let _chartAnimatedOnce = false;  // анимировать только первый READY
  let _chartLastSig = '';          // статус+данные (для дедупа)
  let _chartTimer = 0;
  let _chartRunId = 0;
  let _chartAbort = null;
  let _chartStatus = 'INIT';
  const STATUS_RANK = { INIT:0, NO_ROW:1, WAITING:2, EMPTY:3, READY:4 };

  function renderChart(data, status){
    injectKBJUStylesOnce();
    const box = ensureKBJUHost(); if (!box) return;
    const hint = box.querySelector('#chart-hint');
    const hostId = 'kbju7-host';

    if (status === 'READY' && data && data.length){
      if (hint){ hint.style.display = 'block'; hint.textContent = 'Динамика вашей нормы БЖУ'; }
      window.renderKBJU7(hostId, normalizeChartData(data), {
        visible:7, shape:'clip-capsule', animate: !_chartAnimatedOnce
      });
      _chartAnimatedOnce = true; // больше не анимируем
      return;
    }
    if (status === 'EMPTY' || status === 'WAITING'){
      if (hint){ hint.style.display = 'block'; hint.textContent = 'Обрабатываем данные…'; }
      return;
    }
    if (status === 'NO_ROW'){
      if (hint){ hint.style.display = 'block'; hint.textContent = 'Сначала заполните анкету и сохраните.'; }
      return;
    }
    if (hint){ hint.style.display = 'block'; hint.textContent = '—'; }
  }

  function renderChartSafe(data, nextStatus){
    const cur = STATUS_RANK[_chartStatus] ?? 0;
    const nxt = STATUS_RANK[nextStatus] ?? 0;
    if (nxt < cur) return; // не откатываем статус

    const nextSig = `${nextStatus}|${sigOf(data)}`;
    if (nextSig === _chartLastSig) return; // ничего не поменялось — не дёргаем график

    renderChart(data, nextStatus);
    _chartStatus = nextStatus;
    _chartLastSig = nextSig;
  }

  /* ---------- API ---------- */
  async function apiFrontChartData(requestedRow, signal){
    const payload = { action:'front_chart_data', init_data:String(tg?.initData || ''), row: Number(requestedRow||0) || undefined };
    const resp = await fetch(BACKEND, {
      method:'POST', headers:{ 'Content-Type':'text/plain;charset=UTF-8' },
      body: JSON.stringify(payload), cache:'no-store', credentials:'omit', mode:'cors', signal
    });
    const raw = await resp.text();
    let json = null; try { json = raw ? JSON.parse(raw) : null; } catch(_){}
    if (!resp.ok || !json) throw new Error(`HTTP ${resp.status}`);
    return json;
  }

  function targetRow(){
    return (typeof desiredRow === 'function' && desiredRow() != null)
      ? desiredRow()
      : (typeof getRowCalcForUser === 'function' ? getRowCalcForUser() : null);
  }

  /* ---------- Polling ---------- */
  async function pollOnce(runId){
    if (runId !== _chartRunId) return { done:true };

    const reqRow = targetRow();

    if (_chartAbort) { try{ _chartAbort.abort(); }catch(_){ } }
    const controller = new AbortController();
    _chartAbort = controller;

    try{
      const res = await apiFrontChartData(reqRow, controller.signal);
      if (runId !== _chartRunId) return { done:true };

      // не показываем ответ, если он старее требуемого row
      if (res?.row && reqRow && Number(res.row) < Number(reqRow)) {
        renderChartSafe([], 'WAITING');
        const waitOld = Math.max(200, Math.min(1000, Number(res?.retry_after_ms) || 500));
        return { done:false, wait: waitOld };
      }

      const serverRow = Number(res?.row);
      if (Number.isFinite(serverRow) && (reqRow == null || serverRow > reqRow)) {
        setRowCalcForUser(serverRow);
      }

      if (!res?.ready){
        const status = res?.status || 'WAITING';
        renderChartSafe([], status); // никакой истории до READY
        const wait = Math.max(200, Math.min(1000, Number(res?.retry_after_ms) || 500));
        return { done:false, wait };
      }

      // READY
      const data = Array.isArray(res?.data) ? res.data : [];
      renderChartSafe(data, 'READY');
      if (!(reqRow && Number(res.row || 0) < Number(reqRow))) {
        try {
          const uid = (typeof currentUserId === 'function') ? currentUserId() : 'anon';
          localStorage.setItem(`chart:data:${String(uid)}`, JSON.stringify({ row: res.row, data, updated_at: res.updated_at }));
        } catch(_){}
      }
      return { done:true };

    } catch(err){
      if (err?.name === 'AbortError') return { done:true };
      if (runId !== _chartRunId) return { done:true };
      return { done:false, wait: 1000 };
    }
  }

  async function pollLoop(runId){
    if (runId !== _chartRunId) return;
    clearTimeout(_chartTimer);
    const r = await pollOnce(runId);
    if (r.done || runId !== _chartRunId) return;
    _chartTimer = setTimeout(()=>pollLoop(runId), r.wait);
  }

  /* ---------- Public start ---------- */
  window.startChartFlow = function(){
    _chartRunId += 1;
    const runId = _chartRunId;
    _chartStatus = 'INIT';
    _chartLastSig = ''; // обнуляем сигнатуру при новом запуске

    injectKBJUStylesOnce();
    ensureKBJUHost();

    // показываем кэш только если он не старее требуемого row
    const target = targetRow();
    try{
      const uid = (typeof currentUserId === 'function') ? currentUserId() : 'anon';
      const raw = localStorage.getItem(`chart:data:${String(uid)}`);
      const cached = raw ? JSON.parse(raw) : null;
      if (cached?.data && !(target && Number(cached.row || 0) < Number(target))) {
        renderChartSafe(cached.data, 'READY');
      }
    } catch(_){}

    clearTimeout(_chartTimer);
    if (_chartAbort){ try{ _chartAbort.abort(); }catch(_){ } _chartAbort = null; }

    pollLoop(runId);
  };

  document.addEventListener('visibilitychange', ()=>{
    if (document.visibilityState === 'hidden'){
      clearTimeout(_chartTimer);
      if (_chartAbort){ try{ _chartAbort.abort(); }catch(_){ } _chartAbort = null; }
    } else {
      window.startChartFlow();
    }
  });

  // можно оставить автозапуск — с анти-дребезгом он не будет «дёргать» график
  window.startChartFlow();
})();




/* ============================================================
 *  BLOCK P (Admin): «Скорость работы»
 * ============================================================ */
(function maybeInjectAdminSection(){
  window.__pageLoadTime = window.__pageLoadTime || performance.now();
  function inject(){
    if (!isAdmin()) return;
    const host = document.getElementById('admin-section-anchor');
    if (!host) return;
    if (document.getElementById('sec-performance')) return;

    const sec = document.createElement('section');
    sec.className = 'section collapsed';
    sec.id = 'sec-performance';
    sec.innerHTML = `
      <div class="section-h" data-toggle="sec-performance" role="button" tabindex="0" aria-controls="sec-performance" aria-expanded="false">
        <h2>Скорость работы</h2>
        <div class="toggle" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M8 10l4 4 4-4" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      </div>
      <div class="section-content" id="perf-section">
        <div class="field">
          <div class="help" id="perfText" style="white-space:pre-line;text-align:left;font-family:monospace;font-size:13px"></div>
        </div>
      </div>
    `;
    const anchor = document.getElementById('admin-section-anchor');
    if (anchor) anchor.replaceWith(sec);

    window.updatePerfUI = function(){
      const wheelsInit = (typeof window.__pageLaunchToWheelsInit === 'number') 
        ? (window.__pageLaunchToWheelsInit / 1000).toFixed(3) 
        : '—';
      const requestSent = (typeof window.__pageLaunchToRequestSent === 'number') 
        ? (window.__pageLaunchToRequestSent / 1000).toFixed(3) 
        : '—';
      const responseReceived = (typeof window.__pageLaunchToResponseReceived === 'number') 
        ? (window.__pageLaunchToResponseReceived / 1000).toFixed(3) 
        : '—';
      const wheel = (typeof window.__pageLaunchToUpdateWheel === 'number') 
        ? (window.__pageLaunchToUpdateWheel / 1000).toFixed(3) 
        : '—';
      const comment = (typeof window.__pageLaunchToUpdateComment === 'number') 
        ? (window.__pageLaunchToUpdateComment / 1000).toFixed(3) 
        : '—';
      
      const block = 
`PageLaunch→WheelsInit: ${wheelsInit} s
PageLaunch→RequestSent: ${requestSent} s
PageLaunch→ResponseReceived: ${responseReceived} s
PageLaunch→UpdateWheel: ${wheel} s
PageLaunch→UpdateComment: ${comment} s`;
      
      const el = document.getElementById('perfText');
      if (el) el.textContent = block;
    };

    try { updatePerfUI(); } catch(_){}
  }
  inject(); setTimeout(inject, 300); setTimeout(inject, 1200);
})();



  
/* ============================================================
 *  BLOCK Z: Аккордеон + видимость секций
 * ============================================================ */

/* === Survey: haptics + events + visibility === */
(function(){
  const TMA = window.Telegram?.WebApp;
  try{ TMA?.ready?.(); }catch(_){}
  const hapticImpact = (type='light')=>{ try{ TMA?.HapticFeedback?.impactOccurred?.(type); }catch(_){} };
  const hapticSelect = ()=>{ try{ TMA?.HapticFeedback?.selectionChanged?.(); }catch(_){} };
  const bump = el => { if(!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); };

  document.addEventListener('pointerdown', (e)=>{
    const el = e.target.closest?.('.binary-btn, .choice-item, #bf-none-wrap, #saveBtn');
    if (!el) return;
    hapticImpact('light'); bump(el);
  }, {passive:true});

  document.addEventListener('click', (e)=>{
    const bbtn = e.target.closest?.('.binary-btn');
    if (bbtn){
      const field = bbtn.dataset.field;
      document.querySelectorAll('.binary-btn[data-field="'+field+'"]').forEach(b=>{ b.classList.remove('active'); b.setAttribute('aria-pressed','false'); });
      bbtn.classList.add('active'); bbtn.setAttribute('aria-pressed','true');
      hapticSelect(); updateCycleVisibility();
      return;
    }

    const item = e.target.closest?.('.choice-item');
    if (item){
      const list = item.closest?.('.choice-list'); if (!list) return;
      if (list.dataset.type === 'single'){
        list.querySelectorAll('.choice-item').forEach(i=>{ i.classList.remove('selected'); i.setAttribute('aria-checked','false'); });
        item.classList.add('selected'); item.setAttribute('aria-checked','true'); hapticSelect();
        if (list.dataset.field === 'pregnancy_lactation') updateCycleVisibility();
      } else if (list.dataset.type === 'multiple'){
        const nowSel = item.classList.toggle('selected'); item.setAttribute('aria-checked', nowSel ? 'true':'false'); hapticSelect();
        if (list.dataset.field === 'chronic_conditions'){
          if (item.dataset.value === 'none' && nowSel){
            list.querySelectorAll('.choice-item').forEach(i=>{ if(i!==item){ i.classList.remove('selected'); i.setAttribute('aria-checked','false'); } });
          } else if (item.dataset.value !== 'none' && nowSel){
            const noneItem = list.querySelector('.choice-item[data-value="none"]'); if (noneItem){ noneItem.classList.remove('selected'); noneItem.setAttribute('aria-checked','false'); }
          }
        }
      }
      return;
    }

    const chk = e.target.closest?.('#bf-none-wrap');
    if (chk){
      const input = chk.querySelector('input');
      input.checked = !input.checked;
      chk.classList.toggle('checked', input.checked);
      try {
        const optFat = document.querySelector('#opt_fat'); if (optFat) optFat.checked = input.checked;
        const fatField = document.querySelector('.field[data-key="fat"]');
        const duo = fatField?.querySelector?.('.duo');
        if (duo) duo.classList.toggle('disabled', input.checked);
        const w = wheels?.fat; if (w?.setDisabled) w.setDisabled(input.checked, /*programmatic*/true);

      } catch(_){}
      updateBodyCompVisibility();
      updateSaveButton(); // ← ДОБАВИТЬ для немедленной реакции
      hapticSelect();
    }
  }, {passive:true});

  window.updateCycleVisibility = function(){
    const isFemale = document.querySelector('.binary-btn.active[data-value="female"]');
    const isMale   = document.querySelector('.binary-btn.active[data-value="male"]');
    const secPreg  = document.getElementById('sec-preg');
    const secCycle = document.getElementById('sec-cycle');
    if (!secPreg || !secCycle) return;
    if (isMale){
      secPreg.style.display='none'; secCycle.style.display='none';
      secPreg.querySelectorAll('.choice-item.selected').forEach(i=>i.classList.remove('selected'));
      secCycle.querySelectorAll('.choice-item.selected').forEach(i=>i.classList.remove('selected'));
      return;
    }
    secPreg.style.display = isFemale ? '' : 'none';
    const preg = document.querySelector('.choice-list[data-field="pregnancy_lactation"] .choice-item.selected')?.dataset.value || null;
    const showCycle = !!isFemale && preg === 'none';
    secCycle.style.display = showCycle ? '' : 'none';
    if (!showCycle){ secCycle.querySelectorAll('.choice-item.selected').forEach(i=>i.classList.remove('selected')); }
  };

  window.updateBodyCompVisibility = function(){
    const sec  = document.getElementById('sec-bodycomp');
    if (!sec) return;
    const bf = document.getElementById('bf-none');
    const sys = document.getElementById('opt_fat');
    const show = (bf && bf.checked) || (sys && sys.checked);
    sec.style.display = show ? '' : 'none';
    if (!show){ sec.querySelectorAll('.choice-item.selected').forEach(i=>i.classList.remove('selected')); }
  };

  requestAnimationFrame(()=>{ updateCycleVisibility(); updateBodyCompVisibility(); });

  function ensureFatOptlineStyled(){
    const fatField = document.querySelector('.field[data-key="fat"]');
    if (!fatField) return;
    const optline = fatField.querySelector('.optline');
    if (!optline) return;
    if (!optline.querySelector('#bf-none-wrap')){
      const wrap = document.createElement('label');
      wrap.className = 'check';
      wrap.id = 'bf-none-wrap';
      wrap.innerHTML = '<input type="checkbox" id="bf-none" hidden />'
        + '<span class="check-square" aria-hidden="true"></span>'
        + '<span class="check-label">нет данных</span>';
      optline.appendChild(wrap);
      const sys = document.getElementById('opt_fat');
      const duo = fatField.querySelector('.duo');
      if (sys){ wrap.querySelector('#bf-none').checked = !!sys.checked; }
      if (duo){ duo.classList.toggle('disabled', wrap.querySelector('#bf-none').checked); }
    }
  }
  requestAnimationFrame(ensureFatOptlineStyled);
})();



// ============================================================
// BLOCK Z — Аккордеон: один-единственный обработчик (idempotent)
// ============================================================
(function(){
  function setAriaExpanded(h){
    const id = h.getAttribute('data-toggle');
    const sec = document.getElementById(id);
    if (!sec) return;
    h.setAttribute('aria-controls', id);
    h.setAttribute('role', 'button');
    if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex','0');
    h.setAttribute('aria-expanded', String(!sec.classList.contains('collapsed')));
  }

  function toggleSectionByHeader(h){
    const id = h.getAttribute('data-toggle');
    const sec = document.getElementById(id);
    if (!sec) return;

    const willBeCollapsed = sec.classList.toggle('collapsed');
    h.setAttribute('aria-expanded', String(!willBeCollapsed));

    // Первое раскрытие анкеты → инициализация колёс
    if (id === 'sec-measures' && !willBeCollapsed){
      try { typeof ensureAllWheelsOnce === 'function' && ensureAllWheelsOnce(); } catch(_){}
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        try {
          for (const cfg of FIELDS){
          const w = wheels?.[cfg.key];
          if (w?.setValue){
          const model = (typeof w.getModelValue === 'function') ? w.getModelValue() : w.value;
          w.setValue(model);
          }
          }
        } catch(_){}
      }));
    }
  }

  // ——— жёстко убираем возможные старые слушатели и ставим ровно один ———
  const root = document;

  if (window.__accordionClickHandler){
    root.removeEventListener('click', window.__accordionClickHandler, true);
    root.removeEventListener('click', window.__accordionClickHandler, false);
  }
  if (window.__accordionKeyHandler){
    root.removeEventListener('keydown', window.__accordionKeyHandler, false);
  }

  window.__accordionClickHandler = function(e){
    const h = e.target.closest?.('.section-h');
    if (!h) return;
    if (e.defaultPrevented) return; // не дёргать, если кто-то уже отменил
    toggleSectionByHeader(h);
  };

  window.__accordionKeyHandler = function(e){
    const h = e.target?.closest?.('.section-h');
    if (!h) return;
    if (e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      toggleSectionByHeader(h);
    }
  };

  root.addEventListener('click', window.__accordionClickHandler, { passive:true });
  root.addEventListener('keydown', window.__accordionKeyHandler, false);

  // Синхронизация aria при загрузке
  document.querySelectorAll('.section-h').forEach(setAriaExpanded);

  // Отрисовать «Последний замер», если есть
  try {
    const lastTime = (typeof getLastMeasurementTime === 'function') && getLastMeasurementTime();
    if (lastTime) updateLastTimeDisplay(lastTime);
  } catch(_){}
})();

(function () {
  const opts = { passive: false, capture: true };
  // Старые iOS/WKWebView: пинч/системные жесты
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, opts);
  // Двойной тап
  document.addEventListener('dblclick', function (e) { e.preventDefault(); }, opts);
  // Быстрые два тапа подряд (некоторые сборки iOS Safari)
  let last = 0;
  document.addEventListener('touchend', function (e) {
    const now = Date.now();
    if (now - last < 300) e.preventDefault();
    last = now;
  }, opts);
})();