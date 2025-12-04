
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

  
  // ==============================================
  // 1. CONFIG & STATE
  // ==============================================
  const APP_VERSION = 'v9.0-BATCH-CALENDAR';
  const API_URL = 'https://script.google.com/macros/s/AKfycbxXxlp8PCCZ6dBlc4fyKafLKNDPIv8FQJV663YHp3vp5lcbtvH9CmRsrs9hccEC1weJRQ/exec'; 

  const GRID_H = 60;
  
  // Viewport Settings
  let startOffset = -30, endOffset = 60;
  let currentStart = getStartOfWeek(new Date());
  
  // Data Store
  const KEY_CLIENTS = 'uc_clients_v9';
  const KEY_SESSIONS = 'uc_sessions_v9';
  const KEY_SETTINGS = 'uc_settings_v9';

  let clients = [];       // Read-only from DB
  let sessions = [];      // Read/Write (Source of Truth)
  
  // Local Settings (visual only)
  let dateExceptions = {}; 
  let availabilityPattern = {0:[],1:[],2:[],3:[],4:[],5:[],6:[]}; // График работы тренера
  let specialRanges = []; // Ranges like vacation
  
  // Temp state
  let editingId = null; 
  let tempSessionData = null; // For confirming batch edits
  let updateInterval;
  let isScrolling = false;
  let selectedDayForOptions = null;
  // === [TURBO] ЗАЩИТА ОТ ГОНКИ ДАННЫХ ===
  let lastUserActionTime = 0;

  // ==============================================
  // 2. DATA LAYER (Sync Logic)
  // ==============================================
  const DataManager = {
    getUserId() { return window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 'guest'; },

    // --- LOCAL STORAGE ---
    saveLocally() {
      try {
        localStorage.setItem(KEY_CLIENTS, JSON.stringify(clients));
        localStorage.setItem(KEY_SESSIONS, JSON.stringify(sessions));
        localStorage.setItem(KEY_SETTINGS, JSON.stringify({ pattern: availabilityPattern, exceptions: dateExceptions, ranges: specialRanges }));
      } catch(e) { console.error("Local Save Error", e); }
    },

    loadLocal() {
      try {
        const c = localStorage.getItem(KEY_CLIENTS); if(c) clients = JSON.parse(c);
        const s = localStorage.getItem(KEY_SESSIONS); if(s) sessions = JSON.parse(s);
        const set = localStorage.getItem(KEY_SETTINGS);
        if(set) {
            const parsed = JSON.parse(set);
            if(parsed.pattern) availabilityPattern = parsed.pattern;
            if(parsed.exceptions) dateExceptions = parsed.exceptions;
            if(parsed.ranges) specialRanges = parsed.ranges;
        } else {
            // Default working hours: 09:00 - 21:00 (indexes 9 to 20)
            for(let i=0; i<7; i++) availabilityPattern[i] = Array.from({length:12}, (_,k)=>k+9); 
        }
      } catch(e) { console.error("Local Load Error", e); }
    },

    // --- NETWORK ---
    async fetchFromServer(action, payload = {}) {
      const tg = window.Telegram?.WebApp;
      const bodyData = { 
          action: action, 
          init_data: tg?.initData || '', 
          ...payload 
      };
      
      try {
        const resp = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify(bodyData)
        });
        const json = await resp.json();
        if (!json.ok) throw new Error(json.error || 'Server Error');
        return json.data;
      } catch (e) {
        console.error(`[API ${action}] Failed:`, e);
        throw e;
      }
    },

    // --- SYNC OPERATIONS ---
    
// 1. Full Load (Init) - TURBO VERSION
    async syncLoad() {
        const d = new Date();
        const m1 = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        const nextM = new Date(d); nextM.setMonth(d.getMonth() + 1);
        const m2 = `${nextM.getFullYear()}-${String(nextM.getMonth()+1).padStart(2,'0')}`;

        // [TURBO] Запоминаем время старта запроса
        const requestStartTime = Date.now();
        console.log(`[Sync] Loading ${m1}, ${m2}...`);

        try {
            const [data1, data2] = await Promise.all([
                this.fetchFromServer('init_load', { month_str: m1 }),
                this.fetchFromServer('init_load', { month_str: m2 })
            ]);

            // [TURBO] ПРОВЕРКА: Если юзер что-то менял пока мы грузили — игнорируем старое
            if (lastUserActionTime > requestStartTime) {
                console.warn("[Sync] Ignored: User action is newer than server response");
                return false; 
            }

            this.mergeServerData(data1, m1);
            this.mergeServerData(data2, m2);
            this.saveLocally();
            
            // Если все ок — обновляем интерфейс
            reRenderBlocks(); 
            updateAllDayStats();
            return true;
        } catch (e) {
            console.error(e);
            throw e;
        }
    },

   mergeServerData(data, monthStr) {
    if(!data) return;
    
    // 1. Clients
    if(data.clients && Array.isArray(data.clients)) {
        clients = data.clients;
    }

    // 2. Settings (ОБНОВЛЕНО)
    if(data.settings) {
        // График работы
        if(data.settings.pattern) availabilityPattern = data.settings.pattern;
        
        // Исключения (дни)
        if(data.settings.exceptions) dateExceptions = data.settings.exceptions;
        
        // Отпуска (диапазоны)
        if(data.settings.ranges) specialRanges = data.settings.ranges;

        // === НОВОЕ: Ограничение изменений ===
        if(data.settings.cancel_window) {
            // Сохраняем в память
            localStorage.setItem('uc_settings_cancel_window', data.settings.cancel_window);
            
            // Если элемент управления уже отрисован, обновляем его визуально
            const sel = document.getElementById('settingCancelWindow');
            if(sel) sel.value = data.settings.cancel_window;
        }
        // ====================================
    }

    // 3. Calendar (остальная часть функции без изменений)
    if(data.calendar) {
        sessions = sessions.filter(s => !s.dateStr.startsWith(monthStr));
        Object.keys(data.calendar).forEach(dayKey => {
            const dayEvents = data.calendar[dayKey];
            dayEvents.forEach(evt => {
                const clientObj = clients.find(c => String(c.id) === String(evt.c));
                sessions.push({
                    id: evt.i,
                    clientId: evt.c,
                    client: clientObj ? clientObj.name : 'Unknown',
                    dateStr: `${monthStr}-${dayKey.padStart(2, '0')}`,
                    start: evt.s,
                    end: evt.e,
                    status: evt.st || 'planned',
                    note: evt.n || '',
                    seriesId: evt.sid || null
                });
            });
        });
    }
},

    // 2. Batch Save (The main writer)
    async syncBatch(datesTouched) {
        // Prepare payload: Group sessions by date
        const uniqueDates = [...new Set(datesTouched)];
        const changes = uniqueDates.map(dateStr => {
            // Get all sessions for this date from memory
            const daySessions = sessions.filter(s => s.dateStr === dateStr && s.status !== 'deleted');
            
            // Map to minified format for DB
            const dayData = daySessions.map(s => ({
                i: s.id,
                c: s.clientId,
                s: s.start,
                e: s.end,
                st: s.status,
                n: s.note,
                sid: s.seriesId // Persist series link
            }));

            return { date: dateStr, day_data: dayData };
        });

        if(changes.length === 0) return;

        console.log(`[Sync] Pushing batch updates for ${changes.length} days`);
        await this.fetchFromServer('batch_sync', { changes });
    }
  };

  // ==============================================
  // 3. INITIALIZATION
  // ==============================================
  async function init() {
   

    // 1. Immediate Local Render
    DataManager.loadLocal();
    loadCoachSettings(); // <--- ДОБАВИТЬ ЭТУ СТРОКУ
    
    // Setup UI
    renderTimeColumn(); 
    renderDayRange(startOffset, endOffset);
    scrollToToday(); 
    startClock();
    reRenderBlocks();
    
    // Scroll Listener
    document.getElementById('matrixViewport').addEventListener('scroll', ()=>{ 
        isScrolling=true; 
        cancelLongPress(); 
        onScroll(); 
        handleInfiniteScroll(); 
    }, {passive: true});

// 2. Background Sync (TURBO: No Await)
    DataManager.syncLoad()
        .then(() => {
            showToast("Синхронизировано", true);
        })
        .catch(e => {
            showToast("Оффлайн режим", false);
        });
}
  // ==============================================
  // 4. BUSINESS LOGIC (CRUD)
  // ==============================================
  
  // --- GENERATE UNIQUE ID ---
  function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }

  // --- OPEN ADD/EDIT FORM ---
  function toggleSeriesInput() {
    const isChecked = document.getElementById('inpRecurring').checked;
    const container = document.getElementById('seriesCountContainer');
    container.style.display = isChecked ? 'block' : 'none';
    const toggleBlock = document.getElementById('recurringOptionContainer');
    toggleBlock.style.borderRadius = isChecked ? '10px 10px 0 0' : '10px';
  }

  function openAddSession(dateObj) { 
      editingId = null; 
      populateClientSelect(); 
      document.getElementById('sheetTitle').textContent='Новая запись'; 
      document.getElementById('btnDelete').style.display='none'; 
      // Скрываем кнопку статуса для новой записи
      document.getElementById('btnStatusToggle').style.display = 'none';
      
      // Сброс серии
      const recContainer = document.getElementById('recurringOptionContainer');
      const countContainer = document.getElementById('seriesCountContainer');
      recContainer.style.display = 'flex';
      recContainer.style.borderRadius = '10px'; 
      document.getElementById('inpRecurring').checked = false; 
      document.getElementById('inpSeriesCount').value = 4;
      countContainer.style.display = 'none';

      // Установка даты
      document.getElementById('inpDate').value = getLocalDateStr(dateObj); 
      
      // ВАЖНО: Обновляем красивый заголовок даты
      updateDateDisplay(); 
      
      const h = dateObj.getHours(); 
      document.getElementById('inpStart').value = `${String(h).padStart(2,'0')}:00`; 
      document.getElementById('inpEnd').value = `${String(h+1).padStart(2,'0')}:00`; 
      
      openSheet('sessionSheet'); 
  }

  function openEdit(s) { 
      editingId = s.id; 
      populateClientSelect(); 
      document.getElementById('sheetTitle').textContent = 'Редактировать'; 
      document.getElementById('btnDelete').style.display = 'block'; 
    // === ЛОГИКА КНОПКИ ЗАВЕРШИТЬ ===
      const btnStatus = document.getElementById('btnStatusToggle');
      btnStatus.style.display = 'flex'; // Показываем
      
      if (s.status === 'completed') {
          // Режим отмены
          btnStatus.className = 'btn-status-toggle undo-mode';
          btnStatus.innerHTML = 'Вернуть в запланированные';
      } else {
          // Режим завершения
          btnStatus.className = 'btn-status-toggle';
          btnStatus.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Завершить тренировку';
      }

      const isSeries = !!s.seriesId;
      document.getElementById('recurringOptionContainer').style.display = 'none'; 
      document.getElementById('seriesCountContainer').style.display = 'none';
      
      if(isSeries) {
         document.getElementById('patternInfoBox').style.display = 'flex';
         document.getElementById('patternInfoBox').querySelector('.pib-text').textContent = "Это часть серии тренировок";
      } else {
         document.getElementById('patternInfoBox').style.display = 'none';
      }

      document.getElementById('inpClient').value = s.client; 
      document.getElementById('inpDate').value = s.dateStr; 
      document.getElementById('inpStart').value = s.start; 
      document.getElementById('inpEnd').value = s.end; 
      document.getElementById('inpNote').value = s.note||''; 
      
      // ВАЖНО: Обновляем красивый заголовок даты
      updateDateDisplay(); 
      
      openSheet('sessionSheet'); 
  }

  // --- SAVE LOGIC ---
 // --- SAVE LOGIC ---
