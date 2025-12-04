  // ============================================================================
  // ⚡ SYSTEM CONFIG & STORAGE KEYS
  // ============================================================================
  const tg = window.Telegram?.WebApp;

  const SYS = {
    // 👇 ТВОЙ URL БЭКЕНДА (Проверь, если менял деплой)
    API_URL: 'https://script.google.com/macros/s/AKfycbxnoCFfZ3cBVFEit4mMgVP7E3gd6ZBpEUI4D1XxJvAW4syDegKjHZa49LaLPZ6sP9uBDA/exec',
    
    // Ключи для LocalStorage (Память телефона)
    STORAGE: {
      DATA: 'breath_hist_data',    // Сам массив истории JSON
      ROW_HINT: 'breath_row_hint', // Строка юзера в Index (Hint)
      VERSION: 'breath_data_ver'   // Строка лога (last_log_row) = ВЕРСИЯ
    }
  };

  // ============================================================================
  // 🌬️ BREATHING CONFIGURATION
  // ============================================================================
  const CONFIG = {
    stress: { 
      visual: 'linear', 
      color: '#4facfe', 
      duration: 120, type: 'double_inhale', 
      inhaleBase: 3000, inhaleTop: 800, exhale: 6000,
      title: 'Экстренное снятие стресса',
      desc: 'Когда вы в стрессе, в крови растёт CO₂. Мозг читает это как опасность. Сердце бьётся быстрее. Вы не можете думать. Двойной вдох открывает лёгкие, длинный выдох сбрасывает CO₂. Пульс падает, голова яснеет. Из всех дыхательных техник эта снижает стресс быстрее остальных.',
      steps: [
        {emoji:'👃', title:'Первый вдох носом (80%)', text:'Сильный вдох наполняет легкие.'},
        {emoji:'👃', title:'Второй вдох носом (20%)', text:'Короткий вдох дораскрывает альвеолы.'},
        {emoji:'🌬', title:'Выдох ртом', text:'Длинный выдох удаляет CO2.'}
      ]
    },
    sleep: { 
      visual: 'triangle', 
      color: '#ff9f0a', 
      duration: 180, type: 'standard', 
      inhale: 4000, exhale: 8000, hold: 7000,
      title: 'Быстрое засыпание',
      desc: 'Когда вы не можете уснуть, мозг застревает в режиме тревоги. Мысли крутятся, тело напряжено, дыхание поверхностное. Долгая задержка и медленный выдох переключают нервную систему в режим отдыха. Сердце замедляется, мышцы расслабляются, мозг отпускает контроль. Метод используют врачи для пациентов с бессонницей.',
      steps: [
        {emoji:'👅', title:'Язык к нёбу', text:'Держите кончик языка за верхними зубами.'},
        {emoji:'👃', title:'Вдох носом', text:'Глубокий вдох 4 сек.'},
        {emoji:'🤐', title:'Задержка', text:'Задержка дыхания на 7 сек насыщает кровь кислородом.'},
        {emoji:'🌬', title:'Выдох ртом', text:'Медленный выдох на 8 сек активирует парасимпатику — систему покоя.'}
      ]
    },
    focus: { 
      visual: 'box', 
      color: '#5e60ce', 
      duration: 300, type: 'box', 
      inhale: 4000, exhale: 4000, hold: 4000,
      title: 'Пиковая концентрация',
      desc: 'Поток — это когда мозг работает на максимуме, но без напряжения. Мысли быстрые и точные. Действия автоматические. Время растягивается. Равномерное дыхание 4-4-4-4 балансирует кислород и CO₂ в крови. Сердце бьётся ровно. Префронтальная кора отключает лишнее. Остаётся только задача перед вами.',
      steps: [
        {emoji:'📦', title:'Ритм квадрата', text:'Вдох, пауза, выдох, пауза. Всё по 4 секунды.'},
        {emoji:'👃', title:'Вдох носом', text:'Дышите диафрагмой.'},
        {emoji:'⏸️', title:'Паузы после вдоха', text:'Повышают усвоение кислорода мозгом.'}  
      ]
    }
  };

  // ============================================================================
  // 🏗️ STATE & DOM
  // ============================================================================
  let activeConfig = null;
  let activeKey = null;
  let isRunning = false;
  let sessionInterval = null;
  let wakeLock = null;

  const el = {
    menu: document.getElementById('menuView'),
    intro: document.getElementById('introView'),
    player: document.getElementById('timerView'),
    photon: document.getElementById('photon'),
    lbl: document.getElementById('statusLbl'),
    timer: document.getElementById('timerDisplay'),
    trackLine: document.getElementById('trackLine'),
    trackTri: document.getElementById('trackTri'),
    trackBox: document.getElementById('trackBox'),
    marker: document.getElementById('stressMark'),
    root: document.documentElement,
    orb1: document.getElementById('bgOrb1'),
    orb2: document.getElementById('bgOrb2'),
    overlay: document.getElementById('overlay'),
    cnt: document.getElementById('cntNum'),
    iTitle: document.getElementById('iTitle'),
    iDesc: document.getElementById('iDesc'),
    iSteps: document.getElementById('iSteps'),
    video: document.getElementById('noSleepVideo')
  };

  // ============================================================================
  // 📱 TELEGRAM INIT
  // ============================================================================
  if(tg) {
    tg.ready(); tg.expand(); 
    tg.setHeaderColor('#000000'); tg.setBackgroundColor('#000000');
    tg.BackButton.show();
    tg.BackButton.onClick(() => {
      if (el.player.classList.contains('active')) stopPractice();
      else if (el.intro.classList.contains('active')) goBackToMenu();
      else { tg.HapticFeedback.impactOccurred('light'); window.location.href = 'router.html'; } // Или tg.close()
    });
  }

  // Запускаем синхронизацию при старте
