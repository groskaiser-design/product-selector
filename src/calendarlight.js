  // === CONFIG ===
  const APP_VERSION = 'v9.5-CLIENT-ANALYTICS';
  const API_URL = 'https://script.google.com/macros/s/AKfycbxXxlp8PCCZ6dBlc4fyKafLKNDPIv8FQJV663YHp3vp5lcbtvH9CmRsrs9hccEC1weJRQ/exec'; 
  const GRID_H = 60;
  
  const KEY_SESSIONS = 'uc_client_sessions';
  const KEY_SETTINGS = 'uc_client_settings';
  const KEY_CLIENTS = 'uc_client_list'; 

  let startOffset = -30, endOffset = 60; 
  let sessions = [];
  let clients = []; 
  let availabilityPattern = {0:[],1:[],2:[],3:[],4:[],5:[],6:[]}; 
  let specialRanges = []; 
  let dateExceptions = {};
  let updateInterval;
  let isScrolling = false;
  let currentAnPeriod = 'week'; // Analytics state
  let coachProfiles = {}; // Хранилище настроек тренеров { coachId: { cancel_window: 24 } }
  let currentSession = null; // Для хранения сессии, открытой в шторке
  let lastUserActionTime = 0; // <--- ВСТАВИТЬ ЭТО (Защита от гонки данных)

   /* ============================================================
 * BLOCK 0: TMA boot (FIXED & SAFE)
 * ============================================================ */
(function initTMA() {
  try {
    const tg = window.Telegram?.WebApp;
    if (!tg) return; // Если это не Телеграм, просто выходим, не ломая сайт

    tg.ready();
    tg.expand();

    // 1. Красим заголовок (обернуто в защиту, чтобы не ломало загрузку)
    try {
      tg.setHeaderColor('#050505'); // Черный цвет
      if (tg.setBackgroundColor) {
        tg.setBackgroundColor('#050505');
      }
    } catch (e) {
      console.log('Error setting color:', e);
    }

    // 2. Настраиваем кнопку "Назад"
    try {
      if (tg.BackButton) {
        tg.BackButton.show();
        // Сначала удаляем старые обработчики, чтобы кнопка не тупила
        tg.BackButton.offClick(); 
        // Добавляем переход
        tg.BackButton.onClick(function() {
          window.location.href = 'router.html';
        });
      }
    } catch (e) {
      console.log('Error setting back button:', e);
    }

    // 3. Отключаем свайпы (если поддерживается)
    try {
      if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    } catch (e) {}

  } catch (globalErr) {
    // Если вообще все упало в TMA, выводим ошибку, но НЕ останавливаем скрипт
    console.error('Critical TMA Error:', globalErr);
  }
})();
  
/**
 * Проверка, является ли текущий пользователь админом
 * @returns {boolean} true, если Telegram user.id совпадает с ID администратора
 */