async function trySaveSession() {
      // 1. Считываем данные
      const clientName = document.getElementById('inpClient').value;
      const dateStr = document.getElementById('inpDate').value;
      const start = document.getElementById('inpStart').value;
      const end = document.getElementById('inpEnd').value;
      const note = document.getElementById('inpNote').value;
      const createSeries = document.getElementById('inpRecurring').checked; 
      
      let seriesCount = 4; 
      if (createSeries) {
          const val = parseInt(document.getElementById('inpSeriesCount').value);
          if (!val || val < 2) { showToast("Минимум 2 тренировки", false); return; }
          if (val > 100) { showToast("Максимум 100 за раз", false); return; }
          seriesCount = val;
      }

      const clientObj = clients.find(c => c.name === clientName);
      if (!clientObj) { showToast("Ошибка: Выберите клиента из списка", false); return; }

      const val = validateAppointment(dateStr, start, end, editingId, clientObj.id); 
      if(!val.valid) { showToast(val.msg, false); return; }
      if(val.warning) { showToast(val.warning, false); }

      const baseData = {
          client: clientName,
          clientId: clientObj.id,
          start, end, note,
          status: 'planned'
      };

      // Сценарий A: Серия (Action Sheet) — уведомления тут не трогаем пока
      const currentSession = editingId ? sessions.find(s => s.id === editingId) : null;
      if (currentSession && currentSession.seriesId) {
          tempSessionData = { ...baseData, dateStr, id: editingId, seriesId: currentSession.seriesId };
          openActionSheet('save'); 
          return;
      }

      // [NEW LOGIC] Умное определение уведомлений
      let notifType = null;

      if (!editingId) {
          // 1. Это абсолютно новая запись
          notifType = 'create';
      } 
      else if (currentSession) {
          // Это редактирование. Проверяем, что изменилось.
          
          // А. СМЕНИЛСЯ КЛИЕНТ (Самый важный кейс)
          // Приводим к строке для точного сравнения
          if (String(currentSession.clientId) !== String(clientObj.id)) {
              console.log('[Notify] Client SWAP detected');
              
              // 1. Старому клиенту шлем ОТМЕНУ (используем старые данные currentSession)
              NotificationManager.send('cancel', currentSession);
              
              // 2. Для нового клиента это будет СОЗДАНИЕ (notifType пойдет в конец функции)
              notifType = 'create'; 
          }
          // Б. КЛИЕНТ ТОТ ЖЕ, НО ИЗМЕНИЛОСЬ ВРЕМЯ (НАЧАЛО ИЛИ КОНЕЦ)
          // Добавили проверку currentSession.end !== end
          else if (currentSession.start !== start || currentSession.end !== end || currentSession.dateStr !== dateStr) {
              notifType = 'update';
          }
      }

      // Сценарий B: Новая серия
      if (!editingId && createSeries) {
          createBatchSeries(baseData, dateStr, seriesCount);
          // Уведомляем только о первой тренировке серии
          NotificationManager.send('create', { ...baseData, dateStr });
          return;
      }

      // [TURBO] Фиксируем время действия
      lastUserActionTime = Date.now();
      // Сценарий C: Одиночная запись
      const newSession = { ...baseData, dateStr, id: editingId || generateId(), seriesId: null };
      saveSingleSession(newSession);
      
      // [NEW] Отправляем уведомление (новому или текущему клиенту)
      if (notifType) {
          NotificationManager.send(notifType, newSession);
      }
  }