window.onload = () => {
    syncHistorySmart();
    updateOrbs('default'); // <--- Добавь это для старта
  };

  // ============================================================================
  // 🌐 NETWORKING & SYNC (SMART LOGIC)
  // ============================================================================
  
  /**
   * 1. Загружает кэш (Мгновенно)
   * 2. Проверяет обновления на сервере (Smart Sync)
   */
  async function syncHistorySmart() {
    if (!tg || !tg.initData) return; // Локально без TG не работаем

    // A. OFFLINE FIRST: Достаем то, что есть
    try {
      const cachedRaw = localStorage.getItem(SYS.STORAGE.DATA);
      if (cachedRaw) {
        const data = JSON.parse(cachedRaw);
        console.log('💾 Cache loaded:', data.length, 'records');
        updateDashboardUI(data); // Рисуем графики сразу
      }
    } catch (e) { console.error('Cache read error', e); }

    // B. NETWORK CHECK: Проверяем версию
    const savedHint = localStorage.getItem(SYS.STORAGE.ROW_HINT) || 0;
    const savedVer  = localStorage.getItem(SYS.STORAGE.VERSION) || 0;

    try {
      const response = await fetch(SYS.API_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'get_history',
          init_data: tg.initData,
          user_index_row: savedHint, // Ускоряем поиск
          known_log_row: savedVer    // Сообщаем нашу версию
        })
      });

      const json = await response.json();

      if (json.ok) {
        // Запоминаем актуальную строку юзера в индексе (Hint)
        if (json.user_index_row) {
          localStorage.setItem(SYS.STORAGE.ROW_HINT, json.user_index_row);
        }

        // Сценарий 1: Данные не изменились (304 Not Modified logic)
        if (json.status === 'not_modified') {
          console.log('✅ Data is up to date (Server ver:', json.server_ver, ')');
          return; 
        }

        // Сценарий 2: Пришли новые данные
        if (json.data && Array.isArray(json.data)) {
          console.log('🔄 New data received:', json.data.length);
          
          // Сохраняем
          localStorage.setItem(SYS.STORAGE.DATA, JSON.stringify(json.data));
          // Обновляем версию (pointer)
          if (json.last_log_row) {
            localStorage.setItem(SYS.STORAGE.VERSION, json.last_log_row);
          }

          // Обновляем UI
          updateDashboardUI(json.data);
        }
      }
    } catch (err) {
      console.warn('🌐 Network sync failed (Offline mode)', err);
    }
  }

  /**
   * Отправляет сессию и обновляет Hint
   */
  /**
   * Отправляет сессию и обновляет Hint
   */
