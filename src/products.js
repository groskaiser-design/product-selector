// 🔴 1. CONFIGURATION
  // ТВОЙ АКТУАЛЬНЫЙ URL (оставляем как был)
  const API_URL = "https://script.google.com/macros/s/AKfycbybxqI4xOLAUOcMXGReNl0PVjGToGg6_x3ZxlKNnUHg3XcaZGhkbsu61Adgkb4emrkm/exec"; 

  // 🔴 2. TELEGRAM INIT (FIXED & SAFE)
  const tg = window.Telegram?.WebApp;
  const TG_INIT_DATA = tg?.initData || "";

  if (tg) {
    try {
        tg.ready();
        tg.expand();

        // 1. Красим заголовок и фон (безопасно)
        try {
            tg.setHeaderColor('#050505');
            if (tg.setBackgroundColor) tg.setBackgroundColor('#050505');
            if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
        } catch (e) { console.warn('Color/Swipe settings error:', e); }

        // 2. Настраиваем УМНУЮ кнопку "Назад"
        if (tg.BackButton) {
            tg.BackButton.show();
            tg.BackButton.offClick(); // Сброс старых обработчиков (как в твоем коде)
            
            tg.BackButton.onClick(() => {
                // А. Если открыт поиск -> закрываем его
                if (state.searchMode) {
                    exitSearchMode();
                } 
                // Б. Если открыта категория -> выходим назад к списку
                else if (state.activeCatId) {
                    goBack();
                } 
                // В. Если мы в корне -> идем в роутер (ВМЕСТО tg.close())
                else {
                    window.location.href = 'router.html';
                }
            });
        }
    } catch (globalErr) {
        console.error('Critical TMA Error:', globalErr);
    }
  }

  // 🔴 3. DATA SERVICE (С ФУНКЦИЕЙ ЧИСТКИ МУСОРА)
  const DataService = {
    categories: [],
    productsMap: {}, 
    serverVer: 0,
    
    async init() {
      const hasCache = this.loadFromCache();
      
      if (hasCache) {
        renderCategories();
        hideLoader();
      }
      
      updateSaveButton();
      await this.syncWithServer();
    },

    loadFromCache() {
      try {
        const cached = localStorage.getItem('ultima_data_v2');
        if (cached) {
          const data = JSON.parse(cached);
          this.categories = data.categories || [];
          this.productsMap = data.productsMap || {};
          this.serverVer = data.serverVer || 0;
          
          const savedSelection = localStorage.getItem('ultima_cart_v1');
          if (savedSelection) {
             const parsed = JSON.parse(savedSelection);
             state.selected = new Set(parsed);
             
             // 🔥 ЧИСТКА 1: Проверяем кэш на мусор
             this.cleanupZombieProducts();
             
             state.initialSelected = new Set(state.selected);
          }
          return true;
        }
      } catch(e) { console.error(e); }
      return false;
    },

    async syncWithServer() {
      try {
        if (!API_URL.includes("script.google.com")) { console.warn("No API URL"); hideLoader(); return; }

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'init', clientVer: this.serverVer, initData: TG_INIT_DATA })
        });

        const res = await response.json();
        
        // 1. Сначала обновляем каталог (если есть обнова)
        if (res.ok && res.needUpdate && res.catalog) {
            this.processCatalog(res.catalog, res.serverVer);
        }

        // 2. Потом обновляем выбор юзера
        if (res.ok && res.userSelection) {
            try {
                const serverSel = JSON.parse(res.userSelection);
                state.selected = new Set(serverSel);
                
                // 🔥 ЧИСТКА 2: Чистим то, что пришло с сервера, от удаленных продуктов
                this.cleanupZombieProducts();
                
                // Запоминаем "чистое" состояние
                state.initialSelected = new Set(state.selected);
                
                saveSelectionToCache();
                updateSaveButton();
                renderCategories();
            } catch(e) {}
        }
        
        hideLoader();

      } catch(e) { 
         console.warn("Sync skipped:", e); 
         hideLoader();
         if (!DataService.categories.length) alert("Ошибка загрузки данных. Проверьте интернет.");
      }
    },

    processCatalog(catalogData, newVer) {
        this.categories = catalogData.categories.map(c => ({
            id: String(c.id), name: c.name, icon: c.icon
        }));

        const newMap = {};
        this.categories.forEach(c => newMap[c.id] = []);

        if (catalogData.products && Array.isArray(catalogData.products)) {
            catalogData.products.forEach(row => {
                const pId = String(row[0]);
                const cId = String(row[1]);
                if (!newMap[cId]) newMap[cId] = [];
                newMap[cId].push({ id: pId, name: row[2], meta: row[3] });
            });
        }

        this.productsMap = newMap;
        this.serverVer = newVer;

        localStorage.setItem('ultima_data_v2', JSON.stringify({
            categories: this.categories,
            productsMap: this.productsMap,
            serverVer: this.serverVer
        }));
        
        // 🔥 ЧИСТКА 3: Каталог обновился - проверяем, не исчезли ли выбранные продукты
        this.cleanupZombieProducts();
        
        renderCategories();
        hideLoader();
    },

    // 🧹 ГЛАВНАЯ ФУНКЦИЯ-САНИТАР
    cleanupZombieProducts() {
        if (!state.selected || state.selected.size === 0) return;

        // 1. Собираем все существующие ID продуктов в одну кучу (Set) для быстрого поиска
        const validIds = new Set();
        Object.values(this.productsMap).flat().forEach(p => validIds.add(p.id));

        // 2. Фильтруем выбор пользователя
        const cleanSet = new Set();
        state.selected.forEach(id => {
            if (validIds.has(id)) {
                cleanSet.add(id); // Оставляем только живые
            }
        });

        // 3. Если что-то удалилось, обновляем состояние
        if (cleanSet.size !== state.selected.size) {
            console.log(`🧹 Removed ${state.selected.size - cleanSet.size} zombie products`);
            state.selected = cleanSet;
            saveSelectionToCache(); // Сохраняем чистый список в кэш
        }
    },

    getProducts(catId) { return this.productsMap[catId] || []; },
    
    search(query) {
      const res = []; const q = query.toLowerCase();
      Object.values(this.productsMap).flat().forEach(p => {
        if (p.name.toLowerCase().includes(q)) res.push(p);
      });
      return res;
    },

    async saveSelectionToServer() {
        // Перед отправкой на всякий случай еще раз чистим (для надежности)
        this.cleanupZombieProducts();
        
        saveSelectionToCache();
        try {
            await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'save',
                    initData: TG_INIT_DATA,
                    selection: Array.from(state.selected)
                })
            });
            return true;
        } catch(e) { return false; }
    }
  };

  // 🔴 4. STATE
  const state = {
    selected: new Set(),
    initialSelected: new Set(), // 🔥 Новое поле: для сравнения изменений
    activeCatId: null,
    searchMode: false,
    renderQueue: [],
    renderIndex: 0,
    BATCH_SIZE: 20,
    currentContainer: null
  };

  function saveSelectionToCache() {
    try { localStorage.setItem('ultima_cart_v1', JSON.stringify(Array.from(state.selected))); } catch(e){}
  }

  // 🔴 5. UI ELEMENTS
  const el = {
    catGrid: document.getElementById('catGrid'),
    productList: document.getElementById('productList'),
    viewCats: document.getElementById('view-cats'),
    viewList: document.getElementById('view-list'),
    viewSearch: document.getElementById('view-search'),
    catTitle: document.getElementById('catTitle'),
    btnSelectAll: document.getElementById('btnSelectAll'),
    searchInput: document.getElementById('searchInput'),
    searchClear: document.getElementById('searchClear'),
    searchResults: document.getElementById('searchResults'),
    btnSearchCancel: document.getElementById('btnSearchCancel'),
    btnSave: document.getElementById('btnSave'),
    saveBtnText: document.getElementById('saveBtnText'),
    sentinel: document.getElementById('sentinel'),
    loader: document.getElementById('appLoader')
  };

  // 🔴 6. HELPERS
  function hideLoader() { el.loader.classList.add('hidden'); }
  
  function haptic(type = 'light') {
    try { const t = window.Telegram?.WebApp?.HapticFeedback; if(t) type==='light'?t.impactOccurred('light'):type==='medium'?t.impactOccurred('medium'):t.notificationOccurred('success'); } catch(e){}
  }

  const bump = el => { if(!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); };

  document.addEventListener('touchstart', (e) => {
    const el = e.target.closest('.cat-card, .btn-save');
    if (!el) return; haptic('light'); bump(el);
  }, {passive: true});

  // 🔥 ПРОВЕРКА: ИЗМЕНИЛОСЬ ЛИ ЧТО-ТО?
  function isSelectionChanged() {
    if (state.selected.size !== state.initialSelected.size) return true;
    for (let id of state.selected) {
        if (!state.initialSelected.has(id)) return true;
    }
    return false;
  }

  function init() {
    let viewportWidth = window.innerWidth;
    const fxLayer = document.querySelector('.fx-layer');
    const fixBackground = () => { fxLayer.style.height = window.innerHeight + 'px'; viewportWidth = window.innerWidth; };
    fixBackground(); 
    window.addEventListener('resize', () => { if (window.innerWidth !== viewportWidth) fixBackground(); });

    DataService.init(); 
    
    el.searchInput.addEventListener('input', handleSearch);
    el.searchClear.addEventListener('click', clearSearch);
    
    if(tg) tg.BackButton.show();

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) renderNextBatch();
    }, { rootMargin: '200px' });
    observer.observe(el.sentinel);
  }

  // 🔴 7. RENDER LOGIC
  function renderCategories() {
    el.catGrid.innerHTML = '';
    DataService.categories.forEach(cat => {
      const products = DataService.getProducts(cat.id);
      const total = products.length;
      const sel = products.filter(i => state.selected.has(i.id)).length;
      const progress = total > 0 ? (sel / total) * 100 : 0;
      
      const card = document.createElement('div');
      card.className = 'cat-card';
      card.onclick = () => openCategory(cat.id);
      
      card.innerHTML = `
        <div style="width: 100%">
          <div class="cat-icon">${cat.icon}</div>
          <div class="cat-name">${cat.name}</div>
        </div>
        <div class="cat-meta">
          <span>${sel} из ${total}</span>
          <div class="mini-track"><div class="mini-fill" style="width: ${progress}%"></div></div>
        </div>
      `;
      el.catGrid.appendChild(card);
    });
  }

  function openCategory(id) {
    state.activeCatId = id;
    const cat = DataService.categories.find(c => c.id === id);
    el.catTitle.textContent = cat.name;
    el.productList.style.display = 'flex';
    
    const products = DataService.getProducts(id);
    startInfiniteRender(products, el.productList);
    
    updateSelectAllBtn();
    el.viewCats.classList.add('prev');
    el.viewCats.classList.remove('active');
    el.viewList.classList.add('active');
    el.viewList.classList.remove('next');
    updateSaveButton(); 
    if(tg) tg.BackButton.show();
  }

  function goBack() {
    state.activeCatId = null;
    el.viewList.classList.remove('active');
    el.viewCats.classList.add('active');
    el.viewCats.classList.remove('prev');
    setTimeout(renderCategories, 300); 
    updateSaveButton();
    if(tg) tg.BackButton.show(); 
  }

  function startInfiniteRender(items, container, isSearch = false) {
    container.innerHTML = '';
    container.style.cssText = ''; 
    if (items.length === 0 && isSearch) {
        container.innerHTML = '<div class="simple-no-results">Ничего не найдено</div>';
        return; 
    }
    state.renderQueue = items;
    state.renderIndex = 0;
    
    let target = container;
    if (isSearch) {
        const wrapper = document.createElement('div');
        wrapper.className = 'product-list-container';
        wrapper.style.background = 'transparent'; wrapper.style.border = 'none'; wrapper.style.boxShadow = 'none';
        container.appendChild(wrapper);
        target = wrapper;
    }
    state.currentContainer = target;
    renderNextBatch(isSearch);
  }

  function renderNextBatch(isSearch = false) {
    if (state.renderIndex >= state.renderQueue.length) return;
    const batch = state.renderQueue.slice(state.renderIndex, state.renderIndex + state.BATCH_SIZE);
    const fragment = document.createDocumentFragment();

    batch.forEach((item, i) => {
      const isSel = state.selected.has(item.id);
      const row = document.createElement('div');
      row.className = `product-row ${isSel ? 'selected' : ''}`;
      
      row.addEventListener('touchstart', () => haptic('light'), {passive: true});
      row.onclick = () => toggleProduct(item.id, row);
      
      if (!isSearch) {
        row.style.opacity = '0';
        row.style.animation = `fadeInUp 0.2s ease forwards ${i * 0.02}s`;
        setTimeout(() => { row.style.opacity = '1'; row.style.animation = 'none'; row.style.transform = 'none'; }, (i * 20) + 300);
      }
      
      row.innerHTML = `
        <div class="check-square"></div>
        <div class="prod-info">
          <div class="prod-name">${item.name}</div>
          <div class="prod-meta">${item.meta}</div>
        </div>
      `;
      fragment.appendChild(row);
    });

    state.currentContainer.appendChild(fragment);
    state.renderIndex += state.BATCH_SIZE;
  }
  
  const styleSheet = document.createElement("style");
  styleSheet.innerText = `@keyframes fadeInUp { to { opacity: 1; transform: translateY(0); } }`;
  document.head.appendChild(styleSheet);

  function toggleProduct(id, rowEl) {
    if (state.selected.has(id)) {
      state.selected.delete(id);
      rowEl.classList.remove('selected');
    } else {
      state.selected.add(id);
      rowEl.classList.add('selected');
    }
    
    if (state.searchMode && el.btnSearchCancel) {
        el.btnSearchCancel.textContent = state.selected.size > 0 ? 'Выбрать' : 'Отмена';
        el.btnSearchCancel.style.fontWeight = state.selected.size > 0 ? '600' : '500';
    }

    saveSelectionToCache(); 
    updateSaveButton();
    if (state.activeCatId && !state.searchMode) updateSelectAllBtn();
  }

  // 🔥 ОБНОВЛЕННАЯ ЛОГИКА КНОПКИ
  function updateSaveButton() {
    let text = '';
    
    // 1. Если мы внутри категории — кнопка это "Назад" (или "Выбрать", если это UX паттерн)
    if (state.activeCatId) {
        const products = DataService.getProducts(state.activeCatId);
        const count = products.filter(i => state.selected.has(i.id)).length;
        text = count > 0 ? `Выбрать (${count})` : `Назад`;
        
        // Внутри категории кнопку показываем всегда для навигации
        el.btnSave.classList.add('visible'); 
        el.saveBtnText.textContent = text;
        return;
    } 
    
    // 2. Если мы на ГЛАВНОЙ — кнопка "Сохранить"
    const count = state.selected.size;
    text = `Сохранить (${count})`;
    el.saveBtnText.textContent = text;

    // 🔥 ПОКАЗЫВАЕМ ТОЛЬКО ЕСЛИ ЕСТЬ ИЗМЕНЕНИЯ (даже если список пуст)
    if (isSelectionChanged()) {
        el.btnSave.classList.add('visible');
    } else {
        el.btnSave.classList.remove('visible');
    }
  }

  function updateSelectAllBtn() {
    if (!state.activeCatId) return;
    const products = DataService.getProducts(state.activeCatId);
    const allSelected = products.length > 0 && products.every(i => state.selected.has(i.id));
    el.btnSelectAll.textContent = allSelected ? 'Снять всё' : 'Выбрать всё';
    el.btnSelectAll.onclick = () => toggleAllInCategory(products, !allSelected);
  }

  function toggleAllInCategory(products, select) {
    haptic('medium');
    products.forEach(i => {
      if (select) state.selected.add(i.id);
      else state.selected.delete(i.id);
    });
    saveSelectionToCache(); 
    startInfiniteRender(products, el.productList); 
    updateSelectAllBtn();
    updateSaveButton();
  }

  function handleSearch(e) {
    const query = e.target.value.toLowerCase().trim();
    if (query.length > 0) {
      if (!state.searchMode) enterSearchMode();
      const results = DataService.search(query);
      el.searchResults.style.display = 'block';
      startInfiniteRender(results, el.searchResults, true);
    } else {
      el.searchResults.innerHTML = '';
    }
  }

  function clearSearch() { exitSearchMode(); }

  // 🔥 ОБНОВЛЕННАЯ ЛОГИКА СОХРАНЕНИЯ
  async function saveSelection() {
    haptic('medium');
    
    // Если в категории - выходим назад
    if (state.activeCatId && !state.searchMode) {
        goBack();
        return;
    }
    
    const oldText = el.saveBtnText.textContent;
    el.saveBtnText.textContent = "Сохранение...";
    el.btnSave.style.pointerEvents = 'none'; 
    
    const ok = await DataService.saveSelectionToServer();
    
    if (ok) {
        el.saveBtnText.textContent = "Готово!";
        
        // 🔥 Обновляем "начальное состояние" на текущее (теперь они равны)
        state.initialSelected = new Set(state.selected);
        
        setTimeout(() => {
            el.btnSave.style.pointerEvents = 'auto'; 
            el.saveBtnText.textContent = oldText;
            
            // 🔥 Вызываем апдейт, он увидит что изменений нет и скроет кнопку
            updateSaveButton(); 
            
            if (state.searchMode) exitSearchMode();
            // НЕ ЗАКРЫВАЕМ ПРИЛОЖЕНИЕ (tg.close убрали)
        }, 800);
    } else {
        el.saveBtnText.textContent = "Ошибка!";
        setTimeout(() => {
            el.btnSave.style.pointerEvents = 'auto'; 
            el.saveBtnText.textContent = oldText;
        }, 2000);
    }
  }

  function enterSearchMode() {
    state.searchMode = true;
    if (el.btnSearchCancel) { el.btnSearchCancel.textContent = 'Отмена'; el.btnSearchCancel.style.fontWeight = '500'; }
    document.body.classList.add('search-active');
    el.viewCats.classList.remove('active');
    el.viewList.classList.remove('active');
    el.viewSearch.classList.add('active');
    if(tg) tg.BackButton.show();
  }

  function exitSearchMode() {
    state.searchMode = false;
    document.body.classList.remove('search-active'); 
    el.searchInput.blur(); 
    el.viewSearch.classList.remove('active');
    el.searchResults.style.display = 'none';
    el.searchInput.value = '';
    
    if (state.activeCatId) el.viewList.classList.add('active');
    else {
        el.viewCats.classList.add('active');
        renderCategories();
    }
    updateSaveButton();
  }

  init();