function toggleSessionStatus() {
  // [TURBO]
      lastUserActionTime = Date.now();

      const s = sessions.find(x => x.id === editingId);
      if(!s) return;

      const newStatus = (s.status === 'completed') ? 'planned' : 'completed';
      s.status = newStatus;
      
      // Сохраняем
      saveSingleSession(s); // Используем existing helper
      
      // [NEW] Уведомление о завершении
      if (newStatus === 'completed') {
          NotificationManager.send('complete', s);
      }
      showToast(newStatus === 'completed' ? "Тренировка завершена" : "Статус сброшен", true);
  }
  
  // --- VALIDATION (UPDATED FOR GROUP TRAINING) ---
  function validateAppointment(dateStr, start, end, excludeSessionId, checkClientId) { 
      const [h1, m1] = start.split(':').map(Number); 
      const [h2, m2] = end.split(':').map(Number); 
      const startMins = h1 * 60 + m1; 
      const endMins = h2 * 60 + m2; 

      // Безопасное приведение ID к строке для сравнения
      const targetIdStr = String(checkClientId);
      let hasConflict = false;
      let conflictName = '';

      for (let s of sessions) { 
          if (s.dateStr !== dateStr) continue; 
          if (s.status === 'cancelled') continue;
          
          // Пропускаем саму себя при редактировании
          if (excludeSessionId && String(s.id) === String(excludeSessionId)) continue; 

          const [sH1, sM1] = s.start.split(':').map(Number); 
          const [sH2, sM2] = s.end.split(':').map(Number); 
          const sStart = sH1 * 60 + sM1; 
          const sEnd = sH2 * 60 + sM2; 

          // Проверка пересечения времени
          if (Math.max(startMins, sStart) < Math.min(endMins, sEnd)) {
              
              // Если это ТОТ ЖЕ клиент - запрещаем
              if (s.clientId && String(s.clientId) === targetIdStr) {
                   return { 
                      valid: false, 
                      msg: `Этот клиент (${s.client}) уже записан на это время!` 
                   }; 
              }

              // Если клиент ДРУГОЙ - это групповая. Запоминаем для предупреждения.
              hasConflict = true;
              conflictName = s.client;
          }
      } 
      
      // Разрешаем сохранение, но с предупреждением
      if (hasConflict) {
          return { valid: true, warning: `Групповая: также записан ${conflictName}` };
      }

      return { valid: true }; 
  }

  function saveSingleSession(data) {
      if(editingId) {
          const idx = sessions.findIndex(s => s.id === editingId);
          if(idx !== -1) sessions[idx] = data;
      } else {
          sessions.push(data);
      }
      afterSaveAction([data.dateStr]);
  }

// Helper: Create Batch (N weeks forward) with VALIDATION
  function createBatchSeries(baseData, startDateStr, count) { 
      const seriesId = generateId(); 
      const datesToSync = [];
      const newSessions = [];
      
      let skippedCount = 0; // Счетчик пропущенных дублей

      let currentDate = new Date(startDateStr);
      
      for(let i=0; i < count; i++) {
          const dStr = getLocalDateStr(currentDate);
          
          // === ВНЕДРЯЕМ ПРОВЕРКУ ===
          // Проверяем, свободен ли слот для ЭТОГО клиента
          // baseData.start/end - время, baseData.clientId - ID клиента
          const val = validateAppointment(dStr, baseData.start, baseData.end, null, baseData.clientId);
          
          // Если валидация вернула false (значит, ЭТОТ клиент уже записан тут)
          if (!val.valid) {
              console.log(`[Series] Skipped ${dStr}: Client already booked`);
              skippedCount++;
          } else {
              // Если всё ок (или это групповая тренировка), создаем запись
              const sess = {
                  ...baseData,
                  id: generateId(),
                  dateStr: dStr,
                  seriesId: seriesId
              };
              
              newSessions.push(sess);
              datesToSync.push(dStr);
          }
          
          // Next week
          currentDate.setDate(currentDate.getDate() + 7);
      }

      if (newSessions.length === 0) {
          showToast("Все даты заняты этим клиентом!", false);
          return;
      }

      // Push to memory
      sessions.push(...newSessions);
      // [TURBO]
      lastUserActionTime = Date.now();
    
      // Формируем красивое сообщение
      let msg = `Создана серия: ${newSessions.length}`;
      if (skippedCount > 0) {
          msg += ` (пропущено: ${skippedCount})`;
      }
      
      showToast(msg, true);
      
      afterSaveAction(datesToSync);
  }

  function updateSeriesBatch(mode, originalSessionData) {
      const datesToSync = [];
      const targetSeriesId = originalSessionData.seriesId;

      if(mode === 'single') {
          const newData = { ...originalSessionData, seriesId: null }; 
          const idx = sessions.findIndex(s => s.id === originalSessionData.id);
          if(idx!==-1) sessions[idx] = newData;
          datesToSync.push(newData.dateStr);
      } 
      else if(mode === 'series') {
          const cutOffDate = originalSessionData.dateStr;
          sessions.forEach((s, i) => {
              if(s.seriesId === targetSeriesId && s.dateStr >= cutOffDate) {
                  sessions[i] = {
                      ...sessions[i],
                      start: originalSessionData.start,
                      end: originalSessionData.end,
                      note: originalSessionData.note,
                      client: originalSessionData.client,
                      clientId: originalSessionData.clientId
                  };
                  datesToSync.push(s.dateStr);
              }
          });
      }
      afterSaveAction(datesToSync);
  }

  function tryDeleteSession() {
      const s = sessions.find(x => x.id === editingId);
      if(!s) return;
      if(s.seriesId) {
          openActionSheet('delete'); 
      } else {
          commitDelete('single', s);
      }
  }

  function commitDelete(mode, sessionObj) {
    // [TURBO]
      lastUserActionTime = Date.now();  
    // [NEW] Уведомление об отмене
      NotificationManager.send('cancel', sessionObj);

      const datesToSync = [];
      if(mode === 'single') {
          sessions = sessions.filter(x => x.id !== sessionObj.id);
          datesToSync.push(sessionObj.dateStr);
      } 
      else if (mode === 'series') {
           const cutOffDate = sessionObj.dateStr;
           const targetSeriesId = sessionObj.seriesId;
           sessions.forEach(s => {
               if(s.seriesId === targetSeriesId && s.dateStr >= cutOffDate) {
                   datesToSync.push(s.dateStr);
               }
           });
           sessions = sessions.filter(s => !(s.seriesId === targetSeriesId && s.dateStr >= cutOffDate));
      }
      afterSaveAction(datesToSync);
  }

  function afterSaveAction(datesToSync) {
      DataManager.saveLocally();
      reRenderBlocks();
      updateAllDayStats();
      closeAllSheets();
      
      DataManager.syncBatch(datesToSync)
        .then(() => console.log("Batch Sync OK"))
        .catch(e => showToast("Ошибка сохранения в облако", false));
  }

/* ============================================================
 * MODULE: TELEGRAM NOTIFICATIONS (DEBUG EDITION)
 * ============================================================ */