function trackSession(practiceType, durationSec) {
    if (!tg || !tg.initData) return;

    // 1. Берем текущий момент времени с устройства
    const d = new Date();

    // 2. ВРУЧНУЮ собираем строку YYYY-MM-DD
    // getFullYear, getMonth, getDate - берут время, установленное на телефоне пользователя
    const year = d.getFullYear();
    
    // Месяцы в JS идут от 0 до 11, поэтому добавляем +1. 
    // padStart(2, '0') добавляет нолик, если месяц < 10 (например, делает "05" из "5")
    const month = String(d.getMonth() + 1).padStart(2, '0');
    
    // День месяца (1-31)
    const day = String(d.getDate()).padStart(2, '0');

    // Склеиваем: "2025-11-25"
    const localDateString = `${year}-${month}-${day}`;

    console.log('Sending Date:', localDateString); // Для проверки

    const payload = {
      action: 'track_session',
      init_data: tg.initData,
      practice_type: practiceType,
      duration: durationSec,
      client_day_local: localDateString, // <--- Отправляем эту жесткую строку
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone 
    };

    fetch(SYS.API_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(json => {
      console.log('📤 Track status:', json.status);
      if (json.ok && json.user_index_row) {
        localStorage.setItem(SYS.STORAGE.ROW_HINT, json.user_index_row);
        // Небольшая задержка, чтобы Google Таблица успела обновиться
        setTimeout(() => syncHistorySmart(), 2000);
      }
    })
    .catch(e => console.error('Track error:', e));
  }


  // ============================================================================
  // 🎮 APP LOGIC (UI & ANIMATION)
  // ============================================================================

  async function enableInsomnia() {
    try { el.video.play(); } catch(e){}
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (err){}
  }
  function disableInsomnia() {
    el.video.pause();
    if (wakeLock !== null) { wakeLock.release().then(() => { wakeLock = null; }); }
  }

  function showIntro(key) {
    haptic('light');
    activeKey = key;
    activeConfig = CONFIG[key];
    
    el.root.style.setProperty('--active-color', activeConfig.color);
    updateOrbs(key);

    el.iTitle.textContent = activeConfig.title;
    el.iDesc.textContent = activeConfig.desc;
    el.iSteps.innerHTML = activeConfig.steps.map(s => `
      <div class="step-row"><div class="step-icon">${s.emoji}</div><div class="step-text"><h4>${s.title}</h4><p>${s.text}</p></div></div>
    `).join('');

    el.menu.classList.remove('active');
    el.intro.classList.add('active');
  }

  function goBackToMenu() {
    el.intro.classList.remove('active');
    el.menu.classList.add('active');
    activeKey = null;
    updateOrbs('default');
  }

  async function startFromIntro() {
    haptic('medium');
    enableInsomnia();

    el.intro.classList.remove('active');
    el.player.classList.add('active');
    
    // RESET VISUALS
    el.trackLine.style.opacity = '0';
    el.trackTri.style.opacity = '0';
    el.trackBox.style.opacity = '0';
    el.marker.style.opacity = '0';
    el.photon.style.transition = 'none';

    if (activeConfig.visual === 'triangle') {
      el.trackTri.style.opacity = '1';
      el.photon.style.transform = 'translate(40px, 280px)';
      el.photon.style.boxShadow = getGlowStyle(0);
      
    } else if (activeConfig.visual === 'box') {
      el.trackBox.style.opacity = '1';
      el.photon.style.transform = 'translate(20px, 300px)';
      el.photon.style.boxShadow = getGlowStyle(0);

    } else {
      el.trackLine.style.opacity = '1';
      el.marker.style.opacity = (activeKey === 'stress') ? '1' : '0';
      el.photon.style.transform = 'translate(150px, 320px)';
      el.photon.style.boxShadow = getGlowStyle(0);
    }
    
    void el.photon.offsetWidth; 

    el.overlay.classList.add('active');
    el.cnt.style.display = 'block';
    for(let i=5; i>0; i--) {
      if(!activeKey) break; 
      el.cnt.textContent = i;
      el.cnt.classList.remove('pop');
      void el.cnt.offsetWidth; el.cnt.classList.add('pop');
      haptic('light');
      await wait(1000);
    }
    el.overlay.classList.remove('active');
    
    if(activeKey) startBreathing();
  }

  function startBreathing() {
    isRunning = true;
    let timeLeft = activeConfig.duration;
    updateTimer(timeLeft);
    sessionInterval = setInterval(() => {
      timeLeft--;
      updateTimer(timeLeft);
      if(timeLeft <= 0) stopPractice(true);
    }, 1000);

    if (activeConfig.visual === 'triangle') runTriangleCycle();
    else if (activeConfig.visual === 'box') runBoxCycle();
    else if (activeConfig.type === 'double_inhale') runStressCycle();
    else runLinearCycle();
  }

  function stopPractice(completed = false) {
    // 1. Сохраняем данные
    const finishedKey = activeKey; 
    const finishedDuration = activeConfig ? activeConfig.duration : 0;

    isRunning = false;
    activeKey = null; 
    clearInterval(sessionInterval);
    disableInsomnia();
    el.photon.style.transition = 'none';
    el.lbl.classList.remove('visible');

    // 2. Если успешно — отправляем аналитику
    if(completed) {
      trackSession(finishedKey, finishedDuration);
      if(tg) tg.showPopup({ title: 'Отлично', message: 'Сессия завершена' });
    }

    el.player.classList.remove('active');
    el.menu.classList.add('active');
    updateOrbs('default');
  }

  // === ANIMATION CYCLES (SAME AS BEFORE) ===
  async function runTriangleCycle() {
    const P_TOP = {x: 150, y: 40};  
    const P_BR  = {x: 260, y: 280}; 
    const P_BL  = {x: 40,  y: 280}; 
    const { inhale, hold, exhale } = activeConfig;
    
    while(isRunning) {
      setStatus('ВДОХ'); haptic('heavy'); 
      await movePhotonTo(P_TOP, inhale, 3); 
      if(!isRunning) break;

      setStatus('ЗАДЕРЖКА'); haptic('medium'); 
      await movePhotonTo(P_BR, hold, 3); 
      if(!isRunning) break;

      setStatus('ВЫДОХ'); haptic('soft'); 
      await movePhotonTo(P_BL, exhale, 0); 
      if(!isRunning) break;
    }
  }

  async function runBoxCycle() {
    const P_TL = {x: 20, y: 40};  
    const P_TR = {x: 280, y: 40}; 
    const P_BR = {x: 280, y: 300};
    const P_BL = {x: 20, y: 300};
    const { inhale, hold, exhale } = activeConfig;

    while(isRunning) {
      setStatus('ВДОХ'); haptic('heavy'); 
      await movePhotonTo(P_TL, inhale, 3);
      if(!isRunning) break;

      setStatus('ПАУЗА'); haptic('medium'); 
      await movePhotonTo(P_TR, hold, 3);
      if(!isRunning) break;

      setStatus('ВЫДОХ'); haptic('soft'); 
      await movePhotonTo(P_BR, exhale, 0);
      if(!isRunning) break;

      setStatus('ПАУЗА'); haptic('medium'); 
      await movePhotonTo(P_BL, hold, 0);
      if(!isRunning) break;
    }
  }

  async function runStressCycle() {
    const { inhaleBase, inhaleTop, exhale } = activeConfig;
    el.photon.style.transition = 'none';
    el.photon.style.boxShadow = getGlowStyle(0);
    el.photon.style.transform = 'translate(150px, 320px)'; 
    void el.photon.offsetWidth; 

    while(isRunning) {
      setStatus('ВДОХ'); haptic('heavy');
      await movePhotonTo({x: 150, y: 80}, inhaleBase, 2);
      if(!isRunning) break;

      setStatus('ВТОРОЙ ВДОХ'); haptic('rigid');
      await movePhotonTo({x: 150, y: 20}, inhaleTop, 3);
      if(!isRunning) break;

      setStatus('ВЫДОХ'); haptic('soft');
      await movePhotonTo({x: 150, y: 320}, exhale, 0);
      if(!isRunning) break;
    }
  }
  
  async function runLinearCycle() {
    const { inhale, hold, exhale } = activeConfig;
    while(isRunning) {
      setStatus('ВДОХ'); haptic('heavy'); 
      await movePhotonTo({x: 150, y: 20}, inhale, 2); 
      if(!isRunning) break;
      
      if(hold) { 
          setStatus('ЗАДЕРЖКА'); haptic('medium'); 
          await wait(hold); 
          if(!isRunning) break; 
      }
      
      setStatus('ВЫДОХ'); haptic('soft'); 
      await movePhotonTo({x: 150, y: 320}, exhale, 1); 
      if(!isRunning) break;
    }
  }

  // === UTILS ===
  function hexToRgb(hex) {
    var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(shorthandRegex, function(m, r, g, b) { return r + r + g + g + b + b; });
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 0, g: 0, b: 0 };
  }

  function getGlowStyle(level) {
    const hex = activeConfig.color;
    const rgb = hexToRgb(hex);
    const {r, g, b} = rgb;

    if (level === 0) return `0 0 0 0 rgba(${r}, ${g}, ${b}, 0), inset 0 0 0 0 rgba(255,255,255,0)`;
    if (level === 1) return `0 0 20px 5px rgba(${r}, ${g}, ${b}, 1), inset 0 0 0 0 rgba(255,255,255,0)`;
    if (level === 2) return `0 0 50px 20px rgba(${r}, ${g}, ${b}, 1), inset 0 0 15px 0 rgba(255,255,255,1)`;
    if (level === 3) return `0 0 90px 40px rgba(${r}, ${g}, ${b}, 1), inset 0 0 30px 0 rgba(255,255,255,1)`;
    
    return `0 0 20px 5px rgba(${r}, ${g}, ${b}, 1), inset 0 0 0 0 rgba(255,255,255,0)`;
  }

  function movePhotonTo(coords, duration, targetGlowLevel = null) {
    return new Promise(resolve => {
      const transStr = `transform ${duration}ms linear, box-shadow ${duration}ms linear, -webkit-transform ${duration}ms linear, -webkit-box-shadow ${duration}ms linear`;
      el.photon.style.transition = transStr;
      el.photon.style.webkitTransition = transStr;

      el.photon.style.transform = `translate(${coords.x}px, ${coords.y}px)`;

      if (targetGlowLevel !== null) {
        el.photon.style.boxShadow = getGlowStyle(targetGlowLevel);
      } else {
        const isHighEnergy = coords.y < 150;
        el.photon.style.boxShadow = isHighEnergy ? getGlowStyle(2) : getGlowStyle(1);
      }
      setTimeout(resolve, duration);
    });
  }

  function setStatus(text) {
    if(!isRunning) return;
    el.lbl.classList.remove('visible');
    setTimeout(() => { 
      if(!isRunning) return;
      el.lbl.textContent = text; 
      el.lbl.classList.add('visible'); 
    }, 200);
  }

