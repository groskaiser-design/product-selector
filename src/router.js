  // 🔴 ВСТАВЬ СЮДА СВОЙ URL
  const API_URL = 'https://script.google.com/macros/s/AKfycbzUtBu8wULajQS9KyNPfu4PXCn_V7l_ntnjEY8g1dQNNdY3RBvD4Qkn2dgT6cVJmqbn-g/exec'; 
  
  const CFG = { iconBase: 'https://groskaiser-design.github.io/icons/' };

  const DEFAULT_DATA = {
    version: 1,
    widgets: [
      { type: 'kbju', title: 'Питание', val: '—', sub: 'Загрузка...' },
      { type: 'breath', title: 'Дыхание', val: '0', unit: 'мин/д', btn: 'Начать', link: '#' },
      { type: 'weight', title: 'Вес', val: '—', unit: '', sub: '...' }
    ],
    menu: []
  };

  /* --- SYNC LOGIC --- */
/* --- SYNC LOGIC (FINAL: ЗАЩИТА + ВЕРСИИ) --- */
  async function syncData() {
    const loader = document.getElementById('loader');
    
    // ШАГ 1: Мгновенно показываем то, что есть в памяти (чтобы не было белого экрана)
    const localData = loadCache();
    
    if (localData && localData.widgets && localData.widgets.length > 0) {
      renderAll(localData);
      loader.classList.add('hidden');
    } else {
      renderAll(DEFAULT_DATA);
      loader.classList.add('hidden');
    }

    if (!API_URL) return;

    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'get_data', init_data: initData })
      });
      
      const json = await response.json();

      // === ГЛАВНАЯ ЛОГИКА ===

      // 1. ПРОВЕРКА БЕЗОПАСНОСТИ:
      // Пришли ли виджеты? Не пустой ли массив?
      // Если сервер глюкнул и прислал пустоту, isServerDataValid будет false.
      const isServerDataValid = json.ok && Array.isArray(json.widgets) && json.widgets.length > 0;

      if (isServerDataValid) {
        
        // 2. ПРОВЕРКА ОБНОВЛЕНИЙ:
        
        // А. Изменилась ли версия? (Ваш запрос про Config)
        const isNewVersion = !localData || localData.version !== json.version;

        // Б. Изменились ли данные внутри? (Ккал, вес и т.д.)
        const cacheStr = JSON.stringify(localData?.widgets || []);
        const serverStr = JSON.stringify(json.widgets);
        const isDataChanged = cacheStr !== serverStr;

        // ЕСЛИ (новая версия) ИЛИ (новые данные) -> СОХРАНЯЕМ И РИСУЕМ
        if (isNewVersion || isDataChanged) {
          console.log(`✅ ОБНОВЛЕНИЕ: Версия изменилась? [${isNewVersion}], Данные изменились? [${isDataChanged}]`);
          saveCache(json);
          renderAll(json);
        } else {
          console.log('💤 Данные актуальны, версия та же. Лишняя перерисовка не нужна.');
        }

      } else {
        // СЮДА мы попадаем, если сервер прислал "нули" или ошибку.
        // Мы просто ничего не делаем. Кэш остается старым. Пользователь счастлив.
        console.warn('🛡 СРАБОТАЛА ЗАЩИТА: Сервер прислал пустые виджеты. Оставляем старые данные.');
      }

    } catch (e) { 
      console.warn('Offline/Error:', e); 
    }
  }

  function renderAll(data) {
    const widgets = (data.widgets && data.widgets.length) ? data.widgets : DEFAULT_DATA.widgets;
    const menu = (data.menu && data.menu.length) ? data.menu : [];
    
    renderWidgets(widgets);
    renderMenu(menu);
    initCarousel();
  }

  function loadCache() { try { return JSON.parse(localStorage.getItem('app_cache')); } catch(e){ return null; } }
  function saveCache(data) { try { localStorage.setItem('app_cache', JSON.stringify(data)); } catch(e){} }