const NotificationManager = {
  formatDate(dateStr) {
    const d = new Date(dateStr);
    const dayOpts = { weekday: 'long', day: 'numeric', month: 'long' };
    let str = d.toLocaleDateString('ru-RU', dayOpts);
    return str.charAt(0).toUpperCase() + str.slice(1);
  },

  getText(type, session) {
    const datePretty = this.formatDate(session.dateStr);
    
    switch (type) {
      case 'create':
        return `<b>🆕 Новая тренировка</b>\n\n` +
               `<b>📅 Дата:</b> ${datePretty}\n` +
               `<b>⏰ Время:</b> ${session.start} — ${session.end}\n\n` +
               `Жду вас в зале! 💪`;

      case 'update':
         return `<b>🔄 Изменение времени</b>\n\n` +
                `Ваша тренировка перенесена:\n\n` +
                `<b>✅ ${session.start} — ${session.end}</b>\n\n` +
                `<b>📅 Дата:</b> ${datePretty}`;

      case 'cancel':
         return `<b>🚫 Тренировка отменена</b>\n\n` +
                `Запись на <b>${datePretty} (${session.start})</b> была удалена из расписания.`;

      case 'complete':
         return `<b>✅ Тренировка завершена</b>\n\n` +
                `Отличная работа сегодня! Прогресс зафиксирован. 🔥\n\n` +
                `<i>До встречи на следующей тренировке.</i>`;
      
      default: return '';
    }
  },

  async send(type, sessionData) {
    // 1. ЛОГ: Проверяем, что пришло на вход
    console.log('[Notify] Attempting to send:', type, sessionData);

    if (!sessionData) {
        console.error('[Notify] Error: sessionData is null');
        return;
    }

    // 2. Достаем ID
    const clientId = String(sessionData.clientId);
    console.log('[Notify] Detected Client ID:', clientId);
    
    // 3. Явная проверка ID
    if (!sessionData.clientId || clientId === 'undefined' || clientId === 'null') {
      console.error('[Notify] STOP: Client ID is missing in session data!');
      // Попробуем найти клиента по имени, если ID потерялся (резервный механизм)
      if (sessionData.client) {
          const found = clients.find(c => c.name === sessionData.client);
          if (found) {
              console.log('[Notify] RECOVERY: Found ID by name:', found.id);
              return this.send(type, { ...sessionData, clientId: found.id });
          }
      }
      return;
    }

    // 4. Проверка на длину (тестовые ID)
    if (clientId.length < 5) {
      console.warn('[Notify] Skipped: ID is too short (Test ID)', clientId);
      return;
    }

    const text = this.getText(type, sessionData);
    if (!text) {
        console.error('[Notify] Error: Text generation failed');
        return;
    }

    // 5. Отправка
    console.log(`[Notify] Sending to GAS for ${clientId}...`);
    
    DataManager.fetchFromServer('send_notification', {
      chatId: clientId,
      text: text
    })
    .then(res => console.log('[Notify] Server Response:', res))
    .catch(e => console.error('[Notify] Network Failed', e));
  }
};
  // ==============================================
  // 5. VIEW / UI HELPERS
  // ==============================================  
  function getLocalDateStr(date) { const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0'); return `${y}-${m}-${d}`; }
  function getDateStr(offset) { const d=new Date(); d.setDate(d.getDate()+offset); return getLocalDateStr(d); }
  function getStartOfWeek(date) { const d=new Date(date); const day=d.getDay(); const diff=d.getDate()-day+(day===0?-6:1); d.setDate(diff); d.setHours(0,0,0,0); return d; }
  function hexToRgba(hex, alpha) { 
      if(!hex) return 'rgba(100,100,100,0.5)';
      let r=0,g=0,b=0;
      if(hex.length===4){r="0x"+hex[1]+hex[1];g="0x"+hex[2]+hex[2];b="0x"+hex[3]+hex[3];}
      else if(hex.length===7){r="0x"+hex[1]+hex[2];g="0x"+hex[3]+hex[4];b="0x"+hex[5]+hex[6];}
      return `rgba(${+r}, ${+g}, ${+b}, ${alpha})`; 
  }

  // --- UI RENDERING ---
  function renderTimeColumn() { const col=document.getElementById('timeColumn'), badge=document.getElementById('timeLineBadge'); col.innerHTML=''; col.appendChild(badge); for(let i=0; i<24; i++) { const el=document.createElement('div'); el.className='time-label'; if (i > 0) el.innerHTML=`<span>${String(i).padStart(2,'0')}:00</span>`; col.appendChild(el); } }
  
  function renderDayRange(from, to) {
    const track=document.getElementById('daysHeaderTrack'), grid=document.getElementById('gridColumns');
    const weekDays=['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС']; const base=new Date(); base.setHours(0,0,0,0);
    const todayStr = getLocalDateStr(new Date());
    for(let i=from; i<=to; i++) {
      const d=new Date(base); d.setDate(d.getDate()+i); const dateStr=getLocalDateStr(d);
      let dayIdx=d.getDay()-1; if(dayIdx===-1) dayIdx=6;
      const isToday = dateStr === todayStr;
      
      const h=document.createElement('div'); h.className=`day-col-header ${isToday ? 'today' : ''}`; h.id=`header-${dateStr}`; h.setAttribute('data-date', dateStr);
      h.innerHTML=`<div class="dch-day">${weekDays[dayIdx]}</div><div class="dch-num">${d.getDate()}</div><div class="dch-stats" id="stat-${dateStr}"><div class="dch-stats-fill"></div></div>`;
      h.onclick=()=>openDayOptions(dateStr, `${weekDays[dayIdx]} ${d.getDate()}`); 
      track.appendChild(h);
      
      const c=document.createElement('div'); c.className=`day-column ${isToday ? 'today' : ''}`; c.setAttribute('data-date', dateStr); c.setAttribute('data-day-idx', dayIdx);
      renderEventsForColumn(c, dateStr, dayIdx); 
      attachLongPressHandler(c, d); 
      grid.appendChild(c); 
      updateDayStats(dateStr);
    }
  }

  function reRenderBlocks() {
      document.querySelectorAll('#gridColumns .day-column').forEach(col => {
        col.querySelectorAll('.blocked-slot, .day-off-overlay, .blocked-range-part, .event-card').forEach(e => e.remove());
        
        const dateStr = col.getAttribute('data-date');
        const dayIdx = parseInt(col.getAttribute('data-day-idx'));
        const colLeft = Math.round(col.offsetLeft); 

        // 1. Draw Pattern (Working Hours)
        (availabilityPattern[dayIdx] || []).forEach(h => {
          const b = document.createElement('div');
          b.className = 'blocked-slot stripe-bg';
          const top = h * GRID_H;
          b.style.top = `${top}px`;
          b.style.backgroundPosition = `-${colLeft}px -${top}px`;
          col.appendChild(b);
        });
        
        // 2. Draw Ranges (Vacation)
        if (specialRanges && specialRanges.length > 0) {
            const cS = new Date(dateStr + 'T00:00:00').getTime();
            const cE = new Date(dateStr + 'T23:59:59').getTime();
            
            specialRanges.forEach(r => {
                const rS = new Date(r.start).getTime();
                const rE = new Date(r.end).getTime();
                const oS = Math.max(cS, rS);
                const oE = Math.min(cE, rE);
                
                if (oS < oE) {
                    // Full day overlay
                    if (oS <= cS && oE >= cE - 60000) {
                        if (!col.querySelector('.day-off-overlay')) {
                            const o = document.createElement('div');
                            o.className = 'day-off-overlay stripe-bg';
                            o.style.backgroundPosition = `-${colLeft}px 0px`; 
                            col.appendChild(o);
                        }
                    } else {
                        // Partial overlay
                        const top = (oS - cS) / 3600000 * GRID_H;
                        const h = (oE - oS) / 3600000 * GRID_H;
                        const p = document.createElement('div');
                        p.className = 'blocked-range-part stripe-bg';
                        p.style.top = `${top}px`;
                        p.style.height = `${h}px`;
                        p.style.backgroundPosition = `-${colLeft}px -${top}px`;
                        col.appendChild(p);
                    }
                }
            });
        }

        // 3. Draw Day Off Exception
        if (dateExceptions[dateStr] === 'off') {
          if (!col.querySelector('.day-off-overlay')) {
              const o = document.createElement('div');
              o.className = 'day-off-overlay stripe-bg';
              o.style.backgroundPosition = `-${colLeft}px 0px`;
              col.appendChild(o);
          }
        }

        // 4. Draw Events
        renderEventsForColumn(col, dateStr, dayIdx);
        updateDayStats(dateStr);
      });
  }
  
  function updateAllDayStats() { document.querySelectorAll('.day-col-header').forEach(h => { updateDayStats(h.getAttribute('data-date')); }); }
// === ФИНАЛЬНАЯ АНАЛИТИКА (ЕМКОСТЬ = 24 - БЛОКИ) ===
  function updateDayStats(dateStr) {
    const track = document.getElementById(`stat-${dateStr}`); 
    if (!track) return;
    
    const d = new Date(dateStr);
    let dayIdx = d.getDay() - 1; if (dayIdx === -1) dayIdx = 6;
    
    // 1. Если день полностью выключен через исключения - скрываем
    if (dateExceptions[dateStr] === 'off') { 
        track.style.display = 'none'; 
        return; 
    }

    // 2. СЧИТАЕМ РАБОЧУЮ ЕМКОСТЬ
    // availabilityPattern хранит ЗАБЛОКИРОВАННЫЕ часы (полоски)
    const blockedHours = availabilityPattern[dayIdx] || [];
    const availableHoursCount = 24 - blockedHours.length; // 24 минус зачеркнутые
    const capacityMins = availableHoursCount * 60;

    // 3. СЧИТАЕМ ФАКТИЧЕСКУЮ ЗАНЯТОСТЬ
    const daySessions = sessions.filter(s => s.dateStr === dateStr && s.status !== 'cancelled');
    
    if (daySessions.length === 0) {
        track.style.display = 'none';
        return;
    }

    // Склеиваем пересечения (группы считаем за 1 слот времени)
    let intervals = daySessions.map(s => {
        const [h1, m1] = s.start.split(':').map(Number);
        const [h2, m2] = s.end.split(':').map(Number);
        return [h1 * 60 + m1, h2 * 60 + m2];
    });

    intervals.sort((a, b) => a[0] - b[0]);
    
    let merged = [];
    if (intervals.length > 0) {
        let curr = intervals[0];
        for (let i = 1; i < intervals.length; i++) {
            if (intervals[i][0] < curr[1]) {
                curr[1] = Math.max(curr[1], intervals[i][1]); 
            } else {
                merged.push(curr);
                curr = intervals[i];
            }
        }
        merged.push(curr);
    }

    let busyMins = 0;
    merged.forEach(iv => busyMins += (iv[1] - iv[0]));

    // 4. РИСУЕМ ПОЛОСКУ
    track.style.display = 'flex';
    const fill = track.querySelector('.dch-stats-fill');
    
    // Если доступного времени 0, но работа есть -> Красный (100%)
    if (capacityMins === 0) {
        fill.style.width = '100%';
        fill.style.background = 'var(--acc-red)';
        return;
    }

    const percent = (busyMins / capacityMins) * 100;
    
    console.log(`[${dateStr}] Доступно: ${availableHoursCount}ч, Занято: ${busyMins}мин, Загрузка: ${percent.toFixed(1)}%`);

    if (percent > 100) {
        // Переработка (работал больше, чем доступно часов)
        fill.style.width = '100%';
        fill.style.background = 'var(--acc-red)';
    } else {
        // Нормальная загрузка
        fill.style.width = `${percent}%`; 
        fill.style.background = 'var(--acc-current)';
    }
  }

  // === УМНАЯ ОТРИСОВКА (С РАЗДЕЛЕНИЕМ КОЛОНОК) ===
 // === УМНАЯ ОТРИСОВКА + МИНИ-РЕЖИМ (Скрываем текст при наложении) ===
  function renderEventsForColumn(col, dateStr, dayIdx) {
      // 1. Берем события только этого дня
      const dayEvents = sessions.filter(s => s.dateStr === dateStr);
      
      // 2. Превращаем время в минуты для расчетов
      const items = dayEvents.map(s => {
          const [h, m] = s.start.split(':').map(Number);
          const [hE, mE] = s.end.split(':').map(Number);
          return {
              data: s,
              start: h * 60 + m,
              end: hE * 60 + mE,
              colIndex: 0
          };
      });

      // 3. Сортируем
      items.sort((a, b) => {
          if (a.start !== b.start) return a.start - b.start;
          return (b.end - b.start) - (a.end - a.start);
      });

      // 4. Алгоритм "Укладки" в колонки
      const columns = [];
      items.forEach(item => {
          let placed = false;
          for (let i = 0; i < columns.length; i++) {
              const colItems = columns[i];
              const lastInCol = colItems[colItems.length - 1];
              if (item.start >= lastInCol.end) {
                  colItems.push(item);
                  item.colIndex = i;
                  placed = true;
                  break;
              }
          }
          if (!placed) {
              columns.push([item]);
              item.colIndex = columns.length - 1;
          }
      });

      // 5. Отрисовка
      items.forEach(item => {
          let maxColIndex = 0;
          items.forEach(other => {
               if (Math.max(item.start, other.start) < Math.min(item.end, other.end)) {
                   if (other.colIndex > maxColIndex) maxColIndex = other.colIndex;
               }
          });
          
          const totalCols = maxColIndex + 1;
          const widthPercent = 100 / totalCols;
          const leftPercent = item.colIndex * widthPercent;

          const el = createEventEl(item.data);
          el.style.width = `calc(${widthPercent}% - 4px)`;
          el.style.left = `calc(${leftPercent}% + 2px)`;
          el.style.zIndex = 10 + item.colIndex;

          // === ВОТ ГЛАВНОЕ ОТЛИЧИЕ ===
          // Если ширина меньше 85% (то есть 2 колонки и больше), включаем мини-режим (скрываем текст)
          if (widthPercent < 85) {
              el.classList.add('mini');
          }

          col.appendChild(el);
      });
  }

  function createEventEl(s) { 
      const [h,m] = s.start.split(':').map(Number); 
      const [hE,mE] = s.end.split(':').map(Number); 
      const top = (h*60+m)/60*GRID_H;
      const height = (hE*60+mE-(h*60+m))/60*GRID_H; 
      
      const div = document.createElement('div'); 
      const statusClass = (s.status === 'completed') ? ' status-completed' : '';
      div.className = `event-card${statusClass}`; 
      
      div.style.top = `${top}px`; 
      div.style.height = `${Math.max(height,20)}px`; 
      
      const cli = clients.find(c => (s.clientId && String(c.id) === String(s.clientId)) || c.name === s.client); 
      const color = cli ? cli.color : '#0a84ff'; 
      
      div.style.borderLeftColor = color; 
      div.style.backgroundColor = hexToRgba(color, 0.85); 
      
      // === ФОРМИРУЕМ HTML С ИКОНКАМИ ===
      let html = `<div class="ev-title">${s.client}</div><div class="ev-time">${s.start} - ${s.end}</div>`;
      
      // 1. Иконка повтора (SVG) - добавил класс card-icon
      if(s.seriesId) {
          html += `<svg class="ev-recurring-icon card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>`;
      }

      // 2. Иконка галочки (SVG) - вставляем, только если завершено
      if(s.status === 'completed') {
          // stroke-width="3" делает её жирненькой, но аккуратной
          html += `<svg class="ev-status-icon card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      }
      
      div.innerHTML = html;
      div.onclick = (e)=>{ e.stopPropagation(); openEdit(s); }; 
      return div; 
  }

  // --- INTERACTION ---
  function attachLongPressHandler(element, dateObj) { let startY=0, timer=null; const start=(e)=>{if(e.target.closest('.event-card'))return; isScrolling=false; startY=(e.touches?e.touches[0].clientY:e.clientY); timer=setTimeout(()=>{ if(!isScrolling){ navigator.vibrate?.(50); const rect=element.getBoundingClientRect(); const hour=Math.floor((startY-rect.top)/GRID_H); dateObj.setHours(hour,0); openAddSession(dateObj); } },500); }; const move=()=>{isScrolling=true; clearTimeout(timer);}; const end=()=>{clearTimeout(timer);}; element.addEventListener('touchstart',start,{passive:true}); element.addEventListener('touchmove',move,{passive:true}); element.addEventListener('touchend',end); element.addEventListener('mousedown',start); element.addEventListener('mousemove',move); element.addEventListener('mouseup',end); }
  function cancelLongPress() { /* Handled in closure */ }
  
  function handleInfiniteScroll() { const vp=document.getElementById('matrixViewport'); const sl=vp.scrollLeft, sw=vp.scrollWidth, cw=vp.clientWidth; if(sw-(sl+cw)<300) { const old=endOffset; endOffset+=14; renderDayRange(old+1, endOffset); reRenderBlocks(); } if(sl<300) { const old=startOffset; startOffset-=14; prependDays(startOffset, old-1); vp.scrollLeft+=(14*65); reRenderBlocks(); } }
  function prependDays(from, to) { const track=document.getElementById('daysHeaderTrack'), grid=document.getElementById('gridColumns'); const weekDays=['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС']; const base=new Date(); base.setHours(0,0,0,0); const todayStr = getLocalDateStr(new Date()); const fragH=document.createDocumentFragment(), fragC=document.createDocumentFragment(); for(let i=from; i<=to; i++) { const d=new Date(base); d.setDate(d.getDate()+i); const dateStr=getLocalDateStr(d); let dayIdx=d.getDay()-1; if(dayIdx===-1) dayIdx=6; const isToday = dateStr === todayStr; const h=document.createElement('div'); h.className=`day-col-header ${isToday ? 'today' : ''}`; h.id=`header-${dateStr}`; h.setAttribute('data-date', dateStr); h.innerHTML=`<div class="dch-day">${weekDays[dayIdx]}</div><div class="dch-num">${d.getDate()}</div><div class="dch-stats" id="stat-${dateStr}"><div class="dch-stats-fill"></div></div>`; h.onclick=()=>openDayOptions(dateStr, `${weekDays[dayIdx]} ${d.getDate()}`); fragH.appendChild(h); const c=document.createElement('div'); c.className=`day-column ${isToday ? 'today' : ''}`; c.setAttribute('data-date', dateStr); c.setAttribute('data-day-idx', dayIdx); renderEventsForColumn(c, dateStr, dayIdx); attachLongPressHandler(c, d); fragC.appendChild(c); updateDayStats(dateStr); } track.insertBefore(fragH, track.firstChild); grid.insertBefore(fragC, grid.querySelector('.day-column')); }

  // --- VALIDATION (UPDATED FOR GROUP TRAINING) ---
  function validateAppointment(dateStr, start, end, excludeSessionId, checkClientId) { 
      const [h1, m1] = start.split(':').map(Number); 
      const [h2, m2] = end.split(':').map(Number); 
      const startMins = h1 * 60 + m1; 
      const endMins = h2 * 60 + m2; 

      // Безопасное приведение ID к строке для сравнения
      const targetIdStr = String(checkClientId);
      let hasConflict = false;
      let conflictName = '';

      for (let s of sessions) { 
          if (s.dateStr !== dateStr) continue; 
          if (s.status === 'cancelled') continue; // Игнорируем отмененные
          
          // Пропускаем саму себя при редактировании
          if (excludeSessionId && String(s.id) === String(excludeSessionId)) continue; 

          const [sH1, sM1] = s.start.split(':').map(Number); 
          const [sH2, sM2] = s.end.split(':').map(Number); 
          const sStart = sH1 * 60 + sM1; 
          const sEnd = sH2 * 60 + sM2; 

          // Проверка пересечения времени
          if (Math.max(startMins, sStart) < Math.min(endMins, sEnd)) {
              
              // ГЛАВНОЕ ИЗМЕНЕНИЕ:
              // Если это ТОТ ЖЕ клиент - запрещаем
              if (s.clientId && String(s.clientId) === targetIdStr) {
                   return { 
                      valid: false, 
                      msg: `Этот клиент (${s.client}) уже записан на это время!` 
                   }; 
              }

              // Если клиент ДРУГОЙ - это групповая. Запоминаем для предупреждения.
              hasConflict = true;
              conflictName = s.client;
          }
      } 
      
      // Если было пересечение с другим человеком, возвращаем Warning, но valid = true
      if (hasConflict) {
          return { valid: true, warning: `Групповая: также записан ${conflictName}` };
      }

      return { valid: true }; 
  }

  // --- SHEETS & UI GLUE ---
// === UX HELPER: Красивая дата в заголовке ===
 // === НОВЫЕ ФУНКЦИИ (Вставь в конце скрипта) ===

  function updateDateDisplay() { 
      const val = document.getElementById('inpDate').value; 
      const disp = document.getElementById('sheetDateSubtitle'); 
      if (!val) { disp.textContent = ''; return; } 
      
      const [y, m, d] = val.split('-').map(Number); 
      const dateObj = new Date(y, m - 1, d);
      const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
      let str = dateObj.toLocaleDateString('ru-RU', options);
      str = str.charAt(0).toUpperCase() + str.slice(1);
      disp.textContent = str; 
  }

  function autoSetEndTime() {
      const startVal = document.getElementById('inpStart').value;
      if (!startVal) return;
      const [h, m] = startVal.split(':').map(Number);
      let newH = h + 1;
      if (newH > 23) newH = 0; 
      const endVal = `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      document.getElementById('inpEnd').value = endVal;
  }

  function populateClientSelect() { 
      const sel = document.getElementById('inpClient'); 
      sel.innerHTML = ''; 
      if(clients.length === 0) {
           const opt = document.createElement('option'); opt.text = "Нет клиентов"; sel.appendChild(opt); return;
      }
      clients.forEach(c => { const opt = document.createElement('option'); opt.value = c.name; opt.textContent = c.name; sel.appendChild(opt); }); 
  }

  function openActionSheet(type) { 
      const sheet = document.getElementById('actionSheet'); 
      const overlay = document.getElementById('actionSheetOverlay'); 
      const title = document.getElementById('asTitle'); 
      const btnOne = document.getElementById('asBtnOne'); 
      const btnSeries = document.getElementById('asBtnSeries'); 
      
      overlay.classList.add('active'); 
      sheet.classList.add('open'); 

      if (type === 'save') { 
          title.textContent = "Изменение серии"; 
          btnOne.textContent = "Только эту"; 
          btnOne.onclick = () => { closeActionSheet(); updateSeriesBatch('single', tempSessionData); }; 
          
          btnSeries.textContent = "Эту и будущие"; 
          btnSeries.onclick = () => { closeActionSheet(); updateSeriesBatch('series', tempSessionData); }; 
      } 
      else if (type === 'delete') { 
          title.textContent = "Удаление"; 
          btnOne.textContent = "Только эту"; 
          btnOne.className = "as-button danger";
          btnOne.onclick = () => { closeActionSheet(); commitDelete('single', sessions.find(s=>s.id===editingId)); }; 
          
          btnSeries.textContent = "Эту и будущие"; 
          btnSeries.className = "as-button danger bold";
          btnSeries.onclick = () => { closeActionSheet(); commitDelete('series', sessions.find(s=>s.id===editingId)); }; 
      } 
  }
  function closeActionSheet() { document.getElementById('actionSheet').classList.remove('open'); document.getElementById('actionSheetOverlay').classList.remove('active'); }
  function openSettings(){openSheet('settingsSheet');}

  // Сохранение настроек тренера (Правила отмены)
   // Было: только localStorage
  // Стало: localStorage + Отправка на сервер
  function saveCoachSettings() {
      const windowVal = document.getElementById('settingCancelWindow').value;
    
    // 1. Сохраняем локально (для мгновенного доступа)
    localStorage.setItem('uc_settings_cancel_window', windowVal);
    console.log('[Settings] Cancel window set to:', windowVal);
    
    // 2. Отправляем на сервер (вместе с ranges и pattern, это один JSON объект)
    // Бэкенд просто добавит ключ "cancel_window" в JSON настроек
    DataManager.fetchFromServer('save_settings', { 
        settings: { cancel_window: windowVal } 
    }).catch(e => {
        console.error("Save settings error:", e);
        showToast("Ошибка сохранения настроек", false);
    });
}
    
    // При загрузке восстанавливаем значение (добавь вызов loadCoachSettings() в init())
    function loadCoachSettings() {
        const val = localStorage.getItem('uc_settings_cancel_window');
        if (val) {
            document.getElementById('settingCancelWindow').value = val;
        }
    }
  
  function openRangesSheet(){ 
      closeAllSheets(); 
      resetRangeForm(); 
      renderRangesList(); 
      openSheet('rangesSheet'); 
  }
  
  // Settings: Ranges Logic (Re-implemented for v9.0)
  function addRange() {
      const dS = document.getElementById('rangeStartDate').value; const tS = document.getElementById('rangeStartTime').value;
      const dE = document.getElementById('rangeEndDate').value; const tE = document.getElementById('rangeEndTime').value;
      if (!dS || !tS || !dE || !tE) return alert('Заполните все поля');
      const start = `${dS}T${tS}`, end = `${dE}T${tE}`;
      if (start >= end) return alert('Ошибка дат');
      
      specialRanges.push({ start, end });
      resetRangeForm(); renderRangesList(); reRenderBlocks(); 
      DataManager.saveLocally(); 
      DataManager.fetchFromServer('save_settings', { settings: { ranges: specialRanges } }); // Sync to server
  }
  
  function deleteRange(i) { 
      specialRanges.splice(i, 1); 
      renderRangesList(); reRenderBlocks(); 
      DataManager.saveLocally();
      DataManager.fetchFromServer('save_settings', { settings: { ranges: specialRanges } });
  }

  function resetRangeForm() {
      document.getElementById('rangeStartDate').value = '';
      document.getElementById('rangeStartTime').value = '00:00';
      document.getElementById('rangeEndDate').value = '';
      document.getElementById('rangeEndTime').value = '23:59';
  }

  function renderRangesList() {
      const l = document.getElementById('rangesList');
      l.innerHTML = '';
      if (!specialRanges.length) {
        l.innerHTML = '<div style="color:#8E8E93;font-size:13px;text-align:center;margin-top:20px;">Нет периодов</div>';
        return;
      }
      specialRanges.forEach((r, i) => {
        const el = document.createElement('div');
        el.className = 'range-item';
        const f = (iso) => {
          const d = new Date(iso);
          return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        };
        el.innerHTML = `
          <div><div class="range-text">${f(r.start)} — ${f(r.end)}</div></div>
          <div class="range-actions"><div class="range-icon del" onclick="deleteRange(${i})"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></div></div>`;
        l.appendChild(el);
      });
  }


  
  function scrollToToday() { const today = getLocalDateStr(new Date()); const el = document.getElementById('header-' + today); const vp = document.getElementById('matrixViewport'); if(el && vp) { const vpW = vp.clientWidth; const elLeft = el.offsetLeft; const elW = el.offsetWidth; vp.scrollLeft = elLeft - (vpW / 2) + (elW / 2); vp.scrollTop = 9 * GRID_H; } }
  function onScroll() { const vp=document.getElementById('matrixViewport'), headers=document.querySelectorAll('.day-col-header'); for(let h of headers) if(h.offsetLeft>=vp.scrollLeft) { const d=new Date(h.getAttribute('data-date')); document.getElementById('headerMonth').textContent=`${d.toLocaleString('ru',{month:'long'}).toUpperCase()} ${d.getFullYear()}`; break; } }
  
  function showToast(msg, isSuccess = false) { const t = document.getElementById('toast'); t.className = 'toast-notification ' + (isSuccess ? 'success' : ''); document.getElementById('toastTitle').textContent = isSuccess ? "Успешно" : "Инфо"; document.getElementById('toastMessage').textContent = msg; t.classList.add('show'); setTimeout(() => { t.classList.remove('show'); }, 3000); }
  
  function openDayOptions(d,t){selectedDayForOptions=d;document.getElementById('dayOptionsTitle').textContent=t;openSheet('dayOptionsSheet');}
  function toggleDayOff() { 
      if (selectedDayForOptions) { 
          dateExceptions[selectedDayForOptions] = 'off'; 
          reRenderBlocks(); closeAllSheets(); 
          DataManager.saveLocally();
          DataManager.fetchFromServer('save_settings', { settings: { exceptions: dateExceptions } });
      } 
  }
  function clearDayOff() { 
      if (selectedDayForOptions) { 
          delete dateExceptions[selectedDayForOptions]; 
          reRenderBlocks(); closeAllSheets(); 
          DataManager.saveLocally();
          DataManager.fetchFromServer('save_settings', { settings: { exceptions: dateExceptions } });
      } 
  }

  function openSheet(id){document.getElementById('overlay').classList.add('active');document.getElementById(id).classList.add('open');}
  function closeAllSheets(){document.getElementById('overlay').classList.remove('active');document.querySelectorAll('.sheet').forEach(s=>s.classList.remove('open'));}
  
  // PATTERN EDITOR
  function openPatternEditor(){closeAllSheets();document.getElementById('patternEditor').classList.add('open');renderPatternEditor();}
  function closePatternEditor(){document.getElementById('patternEditor').classList.remove('open');} 
  function savePattern() { 
      document.getElementById('patternEditor').classList.remove('open'); 
      reRenderBlocks(); 
      DataManager.saveLocally(); 
      DataManager.fetchFromServer('save_settings', { settings: { pattern: availabilityPattern } }); 
  }
  
// === NEW PATTERN EDITOR LOGIC (GRID SYSTEM) ===
  
function renderPatternEditor() {
      const grid = document.getElementById('peGrid');
      grid.innerHTML = ''; // Clear previous
      
      const days = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
      
      // 1. Top Left Corner
      const corner = document.createElement('div'); 
      corner.className = 'pe-corner';
      grid.appendChild(corner);

      // 2. Day Headers (Mon-Sun) + ARROWS
      days.forEach((d, i) => {
          const dh = document.createElement('div');
          dh.className = 'pe-col-header';
          // Добавили стрелочку вниз
          dh.innerHTML = `${d} <span class="arrow">↓</span>`;
          dh.onclick = () => toggleColPattern(i); 
          grid.appendChild(dh);
      });

      // 3. Grid Rows (00:00 - 23:00)
      for (let hour = 0; hour < 24; hour++) {
          // Time Label (Left) + ARROW
          const tl = document.createElement('div');
          tl.className = 'pe-time-label';
          // Добавили стрелочку вправо (перед временем, чтобы влезло)
          tl.innerHTML = `<span style="font-size:10px; opacity:0.3; margin-right:2px">→</span>${String(hour).padStart(2,'0')}:00`;
          tl.onclick = () => toggleRowPattern(hour);
          grid.appendChild(tl);

          // 7 Cells for this hour
          for (let day = 0; day < 7; day++) {
              const cell = document.createElement('div');
              const isBlocked = (availabilityPattern[day] || []).includes(hour);
              const isWorking = !isBlocked;

              cell.className = `pe-cell ${isWorking ? 'active' : ''}`;
              cell.onclick = () => toggleSinglePattern(day, hour);
              grid.appendChild(cell);
          }
      }
  }

  // --- TOGGLE HANDLERS ---

  function toggleSinglePattern(dayIdx, hour) {
      if (!availabilityPattern[dayIdx]) availabilityPattern[dayIdx] = [];
      const arr = availabilityPattern[dayIdx];
      const idx = arr.indexOf(hour);

      if (idx === -1) {
          // Was Working (Not in array) -> Click -> Block it (Add to array)
          arr.push(hour);
      } else {
          // Was Blocked (In array) -> Click -> Make Working (Remove from array)
          arr.splice(idx, 1);
      }
      renderPatternEditor(); // Re-render to show change
  }

  function toggleColPattern(dayIdx) {
      if (!availabilityPattern[dayIdx]) availabilityPattern[dayIdx] = [];
      const arr = availabilityPattern[dayIdx];
      
      // If fully empty (working 24h) -> Block all
      // If partially blocked -> Clear blocks (Work 24h)
      
      if (arr.length === 0) {
          // Currently working 24h -> Make it Day Off (Block 0-23)
          availabilityPattern[dayIdx] = Array.from({length: 24}, (_, i) => i);
      } else {
          // Has blocks -> Clear them (Make working day)
          availabilityPattern[dayIdx] = [];
      }
      renderPatternEditor();
  }

  function toggleRowPattern(hour) {
      // Check if this hour is working for EVERY day
      let allWorking = true;
      for (let d = 0; d < 7; d++) {
          if ((availabilityPattern[d] || []).includes(hour)) {
              allWorking = false; // Found a block
              break;
          }
      }

      for (let d = 0; d < 7; d++) {
          if (!availabilityPattern[d]) availabilityPattern[d] = [];
          const idx = availabilityPattern[d].indexOf(hour);

          if (allWorking) {
              // If all working -> Block this hour everywhere
              if (idx === -1) availabilityPattern[d].push(hour);
          } else {
              // If mixed or blocked -> Make working everywhere
              if (idx !== -1) availabilityPattern[d].splice(idx, 1);
          }
      }
      renderPatternEditor();
  }
  
  function renderPCol(c, d) { c.innerHTML = ''; const colLeft = Math.round(c.offsetLeft); (availabilityPattern[d] || []).forEach(x => { const b = document.createElement('div'); b.className = 'blocked-slot stripe-bg'; const top = x * GRID_H; b.style.top = `${top}px`; b.style.backgroundPosition = `-${colLeft}px -${top}px`; b.onclick = (e) => { e.stopPropagation(); toggleSinglePattern(d, x); }; c.appendChild(b); }); }
  
  function startClock(){updateClock();if(updateInterval)clearInterval(updateInterval);updateInterval=setInterval(updateClock,60000);}
  function updateClock(){const n=new Date(),l=document.getElementById('globalTimeLine'),b=document.getElementById('timeLineBadge'),px=(n.getHours()*60+n.getMinutes())/60*GRID_H;l.style.top=`${px}px`;l.style.display='block';b.textContent=`${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;b.style.display='block';b.style.top=`${px}px`;}

  document.addEventListener('DOMContentLoaded', init);

// === DAY DASHBOARD LOGIC ===
  
  function openDayOptions(dateStr) {
      selectedDayForOptions = dateStr;
      
      // 1. Заголовок даты
      const d = new Date(dateStr);
      const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
      // Делаем первую букву заглавной (понедельник -> Понедельник)
      const dateText = d.toLocaleDateString('ru-RU', options);
      document.getElementById('doDateHeader').textContent = dateText.charAt(0).toUpperCase() + dateText.slice(1);

      // 2. Расчет Статистики
      let dayIdx = d.getDay() - 1; if (dayIdx === -1) dayIdx = 6;
      
      // Считаем часы по графику (Pattern)
      const workHours = availabilityPattern[dayIdx] || [];
      const availableHoursCount = 24 - workHours.length; // 24 минус зачеркнутые
      const capacityMins = availableHoursCount * 60;
      
      // Считаем занятость (Sessions)
      const daySessions = sessions.filter(s => s.dateStr === dateStr && s.status !== 'cancelled');
      
      // (Копируем логику слияния интервалов для точности)
      let intervals = daySessions.map(s => {
          const [h1, m1] = s.start.split(':').map(Number);
          const [h2, m2] = s.end.split(':').map(Number);
          return [h1 * 60 + m1, h2 * 60 + m2];
      });
      intervals.sort((a, b) => a[0] - b[0]);
      let merged = [];
      if (intervals.length > 0) {
          let curr = intervals[0];
          for (let i = 1; i < intervals.length; i++) {
              if (intervals[i][0] < curr[1]) { curr[1] = Math.max(curr[1], intervals[i][1]); } 
              else { merged.push(curr); curr = intervals[i]; }
          }
          merged.push(curr);
      }
      let busyMins = 0;
      merged.forEach(iv => busyMins += (iv[1] - iv[0]));

      // Заполняем UI цифрами
      document.getElementById('doWorkHours').textContent = formatMinsToHrs(capacityMins);
      document.getElementById('doBusyHours').textContent = formatMinsToHrs(busyMins);
      
      const percent = capacityMins > 0 ? Math.round((busyMins / capacityMins) * 100) : 0;
      const pEl = document.getElementById('doLoadPercent');
      pEl.textContent = percent + '%';
      
      // Красим проценты
      const card = document.getElementById('statLoadCard');
      if(percent > 100) { pEl.style.color = 'var(--acc-red)'; card.style.borderColor = 'rgba(255, 69, 58, 0.3)'; }
      else if(percent > 80) { pEl.style.color = 'var(--acc-orange)'; card.style.borderColor = 'rgba(255, 159, 10, 0.3)'; }
      else { pEl.style.color = 'var(--acc-green)'; card.style.borderColor = 'rgba(255,255,255,0.05)'; }

      // 3. Список событий
      const listContainer = document.getElementById('doEventsList');
      listContainer.innerHTML = '';
      
      if (daySessions.length === 0) {
          listContainer.innerHTML = `<div class="de-empty">Нет тренировок</div>`;
      } else {
          // Сортируем визуально
          daySessions.sort((a, b) => a.start.localeCompare(b.start));
          daySessions.forEach(s => {
              const clientObj = clients.find(c => c.name === s.client);
              const color = clientObj ? clientObj.color : '#fff';
              
              // Проверяем статус для галочки
              const isDone = s.status === 'completed';
              const checkIcon = isDone 
                  ? `<svg style="width:16px; height:16px; color:var(--acc-green); margin-left:8px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` 
                  : '';
              
              const row = document.createElement('div');
              row.className = 'de-item';
              row.style.borderLeftColor = color;
              
              // Добавили s.end и галочку
              row.innerHTML = `
                  <div class="de-time">${s.start} - ${s.end}</div>
                  <div class="de-name" style="display:flex; align-items:center;">
                      ${s.client}
                      ${checkIcon}
                  </div>
              `;
              listContainer.appendChild(row);
          });
      }

      // 4. Кнопка (Состояние)
      const btn = document.getElementById('btnDayToggle');
      const isOff = dateExceptions[dateStr] === 'off';
      
      if (isOff) {
          btn.textContent = 'Сделать рабочим днем';
          btn.className = 'btn-primary btn-secondary'; // Зеленый/Серый стиль
          btn.style.color = 'var(--acc-green)';
          btn.style.background = 'rgba(48, 209, 88, 0.15)';
      } else {
          btn.textContent = 'Сделать выходным';
          btn.className = 'btn-primary btn-danger';
          btn.style.color = 'var(--acc-red)';
          btn.style.background = 'rgba(255, 69, 58, 0.15)';
      }

      openSheet('dayOptionsSheet');
  }

  