function updateOrbs(type) {
    const isMenu = (type === 'default' || !type);
    
    if (isMenu) {
        document.body.classList.add('menu-mode');
    } else {
        document.body.classList.remove('menu-mode');
    }

    let c1, c2;
    if(type === 'stress') { c1='rgba(79, 172, 254, 0.6)'; c2='rgba(0, 242, 254, 0.4)'; }
    else if(type === 'sleep') { c1='rgba(255, 159, 10, 0.6)'; c2='rgba(255, 69, 58, 0.4)'; }
    else if(type === 'focus') { c1='rgba(94, 96, 206, 0.6)'; c2='rgba(162, 155, 254, 0.4)'; } 
    else { 
        // 🔥 УСИЛИЛИ ЦВЕТА ДЛЯ МЕНЮ (альфа-канал 1.0 вместо 0.6)
        c1='rgba(108, 92, 231, 1.0)'; 
        c2='rgba(108, 92, 231, 1.0)'; 
    } 
    
    el.orb1.style.background = `radial-gradient(circle, ${c1} 0%, transparent 70%)`;
    el.orb2.style.background = `radial-gradient(circle, ${c2} 0%, transparent 70%)`;
  }

  function updateTimer(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    el.timer.textContent = `${m}:${s}`;
  }

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
  function haptic(style) { tg?.HapticFeedback?.impactOccurred(style); }