function isAdmin() {
  try {
    const userId = Number(window.Telegram?.WebApp?.initDataUnsafe?.user?.id);
    return userId === 196047220;
  } catch (_) {
    return false;
  }
}

  // === DATA LAYER ===
  const DataManager = {
    saveLocally() {
      try {
        localStorage.setItem(KEY_SESSIONS, JSON.stringify(sessions));
        localStorage.setItem(KEY_CLIENTS, JSON.stringify(clients));
        localStorage.setItem(KEY_SETTINGS, JSON.stringify({ pattern: availabilityPattern, ranges: specialRanges, exceptions: dateExceptions }));
      } catch(e) {}
    },

    loadLocal() {
      try {
        const s = localStorage.getItem(KEY_SESSIONS); if(s) sessions = JSON.parse(s);
        const c = localStorage.getItem(KEY_CLIENTS); if(c) clients = JSON.parse(c);
        const set = localStorage.getItem(KEY_SETTINGS);
        if(set) {
            const parsed = JSON.parse(set);
            if(parsed.pattern) availabilityPattern = parsed.pattern;
            if(parsed.ranges) specialRanges = parsed.ranges;
            if(parsed.exceptions) dateExceptions = parsed.exceptions;
        }
      } catch(e) {}
    },

async syncLoad() {
      const d = new Date();
      const m1 = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const nextM = new Date(d); nextM.setMonth(d.getMonth() + 1);
      const m2 = `${nextM.getFullYear()}-${String(nextM.getMonth()+1).padStart(2,'0')}`;

      // 1. Запоминаем время НАЧАЛА запроса
      const requestStartTime = Date.now();

      try {
        const tg = window.Telegram?.WebApp;
        const initData = tg?.initData || '';

        const [r1, r2] = await Promise.all([
            fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'client_load', init_data: initData, month_str: m1 }) }).then(r=>r.json()),
            fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'client_load', init_data: initData, month_str: m2 }) }).then(r=>r.json())
        ]);

        // 2. ЗАЩИТА: Если юзер нажал что-то ПОКА шла загрузка — игнорируем старые данные
        if (lastUserActionTime > requestStartTime) {
            console.log("Sync ignored: User action is newer than server response");
            return; 
        }

        if(r1.ok) this.applyData(r1.data, m1);
        if(r2.ok) this.applyData(r2.data, m2);
        
        this.saveLocally();
        // showToast("Синхронизировано"); 
      } catch (e) {
        // showToast("Оффлайн режим");
      }
    },
    
    applyData(data, monthStr) {
      if(!data) return;
      if (data.settings) {
        if(data.settings.pattern) availabilityPattern = data.settings.pattern;
        if(data.settings.ranges) specialRanges = data.settings.ranges;
        if(data.settings.exceptions) dateExceptions = data.settings.exceptions;
      }
      if (data.clients && Array.isArray(data.clients)) clients = data.clients;

      // 3. Coach Profiles (НОВОЕ)
        if (data.coach_profiles) {
            // Мержим новые профили с существующими
            coachProfiles = { ...coachProfiles, ...data.coach_profiles };
        }
      
      if (data.calendar) {
        sessions = sessions.filter(s => !s.dateStr.startsWith(monthStr));
        Object.keys(data.calendar).forEach(dayKey => {
            const evts = data.calendar[dayKey];
            evts.forEach(evt => {
                sessions.push({
                    id: evt.i,
                    clientId: evt.c, 
                    coachId: evt.cid, // IMPORTANT: Trainer ID from backend
                    dateStr: `${monthStr}-${dayKey.padStart(2, '0')}`,
                    start: evt.s,
                    end: evt.e,
                    note: evt.n || '',
                    status: evt.st || 'planned',
                    seriesId: evt.sid
                });
            });
        });
      }
      reRenderBlocks();
    }
  };

  // === INITIALIZATION ===
  function init() {
    DataManager.loadLocal(); 
    
    renderTimeColumn();
    renderDayRange(startOffset, endOffset);
    scrollToToday();
    startClock();
    reRenderBlocks();
    
    document.getElementById('matrixViewport').addEventListener('scroll', ()=>{ 
        isScrolling=true; 
        onScroll(); 
        handleInfiniteScroll(); 
    }, {passive: true});
    
    DataManager.syncLoad();
  }

  // === RENDER ENGINE ===
  function renderTimeColumn() { 
      const col=document.getElementById('timeColumn'); 
      const badge=document.getElementById('timeLineBadge');
      col.innerHTML=''; 
      col.appendChild(badge); 
      for(let i=0; i<24; i++) { 
          const el=document.createElement('div'); el.className='time-label'; 
          if (i > 0) el.innerHTML=`<span>${String(i).padStart(2,'0')}:00</span>`; 
          col.appendChild(el); 
      } 
  }
  
  function renderDayRange(from, to) {
    const track=document.getElementById('daysHeaderTrack'), grid=document.getElementById('gridColumns');
    const weekDays=['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС']; const base=new Date(); base.setHours(0,0,0,0);
    const todayStr = getLocalDateStr(new Date());
    
    for(let i=from; i<=to; i++) {
      const d=new Date(base); d.setDate(d.getDate()+i); const dateStr=getLocalDateStr(d);
      let dayIdx=d.getDay()-1; if(dayIdx===-1) dayIdx=6;
      const isToday = dateStr === todayStr;
      
      const h=document.createElement('div'); h.className=`day-col-header ${isToday ? 'today' : ''}`; h.setAttribute('data-date', dateStr);
      h.innerHTML=`<div class="dch-day">${weekDays[dayIdx]}</div><div class="dch-num">${d.getDate()}</div>`;
      track.appendChild(h);
      
      const c=document.createElement('div'); c.className=`day-column ${isToday ? 'today' : ''}`; c.setAttribute('data-date', dateStr); c.setAttribute('data-day-idx', dayIdx);
      grid.appendChild(c);
    }
  }

  function reRenderBlocks() {
      document.querySelectorAll('.day-column').forEach(col => {
        col.querySelectorAll('.blocked-slot, .day-off-overlay, .blocked-range-part, .event-card').forEach(e => e.remove());
        
        const dateStr = col.getAttribute('data-date');
        const dayIdx = parseInt(col.getAttribute('data-day-idx'));
        const colLeft = Math.round(col.offsetLeft); 

        // Gray Zones
        (availabilityPattern[dayIdx] || []).forEach(h => {
          const b = document.createElement('div'); b.className = 'blocked-slot stripe-bg';
          b.style.top = `${h * GRID_H}px`; b.style.backgroundPosition = `-${colLeft}px -${h * GRID_H}px`; col.appendChild(b);
        });
        
        // Ranges
        if (specialRanges.length > 0) {
            const cS = new Date(dateStr + 'T00:00:00').getTime();
            const cE = new Date(dateStr + 'T23:59:59').getTime();
            specialRanges.forEach(r => {
                const rS = new Date(r.start).getTime(); const rE = new Date(r.end).getTime();
                const oS = Math.max(cS, rS); const oE = Math.min(cE, rE);
                if (oS < oE) {
                    const top = (oS - cS) / 3600000 * GRID_H;
                    const h = (oE - oS) / 3600000 * GRID_H;
                    const p = document.createElement('div');
                    if (h >= 23.5 * GRID_H) {
                        p.className = 'day-off-overlay stripe-bg'; 
                        p.style.backgroundPosition = `-${colLeft}px 0px`;
                    } else { 
                        p.className = 'blocked-range-part stripe-bg'; 
                        p.style.top = `${top}px`; p.style.height = `${h}px`; 
                        p.style.backgroundPosition = `-${colLeft}px -${top}px`;
                    }
                    col.appendChild(p);
                }
            });
        }

        // Sessions
        renderEventsForColumn(col, dateStr);
      });
  }

  function renderEventsForColumn(col, dateStr) {
      const dayEvents = sessions.filter(s => s.dateStr === dateStr);
      const items = dayEvents.map(s => {
          const [h, m] = s.start.split(':').map(Number);
          const [hE, mE] = s.end.split(':').map(Number);
          return { data: s, start: h * 60 + m, end: hE * 60 + mE, colIndex: 0 };
      });

      items.sort((a, b) => (a.start - b.start) || ((b.end - b.start) - (a.end - a.start)));
      const columns = [];
      items.forEach(item => {
          let placed = false;
          for (let i = 0; i < columns.length; i++) {
              const colItems = columns[i];
              if (item.start >= colItems[colItems.length - 1].end) {
                  colItems.push(item); item.colIndex = i; placed = true; break;
              }
          }
          if (!placed) { columns.push([item]); item.colIndex = columns.length - 1; }
      });

      items.forEach(item => {
          let maxCol = 0;
          items.forEach(other => { if (Math.max(item.start, other.start) < Math.min(item.end, other.end) && other.colIndex > maxCol) maxCol = other.colIndex; });
          
          const totalCols = maxCol + 1;
          const widthPercent = 100 / totalCols;
          const leftPercent = item.colIndex * widthPercent;

          const el = document.createElement('div');
          const s = item.data;
          
          // === COLOR LOGIC ===
          // Use Client Base Color + Opacity
          let baseColor = '#0a84ff'; 
          if (clients && clients.length > 0) {
              const cli = clients.find(c => String(c.id) === String(s.clientId));
              if (cli && cli.color) baseColor = cli.color;
          }

          const isCompleted = s.status === 'completed';
          const opacity = isCompleted ? 1.0 : 0.45; 
          
          el.className = 'event-card' + (isCompleted ? ' status-completed' : '');
          el.style.backgroundColor = hexToRgba(baseColor, opacity);
          el.style.borderLeftColor = baseColor; 
          
          const top = item.start / 60 * GRID_H;
          const height = (item.end - item.start) / 60 * GRID_H;
          
          el.style.top = `${top}px`;
          el.style.height = `${Math.max(height, 20)}px`;
          el.style.width = `calc(${widthPercent}% - 4px)`;
          el.style.left = `calc(${leftPercent}% + 2px)`;
          el.style.zIndex = 10 + item.colIndex;

          if (widthPercent < 85) el.classList.add('mini');

          let icons = '';
          if(s.seriesId) icons += `<svg class="card-icon ev-recurring-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>`;
          if(isCompleted) icons += `<svg class="card-icon ev-status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;

          el.innerHTML = `
             <div class="ev-title">Тренировка</div>
             <div class="ev-time">${s.start} - ${s.end}</div>
             ${icons}
          `;
          
          el.onclick = (e) => { e.stopPropagation(); openDetails(s); };
          col.appendChild(el);
      });
  }

  // === ANALYTICS LOGIC ===
  function openAnalytics() {
      const weekBtn = document.querySelector('.period-switch .p-btn'); 
      setAnalyticsPeriod('week', weekBtn); 
      openSheet('analyticsSheet');
  }

  function setAnalyticsPeriod(period, btnEl) {
      currentAnPeriod = period;
      
      document.querySelectorAll('.period-switch .p-btn').forEach(b => b.classList.remove('active'));
      if(btnEl) btnEl.classList.add('active');

      const customRow = document.getElementById('anCustomDates');
      customRow.style.display = (period === 'custom') ? 'flex' : 'none';

      const now = new Date();
      let start = new Date();
      let end = new Date();

      if (period === 'week') {
          start = getStartOfWeek(now);
          end = new Date(start);
          end.setDate(end.getDate() + 6);
      } else if (period === 'month') {
          start = new Date(now.getFullYear(), now.getMonth(), 1);
          end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      } else {
          if (!document.getElementById('anStart').value) {
              document.getElementById('anStart').value = getLocalDateStr(now);
              document.getElementById('anEnd').value = getLocalDateStr(now);
          }
          refreshAnalytics(); 
          return;
      }

      document.getElementById('anStart').value = getLocalDateStr(start);
      document.getElementById('anEnd').value = getLocalDateStr(end);
      
      refreshAnalytics();
  }

  function refreshAnalytics() {
      const sStr = document.getElementById('anStart').value;
      const eStr = document.getElementById('anEnd').value;
      if (!sStr || !eStr) return;

      const rangeSessions = sessions.filter(s => s.dateStr >= sStr && s.dateStr <= eStr && s.status !== 'cancelled');

      const total = rangeSessions.length;
      const completed = rangeSessions.filter(s => s.status === 'completed').length;
      const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

      document.getElementById('anPercent').textContent = `${percent}%`;
      document.getElementById('anTotalStats').textContent = `${completed} из ${total} выполнено`;
      
      const circle = document.getElementById('anDonutCircle');
      const circumference = 2 * Math.PI * 35; 
      const offset = circumference - (percent / 100) * circumference;
      circle.style.strokeDashoffset = offset;
      
      // Group by Coach ID
      const trainerStats = {};
      rangeSessions.forEach(s => {
          const tid = s.coachId || 'Unknown';
          if (!trainerStats[tid]) {
              // Generate a consistent color for trainer ID hash
              const colorHash = '#' + (tid.toString().substr(0,6)); 
              trainerStats[tid] = { total: 0, done: 0, color: colorHash };
          }
          trainerStats[tid].total++;
          if (s.status === 'completed') trainerStats[tid].done++;
      });

      const list = document.getElementById('analyticsList');
      list.innerHTML = '';
      
      const sortedTrainers = Object.entries(trainerStats).sort((a, b) => b[1].total - a[1].total);

      if (sortedTrainers.length === 0) {
          list.innerHTML = `<div class="empty-state">Нет тренировок за этот период</div>`;
          return;
      }

      sortedTrainers.forEach(([tid, stat]) => {
          const cPercent = Math.round((stat.done / stat.total) * 100);
          const el = document.createElement('div');
          el.className = 'client-stat-card';
          el.style.borderLeftColor = stat.color; 
          
          el.innerHTML = `
            <div class="csc-row-top">
               <div class="csc-name">Тренер #${tid.substr(0,5)}</div>
               <div class="csc-nums"><span>${stat.done}</span> / ${stat.total}</div>
            </div>
            <div class="progress-track">
               <div class="progress-fill" style="width: ${cPercent}%"></div>
            </div>
          `;
          list.appendChild(el);
      });
  }

  // === COMMON HELPERS ===
function openDetails(s) {
  currentSession = s; // Запоминаем текущую сессию

  const d = new Date(s.dateStr);
  const datePretty = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  document.getElementById('detDate').textContent = datePretty.charAt(0).toUpperCase() + datePretty.slice(1);
  document.getElementById('detTime').textContent = `${s.start} - ${s.end}`;
  document.getElementById('detNote').textContent = s.note || 'Без заметок';

  const statEl = document.getElementById('detStatus');
  const cancelContainer = document.getElementById('cancelContainer');
  const cancelBtn = cancelContainer.querySelector('.btn-cancel');
  const reschedBtn = cancelContainer.querySelector('.btn-reschedule'); // NEW
  const cancelHint = document.getElementById('cancelHint');

  // 1. Статус и цвет
  if (s.status === 'completed') {
      statEl.textContent = '✅ Завершена'; statEl.style.color = 'var(--acc-green)';
      cancelContainer.style.display = 'none'; // Нельзя отменить завершенную
  } else {
      statEl.textContent = '📅 Запланирована'; statEl.style.color = 'var(--acc-blue)';
      cancelContainer.style.display = 'block'; // Показываем блок отмены

      // 2. Проверка Времени (Validation Logic)
      const sessionStart = new Date(`${s.dateStr}T${s.start}`);
      const now = new Date();
      const diffHours = (sessionStart - now) / (1000 * 60 * 60); // Разница в часах

      // Берем правило тренера. Если нет данных, считаем 24 часа по умолчанию
      const trainerRule = (coachProfiles[s.coachId] && coachProfiles[s.coachId].cancel_window) 
                          ? parseInt(coachProfiles[s.coachId].cancel_window) 
                          : 24; 

      if (trainerRule === 0 || diffHours >= trainerRule) {
          // МОЖНО ОТМЕНИТЬ / ПЕРЕНЕСТИ
          cancelBtn.style.display = 'block';
          reschedBtn.style.display = 'block';
          cancelHint.style.display = 'none';
      } else {
          // НЕЛЬЗЯ ОТМЕНИТЬ
          cancelBtn.style.display = 'none';
          reschedBtn.style.display = 'none';
          cancelHint.style.display = 'block';

          // Красивый текст ошибки
          let ruleText = (trainerRule === 0) ? 'в любое время' : `за ${trainerRule} ч.`;
          cancelHint.textContent = `Изменения возможны только ${ruleText} до начала`;
      }
  }

  document.getElementById('overlay').classList.add('active');
  document.getElementById('detailsSheet').classList.add('open');
}
  

  function closeAllSheets() {
    document.getElementById('overlay').classList.remove('active');
    document.querySelectorAll('.sheet').forEach(s => s.classList.remove('open'));
  }
  function openSheet(id){
      document.getElementById('overlay').classList.add('active');
      document.getElementById(id).classList.add('open');
  }

  function getLocalDateStr(date) { const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0'); return `${y}-${m}-${d}`; }
  function getStartOfWeek(date) { const d=new Date(date); const day=d.getDay(); const diff=d.getDate()-day+(day===0?-6:1); d.setDate(diff); d.setHours(0,0,0,0); return d; }
  
  function scrollToToday() { 
      const today = getLocalDateStr(new Date()); 
      setTimeout(() => {
          const el = document.querySelector(`.day-col-header[data-date="${today}"]`); 
          if(el) { 
              const vp = document.getElementById('matrixViewport'); 
              const offset = el.offsetLeft - (vp.clientWidth/2) + (el.offsetWidth/2);
              vp.scrollTo({ left: offset, behavior: 'auto' }); 
              vp.scrollTop = 9 * GRID_H; 
          }
      }, 50);
  }
  
  function startClock(){updateClock();if(updateInterval)clearInterval(updateInterval);updateInterval=setInterval(updateClock,60000);}
  function updateClock(){
      const n=new Date();
      const l=document.getElementById('globalTimeLine');
      const b=document.getElementById('timeLineBadge');
      const px=(n.getHours()*60+n.getMinutes())/60*GRID_H;
      l.style.top=`${px}px`; l.style.display='block';
      b.style.top=`${px}px`; b.style.display='block';
      b.textContent=`${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
  }
  function onScroll() { const vp=document.getElementById('matrixViewport'), headers=document.querySelectorAll('.day-col-header'); for(let h of headers) if(h.offsetLeft>=vp.scrollLeft) { const d=new Date(h.getAttribute('data-date')); document.getElementById('headerMonth').textContent=`${d.toLocaleString('ru',{month:'long'}).toUpperCase()} ${d.getFullYear()}`; break; } }
  function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'), 2000); }
  function handleInfiniteScroll() { const vp=document.getElementById('matrixViewport'); const sl=vp.scrollLeft, sw=vp.scrollWidth, cw=vp.clientWidth; if(sw-(sl+cw)<300) { const old=endOffset; endOffset+=14; renderDayRange(old+1, endOffset); reRenderBlocks(); } if(sl<300) { const old=startOffset; startOffset-=14; prependDays(startOffset, old-1); vp.scrollLeft+=(14*65); reRenderBlocks(); } }
  function prependDays(from, to) { const track=document.getElementById('daysHeaderTrack'), grid=document.getElementById('gridColumns'); const weekDays=['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС']; const base=new Date(); base.setHours(0,0,0,0); const todayStr = getLocalDateStr(new Date()); const fragH=document.createDocumentFragment(), fragC=document.createDocumentFragment(); for(let i=from; i<=to; i++) { const d=new Date(base); d.setDate(d.getDate()+i); const dateStr=getLocalDateStr(d); let dayIdx=d.getDay()-1; if(dayIdx===-1) dayIdx=6; const isToday = dateStr === todayStr; const h=document.createElement('div'); h.className=`day-col-header ${isToday ? 'today' : ''}`; h.setAttribute('data-date', dateStr); h.innerHTML=`<div class="dch-day">${weekDays[dayIdx]}</div><div class="dch-num">${d.getDate()}</div>`; fragH.appendChild(h); const c=document.createElement('div'); c.className=`day-column ${isToday ? 'today' : ''}`; c.setAttribute('data-date', dateStr); c.setAttribute('data-day-idx', dayIdx); fragC.appendChild(c); } track.insertBefore(fragH, track.firstChild); grid.insertBefore(fragC, grid.querySelector('.day-column')); }

 function hexToRgba(hex, alpha) { 
      let c;
      if(/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)){
          c= hex.substring(1).split('');
          if(c.length== 3){ c= [c[0], c[0], c[1], c[1], c[2], c[2]]; }
          c= '0x'+c.join('');
          return 'rgba('+[(c>>16)&255, (c>>8)&255, c&255].join(',')+','+alpha+')';
      }
      return 'rgba(10, 132, 255, ' + alpha + ')';
  }

// === CUSTOM CONFIRM LOGIC ===
  let confirmResolver = null;

  function showCustomConfirm(title, text, isDestructive = true) {
    // 1. Настраиваем тексты
    document.getElementById('ccTitle').textContent = title;
    document.getElementById('ccText').textContent = text;
    
    // 2. Настраиваем цвет кнопки (Красный для отмены, Синий для переноса)
    const btn = document.getElementById('ccYesBtn');
    if (isDestructive) {
        btn.style.color = '#ff453a'; // Red
        btn.style.fontWeight = '600';
    } else {
        btn.style.color = '#0a84ff'; // Blue
        btn.style.fontWeight = '600';
    }

    // 3. Показываем
    return new Promise((resolve) => {
      confirmResolver = resolve;
      document.getElementById('customConfirm').classList.add('visible');
    });
  }

  function resolveCustomConfirm(result) {
    document.getElementById('customConfirm').classList.remove('visible');
    if (confirmResolver) confirmResolver(result);
  }

  // === UPDATED CANCEL FUNCTION ===
  async function tryCancelCurrentSession() {
      if (!currentSession) return;

      // Вызываем попап с КРАСНОЙ кнопкой (true)
      const isConfirmed = await showCustomConfirm(
          'Отмена записи', 
          'Вы действительно хотите отменить эту тренировку?', 
          true
      );
      
      if (!isConfirmed) return;

      const s = currentSession;
      closeAllSheets(); 

      // Оптимистичное удаление
      sessions = sessions.filter(x => x.id !== s.id);
      reRenderBlocks();
      showToast("Отменено");
      lastUserActionTime = Date.now();

      try {
          const tg = window.Telegram?.WebApp;
          const resp = await fetch(API_URL, {
              method: 'POST',
              body: JSON.stringify({
                  action: 'client_cancel',
                  init_data: tg?.initData || '',
                  coachId: s.coachId,
                  dateStr: s.dateStr,
                  sessionId: s.id
              })
          });
          if (resp.ok) DataManager.saveLocally();
      } catch (e) {
          showToast("Ошибка сети");
      }
  }

  // === RESCHEDULE LOGIC (v9.5) ===
  let availableSlotsCache = {}; 
  let selectedRsDate = null;

  async function startRescheduleFlow() {
    if (!currentSession) return;
    
    document.getElementById('detailsSheet').classList.remove('open'); 
    document.getElementById('rescheduleSheet').classList.add('open');
    
    const track = document.getElementById('rsDatesTrack');
    const grid = document.getElementById('rsSlotsGrid');
    track.innerHTML = '';
    grid.innerHTML = '<div class="rs-loader">Поиск свободных окошек...</div>';
    
    const [hS, mS] = currentSession.start.split(':').map(Number);
    const [hE, mE] = currentSession.end.split(':').map(Number);
    const durationMinutes = (hE * 60 + mE) - (hS * 60 + mS);

    try {
      const tg = window.Telegram?.WebApp;
      const resp = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'get_slots',
          coachId: currentSession.coachId,
          duration: durationMinutes,
          init_data: tg?.initData || '',
          excludeSessionId: currentSession.id
        })
      });
      
      const json = await resp.json();
      if (json.ok && json.data) {
        availableSlotsCache = json.data; 
        renderRescheduleDates();
      } else {
        grid.innerHTML = '<div class="rs-empty">Нет мест</div>';
      }
    } catch (e) {
      grid.innerHTML = '<div class="rs-empty">Ошибка сети</div>';
    }
  }

  function renderRescheduleDates() {
    const track = document.getElementById('rsDatesTrack');
    track.innerHTML = '';
    
    const dates = Object.keys(availableSlotsCache).sort();
    const weekDays = ['ВС','ПН','ВТ','СР','ЧТ','ПТ','СБ']; 
    
    if (dates.length === 0) {
       document.getElementById('rsSlotsGrid').innerHTML = '<div class="rs-empty">Нет свободного времени на ближайшие 14 дней</div>';
       return;
    }

    dates.forEach((dateStr, index) => {
       const d = new Date(dateStr);
       const dayName = weekDays[d.getDay()];
       const dayNum = d.getDate();
       
       const chip = document.createElement('div');
       chip.className = 'rs-date-chip';
       if (index === 0) chip.classList.add('active'); 
       
       chip.innerHTML = `<div class="rs-day-name">${dayName}</div><div class="rs-day-num">${dayNum}</div>`;
       chip.onclick = () => selectRsDate(dateStr, chip);
       
       track.appendChild(chip);
    });

    selectRsDate(dates[0], track.firstChild);
  }

  function selectRsDate(dateStr, chipEl) {
    selectedRsDate = dateStr;
    
    document.querySelectorAll('.rs-date-chip').forEach(c => c.classList.remove('active'));
    if(chipEl) chipEl.classList.add('active');
    
    const grid = document.getElementById('rsSlotsGrid');
    grid.innerHTML = '';
    
    const slots = availableSlotsCache[dateStr] || [];
    if (slots.length === 0) {
      grid.innerHTML = '<div class="rs-empty">Нет мест</div>';
      return;
    }

    slots.forEach(time => {
      const btn = document.createElement('button');
      btn.className = 'rs-time-btn';
      btn.textContent = time;
      btn.onclick = () => confirmReschedule(time);
      grid.appendChild(btn);
    });
  }

  async function confirmReschedule(newTime) {
     // === ИСПОЛЬЗУЕМ КРАСИВЫЙ ПОПАП (СИНЯЯ КНОПКА) ===
     const d = new Date(selectedRsDate);
     const datePretty = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

     const isConfirmed = await showCustomConfirm(
        'Перенос записи', 
        `Перенести тренировку на ${datePretty} в ${newTime}?`, 
        false // false = НЕ деструктивное действие (кнопка будет синей)
     );

     if(!isConfirmed) return;
     
     closeAllSheets();
     showToast("Переносим...");
      lastUserActionTime = Date.now();
     
     // 1. Optimistic Update
     const oldDate = currentSession.dateStr;
     const sId = currentSession.id;
     
     const [hS, mS] = currentSession.start.split(':').map(Number);
     const [hE, mE] = currentSession.end.split(':').map(Number);
     const duration = (hE * 60 + mE) - (hS * 60 + mS);
     
     const [nH, nM] = newTime.split(':').map(Number);
     const newEndMin = nH * 60 + nM + duration;
     const newH = Math.floor(newEndMin / 60);
     const newM = newEndMin % 60;
     const newEndTime = `${String(newH).padStart(2,'0')}:${String(newM).padStart(2,'0')}`;

     const sIdx = sessions.findIndex(s => s.id === sId);
     if (sIdx !== -1) {
         sessions[sIdx].dateStr = selectedRsDate;
         sessions[sIdx].start = newTime;
         sessions[sIdx].end = newEndTime;
         reRenderBlocks(); 
     }

     try {
       const tg = window.Telegram?.WebApp;
       const resp = await fetch(API_URL, {
         method: 'POST',
         body: JSON.stringify({
           action: 'reschedule',
           init_data: tg?.initData || '',
           oldSessionId: sId,
           oldDate: oldDate,
           newDate: selectedRsDate,
           newTime: newTime,
           coachId: currentSession.coachId
         })
       });
       
       const json = await resp.json();
       if (!json.ok) {
         showToast("Ошибка переноса!");
         DataManager.syncLoad(); 
       } else {
         showToast("Успешно перенесено");
         DataManager.saveLocally();
       }
     } catch (e) {
       showToast("Ошибка сети");
     }
  }

  document.addEventListener('DOMContentLoaded', init);