/* =========================================
   * МОДУЛЬ АНАЛИТИКИ
   * ========================================= */
  let currentAnPeriod = 'week';

  function openAnalytics() {
      // При открытии ставим "Неделю" по умолчанию
      const weekBtn = document.querySelector('.period-switch .p-btn'); 
      setAnalyticsPeriod('week', weekBtn); 
      
      closeAllSheets();
      openSheet('analyticsSheet');
  }

  function setAnalyticsPeriod(period, btnEl) {
      currentAnPeriod = period;
      
      // Переключаем табы
      document.querySelectorAll('.period-switch .p-btn').forEach(b => b.classList.remove('active'));
      if(btnEl) btnEl.classList.add('active');

      // Показываем/скрываем выбор дат
      const customRow = document.getElementById('anCustomDates');
      customRow.style.display = (period === 'custom') ? 'flex' : 'none';

      // Считаем даты
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
          // Если "Период", проверяем, заполнены ли инпуты
          if (!document.getElementById('anStart').value) {
              document.getElementById('anStart').value = getLocalDateStr(now);
              document.getElementById('anEnd').value = getLocalDateStr(now);
          }
          refreshAnalytics(); 
          return;
      }

      // Записываем даты в инпуты (даже если они скрыты) для расчетов
      document.getElementById('anStart').value = getLocalDateStr(start);
      document.getElementById('anEnd').value = getLocalDateStr(end);
      
      refreshAnalytics();
  }

  function refreshAnalytics() {
      const sStr = document.getElementById('anStart').value;
      const eStr = document.getElementById('anEnd').value;
      if (!sStr || !eStr) return;

      // 1. Фильтруем тренировки
      const rangeSessions = sessions.filter(s => s.dateStr >= sStr && s.dateStr <= eStr && s.status !== 'cancelled');

      // 2. Общая статистика
      const total = rangeSessions.length;
      const completed = rangeSessions.filter(s => s.status === 'completed').length;
      const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

      // Обновляем виджет (Текст белый/серый)
      document.getElementById('anPercent').textContent = `${percent}%`;
      document.getElementById('anTotalStats').textContent = `${completed} из ${total} выполнено`;
      
      // Анимация круга (Синий)
      const circle = document.getElementById('anDonutCircle');
      const circumference = 2 * Math.PI * 35; // ~220
      const offset = circumference - (percent / 100) * circumference;
      circle.style.strokeDashoffset = offset;
      
      // 3. Группируем по клиентам
      const clientStats = {};
      rangeSessions.forEach(s => {
          if (!clientStats[s.client]) {
              const cObj = clients.find(c => c.name === s.client);
              clientStats[s.client] = { total: 0, done: 0, color: cObj ? cObj.color : '#fff' };
          }
          clientStats[s.client].total++;
          if (s.status === 'completed') clientStats[s.client].done++;
      });

      // 4. Рисуем список
      const list = document.getElementById('analyticsList');
      list.innerHTML = '';
      
      const sortedClients = Object.entries(clientStats).sort((a, b) => b[1].total - a[1].total);

      if (sortedClients.length === 0) {
          list.innerHTML = `<div class="empty-state">Нет тренировок за этот период</div>`;
          return;
      }

      sortedClients.forEach(([name, stat]) => {
          const cPercent = Math.round((stat.done / stat.total) * 100);
          
          const el = document.createElement('div');
          el.className = 'client-stat-card';
          
          // Цветная полоска слева (связь с календарем)
          el.style.borderLeftColor = stat.color; 
          
          // Контент (Строгий стиль: белый текст, синий бар)
          el.innerHTML = `
            <div class="csc-row-top">
               <div class="csc-name">${name}</div>
               <div class="csc-nums"><span>${stat.done}</span> / ${stat.total}</div>
            </div>
            <div class="progress-track">
               <div class="progress-fill" style="width: ${cPercent}%"></div>
            </div>
          `;
          list.appendChild(el);
      });
  }
// Хелпер для красивого времени (120 -> 2ч, 150 -> 2ч 30м)
  function formatMinsToHrs(mins) {
      if (mins === 0) return "0";
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      if (m === 0) return `${h}ч`;
      return `${h}ч ${m}м`;
  }
  