// ============================================================================
// 📊 ЛОГИКА ГРАФИКА (100% КОПИЯ KBJU + FIX ОБВОДКИ)
// ============================================================================

let __chartData = [];

function updateDashboardUI(historyData) {
  __chartData = aggregateHistoryByDay(historyData);
  
  const chartBox = document.getElementById('chart-box');
  const root = document.getElementById('breath-chart-host');
  
  if (chartBox) {
    chartBox.style.display = 'block';
    renderBreathChart(root, __chartData, { visible: 7, shape: 'clip-capsule', animate: true });
  }
}

function aggregateHistoryByDay(rawList) {
  if (!rawList || !Array.isArray(rawList)) return [];
  const map = {};

  rawList.forEach(row => {
    if (Array.isArray(row) && row.length >= 7) {
       const date = row[2];
       if (!date) return;
       if (!map[date]) map[date] = { date, stress: 0, sleep: 0, focus: 0 };
       map[date].stress += Number(row[4]) || 0;
       map[date].sleep  += Number(row[5]) || 0;
       map[date].focus  += Number(row[6]) || 0;
    }
    else if (typeof row === 'object') {
       const date = row.date || row.day || row.client_day_local;
       if (!date) return;
       if (!map[date]) map[date] = { date, stress: 0, sleep: 0, focus: 0 };
       map[date].stress += Number(row.stress) || 0;
       map[date].sleep  += Number(row.sleep) || 0;
       map[date].focus  += Number(row.focus) || 0;
    }
  });

  return Object.values(map).sort((a, b) => new Date(a.date) - new Date(b.date));
}