/* --- RENDER WIDGETS --- */
  function renderWidgets(widgets) {
    const track = document.getElementById('carouselTrack');
    track.innerHTML = '';

    widgets.forEach(w => {
      // 🔍 ОТЛАДКА: Смотрим в консоль, что пришло
      if (w.type === 'macros') console.log('MACROS DATA:', w);

      const el = document.createElement('div');
      el.className = 'widget';
      el.onclick = () => nav(w.link);

      // Иконка из таблицы (если есть)
      const icon = w.icon || '';

      let content = '';
      
      if (w.type === 'kbju' || w.type === 'donut') {
        // --- KBJU / DONUT ---
        const valClean = String(w.val).replace(/[^0-9.,]/g, '').replace(',', '.');
        const curr = Number(w.raw_curr) || parseFloat(valClean) || 0;
        let max = Number(w.raw_max) || 2100;
        if (!w.raw_max && w.sub) {
           const match = w.sub.match(/(\d+[\s.,]?\d*)/);
           if (match) max = parseFloat(match[0].replace(/\s/g,'').replace(',', '.')) || 2100;
        }
        const pct = Math.min(100, Math.max(0, (curr / max) * 100));
        const offset = 251 - (251 * pct / 100);

        content = `
          <div class="w-left">
            <div class="w-lbl">${w.title}</div>
            <div class="w-val">${w.val} <span>${w.unit||''}</span></div>
            <div class="w-sub">${w.sub}</div>
          </div>
          <div class="w-right">
            <svg class="donut-svg" viewBox="0 0 100 100">
              <circle class="d-bg" cx="50" cy="50" r="40"/>
              <circle class="d-val" cx="50" cy="50" r="40" style="stroke-dashoffset: ${offset}px"/>
            </svg>
            <div class="d-icon">${icon || '🔥'}</div>
          </div>`;

      } else if (w.type === 'weight') {
        // --- WEIGHT ---
        content = `
          <div class="w-left">
            <div class="w-lbl" style="color: var(--acc-green)">${w.title} <span style="margin-left:6px; filter: grayscale(0); font-size:14px">${icon}</span></div>
            <div class="w-val">${w.val} <span>${w.unit||''}</span></div>
            <div class="w-sub" style="color: var(--acc-green)">${w.sub}</div>
          </div>
          <div class="w-right">
            <div class="tech-graph-box">
              <div class="tech-graph-track">
                <svg class="tech-graph-svg" viewBox="0 0 100 50" preserveAspectRatio="none"><path class="tg-fill" d="M0,50 L0,40 L20,25 L40,35 L60,10 L80,25 L100,40 L100,50 Z"/><path class="tg-line" d="M0,40 L20,25 L40,35 L60,10 L80,25 L100,40"/></svg>
                <svg class="tech-graph-svg" viewBox="0 0 100 50" preserveAspectRatio="none"><path class="tg-fill" d="M0,50 L0,40 L20,25 L40,35 L60,10 L80,25 L100,40 L100,50 Z"/><path class="tg-line" d="M0,40 L20,25 L40,35 L60,10 L80,25 L100,40"/></svg>
              </div>
            </div>
          </div>`;

        } else if (w.type === 'water') {
        // --- WATER (FIXED) ---
        // 1. Чистим текущее значение (убираем "мл", меняем запятую на точку)
        const valClean = String(w.val).replace(/[^0-9.,]/g, '').replace(',', '.');
        const curr = Number(w.raw_curr) || parseFloat(valClean) || 0;
        
        // 2. Ищем цель (max). Дефолт ставим 2500 (мл), чтобы не было переполнения, если парсинг не сработает
        let max = Number(w.raw_max) || 2500; 
        
        if (!w.raw_max && w.sub) {
           // Убираем пробелы из строки (на случай "3 150") и ищем число
           const cleanSub = w.sub.replace(/\s+/g, '');
           const match = cleanSub.match(/(\d+[,.]?\d*)/);
           if (match) {
               max = parseFloat(match[0].replace(',', '.')) || 2500;
           }
        }

        // 🛡 АВТО-КОРРЕКЦИЯ: Если факт в МЛ (например 2000), а цель в ЛИТРАХ (например 3.1)
        // Если факт > 500, а цель < 10, значит цель точно в литрах. Умножаем на 1000.
        if (curr > 500 && max < 20) {
            max = max * 1000;
        }
        
        const pct = Math.min(100, Math.max(0, (curr / max) * 100));
        
        // 🔧 ИСПРАВЛЕНИЕ ВИЗУАЛА: 
        // Старый коэф 1.5 слишком быстро поднимал волну. 
        // 1.2 — более плавный подъем, 63% будет выглядеть как 65% (с учетом гребня волны), а не как 95%.
        const waveLevel = -210 + (pct * 1.2); 

        content = `
          <div class="w-left">
            <div class="w-lbl" style="color: var(--acc-blue)">${w.title} <span style="margin-left:6px; filter: grayscale(0); font-size:14px">${icon}</span></div>
            <div class="w-val">${w.val} <span>${w.unit||''}</span></div>
            <div class="w-sub">${w.sub}</div>
          </div>
          <div class="w-right">
            <div class="wave-box"><div class="wave" style="margin-bottom: ${waveLevel}%"></div></div>
          </div>`;

      } else if (w.type === 'insight') {
        // --- INSIGHT ---
        el.style.borderTopColor = ''; 
        const showBtn = w.link && w.link !== '#';
        const btnHtml = showBtn ? `<div class="w-btn">${w.btn || 'Читать →'}</div>` : '';
        const bulbAnim = `
          <div class="bulb-box">
            <svg class="v2-bulb" viewBox="0 0 50 60">
               <path class="v2-path" d="M25 5 A 20 20 0 0 0 5 25 C 5 36 15 40 18 48 L 32 48 C 35 40 45 36 45 25 A 20 20 0 0 0 25 5" />
               <line class="v2-path" x1="18" y1="55" x2="32" y2="55" stroke-width="3" />
            </svg>
          </div>`;

        content = `
          <div class="w-left">
            <div class="w-lbl" style="color: ${w.color || 'var(--acc-orange)'}">${w.title}</div>
            <div class="w-txt">${w.text}</div>
            ${btnHtml}
          </div>
          <div class="w-right">${bulbAnim}</div>`;

      } else if (w.type === 'news') {
        // --- NEWS ---
        content = `
          <div class="w-left">
            <div class="w-lbl"><span class="w-tag">BLOG</span></div>
            <div class="w-txt">${w.text}</div>
            <div class="w-btn" style="background: var(--acc-blue); color: #fff">${w.btn || 'Открыть'}</div>
          </div>
          <div class="w-right">
             <div class="blog-anim-box"><div class="blog-col"></div><div class="blog-col"></div><div class="blog-col"></div></div>
          </div>`;

      } else if (w.type === 'alert') {
        // --- ALERT ---
        if (!w.text || w.text.trim() === '' || w.text === '0') return;
        const targetUrl = (w.sub && w.sub !== '') ? w.sub : w.link;
        el.onclick = () => nav(targetUrl);

        el.style.background = 'linear-gradient(160deg, rgba(255,69,58,0.15) 0%, rgba(20,20,20,0.6) 100%)'; 
        el.style.borderColor = 'rgba(255,69,58,0.3)';
        
        const bellAnim = `
          <div class="bell-box">
             <div class="bell-wave w1"></div><div class="bell-wave w2"></div>
             <svg class="bell-svg" viewBox="0 0 24 24"><g class="bell-group"><path class="bell-path" d="M18 8 A6 6 0 0 0 6 8 C6 15 3 17 3 17 L21 17 C21 17 18 15 18 8 Z" /><path class="bell-clapper" d="M10 17 L10 19 A2 2 0 0 0 14 19 L14 17 Z" style="stroke:none" /></g></svg>
          </div>`;
        
        content = `
          <div class="w-left">
            <div class="w-lbl" style="color: var(--acc-red)">${w.title}</div>
            <div class="w-txt">${w.text}</div>
            <div class="w-btn" style="background: rgba(255,69,58,0.2); color: var(--acc-red)">${w.btn || 'Перейти'}</div>
          </div>
          <div class="w-right">${bellAnim}</div>`;

} else if (w.type === 'macros') {
    el.style.padding = '0 4px';  // <--- ВОТ ЭТУ СТРОКУ ДОБАВИТЬ
    el.style.display = 'flex';
        // Фон берется из CSS класса .widget (стекло). 
        // Если хочешь чуть темнее, раскомментируй строку ниже:
        // el.style.background = 'linear-gradient(145deg, rgba(20,20,20,0.6) 0%, rgba(0,0,0,0.9) 100%)';
        
        let d = {};
        try { d = typeof w.val === 'object' ? w.val : JSON.parse(w.val); } catch(e) { d = {}; }
        
        const getOffset = (cur, max) => {
           const c = parseFloat(cur) || 0;
           const m = parseFloat(max) || 1;
           const pct = Math.min(1, Math.max(0, c / m));
           return 151 - (151 * pct);
        };

        const kcal = d.kcal || "0/2000";
        const prot = d.prot || "0/100";
        const fats = d.fats || "0/60";
        const carb = d.carb || "0/200";

        const [k_c, k_m] = String(kcal).split('/');
        const [p_c, p_m] = String(prot).split('/');
        const [f_c, f_m] = String(fats).split('/');
        const [c_c, c_m] = String(carb).split('/');

        content = `

        <div class="macros-wrapper">
          <div class="macros-grid">
          
             <div class="macro-item">
               <div class="donut-box">
                 <svg class="mini-donut" viewBox="0 0 60 60">
                   <circle class="md-bg" cx="30" cy="30" r="24"/>
                   <circle class="md-val stroke-kcal" cx="30" cy="30" r="24" style="stroke-dashoffset: ${getOffset(k_c, k_m)}px"/>
                 </svg>
                 <div class="m-icon-center">🔥</div>
               </div>
               <div class="m-val-txt">${k_c}</div>
               <div class="m-lbl-txt">Ккал</div>
             </div>

             <div class="macro-item">
               <div class="donut-box">
                 <svg class="mini-donut" viewBox="0 0 60 60">
                   <circle class="md-bg" cx="30" cy="30" r="24"/>
                   <circle class="md-val stroke-prot" cx="30" cy="30" r="24" style="stroke-dashoffset: ${getOffset(p_c, p_m)}px"/>
                 </svg>
                 <div class="m-icon-center">🐓</div>
               </div>
               <div class="m-val-txt">${p_c}</div>
               <div class="m-lbl-txt">Белки</div>
             </div>

             <div class="macro-item">
               <div class="donut-box">
                 <svg class="mini-donut" viewBox="0 0 60 60">
                   <circle class="md-bg" cx="30" cy="30" r="24"/>
                   <circle class="md-val stroke-fats" cx="30" cy="30" r="24" style="stroke-dashoffset: ${getOffset(f_c, f_m)}px"/>
                 </svg>
                 <div class="m-icon-center">🥑</div>
               </div>
               <div class="m-val-txt">${f_c}</div>
               <div class="m-lbl-txt">Жиры</div>
             </div>

             <div class="macro-item">
               <div class="donut-box">
                 <svg class="mini-donut" viewBox="0 0 60 60">
                   <circle class="md-bg" cx="30" cy="30" r="24"/>
                   <circle class="md-val stroke-carb" cx="30" cy="30" r="24" style="stroke-dashoffset: ${getOffset(c_c, c_m)}px"/>
                 </svg>
                 <div class="m-icon-center">🌾</div>
               </div>
               <div class="m-val-txt">${c_c}</div>
               <div class="m-lbl-txt">Угли</div>
             </div>
             
          </div>
        </div>`;

      } else if (w.type === 'breath') {
        // --- BREATH ---
        el.style.background = 'linear-gradient(145deg, rgba(129, 236, 236, 0.08) 0%, rgba(5, 5, 5, 0.4) 100%)';
        el.style.borderTop = '1px solid rgba(129, 236, 236, 0.15)';
        
        content = `
          <div class="w-left">
            <div class="w-lbl" style="color: var(--acc-breath); margin-top: 12px;">${w.title}</div>
            <div style="display:flex; align-items:baseline; margin-bottom: 8px;">
              <div class="breath-val">${w.val}</div>
              <span class="breath-unit">${w.unit || 'мин/д'}</span>
            </div>
            <div class="w-btn" style="background: rgba(129, 236, 236, 0.1); color: var(--acc-breath); border: 1px solid rgba(129, 236, 236, 0.2); padding: 9px 20px;">${w.btn || 'Начать'}</div>
          </div>
          <div class="w-right">
            <div class="zero-point"><div class="circle c-echo"></div><div class="circle c-core"></div></div>
          </div>`;
      } 

      el.innerHTML = content;
      track.appendChild(el);
    });
  }

  function renderMenu(menuData) {
    const root = document.getElementById('dynamicContent');
    root.innerHTML = '';
    if(!menuData) return;

    menuData.forEach(section => {
      const wrapper = document.createElement('div'); wrapper.className = 'section-wrapper';
      if (section.title) { const t=document.createElement('div'); t.className='section-title'; t.textContent=section.title; wrapper.appendChild(t); }
      const container = document.createElement('div');
      
      if (section.type === 'list') {
        container.className = 'settings-list';
        section.items.forEach(item => {
          const row = document.createElement('div'); row.className = 'list-item'; row.onclick = () => nav(item.link);
          row.innerHTML = `<div class="li-left"><img src="${CFG.iconBase + (item.icon||'star.svg')}" class="li-icon">${item.title}</div><div class="li-arrow">⌄</div>`;
          container.appendChild(row);
        });
      } else {
        container.className = 'grid';
        section.items.forEach(item => {
          const tile = document.createElement('div');
          const layout = item.layout || 'std';
          tile.className = `tile ${layout}`; tile.onclick = () => nav(item.link);
          tile.innerHTML = `<div class="t-icon-box"><img src="${CFG.iconBase + (item.icon||'star.svg')}" class="t-icon-img"></div><div class="t-content"><div class="t-title">${item.title}</div>${item.sub?`<div class="t-sub">${item.sub}</div>`:''}</div>`;
          container.appendChild(tile);
        });
      }
      wrapper.appendChild(container); root.appendChild(wrapper);
    });
    
    const scrollPos = window.scrollY;
    if (scrollPos > 0) window.scrollTo(0, scrollPos);
    
 

  }

  const tg = window.Telegram?.WebApp;
  if(tg){ tg.ready(); tg.expand(); tg.setHeaderColor('#050505'); tg.setBackgroundColor('#050505'); tg.BackButton?.hide(); if (tg.isVersionAtLeast && tg.isVersionAtLeast('6.1')) tg.disableVerticalSwipes(); }

  function nav(url) {
    if(tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
    if(url && url !== '#') setTimeout(()=>window.location.href=url, 70);
    else tg?.showPopup({ title: 'В разработке', message: 'Скоро появится' });
  }

  function haptic(style) { if(tg?.HapticFeedback) tg.HapticFeedback.impactOccurred(style); }

  function getGreeting() {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return 'Доброе утро,'; if (h >= 12 && h < 18) return 'Добрый день,';
    if (h >= 18) return 'Добрый вечер,'; return 'Доброй ночи,';
  }

  function loadUser() {
    const u = tg?.initDataUnsafe?.user || { first_name: 'Александр' };
    document.getElementById('username').textContent = u.first_name;
    const greetingEl = document.querySelector('.greeting-text'); if (greetingEl) greetingEl.textContent = getGreeting();
    if(u.photo_url){ const img = document.getElementById('ava'); img.src=u.photo_url; img.style.display='block'; }
  }

  function initCarousel() {
    const track = document.getElementById('carouselTrack');
    const dotsContainer = document.getElementById('carouselDots');
    const slides = track.querySelectorAll('.widget');
    if (slides.length < 2) { dotsContainer.style.display = 'none'; return; }
    
    dotsContainer.style.display = 'flex';
    dotsContainer.innerHTML = '';
    slides.forEach((_, i) => { const dot = document.createElement('div'); dot.className = `dot ${i === 0 ? 'active' : ''}`; dotsContainer.appendChild(dot); });
    
    if (window.carouselObserver) window.carouselObserver.disconnect();
    window.carouselObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const index = Array.from(slides).indexOf(entry.target);
          if (index !== -1) {
            const dots = dotsContainer.querySelectorAll('.dot');
            dots.forEach(d => d.classList.remove('active'));
            if(dots[index]) dots[index].classList.add('active');
          }
        }
      });
    }, { root: track, threshold: 0.6 });
    slides.forEach(s => window.carouselObserver.observe(s));
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadUser();
    document.getElementById('fabIcon').src = CFG.iconBase + 'ai.svg';
    initCarousel();
    syncData(); 
    // ЗАПУСК НОВОГО ГОДА ❄️
    startSnowfall();
  
  });


  /* === НОВЫЙ ГОД === */

  // 1. Запуск снегопада
    function startSnowfall() {
    const count = 30; // Количество снежинок (не ставь больше 50 для производительности)
    const container = document.body;

    for (let i = 0; i < count; i++) {
    const flake = document.createElement('div');
    flake.className = 'snowflake';
    
    // Рандомизация
    const size = Math.random() * 4 + 2 + 'px'; // Размер от 2 до 6px
    const left = Math.random() * 100 + 'vw';
    const duration = Math.random() * 5 + 5 + 's'; // Скорость падения от 5 до 10 сек
    const delay = Math.random() * -10 + 's'; // Отрицательная задержка, чтобы снег уже шел при запуске

    flake.style.width = size;
    flake.style.height = size;
    flake.style.left = left;
    flake.style.animationDuration = duration;
    flake.style.animationDelay = delay;

    container.appendChild(flake);
  }
}