function renderBreathChart(hostEl, data, opts = {}) {
  const root = hostEl;
  if (!root) return;

  const scr = root.querySelector('#breath-chart-scroll');
  const svg = root.querySelector('#breath-chart-svg');
  const infS = root.querySelector('#val-stress');
  const infL = root.querySelector('#val-sleep');
  const infF = root.querySelector('#val-focus');

  const list = (data || []).slice(); 
  
  if (!list.length) {
    svg.setAttribute('viewBox', '0 0 300 160');
    svg.innerHTML = '<text x="150" y="80" fill="#fff" opacity=".5" text-anchor="middle" font-size="14">Нет данных</text>';
    if(infS) infS.textContent = '—'; if(infL) infL.textContent = '—'; if(infF) infF.textContent = '—';
    return;
  }

  const H = 160, DATE_PAD = 18, LIFT = 8, TOP_PAD = 14;
  const visible = Number(opts.visible || 7);
  const shape   = opts.shape || 'clip-capsule';
  const doAnim = !!opts.animate; 

  const W = (scr && scr.clientWidth) || root.clientWidth || 320;
  const GAP = 8;
  const BAR = Math.max(12, Math.floor((W - GAP*(visible+1)) / visible));
  const contentW = list.length * (BAR + GAP) + GAP;
  
  const filter = root.getAttribute('data-filter') || 'all';

  let maxVal = 0;
  if (filter === 'all') {
    maxVal = Math.max(...list.map(d => d.stress + d.sleep + d.focus));
  } else {
    maxVal = Math.max(...list.map(d => d[filter] || 0));
  }
  if (maxVal < 1) maxVal = 1;

  const yG = v => (H - TOP_PAD - DATE_PAD - 4) * (v / maxVal);
  const fmtD = d => { try { return new Date(d).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}); } catch { return d; } };

  svg.setAttribute('viewBox', `0 0 ${contentW} ${H}`);
  svg.setAttribute('width', contentW);
  svg.setAttribute('height', H);
  svg.setAttribute('shape-rendering', 'geometricPrecision'); 
  svg.innerHTML = ''; 

  const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
  const gBars = document.createElementNS('http://www.w3.org/2000/svg','g');
  const gSel  = document.createElementNS('http://www.w3.org/2000/svg','g');
  const gHit  = document.createElementNS('http://www.w3.org/2000/svg','g');
  
  const groups=[]; const dates=[]; const outlines=[];
  const yBase = H - 2 - DATE_PAD;
  const yDate = H - 6;
  const outerR = 6;

  list.forEach((d, i) => {
    const x = GAP + i*(BAR + GAP);
    
    let gS = d.stress || 0; let gL = d.sleep || 0; let gF = d.focus || 0;
    if (filter === 'stress') { gL = 0; gF = 0; }
    else if (filter === 'sleep') { gS = 0; gF = 0; }
    else if (filter === 'focus') { gS = 0; gL = 0; }

    const hS = yG(gS); const hL = yG(gL); const hF = yG(gF);
    const sum = hS + hL + hF;
    const topY = yBase - Math.max(sum, 0);

    let clipId = null;
    if (shape === 'clip-capsule'){
      clipId = `clip_br_${i}`;
      const cp = document.createElementNS('http://www.w3.org/2000/svg','clipPath');
      cp.setAttribute('id', clipId);
      const pill = rect(x, Math.max(TOP_PAD, topY), BAR, Math.max(sum, 0.0001), outerR);
      cp.appendChild(pill); defs.appendChild(cp);
    }

    const group = document.createElementNS('http://www.w3.org/2000/svg','g');
    if (clipId) group.setAttribute('clip-path', `url(#${clipId})`);
    group.style.transition = 'transform .2s ease';

    const rS = rect(x, yBase - hS, BAR, hS, 0); 
    const rL = rect(x, yBase - (hS + hL), BAR, hL, 0); 
    const rF = rect(x, yBase - (hS + hL + hF), BAR, hF, 0); 

    rS.setAttribute('fill', 'var(--c-stress)');
    rL.setAttribute('fill', 'var(--c-sleep)');
    rF.setAttribute('fill', 'var(--c-focus)');

    if (doAnim){ rS.classList.add('bar-anim'); rL.classList.add('bar-anim'); rF.classList.add('bar-anim'); }
    group.appendChild(rS); group.appendChild(rL); group.appendChild(rF);
    gBars.appendChild(group);

    if (filter !== 'all') {
      const val = filter==='stress' ? gS : filter==='sleep' ? gL : gF;
      const hVal = filter==='stress' ? hS : filter==='sleep' ? hL : hF;
      if (hVal > 22) {
        const tx = document.createElementNS('http://www.w3.org/2000/svg','text');
        tx.textContent = String(Math.round(val));
        tx.setAttribute('x', Math.round(x + BAR/2));
        tx.setAttribute('y', Math.round(yBase - (hVal * 0.75))); 
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
    tDate.setAttribute('x', Math.round(x + BAR/2));
    tDate.setAttribute('y', Math.round(yDate));
    tDate.setAttribute('text-anchor','middle');
    tDate.setAttribute('font-size','12');
    tDate.setAttribute('font-weight','700');
    tDate.setAttribute('fill','rgba(255,255,255,.9)');
    tDate.style.opacity = '0';
    tDate.style.transition = 'opacity .18s ease';
    tDate.style.pointerEvents = 'none';
    gBars.appendChild(tDate); dates.push(tDate);
    groups.push(group); // <-- ВАЖНО: сохраняем ссылку на группу

    // --- ОБВОДКА (FIXED) ---
    // Исправлено: topY - 1 и height + 2 для полного охвата
    const selOutline = rect(x-1, topY - 1, BAR+2, Math.max(sum,2) + 2, outerR + 2);
    selOutline.setAttribute('class','sel-outline'); 
    selOutline.style.opacity = '0';
    selOutline.style.transition = 'transform .2s ease, opacity .12s ease';
    gSel.appendChild(selOutline); outlines.push(selOutline);

    const hit = rect(x, 0, BAR, H, outerR); 
    hit.setAttribute('fill','transparent'); 
    hit.style.cursor='pointer';
    hit.addEventListener('click', ()=> select(i, d)); 
    gHit.appendChild(hit);
  });

  svg.appendChild(defs); svg.appendChild(gBars); svg.appendChild(gSel); svg.appendChild(gHit);

  if (doAnim){
    requestAnimationFrame(()=>{ svg.querySelectorAll('.bar-anim').forEach(el=> el.classList.add('show')); });
  }
  requestAnimationFrame(() => { if(scr) scr.scrollLeft = scr.scrollWidth; });

  if (list.length > 0) { select(list.length-1, list[list.length-1]); }

  function select(idx, d){
    if (infS) infS.textContent = Math.round(d.stress || 0);
    if (infL) infL.textContent = Math.round(d.sleep || 0);
    if (infF) infF.textContent = Math.round(d.focus || 0);

    outlines.forEach((o,i)=>{ 
      o.style.opacity = (i===idx ? '1' : '0'); 
      // FIX: Обводка прыгает вместе со столбиком
      o.style.transform = (i===idx ? `translateY(-${LIFT}px)` : 'translateY(0)'); 
    });
    groups.forEach((g,i)=>{ 
      g.style.transform = (i===idx ? `translateY(-${LIFT}px)` : 'translateY(0)'); 
    });
    dates.forEach((t,i)=>{ 
      t.style.opacity = (i===idx ? '1' : '0'); 
    });

    const tg = window.Telegram?.WebApp;
    if (tg && tg.HapticFeedback) { tg.HapticFeedback.selectionChanged(); }
  }

  function rect(x,y,w,h,r=0){
    const e = document.createElementNS('http://www.w3.org/2000/svg','rect');
    e.setAttribute('x', x); e.setAttribute('y', Math.max(0,y));
    e.setAttribute('width', w); e.setAttribute('height', Math.max(0,h));
    if (r){ e.setAttribute('rx', r); e.setAttribute('ry', r); }
    return e;
  }
}

(function bindBreathLegend(){
  const root = document.getElementById('breath-chart-host');
  if (!root) return;
  const info = root.querySelector('#breath-chart-info'); 
  if (!info || info._bound) return; 

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

    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
    }

    if (__chartData && __chartData.length > 0) {
        renderBreathChart(root, __chartData, { visible: 7, shape: 'clip-capsule', animate: false });
    }
  });
  info._bound = true;
})();