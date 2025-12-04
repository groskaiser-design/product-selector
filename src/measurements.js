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

/* ============================================================
 *  BLOCK A: UI utils
 *  Вспомогательные утилиты для UI: высота строки, паддинги, clamp, парсинг чисел
 * ============================================================ */

// Читаем CSS-переменную --row с корневого элемента (обычно высота одной строки графика, например "40px")
const ROW_VAR = getComputedStyle(document.documentElement)
  .getPropertyValue('--row')
  .trim();

// Превращаем значение --row в число (в пикселях).
// Если оно оканчивается на "px" → парсим как float.
// Если там, например, просто "40" или значение невалидно → пытаемся взять число, иначе используем дефолт 36.
const rowH = ROW_VAR.endsWith('px')
  ? parseFloat(ROW_VAR)
  : (parseFloat(ROW_VAR) || 36);

// Базовый внутренний отступ/паддинг (4 пикселя) — используется при расчёте высот, позиционирования и т.п.
const pad = 4;

// Универсальная функция "зажима" значения v в диапазон [a, b].
// Если v меньше a → вернём a; если больше b → вернём b; иначе само v.
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Универсальная нормализация чисел из бэка/локального стейта.
 *
 * Принимает что угодно (number | string | null | undefined) и возвращает:
 *  - число (JS Number), если его корректно удалось распарсить;
 *  - null, если значение пустое/невалидное.
 *
 * Особенности:
 *  - поддерживает строки c запятой вместо точки ("12,5");
 *  - обрабатывает строку "null" как отсутствие значения;
 *  - отбрасывает бесконечности и нечисловые значения.
 */
function numOrNull(v) {
  // 1) Если значение отсутствует (null/undefined) → считаем, что данных нет
  if (v == null) return null;

  // 2) Если это число:
  if (typeof v === 'number') {
    //    - возвращаем его, только если оно конечно (не Infinity / -Infinity / NaN)
    return Number.isFinite(v) ? v : null;
  }

  // 3) Если это строка:
  if (typeof v === 'string') {
    const s = v.trim(); // убираем пробелы по краям
    //    - пустая строка или "null" (в любом регистре) → считаем отсутствием значения
    if (!s || /^null$/i.test(s)) return null;

    //    - заменяем запятую на точку и пытаемся привести к Number
    const n = Number(s.replace(',', '.'));

    //    - возвращаем только если получилось конечное число
    return Number.isFinite(n) ? n : null;
  }

  // 4) Всё остальное (объекты, массивы, boolean и т.п.) → нечисловое, возвращаем null
  return null;
}

/* ============================================================
 *  BLOCK A1: Wheels + ensureWheel
 *  Колёса для ввода чисел (целая + дробная часть) и их инициализация
 * ============================================================ */
/**
 * Строит колесо для одного поля замеров.
 *
 * @param {HTMLElement} fieldEl - контейнер поля с разметкой вида:
 *    <div data-key="weight" data-min="40" data-max="200" data-only-int="0">
 *      <div class="duo">
 *        <div class="col-int"></div>
 *        <div class="col-frac"></div>
 *      </div>
 *    </div>
 * @param {number} [initial] - начальное значение (если не передано, берётся середина диапазона)
 * @returns {object} api - управление колесом
 *    - setValue(v)
 *    - value (getter)
 *    - getModelValue()
 *    - setDisabled(dis, programmatic?)
 *    - destroy()
 */
function buildWheel(fieldEl, initial) {
  // 1. Читаем конфигурацию поля из data-атрибутов
  const min      = +fieldEl.dataset.min;             // минимальное значение
  const max      = +fieldEl.dataset.max;             // максимальное значение
  const minInt   = Math.floor(min);                  // минимальное целое
  const maxInt   = Math.floor(max);                  // максимальное целое
  const intRange = maxInt - minInt;                  // диапазон целых значений
  const key      = fieldEl.dataset.key;              // ключ поля (weight, height, fat, …)
  const onlyInt  = fieldEl.dataset.onlyInt === '1' || fieldEl.dataset.onlyInt === 'true';

  // 2. Находим нужные элементы внутри поля
  const intCol  = fieldEl.querySelector('.col-int');   // колонка целых
  const fracCol = fieldEl.querySelector('.col-frac');  // колонка десятых
  const duo     = fieldEl.querySelector('.duo');       // общий контейнер (для disabled и aria)

  // 3. Хелпер для создания одной текстовой опции (одной «строчки» в колесе)
  const opt = t => { const d = document.createElement('div'); d.className = 'option'; d.textContent = t; return d; };

  // 4. Заполняем колонку значениями с «пустыми» паддингами сверху/снизу
  function fillCol(col, from, to) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < pad; i++) frag.appendChild(opt(''));   // верхний паддинг
    for (let i = from; i <= to; i++) frag.appendChild(opt(i)); // сами значения
    for (let i = 0; i < pad; i++) frag.appendChild(opt(''));   // нижний паддинг
    col.innerHTML = ''; 
    col.appendChild(frag);
  }
  fillCol(intCol,  minInt, maxInt);               // целая часть: от minInt до maxInt
  fillCol(fracCol, 0,      onlyInt ? 0 : 9);      // дробная часть: 0–9 или только 0, если onlyInt

  // 5. Функция вычисляет ближайший индекс значения по текущему scrollTop в колонке
  const nearestIndex = col =>
    Math.round((col.scrollTop + (col.clientHeight - rowH) / 2) / rowH) - pad;

  // 6. Подсветка активной строки + виброотклик (по колонке)
  const lastActiveIdx = new WeakMap();
  function markActive(col) {
    const idx  = nearestIndex(col) + pad;           // сдвиг с учётом паддинга
    const prev = lastActiveIdx.get(col);           // предыдущий активный индекс

    // Если пользователь крутит колесо руками (не программно) и индекс сменился, даём тактильный отклик
    if (typeof prev === 'number' && prev !== idx && !isProgrammatic) {
      try { window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.(); } catch (_) {}
    }

    // Снимаем active с предыдущего, если он был
    if (typeof prev === 'number' && col.children[prev]) col.children[prev].classList.remove('active');

    // Вешаем active на текущий (если существует)
    const el = col.children[idx];
    if (el) el.classList.add('active');

    lastActiveIdx.set(col, idx);
  }

  // 7. Мгновенно устанавливаем scroll к нужному индексу (без анимации), центрируя строку
  const setScrollInstant = (col, idx) => {
    const ch  = col.clientHeight || rowH * 5; // если высота ещё не посчитана — считаем 5 строк
    const top = (idx + pad) * rowH - (ch - rowH) / 2;
    col.scrollTop = top;
    requestAnimationFrame(() => markActive(col));
  };

  // 8. Временно выключаем scroll-snap, чтобы программное позиционирование не дёргалось
  function withNoSnap(fn) {
    const prevInt  = intCol.style.scrollSnapType;
    const prevFrac = fracCol.style.scrollSnapType;
    intCol.style.scrollSnapType  = 'none';
    fracCol.style.scrollSnapType = 'none';
    try { fn(); }
    finally {
      requestAnimationFrame(() => {
        intCol.style.scrollSnapType  = prevInt  || '';
        fracCol.style.scrollSnapType = prevFrac || '';
        markActive(intCol);
        markActive(fracCol);
      });
    }
  }

  // 9. Внутреннее состояние
  let isProgrammatic   = false;           // флаг: сейчас двигаем колесо программно (чтобы не триггерить лишние реакции)
  let rafInt           = 0, rafFrac = 0;  // ID requestAnimationFrame для throttling scroll-событий
  let snapTimer        = null;            // таймер отложенного снаппинга
  const supportsScrollEnd = ('onscrollend' in window);
  let disabled         = false;           // флаг блокировки колеса

  // Модельное значение — хранится независимо от того, где сейчас стоит визуальный скролл
  let modelValue = (typeof initial === 'number')
    ? clamp(+initial, min, max)
    : clamp(min + (max - min) / 2, min, max);   // по умолчанию середина диапазона

  // 10. Лочим дробную колонку, если нужно (onlyInt или выбран максимум)
  function applyFracLock(iVal) {
    if (disabled) return;
    const lock = onlyInt || (iVal === maxInt);
    fracCol.style.pointerEvents = lock ? 'none' : 'auto';
    fracCol.style.opacity       = lock ? 0.5   : 1;
  }

  // 11. Уведомляем систему об изменении значения (одно событие на оба колеса)
  function dispatchChange() {
    const v = api.value;  // текущее визуальное значение
    document.dispatchEvent(new CustomEvent('wheelchange', {
      detail: { key, value: v, programmatic: isProgrammatic }
    }));
  }

  // 12. Программно задать значение колеса
  function setValue(v) {
    const clamped = clamp(+v, min, max);                                 // зажимаем в диапазоне
    const rounded = onlyInt ? Math.round(clamped) : Math.round(clamped * 10) / 10;
    modelValue    = rounded;

    const iVal = Math.trunc(rounded);                                    // целая часть
    let f      = onlyInt ? 0 : Math.round((rounded - iVal) * 10);        // дробная часть (0–9)
    if (iVal === maxInt) f = 0;                                          // на максимуме всегда .0
    const iIdx = iVal - minInt;                                          // индекс в целевой колонке

    const prev = isProgrammatic; isProgrammatic = true;
    withNoSnap(() => {
      setScrollInstant(intCol,  iIdx);
      setScrollInstant(fracCol, f);
    });
    applyFracLock(iVal);
    markActive(intCol);
    markActive(fracCol);

    requestAnimationFrame(() => { isProgrammatic = prev; dispatchChange(); });
  }

  // 13. Притянуть колонки к ближайшим значениям (снаппинг) после окончания скролла
  function snapNow() {
    if (isProgrammatic) return;

    let iIdx = clamp(nearestIndex(intCol),  0, intRange);
    let f    = onlyInt ? 0 : clamp(nearestIndex(fracCol), 0, 9);

    const iVal = minInt + iIdx;
    if (iVal === maxInt) f = 0; // на максимуме обнуляем дробную часть

    modelValue = onlyInt ? iVal : +(iVal + f / 10).toFixed(1);

    const prev = isProgrammatic; isProgrammatic = true;
    setScrollInstant(intCol,  iIdx);
    setScrollInstant(fracCol, f);
    applyFracLock(iVal);
    markActive(intCol);
    markActive(fracCol);
    requestAnimationFrame(() => { isProgrammatic = prev; dispatchChange(); });
  }

  // 14. Обработчики scroll для колонок (обновляем подсветку и планируем снаппинг)
  function onScrollInt() {
    if (isProgrammatic) return;
    if (rafInt) cancelAnimationFrame(rafInt);
    rafInt = requestAnimationFrame(() => markActive(intCol));
    scheduleSnap();
  }
  function onScrollFrac() {
    if (isProgrammatic || onlyInt) return;
    if (rafFrac) cancelAnimationFrame(rafFrac);
    rafFrac = requestAnimationFrame(() => markActive(fracCol));
    scheduleSnap();
  }

  // 15. Планируем отложенный снаппинг (через 80 мс после последнего скролла)
  function scheduleSnap() {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(snapNow, 80);
  }

  // 16. Подписываемся на scroll события
  intCol.addEventListener('scroll', onScrollInt,  { passive: true });
  fracCol.addEventListener('scroll', onScrollFrac, { passive: true });
  if (supportsScrollEnd) {
    intCol.addEventListener('scrollend', snapNow, { passive: true });
    if (!onlyInt) fracCol.addEventListener('scrollend', snapNow, { passive: true });
  }

  // 17. Включение/выключение колеса
  function setDisabled(dis, programmatic = false) {
    const prev = isProgrammatic; if (programmatic) isProgrammatic = true;
    disabled = dis;

    duo.classList.toggle('disabled', dis);
    duo.setAttribute('aria-disabled', String(dis));
    [intCol, fracCol].forEach(c => c.style.pointerEvents = dis ? 'none' : 'auto');

    // При включении снова корректно настраиваем блокировку дробной части
    if (!dis) {
      const iIdx = clamp(nearestIndex(intCol), 0, intRange);
      const iVal = minInt + iIdx;
      applyFracLock(iVal);
    }

    dispatchChange();
    isProgrammatic = prev;
  }

  // 18. Начальное значение: не трогаем скрытые колёса (аккордеон свернут),
  //     чтобы не перетёреть данные, которые ещё не пришли с бэка.
  const initVal = (typeof initial === 'number') ? initial : (min + (max - min) / 2);
  if (fieldEl.offsetParent !== null) {
    setValue(initVal);
  }

  // 19. Внешний API для работы с колесом
  const api = {
    // Программно установить значение
    setValue,

    // Текущее визуальное значение (считается по позиции скролла)
    get value() {
      const iIdx = clamp(nearestIndex(intCol),  0, intRange);
      let f      = onlyInt ? 0 : clamp(nearestIndex(fracCol), 0, 9);
      const iVal = minInt + iIdx;
      if (iVal === maxInt) f = 0;
      return onlyInt ? iVal : +(iVal + f / 10).toFixed(1);
    },

    // Модельное значение (последнее зафиксированное программно/снаппингом)
    getModelValue() { return modelValue; },

    // Выключение/включение
    setDisabled,

    // Полная очистка: снимаем обработчики и таймеры
    destroy() {
      clearTimeout(snapTimer);
      intCol.removeEventListener('scroll', onScrollInt);
      fracCol.removeEventListener('scroll', onScrollFrac);
      if (supportsScrollEnd) {
        intCol.removeEventListener('scrollend', snapNow);
        if (!onlyInt) fracCol.removeEventListener('scrollend', snapNow);
      }
    }
  };

  return api;
}

// Глобальные реестры колёс
const wheels   = {};            // по ключу (weight, height, …) → wheel API
const wheelMap = new WeakMap(); // по DOM-элементу fieldEl → wheel API

/**
 * Гарантирует, что для данного поля уже есть/будет только одно колесо.
 *
 * @param {HTMLElement} fieldEl - контейнер поля
 * @param {object} cfg - конфиг: { key, initial, optional }
 * @returns {object} wheel API
 */
function ensureWheel(fieldEl, cfg) {
  // 1. Если колесо для этого DOM-узла уже было создано — просто возвращаем его
  let w = wheelMap.get(fieldEl);
  if (w) return w;

  // 2. Читаем «отложенные» значения, которые могли прийти из бэка до рендера колеса
  const pend    = (window.__pendingInputs || {});
  const hasPend = Object.prototype.hasOwnProperty.call(pend, cfg.key);
  const pendVal = hasPend ? pend[cfg.key] : undefined;
  const parsed  = numOrNull(pendVal);                         // нормализуем число или null
  const initVal = (parsed != null) ? parsed : cfg.initial;    // если число есть — используем его, иначе дефолт

  // 3. Создаём wheel и регистрируем его
  w = buildWheel(fieldEl, initVal);
  wheelMap.set(fieldEl, w);
  wheels[cfg.key] = w;

  // 4. Если поле опциональное — добавляем/подключаем чекбокс "нет данных"
  if (cfg.optional) {
    let cb = fieldEl.querySelector('#opt_' + cfg.key);

    // Если чекбокса ещё нет в DOM — создаём его
    if (!cb) {
      const opt = document.createElement('div');
      opt.className = 'optline';
      opt.innerHTML = `
        <label style="display:flex;align-items:center;gap:8px;opacity:.95">
          <input type="checkbox" id="opt_${cfg.key}"> нет данных
        </label>`;
      fieldEl.appendChild(opt);
      cb = opt.querySelector('input');
    }

    // Подписываемся на изменение чекбокса (делаем это один раз)
    if (!cb._bound) {
      cb.addEventListener('change', () => { w.setDisabled(cb.checked); }, { passive: true });
      cb._bound = true;
    }

    // Если в pending для этого поля было явно "нет значения" (null),
    // сразу ставим чекбокс и программно отключаем колесо
    if (hasPend && pendVal == null) {
      cb.checked = true;
      w.setDisabled(true, /* programmatic */ true);
    }
  }

  // 5. Если мы успешно применили pending-значение (parsed != null) —
  //    очищаем его, чтобы не переиспользовать.
  if (hasPend && parsed != null) {
    delete pend[cfg.key];
  }

  return w;
}

/* ============================================================
 *  BLOCK B: Fields + render + hard init
 *  Описание полей замеров, генерация HTML и первичная инициализация колёс
 * ============================================================ */

/**
 * Описание всех полей замеров:
 * - key      — внутренний ключ (для бэка, кэша, колёс)
 * - label    — подпись в UI
 * - unit     — единицы измерения (кг, см, % и т.п.)
 * - min/max  — допустимый диапазон ввода
 * - initial  — дефолтное значение до прихода данных из бэка
 * - optional — опциональное поле (появляется чекбокс "нет данных")
 */
const FIELDS = [
  { key:'weight',   label:'Вес',                    unit:'кг', min:40,  max:250, initial:70.0 },
  { key:'height',   label:'Рост',                   unit:'см', min:120, max:230, initial:175.0 },
  { key:'fat',      label:'% жира',                 unit:'%', min:3,   max:60,  initial:18.0, optional:true },
  { key:'neck',     label:'Шея',                    unit:'см', min:20,  max:70,  initial:38 },
  { key:'shoulders',label:'Плечи обхват',           unit:'см', min:60,  max:180, initial:90.0 },
  { key:'chest',    label:'Грудь',                  unit:'см', min:60,  max:160, initial:100 },
  { key:'waist',    label:'Талия',                  unit:'см', min:40,  max:160, initial:70 },
  { key:'bicep_l_rel',  label:'Бицепс левый (расслаб.)', unit:'см', min:15, max:70, initial:31 },
  { key:'bicep_r_rel',  label:'Бицепс правый (расслаб.)', unit:'см', min:15, max:70, initial:31 },
  { key:'bicep_l_flex', label:'Бицепс левый (напряж.)',   unit:'см', min:15, max:70, initial:31 },
  { key:'bicep_r_flex', label:'Бицепс правый (напряж.)',  unit:'см', min:15, max:70, initial:31 },
  { key:'thigh_l',  label:'Бедро левое',            unit:'см', min:30,  max:100, initial:50 },
  { key:'thigh_r',  label:'Бедро правое',           unit:'см', min:30,  max:100, initial:50 },
  { key:'calf_l',   label:'Икра левая',             unit:'см', min:25,  max:70,  initial:35 },
  { key:'calf_r',   label:'Икра правая',            unit:'см', min:25,  max:70,  initial:35 },
  { key:'hips',     label:'Ягодицы',                unit:'см', min:70,  max:160, initial:90 },
  { key:'wrist',    label:'Обхват запястья',        unit:'см', min:10,  max:30,  initial:17 },
  { key:'knee',     label:'Обхват колена',          unit:'см', min:25,  max:60,  initial:36 },
  { key:'ankle',    label:'Обхват лодыжки',         unit:'см', min:15,  max:35,  initial:22 },
];
/**
 * Быстрый доступ к конфигу поля по key:
 *  CFG['weight'] → объект описания поля weight
 */
const CFG = Object.fromEntries(FIELDS.map(f => [f.key, f]));
/**
 * Контейнер для всех полей замеров (см. HTML: <div id="fields"></div>)
 */
const fieldsWrap = document.getElementById('fields');
/**
 * Хеш-таблица "ключ поля → DOM-элемент этого поля"
 *  fieldByKey['waist'] → <div class="field" data-key="waist">...</div>
 */
const fieldByKey = Object.create(null);
/**
 * Глобальный объект для "отложенных" значений (которые пришли с бэка до инициализации колёс).
 * Используется в ensureWheel / buildWheel.
 */
window.__pendingInputs = window.__pendingInputs || {};
/**
 * Генерация HTML-разметки для каждого поля замеров.
 * На каждом шаге:
 *  - создаём <div class="field"> с нужными data-атрибутами;
 *  - вставляем шапку с label + unit;
 *  - вставляем контейнер дуо-колёс (целая и дробная часть);
 *  - добавляем текст-подсказку (help);
 *  - сохраняем ссылку в fieldByKey и добавляем поле в DOM.
 */
for (const cfg of FIELDS) {
  // 1) Корневой контейнер поля
  const f = document.createElement('div');
  f.className   = 'field';
  f.dataset.key = cfg.key;
  f.dataset.min = cfg.min;
  f.dataset.max = cfg.max;
  if (cfg.onlyInt) f.dataset.onlyInt = '1';
  // 2) Основная разметка поля: заголовок + единицы + контейнер для колёс
  f.innerHTML = `
    <div class="row">
      <div class="label">${cfg.label}</div>
      <div class="unit">${cfg.unit}</div>
    </div>
    <div class="duo">
      <div class="col col-int"></div>
      <div class="sep">,</div>
      <div class="col col-frac"></div>
    </div>
  `;
  // 3) Блок подсказки под полем (как вводить: только целые, целые + десятые и т.п.)
  const h  = document.createElement('div');
  h.className = 'help';
  h.textContent = cfg.onlyInt
    ? 'целые годы'
    : (cfg.unit === 'кг'
        ? 'кг: целые и десятые'
        : cfg.unit === 'см'
          ? 'см: целые и десятые (1 десятая = 1 мм)'
          : 'проценты: целые и десятые');
  f.appendChild(h);
  // 4) Добавляем поле в DOM и сохраняем ссылку по key
  fieldsWrap.appendChild(f);
  fieldByKey[cfg.key] = f;
}
/**
 * Жёсткая инициализация всех колёс для всех полей (однократно).
 * - создаёт колёса через ensureWheel();
 * - меряет время инициализации и складывает метрику в window.__wheelsInitMs;
 * - ставит флаг window.__wheelsInitDone, чтобы не инициализировать повторно;
 * - для админа дополнительно пишет метрику "от запуска страницы до инициализации колёс"
 *   в window.__pageLaunchToWheelsInit и обновляет debug UI (updatePerfUI).
 */
function ensureAllWheelsOnce() {
  // Если уже инициализировали — больше ничего не делаем
  if (window.__wheelsInitDone) return;
  // Старт таймера
  const t0 = performance?.now ? performance.now() : Date.now();
  // Пробегаем по всем полям, создаём колесо для каждого
  for (const cfg of FIELDS) {
    const el = fieldByKey[cfg.key];
    if (el) ensureWheel(el, cfg);
  }
  // Конец таймера + округление до 0.1 мс
  const t1 = performance?.now ? performance.now() : Date.now();
  window.__wheelsInitMs   = +(t1 - t0).toFixed(1);
  window.__wheelsInitDone = true;
  // Для админа: метрика "время от старта страницы до готовности колёс"
  if (isAdmin() && typeof window.__pageLaunchToUpdateWheel !== 'number') {
    window.__pageLaunchToWheelsInit = performance.now() - window.__pageLoadTime;
    if (typeof window.updatePerfUI === 'function') window.updatePerfUI();
  }
  // На всякий случай пробуем обновить UI метрик, если такой хук есть глобально
  try { if (typeof updatePerfUI === 'function') updatePerfUI(); } catch (_) {}
}
// Сразу при загрузке страницы инициализируем все колёса
ensureAllWheelsOnce();

/**
 * Публичный хук: принудительная переинициализация всех колёс снаружи (если вдруг потребуется).
 */
window.forceInitAllWheels = ensureAllWheelsOnce;

  
/* ===========================
 * BLOCK C — SAVE (Apps Script)
 * Сохранение замеров в Google Apps Script и ожидание свежих данных
 * Этот блок отвечает за полный цикл «сохранить замеры → дождаться, когда бэкенд всё посчитает → забрать свежие данные»
 * =========================== */

// Endpoint бэкенда (Google Apps Script)
const BACKEND_URL_bm = 'https://script.google.com/macros/s/AKfycbyMqlDnpFYUuOn2MzCw5Zti3yIpKrez6TQM5DdsrbANY6kygy-2a4MLhEBh3FoXtpPmpA/exec';
// Версия фронта — уходит в бэкенд как APP_VERSION для логов и контроля совместимости
const APP_VERSION_bm = 'frontend-2025-01';
// Таймаут HTTP-запроса на сохранение (мс)
const REQUEST_TIMEOUT_MS_bm = 30000;
// Текущий момент времени в ISO-формате (UTC)
function nowIso_bm() { return new Date().toISOString(); }
/**
 * Дата "сегодня" в формате YYYY-MM-DD в заданной таймзоне.
 * Используется, чтобы на бэке видеть локальный день клиента.
 */
function todayLocalISO_bm(tz) {
  try {
    const d = new Date();
    const y  = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:  'numeric' }).format(d);
    const m  = new Intl.DateTimeFormat('en-CA', { timeZone: tz, month: '2-digit' }).format(d);
    const da = new Intl.DateTimeFormat('en-CA', { timeZone: tz, day:   '2-digit' }).format(d);
    return `${y}-${m}-${da}`;
  } catch {
    // Fallback: просто первые 10 символов ISO-строки (YYYY-MM-DD)
    return new Date().toISOString().slice(0, 10);
  }
}
/**
 * Определяет таймзону клиента (например, "Europe/Moscow").
 * Если по какой-то причине недоступно — возвращает 'UTC'.
 */
function clientTZ_bm() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
}
/**
 * Генерация уникального идентификатора сохранения.
 * Нужен, чтобы на бэке однозначно связать запросы и логировать операции.
 */
function genSaveId_bm() { return Date.now() + '_' + Math.random().toString(36).slice(2, 10); }
/**
 * Основная функция сохранения замеров в БД (Google Apps Script).
 * @param {object} values - вся анкета: пол, колёса, прочие поля.
 * @param {string} [saveId] - опциональный заранее сгенерированный ID сохранения.
 * @returns {Promise<{ok:boolean, day_local:string, ts_iso:string, row_all:number, row_calc:number}>}
 */
async function saveMeasurementsToDB_bm(values, saveId) {
  if (!values || typeof values !== 'object') throw new Error('Нет данных для сохранения.');
  const tg       = window.Telegram?.WebApp;
  const tz       = clientTZ_bm();
  const dayLocal = todayLocalISO_bm(tz);
  // Формируем payload для Apps Script
  const payload = {
    action: 'save',
    init_data: String(tg?.initData || ''),                 // сырые initData от Telegram
    tz,
    client_day_local: dayLocal,                            // "сегодня" в локальной таймзоне клиента
    locale: tg?.initDataUnsafe?.user?.language_code || '', // язык пользователя
    source: 'webapp',
    APP_VERSION: APP_VERSION_bm,
    t_client: nowIso_bm(),                                 // timestamp на клиенте
    save_id: saveId || genSaveId_bm(),                     // уникальный ID сохранения
    data: values                                           // ← тут ВСЯ АНКЕТА (колёса + все выборы)
  };
  // Готовим AbortController для ручного таймаута
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS_bm);
  let resp, raw, json = null;
  try {
    // Отправляем POST-запрос
    resp = await fetch(BACKEND_URL_bm, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, // simple request, без preflight
      body: JSON.stringify(payload),
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors',
      signal: controller.signal
    });
    // Читаем тело как текст и пробуем распарсить JSON
    raw = await resp.text();
    try { json = raw ? JSON.parse(raw) : null; } catch {}
  } catch (err) {
    // Превращаем AbortError в "сервер не ответил вовремя" с кодом 408
    if (err && err.name === 'AbortError') { const e = new Error('Сервер не ответил вовремя'); e.code = 408; throw e; }
    throw err;
  } finally {
    clearTimeout(t);
  }
  // Определяем, что нас зарейт-лимитили (слишком частые запросы)
  const isRateLimited =
    resp?.status === 429 ||
    (json && (json.code === 429 || json.status === 429)) ||
    /(?:too\s*many\s*requests|rate[-_\s]*limit|429|слишком\s+часто)/i.test(String(json?.error || resp?.statusText || ''));
  // Проверка на успешность ответа и наличие json.ok === true
  if (!resp?.ok || !json || json.ok !== true) {
    const msg = (json && json.error)
      ? json.error
      : `HTTP ${resp?.status ?? '0'} ${resp?.statusText ?? ''}`.trim();
    // Специальная обработка rate limit (429)
    if (isRateLimited) {
      const e = new Error('Too many requests');
      e.code = 429;
      throw e;
    }
    // Специальная обработка таймаутов и сетевых проблем
    if (msg === 'timeout' || /timeout|network/i.test(String(msg))) {
      const e = new Error('Сервер не ответил вовремя');
      e.code = 408;
      throw e;
    }
    // Общий случай ошибки
    const e = new Error(msg || 'Save failed');
    e.code = resp?.status ?? 0;
    throw e;
  }
  // Нормализуем интересующие поля ответа
  return {
    ok: true,
    day_local: json.day_local,
    ts_iso:    json.ts_iso,
    row_all:   Number(json.row_all),
    row_calc:  Number(json.row_calc)
  };
}
/**
 * Безопасный пост-чек факта существования записи пользователя.
 * Используется после таймаута save-запроса: мы проверяем, не сохранились ли данные на бэке всё-таки.
 * @returns {Promise<object|null>} raw json от бэка или null, если ошибка/не ok
 */
async function fetchUserRow_bm() {
  const tg = window.Telegram?.WebApp;
  try {
    const resp = await fetch(BACKEND_URL_bm, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ action: 'user_row', init_data: String(tg?.initData || '') }),
      cache: 'no-store',
      credentials: 'omit',
      mode: 'cors'
    });
    const raw  = await resp.text();
    const json = raw ? JSON.parse(raw) : null;
    if (!resp.ok || !json || json.ok !== true) return null;
    return json;
  } catch {
    return null;
  }
}
/**
 * Подтверждение факта сохранения после таймаута основного запроса.
 * @param {number} prevRowCalc - номер последней "расчётной" строки до сохранения
 * @returns {Promise<number|null>} новый row_calc, если он изменился, иначе null
 */
async function confirmSavedAfterTimeout_bm(prevRowCalc) {
  const row = await fetchUserRow_bm().catch(() => null);
  if (
    row &&
    row.found &&
    Number(row.row_calc) &&
    Number(row.row_calc) !== Number(prevRowCalc || 0)
  ) {
    return Number(row.row_calc);
  }
  return null;
}
/**
 * Ожидаем, пока новые данные (front + macros + chart) появятся на сервере.
 * Работает в две фазы:
 *  - Фаза A (быстрая): короткий интервал опроса (200 мс), ограничение по времени fastMs.
 *  - Фаза B (медленная): более редкий опрос (750 мс), но дольше (slowMs).
 * Условия выхода:
 *  - все части готовы (front.ready, macros.ready, chart.ready), ИЛИ
 *  - номер строки b.row совпадает с rowCalcAfterSave (бэк сигнализирует, что данные консистентны).
 * @param {number} rowCalcAfterSave - row_calc, который вернул saveMeasurementsToDB_bm
 * @param {number} [fastMs=10000]   - длительность быстрой фазы, мс
 * @param {number} [slowMs=60000]   - длительность медленной фазы, мс
 * @returns {Promise<object|null>} bootstrap-ответ или null при истечении обоих таймаутов
 */
async function waitForFreshData_bm(rowCalcAfterSave, fastMs = 20000, slowMs = 60000) {
  // Unified API для фронта: сначала пробуем window.apiFrontBootstrap_bm_bm_eai_bm,
  // если его нет — глобальную функцию apiFrontBootstrap_bm_eai_bm.
  const api = (window && typeof window.apiFrontBootstrap_bm_bm_eai_bm === 'function')
    ? window.apiFrontBootstrap_bm_bm_eai_bm
    : (typeof apiFrontBootstrap_bm_eai_bm === 'function' ? apiFrontBootstrap_bm_eai_bm : null);
  if (!api) return null;
  let seenFront  = false;
  let seenMacros = false;
  let seenChart  = false;
  const t0 = Date.now();
  // --- Фаза A — быстрая: пытаемся быстро поймать готовность данных
  while (Date.now() - t0 < fastMs) {
    try {
      const b = await api(rowCalcAfterSave);
      const sameRow = Number(b?.row) === Number(rowCalcAfterSave);
      if (b?.front)  seenFront  = seenFront  || !!(b.front.ready  || b.front.html);
      if (b?.macros) seenMacros = seenMacros || !!b.macros.ready;
      if (b?.chart)  seenChart  = seenChart  || !!b.chart.ready;
      if ((seenFront && seenMacros && seenChart) || sameRow) return b;
    } catch (_) {}
    await new Promise(res => setTimeout(res, 200));
  }
  // --- Фаза B — медленная: продолжаем ждать, но опрашиваем реже
  const t1 = Date.now();
  while (Date.now() - t1 < slowMs) {
    try {
      const b = await api(rowCalcAfterSave);
      const sameRow   = Number(b?.row) === Number(rowCalcAfterSave);
      const allReady  = !!(b?.front?.ready) && !!(b?.macros?.ready) && !!(b?.chart?.ready);
      if (allReady || sameRow) return b;
    } catch (_) {}
    await new Promise(res => setTimeout(res, 750));
  }
  // Если и после медленной фазы ничего — отдаём null, UI сам решит, что делать дальше.
  return null;
}

/* ============================================================
 *  BLOCK D — Кулдаун, попапы, сохранение/ «жизненный цикл» кнопки «Сохранить»
 * ============================================================ */

/** Флаг: прямо сейчас идёт сохранение (не даём стартовать второе параллельно) */
var SAVE_IN_PROGRESS = false;
/** Базовый кулдаун между сохранениями: 60 000 мс = 60 секунд */
var COOLDOWN_MS_bm = 60000;
/** Ключ в localStorage, где хранится время следующей «разблокировки» кнопки */
var COOLDOWN_KEY = 'bm:save_unlock_time';
/** Читаем из localStorage время, когда можно снова сохранять (0, если ничего нет) */
function getUnlockTime_bm() {
  try { return Number(localStorage.getItem(COOLDOWN_KEY)) || 0; }
  catch(_) { return 0; }
}
/** Записываем в localStorage новое время разблокировки (timestamp в мс) */
function setUnlockTime_bm(time) {
  try { localStorage.setItem(COOLDOWN_KEY, String(time)); } catch(_){}
}
/**
 * Можно ли сейчас запускать сохранение?
 * - если SAVE_IN_PROGRESS === true → нельзя.
 * - если текущее время меньше, чем unlock_time → нельзя.
 */
function canSaveNow_bm() {
  if (SAVE_IN_PROGRESS) return false;
  var now = Date.now();
  return !(getUnlockTime_bm() > now);
}
/* ===== row_calc для пользователя (номер строки в базе) ===== */
var ROWCALC_KEY_PREFIX = 'bm:macros:last_row_calc:';
/** ID текущего пользователя из Telegram (или 'anon', если нет) */
function currentUserId_bm() {
  try { return window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 'anon'; }
  catch(_) { return 'anon'; }
}
/** Ключ для localStorage с row_calc для конкретного пользователя */
function rowCalcKey_bm(uid) { return ROWCALC_KEY_PREFIX + String(uid); }
/**
 * Сохраняем row_calc для пользователя:
 * - сначала в localStorage, если не получилось — в sessionStorage;
 * - дублируем в in-memory-объект window.__rowCalcByUid.
 */
function setRowCalcForUser_bm(rowCalc, uid) {
  if (typeof uid === 'undefined') uid = currentUserId_bm();
  try { localStorage.setItem(rowCalcKey_bm(uid), String(rowCalc)); }
  catch(_) { try { sessionStorage.setItem(rowCalcKey_bm(uid), String(rowCalc)); } catch(_){ } }
  if (!window.__rowCalcByUid) window.__rowCalcByUid = {};
  window.__rowCalcByUid[String(uid)] = Number(rowCalc);
}
/**
 * Читаем row_calc для пользователя.
 * - сначала из in-memory-объекта window.__rowCalcByUid;
 * - если там нет — из localStorage/sessionStorage и кэшируем в память.
 */
function getRowCalcForUser_bm(uid) {
  if (typeof uid === 'undefined') uid = currentUserId_bm();
  if (window.__rowCalcByUid && (String(uid) in window.__rowCalcByUid)) {
    return window.__rowCalcByUid[String(uid)];
  }
  var v = null; 
  try { v = localStorage.getItem(rowCalcKey_bm(uid)); } 
  catch(_) { try { v = sessionStorage.getItem(rowCalcKey_bm(uid)); } catch(_){ } }
  var n = (v == null) ? null : Number(v);
  if (!window.__rowCalcByUid) window.__rowCalcByUid = {};
  window.__rowCalcByUid[String(uid)] = isNaN(n) ? null : n;
  return window.__rowCalcByUid[String(uid)];
}
// Публичные хелперы в window (используются в других частях фронта)
window.getRowCalcForUser_bm_bm = getRowCalcForUser_bm;
window.setRowCalcForUser_bm_bm = setRowCalcForUser_bm;
/* ===== время последнего замера для пользователя ===== */
var LASTTIME_KEY_PREFIX = 'bm:macros:last_measurement_time:';
function lastTimeKey_bm(uid) { return LASTTIME_KEY_PREFIX + String(uid); }
/**
 * Сохраняем timestamp последнего замера для конкретного пользователя
 * (localStorage либо sessionStorage) и сразу обновляем надпись «Последний замер».
 */
function setLastMeasurementTime_bm(timestamp, uid) {
  if (typeof uid === 'undefined') uid = currentUserId_bm();
  try { localStorage.setItem(lastTimeKey_bm(uid), String(timestamp)); } 
  catch(_) { try { sessionStorage.setItem(lastTimeKey_bm(uid), String(timestamp)); } catch(_){ } }
  if (!window.__lastTimeByUid) window.__lastTimeByUid = {};
  window.__lastTimeByUid[String(uid)] = Number(timestamp);
  updateLastTimeDisplay(timestamp);
}
/**
 * Читаем timestamp последнего замера для пользователя.
 */
function getLastMeasurementTime_bm(uid) {
  if (typeof uid === 'undefined') uid = currentUserId_bm();
  if (window.__lastTimeByUid && (String(uid) in window.__lastTimeByUid)) {
    return window.__lastTimeByUid[String(uid)];
  }
  var v = null; 
  try { v = localStorage.getItem(lastTimeKey_bm(uid)); } 
  catch(_) { try { v = sessionStorage.getItem(lastTimeKey_bm(uid)); } catch(_){ } }
  var n = (v == null) ? null : Number(v);
  if (!window.__lastTimeByUid) window.__lastTimeByUid = {};
  window.__lastTimeByUid[String(uid)] = isNaN(n) ? null : n;

  return window.__lastTimeByUid[String(uid)];
}
/**
 * Обновляем текст в DOM: «Последний замер: ...»
 */
function updateLastTimeDisplay(timestamp) {
  var el = document.getElementById('lastTime');
  if (!el) return;
  if (!timestamp) {
    el.textContent = 'Последний замер: нет данных';
    return;
  }
  var date = new Date(timestamp);
  var dateStr = date.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' });
  var timeStr = date.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
  el.textContent = 'Последний замер: ' + dateStr + ' ' + timeStr;
}
window.setLastMeasurementTime_bm_bm = setLastMeasurementTime_bm;
window.getLastMeasurementTime_bm_bm = getLastMeasurementTime_bm;
/* ===== Row lock: держим целевой row после сохранения, чтобы не откатываться на старые данные ===== */
/** Целевой row_calc и срок жизни этого lock’а */
var __desiredRow = null, __desiredRowUntil = 0;
/** Залочить «желаемый» row_calc на ms миллисекунд */
function lockDesiredRow(row, ms) {
  __desiredRow = Number(row) || null;
  __desiredRowUntil = Date.now() + (ms || 60000);
}
/** Получить текущий залоченный row (или null, если срок истёк) */
function desiredRow() {
  return (Date.now() < __desiredRowUntil) ? __desiredRow : null;
}
/* ===== UI утилиты для кнопки, попапов и скролла ===== */
function getSaveBtn() { return document.getElementById('saveBtn'); }
/**
 * Переводим кнопку «Сохранить» в состояние загрузки и обратно.
 * Меняем:
 *  - класс .loading;
 *  - aria-busy;
 *  - показываем/прячем спиннер;
 *  - текст: «Сохранить» / «Обработка…».
 */
function setSavingState(isSaving) {
  var btn = getSaveBtn(); 
  if (!btn) return;
  var label = btn.querySelector('.btn-label');
  var sp    = btn.querySelector('.spinner');
  btn.classList.toggle('loading', !!isSaving);
  btn.setAttribute('aria-busy', String(!!isSaving));
  if (sp)    sp.hidden = !isSaving;
  if (label) label.textContent = isSaving ? 'Обработка…' : 'Сохранить';
}
/**
 * Показ попапа:
 * - через Telegram WebApp.showPopup, если доступен;
 * - иначе стандартный alert.
 * Опционально даём хаптик (haptic: 'success' | 'error' | 'warning').
 */
function showPopup(title, message, haptic) {
  var tg = window.Telegram?.WebApp;
  if (haptic && tg?.HapticFeedback?.notificationOccurred) {
    try { tg.HapticFeedback.notificationOccurred(haptic); } catch(_){ }
  }
  if (tg?.showPopup) {
    tg.showPopup({ title, message, buttons: [{ type: 'ok' }] });
  } else {
    alert(title + '\n\n' + message);
  }
}
/**
 * Аккуратно сворачиваем аккордеон «Анкета» (sec-measures),
 * делаем это через double requestAnimationFrame, чтобы избежать визуальных дёрганий.
 */
function collapseAccordionSafe() {
  var act = function() {
    try {
      var section = document.getElementById('sec-measures');
      if (section) {
        section.classList.add('collapsed');
        section.setAttribute('aria-hidden', 'true');
      }
      document.querySelectorAll('[data-toggle="sec-measures"]').forEach(function(h) {
        h.setAttribute('aria-expanded', 'false');
      });
    } catch(_){}
  };
  try { requestAnimationFrame(function(){ requestAnimationFrame(act); }); }
  catch(_) { act(); }
}
/**
 * Скроллим страницу к самому верху без плавной анимации,
 * предварительно убираем фокус с активного элемента, чтобы не прыгали клавиатуры/подсветки.
 */
function scrollTopNoJump() {
  try { document.activeElement?.blur?.(); } catch(_){}
  try {
    const html  = document.documentElement;
    const body  = document.body;
    const prev  = html.style.scrollBehavior;
    html.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    html.scrollTop = 0;
    body.scrollTop = 0;
    html.style.scrollBehavior = prev || '';
  } catch(_){}
}
/* === СБОР КОЛЁС === */
/**
 * Собираем значения всех колёс из FIELDS.
 * Для опциональных полей:
 *  - если чекбокс "нет данных" включён → кладём null
 *  - иначе берём текущий value колеса.
 */
function collectWheelValues() {
  var out = {};
  for (var i = 0; i < FIELDS.length; i++) {
    var cfg     = FIELDS[i];
    var fieldEl = fieldByKey[cfg.key];
    var w       = (wheels[cfg.key] || ensureWheel(fieldEl, cfg));
    var cb      = fieldEl ? fieldEl.querySelector('#opt_' + cfg.key) : null;
    out[cfg.key] = (cfg.optional && cb && cb.checked) ? null : w.value;
  }
  // if (typeof out.age === 'number') out.age = Math.round(out.age); // пример старой логики
  return out;
}
/* === СБОР АНКЕТЫ (селекторы) === */
/**
 * Сейчас фактически собирает только gender.
 * Структура single/multiple оставлена на будущее/совместимость.
 */
function collectSurveyValues() {
  const out = {};
  // Хелпер: скрыт ли узел/поле (display:none / visibility:hidden)
  const isHidden = (node) => {
    if (!node) return true;
    const field = node.closest?.('.field') || node;
    const cs    = field && getComputedStyle(field);
    return !field || cs.display === 'none' || cs.visibility === 'hidden';
  };
  // Пол (gender) — активная .binary-btn с data-field="gender"
  const g = document.querySelector('.binary-btn.active[data-field="gender"]');
  out.gender = g ? g.dataset.value : null;
  // Шаблоны для возможных single/multiple выборов (сейчас не используются)
  const single = (field) => {
    const list = document.querySelector(`.choice-list[data-type="single"][data-field="${field}"]`);
    if (!list || isHidden(list)) return null;
    const sel = list.querySelector('.choice-item.selected');
    return sel ? sel.dataset.value : null;
  };
  const multiple = (field) => {
    const list = document.querySelector(`.choice-list[data-type="multiple"][data-field="${field}"]`);
    if (!list || isHidden(list)) return null;
    const vals = [...list.querySelectorAll('.choice-item.selected')].map(i => i.dataset.value);
    if (!vals.length) return null;
    if (vals.includes('none')) return ['none'];
    return vals;
  };
  return out;
}
/* === CACHE: inputs (анкета целиком) === */
const INPUTS_KEY_PREFIX = 'bm:inputs:vals:';
// Подстраховка: если где-то currentUserId_bm не определён, определяем здесь
if (typeof currentUserId_bm !== 'function') {
  function currentUserId_bm() {
    try { return window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 'anon'; }
    catch(_) { return 'anon'; }
  }
}
/** Ключ для кэша анкеты по пользователю */
function inputsKey_bm(uid) { return INPUTS_KEY_PREFIX + String(uid ?? currentUserId_bm()); }
/** Сохраняем кэш анкеты (row, inputs, updated_at) в localStorage */
function saveInputsCache_bm(obj, uid) {
  try { localStorage.setItem(inputsKey_bm(uid), JSON.stringify(obj)); } catch(_){}
}
/** Читаем кэш анкеты из localStorage */
function loadInputsCache_bm(uid) {
  try {
    const raw = localStorage.getItem(inputsKey_bm(uid));
    return raw ? JSON.parse(raw) : null;
  } catch(_) {
    return null;
  }
}
/* ===== ВАЛИДАЦИЯ формы ===== */
/**
 * Валидна ли форма?
 * - вес заполнен и не 0;
 * - рост заполнен и не 0;
 * - пол выбран.
 */
function isFormValid() {
  try {
    const wheelsVals = collectWheelValues();   // все колёса (с учётом optional → null)
    const survey     = collectSurveyValues();  // сейчас фактически только gender
    // 1. Проверяем пол
    if (!survey.gender) return false;
    // 2. Проверяем все поля из FIELDS
    for (let i = 0; i < FIELDS.length; i++) {
      const cfg     = FIELDS[i];
      const key     = cfg.key;
      const value   = wheelsVals[key];
      const fieldEl = fieldByKey[key];
      const cb      = fieldEl ? fieldEl.querySelector('#opt_' + key) : null;
      const hasNone = cfg.optional && cb && cb.checked; // пользователь явно выбрал "нет данных"
      // a) Если поле опциональное и пользователь нажал "нет данных" → считаем валидным
      if (hasNone) continue;
      // b) Во всех остальных случаях значение обязательно:
      //    - не null/undefined
      //    - не 0 (в твоих диапазонах min>0, так что 0 = "не выставлено")
      if (value == null || value === 0) return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}
/**
 * Обновляем состояние кнопки «Сохранить»:
 * - disabled + класс .disabled;
 * - курсор not-allowed / pointer.
 */
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
/**
 * Настройка авто-валидации:
 * - первый запуск через 100 мс после загрузки;
 * - обновление по событию 'wheelchange';
 * - обновление по клику на бинарный пол или choice-item;
 * - периодический пересчёт каждые 1 секунду на всякий случай.
 */
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
  setInterval(updateSaveButton, 1000);
})();
/* === КНОПКА СОХРАНЕНИЯ: сохраняем весь пакет === */
function handleSaveClick_bm(e) {
  if (e && e.preventDefault) { try { e.preventDefault(); } catch(_){ } }
  // 1) Проверка кулдауна / параллельного сохранения
  if (!canSaveNow_bm()) {
    showPopup('Too many requests', 'Не нужно так часто нажимать эту кнопку', 'error');
    return;
  }
  // 2) Проверка валидации
  if (!isFormValid()) {
    const tg = window.Telegram?.WebApp;
    try { tg?.HapticFeedback?.notificationOccurred?.('error'); } catch(_){}
    showPopup('Не все поля заполнены', 'Заполните все обязательные поля анкеты.', 'error');
    return;
  }
  const tg = window.Telegram?.WebApp;
  const prevRowCalc = getRowCalcForUser_bm();
  
  // 🔒 FIX: Для новых пользователей (prevRowCalc == null) не лочим "row 1", 
  // чтобы не блокировать отображение, если бэк вернет NO_ROW во время сохранения.
  // Лочим только если у нас реально был предыдущий row.
  if (prevRowCalc) {
      const minNewRow = (Number(prevRowCalc) || 0) + 1;
      try { lockDesiredRow(minNewRow, 60000); } catch(_){}
  }

  const saveId = genSaveId_bm();
  // 3) Флаг процесса сохранения + кулдаун + UI
  SAVE_IN_PROGRESS = true;
  setUnlockTime_bm(Date.now() + COOLDOWN_MS_bm);
  setSavingState(true);
  try { tg?.HapticFeedback?.impactOccurred?.('light'); } catch(_){}
  // 4) Собираем все значения: анкета + колёса
  const values = { ...collectSurveyValues(), ...collectWheelValues() };

    // 5) Сбрасываем кэш макросов, графика и AI-комментария
  try {
    const uid = (typeof currentUserId_bm === 'function') ? currentUserId_bm() : 'anon';
    localStorage.removeItem('bm:macros:vals:'  + String(uid));
    localStorage.removeItem('bm:chart:data:'   + String(uid));
    localStorage.removeItem('bm:comment:html:' + String(uid));
    localStorage.removeItem('bm:chart_weight:data:' + String(uid));
   
  } catch(_){}

  // 👉 после сохранения анкеты забываем выбранную дату — следующий график станет на последнюю
  try {
    window._pf_active_date = null;
  } catch(_){}

  // 6) Запускаем запрос на сохранение
  const saveTask = saveMeasurementsToDB_bm(values, saveId);

  
  // 7) UI: сворачиваем анкету, скроллим вверх
  collapseAccordionSafe();
  requestAnimationFrame(() => requestAnimationFrame(scrollTopNoJump));
  
  // 8) Запускаем потоки обновления фронта (AI, макросы, график)
  // FIX: Задержка чуть больше, чтобы дать saveTask шанс выполниться
  setTimeout(() => {
    try { startFrontDataFlow_bm(); } catch(_){}
    try { window.startFrontDataFlow_bm_bm(); } catch(_){}
    try { window.startMacrosFlow_bm_bm(); } catch(_){}
    try { window.startChartDataFlow_bm_bm && window.startChartDataFlow_bm_bm(); } catch(_){}
    try { window.startChartFlow_bm_bm(); } catch(_){}
    try { window.startWeightChartFlow_bm_bm(); } catch(_){}
    try { window.startWeightChartDataFlow_bm_bm && window.startWeightChartDataFlow_bm_bm(); } catch(_){} // ⬅️ ДОБАВЬ
  }, 50);

  // 9) Мгновенная обратная связь пользователю
  try { tg?.HapticFeedback?.notificationOccurred?.('success'); } catch(_){}
  showPopup('Готово', 'Данные отправлены. Обновляем…', 'success');
  
  // 10) Обработка успешного сохранения
  saveTask
    .then(async (res) => {
      const rowCalc = Number(res?.row_calc);
      if (Number.isFinite(rowCalc)) setRowCalcForUser_bm(rowCalc);
      const ts = res?.ts_iso ? Date.parse(res.ts_iso) : Date.now();
      setLastMeasurementTime_bm(ts);
      
      // 🔒 Перелочим уже на фактический row (ещё на 10 секунд)
      try { lockDesiredRow(Number(rowCalc), 10000); } catch(_){}
      
      // Обновляем макросы и график
      try { window.startMacrosFlow_bm_bm(); } catch(_){}
      try { window.startChartFlow_bm_bm(); } catch(_){}
      try { window.startWeightChartFlow_bm_bm(); } catch(_){} 
      // Кэшируем введённые данные анкеты
      try {
        const uid = (typeof currentUserId_bm === 'function') ? currentUserId_bm() : 'anon';
        saveInputsCache_bm(
          { row: rowCalc || null, inputs: values, updated_at: new Date().toISOString() },
          uid
        );
      } catch(_){}
      
      // Ждём, пока свежие данные для графика точно доедут (fast=20с, slow=60с по умолчанию)
      waitForFreshData_bm(rowCalc)
      .then(b => {
        if (b && b.chart && b.chart.ready && b.chart.data) {
          const uid = (typeof currentUserId_bm === 'function') ? currentUserId_bm() : 'anon';
          const chartRow = Number(b.chart.row || b.row || 0);

          // ✅ НЕ кладём в кэш график, если он старее только что сохранённого rowCalc
          if (rowCalc && chartRow && chartRow < Number(rowCalc)) {
            console.log('⚠️ Chart: получили старый row из waitForFreshData, игнорируем', { chartRow, rowCalc });
            return;
          }
          const seed = { 
            row: chartRow || null, 
            data: b.chart.data, 
            updated_at: b.chart.updated_at 
          };
          localStorage.setItem('bm:chart:data:' + uid, JSON.stringify(seed));
          console.log('✅ Chart: данные сохранены после waitForFreshData');
          try { window.startChartFlow_bm_bm(); } catch(_){}
        }
      })
      .catch(()=>{});
    })

    // 11) Обработка ошибок сохранения (PRODUCTION)
    .catch(async (err) => {
      const msg = String((err && err.message) || err || '');
      
      // --- Таймаут / сетевые проблемы (код 408 или текст timeout) ---
      if ((err && err.code === 408) || /timeout|network/i.test(msg)) {
        // Пробуем понять, не сохранил ли бэк всё-таки данные, пока мы отвалились
        const confirmed = await confirmSavedAfterTimeout_bm(prevRowCalc).catch(() => null);
        
        if (confirmed != null) {
          // УРА! Сервер всё-таки сохранил данные. Восстанавливаемся.
          setRowCalcForUser_bm(Number(confirmed));
          setLastMeasurementTime_bm(Date.now());
          setUnlockTime_bm(Date.now() + 4000);
          
          // 🔒 Лочим на подтвержденный row
          try { lockDesiredRow(Number(confirmed), 10000); } catch(_){}
          
          // Запускаем обновление интерфейса
          try { window.startMacrosFlow_bm_bm(); } catch(_){}
          try { window.startChartFlow_bm_bm(); } catch(_){}
          
          // Пытаемся подтянуть график (восстановление)
          waitForFreshData_bm(confirmed, 20000, 60000)
            .then(b => {
              if (b && b.chart && b.chart.ready && b.chart.data) {
                const uid = (typeof currentUserId_bm === 'function') ? currentUserId_bm() : 'anon';
                const chartRow = Number(b.chart.row || b.row || 0);

                // Защита от старых данных
                if (confirmed && chartRow && chartRow < Number(confirmed)) return;

                const seed = { 
                  row: chartRow || null, 
                  data: b.chart.data, 
                  updated_at: b.chart.updated_at 
                };
                localStorage.setItem('bm:chart:data:' + uid, JSON.stringify(seed));
                try { window.startChartFlow_bm_bm(); } catch(_){}
              }
            })
            .catch(()=>{});

          return; // Успешно восстановились, ошибку не показываем
        }
        
        // Если подтвердить сохранение не удалось — тогда уже ошибка
        setUnlockTime_bm(Date.now() + 2000);
        showPopup('Не подтверждено', 'Сервер не успел ответить. Проверьте «Последний замер».', 'error');
        try { startFrontDataFlow_bm(); } catch(_){}
        return;
      }
      
      // --- Rate limit (слишком часто жмут кнопку) ---
      if ((err && err.code === 429) || /too\s*many\s*requests|rate[-_\s]*limit|слишком\s+часто|429/i.test(msg)) {
        setUnlockTime_bm(Date.now() + 4000);
        showPopup('Too many requests', 'Не нужно так часто нажимать эту кнопку', 'error');
        return;
      }
      
      // --- Любая другая ошибка ---
      setUnlockTime_bm(Date.now() + 2000);
      showPopup('Не сохранено', 'Произошла ошибка при сохранении. Попробуйте позже.', 'error');
    })
    
    // 12) В любом случае после then/catch возвращаем кнопку и флаг в норму
    .finally(() => {
      setSavingState(false);
      SAVE_IN_PROGRESS = false;
    });
}
/**
 * Подвязываем обработчик клика к кнопке сохранения.
 * Через cloneNode(true) сбрасываем старые обработчики, чтобы не было дублей.
 */
(function bindSave() {
  var btn = document.getElementById('saveBtn');
  if (!btn) return;
  var newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', handleSaveClick_bm, false);
  
})();

/* ============================================================
 *  BLOCK E: Front data flow (inputs + macros/chart bootstrap)
 *  ВНИМАНИЕ: AI-комментарий теперь обслуживается BLOCK EAI.
 *  Ниже legacy-код для AI закомментирован, чтобы не мешаться.
 * ============================================================ */
(function frontDataFlowInit(){
  const tg = window.Telegram?.WebApp;
  const BACKEND = (typeof BACKEND_URL_bm !== 'undefined' && BACKEND_URL_bm) ? BACKEND_URL_bm : '';

  // const elAI = ()=>document.getElementById('ai-comment'); // LEGACY (AI)
  const elAnalytics = ()=>document.getElementById('analytics');

  // LEGACY (AI) — теперь AI-статусы и рендер делает BLOCK EAI
  // function setAIStatus(text){
  //   const host = elAI(); if (!host) return;
  //   host.innerHTML = `<div class="field"><div class="help">${text}</div></div>`;
  // }

  function setAnalyticsPlaceholder(){
    const host = elAnalytics(); if (!host) return;
    host.innerHTML = `<div class="field"><div class="help">После сохранения появятся показатели</div></div>`;
  }

  // === 0) API: единый бутстрап-пакет (ИСПОЛЬЗУЕТСЯ BLOCK C, D, EAI) ===
  async function apiFrontBootstrap_bm_eai_bm(requestedRow){
    const payload = {
      action: 'front_bootstrap',
      init_data: String(tg?.initData || ''),
      row: Number(requestedRow || 0) || undefined
    }
    // Экспортируем глобальный API для waitForFreshData_bm и других блоков
    window.apiFrontBootstrap_bm_bm_eai_bm = apiFrontBootstrap_bm_eai_bm;

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
  window.apiFrontBootstrap_bm_bm_eai_bm = apiFrontBootstrap_bm_eai_bm;

  // LEGACY AI: старый endpoint front_wait больше не используется (заменён на BLOCK EAI)
  // async function apiFrontWait_bm(timeoutSec){
  //   const payload = {
  //     action:'front_wait',
  //     init_data:String(tg?.initData || ''),
  //     timeout_sec: Math.max(0, Math.min(25, Number(timeoutSec)||25))
  //   };
  //   const t0 = performance?.now ? performance.now() : Date.now();
  //   const resp = await fetch(BACKEND, {
  //     method:'POST',
  //     headers:{'Content-Type':'text/plain;charset=UTF-8'},
  //     body:JSON.stringify(payload),
  //     cache:'no-store', credentials:'omit', mode:'cors'
  //   });
  //   const raw = await resp.text();
  //   let json = null; try{ json = raw ? JSON.parse(raw) : null; }catch(_){}
  //   const t1 = performance?.now ? performance.now() : Date.now();
  //   window.__frontWaitLastMs = +(t1 - t0).toFixed(1);
  //   try { updatePerfUI && updatePerfUI(); } catch(_){}
  //   if (!resp.ok || !json) throw new Error(`HTTP ${resp.status}`);
  //   return json;
  // }

  // === Последние вводы пользователя (анкета) ===
  async function apiLastInputs_bm(){
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

  // LEGACY AI: отрисовка комментария теперь живёт в BLOCK EAI
  // function renderAIComment(html){
  //   if (isAdmin() && typeof window.__pageLaunchToUpdateComment !== 'number') {
  //     window.__pageLaunchToUpdateComment = performance.now() - window.__pageLoadTime;
  //     if (typeof window.updatePerfUI === 'function') window.updatePerfUI();
  //   }
  //   const host = elAI(); if (!host) return;
  //   host.innerHTML = html
  //     ? `<div class="field">${html}</div>`
  //     : `<div class="field"><div class="help">Комментарий пока не готов…</div></div>`;
  // }

  // === Применение inputs к колёсам ===
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

      const target = v; // возраста больше нет — прямое значение
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

  // === Применение inputs к анкете (gender и future single/multiple) ===
  function applyInputsToSurvey(inputs){
    if (!inputs || typeof inputs !== 'object') return;

    if (typeof inputs.gender === 'string'){
      document.querySelectorAll('.binary-btn[data-field="gender"]').forEach(b=>{
        const on = b.dataset.value === inputs.gender;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true':'false');
      });
    }

    // Зарезервировано под future single/multiple поля
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

    try { updateCycleVisibility(); updateBodyCompVisibility(); } catch(_){}
  }

  // LEGACY AI polling — заменён на BLOCK EAI
  // let _pollTimer = 0;
  // async function pollOnce(){
  //   try{
  //     const res = await apiFrontWait_bm(25);
  //     if (res?.ready){
  //       renderAIComment(res.html || '');
  //       try {
  //         fetch(BACKEND, {
  //           method:'POST',
  //           headers:{'Content-Type':'text/plain;charset=UTF-8'},
  //           body: JSON.stringify({ action:'front_ack', init_data:String(tg?.initData || '') }),
  //           cache:'no-store', credentials:'omit', mode:'cors'
  //         }).catch(()=>{});
  //       } catch(_){}
  //       return {done:true};
  //     }
  //     setAIStatus('Обрабатываем… (ждём комментарий)');
  //     const wait = Math.max(300, Math.min(2000, Number(res?.retry_after_ms) || 1000));
  //     return {done:false, wait};
  //   } catch(_){
  //     setAIStatus('Не удалось загрузить данные. Попробуйте позже.');
  //     return {done:false, wait:1500};
  //   }
  // }
  // async function pollLoop(){
  //   clearTimeout(_pollTimer);
  //   const r = await pollOnce();
  //   if (r.done) return;
  //   _pollTimer = setTimeout(()=>pollLoop(), r.wait);
  // }
  // window.startFrontDataFlow_bm_bm = function(){ pollLoop(); };

  // Инициализация плейсхолдера аналитики (графики)
  // setAIStatus('Ждём данные…'); // AI теперь делает BLOCK EAI
  setAnalyticsPlaceholder();

  (async function bootstrapThenHydrate(){
    try {
      const seed = (typeof loadInputsCache_bm === 'function') ? loadInputsCache_bm() : null;
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
        : ((typeof getRowCalcForUser_bm === 'function') ? getRowCalcForUser_bm() : null);

    try{
      const b = await apiFrontBootstrap_bm_eai_bm(reqRow);
      if (!b || b.ok !== true) throw new Error('bootstrap_failed');

      if (b.row) { try { setRowCalcForUser_bm(b.row); } catch(_){ } }

      // INPUTS
      if (b.inputs && b.inputs.found && b.inputs.inputs){
        applyInputsToWheels(b.inputs.inputs);
        applyInputsToSurvey(b.inputs.inputs);
        try {
          const uid = (typeof currentUserId_bm === 'function') ? currentUserId_bm() : 'anon';
          saveInputsCache_bm({ row: b.row || null, inputs: b.inputs.inputs, updated_at: b.updated_at || new Date().toISOString() }, uid);
        } catch(_){}
      } else {
        try{
          const r = await apiLastInputs_bm();
          if (r && r.found && r.inputs){
            applyInputsToWheels(r.inputs);
            applyInputsToSurvey(r.inputs);
            try {
              const uid = (typeof currentUserId_bm === 'function') ? currentUserId_bm() : 'anon';
              saveInputsCache_bm({ row: b?.row || null, inputs: r.inputs, updated_at: new Date().toISOString() }, uid);
            } catch(_){}
          } else {
            ensureAllWheelsOnce();
          }
        } catch { ensureAllWheelsOnce(); }
      }

      // AI-комментарий теперь обрабатывается BLOCK EAI.
      // Здесь можем максимум подсказать EAI запуститься, но он уже сам стартует при загрузке.
      // if (b.front && b.front.html){
      //   renderAIComment(b.front.html || '');
      // } else {
      //   setAIStatus('Обрабатываем… (ждём комментарий)');
      //   window.startFrontDataFlow_bm_bm();
      // }

      // MACROS
      try{
        const uid = (typeof currentUserId_bm === 'function') ? currentUserId_bm() : 'anon';
        if (b.macros){
          const macrosRow = Number(b.macros.row || b.row || 0);
          // ✅ не кладём старее reqRow
          if (b.macros.ready && b.macros.macros && !(reqRow && macrosRow < Number(reqRow))) {
            const seed = { row: b.macros.row || b.row || null, macros: b.macros.macros, updated_at: b.macros.updated_at };
            localStorage.setItem('bm:macros:vals:' + String(uid), JSON.stringify(seed));
          }
          try { window.startMacrosFlow_bm_bm(); } catch(_){}
        } else { try { window.startMacrosFlow_bm_bm(); } catch(_){} }
      } catch(_){}

      // CHART
      try{
        const uid = (typeof currentUserId_bm === 'function') ? currentUserId_bm() : 'anon';
        if (b.chart){
          const chartRow = Number(b.chart.row || b.row || 0);
          // ✅ не кладём старее reqRow
          if (b.chart.ready && b.chart.data && !(reqRow && chartRow < Number(reqRow))) {  
            const seed = { row: b.chart.row || b.row || null, data: b.chart.data, updated_at: b.chart.updated_at };
            localStorage.setItem('bm:chart:data:' + String(uid), JSON.stringify(seed));
          }
          try { window.startChartFlow_bm_bm(); } catch(_){}
        } else { try { window.startChartFlow_bm_bm(); } catch(_){ } }
      } catch(_){}

    // CHART WEIGHT
          try{
            const uid = (typeof currentUserId_bm === 'function') ? currentUserId_bm() : 'anon';
            console.log('📊 [D] chart_weight from backend:', b.chart_weight);
            if (b.chart_weight){
              const chartWeightRow = Number(b.chart_weight.row || b.row || 0);
              // не кладём старее reqRow
              if (b.chart_weight.ready && b.chart_weight.data && !(reqRow && chartWeightRow < Number(reqRow))) {  
                const seed = { 
                  row: b.chart_weight.row || b.row || null, 
                  data: b.chart_weight.data, 
                  updated_at: b.chart_weight.updated_at || new Date().toISOString()
                };
                localStorage.setItem('bm:chart_weight:data:' + String(uid), JSON.stringify(seed));
                console.log('✅ WeightChart: данные сохранены в кэш');
              }
              try { window.startWeightChartFlow_bm_bm(); } catch(_){}
            } else { 
              try { window.startWeightChartFlow_bm_bm(); } catch(_){} 
            }
          } catch(_){}
      
    } catch {
      // AI-поток здесь больше не запускаем — им управляет BLOCK EAI
      // window.startFrontDataFlow_bm_bm();
      try{
        const r = await apiLastInputs_bm();
        if (r && r.found && r.inputs){
          applyInputsToWheels(r.inputs);
          applyInputsToSurvey(r.inputs);
        } else {
          ensureAllWheelsOnce();
        }
      } catch { ensureAllWheelsOnce(); }
      try { window.startMacrosFlow_bm_bm(); } catch(_){}
      try { window.startChartFlow_bm_bm(); } catch(_){}
    }
  })();
})();


/* ============================================================
 *  BLOCK EAI: Front data flow (AI comment) — АДАПТИРОВАНО ПОД БЭКЕНД
 * ============================================================ */
(function frontDataFlowInit(){
  const tg = window.Telegram?.WebApp;
  const BACKEND = (typeof BACKEND_URL_bm !== 'undefined' && BACKEND_URL_bm) ? BACKEND_URL_bm : '';

  const elAI = ()=>document.getElementById('ai-comment');

  /* ---------- Кэш комментария ---------- */
  const COMMENT_KEY_PREFIX = 'bm:comment:html:';
  function currentUserId_bm(){ 
    try { return window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 'anon'; } 
    catch(_){ return 'anon'; } 
  }
  function commentKey_bm(uid){ return COMMENT_KEY_PREFIX + String(uid ?? currentUserId_bm()); }
  function saveCommentCache_bm(obj, uid){ 
    try { localStorage.setItem(commentKey_bm(uid), JSON.stringify(obj)); } 
    catch(_){} 
  }
  function loadCommentCache_bm(uid){ 
    try { 
      const raw = localStorage.getItem(commentKey_bm(uid)); 
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
  async function apiFrontBootstrap_bm_eai_bm(requestedRow, signal){
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
      : (typeof getRowCalcForUser_bm === 'function' ? getRowCalcForUser_bm() : null);
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
      const res = await apiFrontBootstrap_bm_eai_bm(reqRow, controller.signal);
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
        if (typeof setRowCalcForUser_bm === 'function') {
          setRowCalcForUser_bm(serverRow);
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
        saveCommentCache_bm({ 
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
  window.startFrontDataFlow_bm_bm = function(){
    _commentRunId += 1;
    const runId = _commentRunId;
    _commentStatus = 'INIT';
    _commentLastSig = ''; // обнуляем сигнатуру

    // Показываем кэш (если не старее desiredRow)
    const target = targetRow();
    const cached = loadCommentCache_bm();
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
      window.startFrontDataFlow_bm_bm();
    }
  });

  /* ---------- Initial start ---------- */
  window.startFrontDataFlow_bm_bm();
})();
  
/* ============================================================
 *  BLOCK E1 — Analytics Macros (poll + cache) + DEBUG
 * ============================================================ */
(function macrosAnalyticsInit(){
  const tg = window.Telegram?.WebApp;
  const BACKEND = (typeof BACKEND_URL_bm !== 'undefined' && BACKEND_URL_bm) ? BACKEND_URL_bm : '';
  const host = () => document.getElementById('analytics');

  const MACROS_KEY_PREFIX = 'bm:macros:vals:';
  function currentUserId_bm(){ try { return window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 'anon'; } catch(_){ return 'anon'; } }
  function macrosKey_bm(uid){ return MACROS_KEY_PREFIX + String(uid); }
  function saveMacrosCache_bm(obj, uid){ try { localStorage.setItem(macrosKey_bm(uid ?? currentUserId_bm()), JSON.stringify(obj)); } catch(_){} }
  function loadMacrosCache_bm(uid){ try { const raw = localStorage.getItem(macrosKey_bm(uid ?? currentUserId_bm())); return raw ? JSON.parse(raw) : null; } catch(_) { return null; } }

  function fmtNum(v){ 
  if (v == null || v === '' || (typeof v === 'number' && isNaN(v))) return '—';
  if (typeof v === 'string') return v; // для "Не известно"
  const num = Number(v);
  // Для всех метрик показываем 2 знака после запятой
  return num.toFixed(2); // <-- Теперь всегда 2 знака
}


  function renderSkeleton(){
    const el = host(); if (!el) return;
    el.innerHTML = `
      <div class="field">
        <div class="macros-grid" id="macros-cards">
          <div class="macro-card"><div class="m-label">ИМТ</div><div class="m-value" id="BMI">—</div><div class="m-unit">кг/м²</div></div>
          <div class="macro-card"><div class="m-label">Масса жира</div><div class="m-value" id="fat_mass">—</div><div class="m-unit">кг</div></div>
          <div class="macro-card"><div class="m-label">Талия к ягодицам</div><div class="m-value" id="waist_hips_ratio">—</div><div class="m-unit">отношение</div></div>
          <div class="macro-card"><div class="m-label">Плечи к талии</div><div class="m-value" id="shoulders_waist_ratio">—</div><div class="m-unit">отношение</div></div>
        </div>
        <div class="macro-hint" id="macros-hint">После сохранения появятся показатели...</div>
      </div>`;
  }

  function renderValues(macros, opts){
    console.log('🎨 renderValues called with:', { macros, opts });
    
    const o = opts || {};
    const set = (id, val) => { 
      const el = document.getElementById(id);
      console.log(`   Setting ${id}:`, val, '→ element exists:', !!el);
      if (el) {
        el.textContent = fmtNum(val);
      }
    };
    
    // ✅ Правильные ID
    set('BMI', macros?.BMI);
    set('fat_mass', macros?.fat_mass);
    set('waist_hips_ratio', macros?.waist_hips_ratio);
    set('shoulders_waist_ratio', macros?.shoulders_waist_ratio);

    const hint = document.getElementById('macros-hint');
    if (!hint) return;
    if (o.status === 'READY'){ hint.textContent = 'Ваши метрики'; }
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
    console.log('🔒 renderValuesSafe:', { macros, nextStatus, currentStatus: _macrosStatus });
    const cur = STATUS_RANK[_macrosStatus] ?? 0;
    const nxt = STATUS_RANK[nextStatus] ?? 0;
    if (nxt < cur) {
      console.log('   ⚠️ Skipped: new status rank lower');
      return;
    }
    renderValues(macros, { status: nextStatus });
    _macrosStatus = nextStatus;
  }

  async function apiFrontMacros_bm(requestedRow, signal){
    const payload = {
      action: 'front_metrics', // ✅ ИСПРАВЛЕНО! было 'front_macros'
      init_data: String(tg?.initData || ''),
      row: Number(requestedRow || 0) || undefined
    };
    
    console.log('📡 API call:', { action: payload.action, row: payload.row });
    
    const resp = await fetch(BACKEND, {
      method:'POST',
      headers:{ 'Content-Type':'text/plain;charset=UTF-8' },
      body: JSON.stringify(payload),
      cache:'no-store', credentials:'omit', mode:'cors',
      signal
    });
    const raw = await resp.text();
    console.log('📡 Response raw:', raw.substring(0, 500));
    
    let json = null; 
    try { json = raw ? JSON.parse(raw) : null; } catch(e){
      console.error('❌ JSON parse error:', e);
    }
    
    if (!resp.ok || !json) throw new Error(`HTTP ${resp.status}`);
    
    console.log('📡 Response parsed:', json);
    return json;
  }

  async function pollOnce(runId){
    if (runId !== _macrosRunId) return { done:true };

    const reqRow =
      (typeof desiredRow === 'function' && desiredRow() != null)
        ? desiredRow()
        : getRowCalcForUser_bm();

    console.log('🔄 pollOnce: reqRow=', reqRow);

    if (_macrosAbort) { try{ _macrosAbort.abort(); }catch(_){ } }
    const controller = new AbortController();
    _macrosAbort = controller;

    try{
      const res = await apiFrontMacros_bm(reqRow, controller.signal);
      
      console.log('✅ Poll result:', {
        row: res?.row,
        status: res?.status,
        ready: res?.ready,
        metrics: res?.metrics,
        macros: res?.macros
      });
      
      if (res?.row && reqRow && Number(res.row) < Number(reqRow)) {
        const wait = Math.max(200, Math.min(1000, Number(res?.retry_after_ms) || 500));
        return { done:false, wait };
      }
      if (runId !== _macrosRunId) return { done:true };

      const serverRow = Number(res?.row);
      if (Number.isFinite(serverRow) && (reqRow == null || serverRow > reqRow)) {
        setRowCalcForUser_bm(serverRow);
      }

      // ✅ ИСПРАВЛЕНО! Проверяем и res.metrics, и res.macros
      const metricsData = res?.metrics || res?.macros || {};
      console.log('📊 Using metrics:', metricsData);
      
      renderValuesSafe(metricsData, res?.status || 'WAITING');

      if (res?.ready){
        if (!(reqRow && Number(res.row || 0) < Number(reqRow))) {
          saveMacrosCache_bm({ row: res.row, macros: metricsData, updated_at: res.updated_at });
        }
        return { done:true };
      }
      const wait = Math.max(200, Math.min(1000, Number(res?.retry_after_ms) || 500));
      return { done:false, wait };
    } catch(err){
      console.error('❌ Poll error:', err);
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

  window.startMacrosFlow_bm_bm = function forceStart(){
    console.log('🚀 Starting macros flow');
    _macrosRunId += 1;
    const runId = _macrosRunId;
    _macrosStatus = 'INIT';

    renderSkeleton();

    const target =
      (typeof desiredRow === 'function' && desiredRow() != null)
        ? desiredRow()
        : getRowCalcForUser_bm();

    const cached = loadMacrosCache_bm();
    console.log('💾 Cache loaded:', { cached, target });
    
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
      window.startMacrosFlow_bm_bm();
    }
  });

  console.log('📦 Macros module initialized');
  window.startMacrosFlow_bm_bm();
})();

/* ============================================================
 *  BLOCK E2.4 — Chart data flow (poll + cache, как макросы)
 * ============================================================ */
(function chartDataFlowInit(){
  console.log('%c[E2.4] init', 'color:#4af');

  const tg = window.Telegram?.WebApp;
  const BACKEND = (typeof BACKEND_URL_bm !== 'undefined' && BACKEND_URL_bm) ? BACKEND_URL_bm : '';

  const CHART_KEY_PREFIX = 'bm:chart:data:';

  function currentUserId_bm(){ 
    try { return window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 'anon'; }
    catch(_){ return 'anon'; }
  }
  function chartKey_bm(uid){
    return CHART_KEY_PREFIX + String(uid ?? currentUserId_bm());
  }
  function saveChartCache_bm(obj, uid){
    try {
      console.log('%c[E2.4] save cache','color:#4af', obj);
      localStorage.setItem(chartKey_bm(uid ?? currentUserId_bm()), JSON.stringify(obj));
    } catch(err){
      console.warn('[E2.4] cache save error', err);
    }
  }
  function loadChartCache_bm(uid){
    try {
      const raw = localStorage.getItem(chartKey_bm(uid ?? currentUserId_bm()));
      const obj = raw ? JSON.parse(raw) : null;
      console.log('%c[E2.4] load cache','color:#4af', obj);
      return obj;
    } catch(err){
      console.warn('[E2.4] cache load error', err);
      return null;
    }
  }

  function targetRow(){
    try {
      const dr = (typeof desiredRow === 'function') ? desiredRow() : null;
      const gr = (typeof getRowCalcForUser_bm === 'function') ? getRowCalcForUser_bm() : null;
      const use = dr ?? gr;
      console.log('%c[E2.4] targetRow','color:#4af', { desired:dr, rowCalc:gr, use });
      return use;
    } catch(err){
      console.warn('[E2.4] targetRow error', err);
      return null;
    }
  }

  // ✅ Используем общий bootstrap-API, как waitForFreshData_bm / EAI
  async function apiFrontChart_bm(requestedRow, signal){
    console.log('%c[E2.4] request to backend','color:#4af', { requestedRow });

    const api = (window && typeof window.apiFrontBootstrap_bm_bm_eai_bm === 'function')
      ? window.apiFrontBootstrap_bm_bm_eai_bm
      : (typeof apiFrontBootstrap_bm_eai_bm === 'function' ? apiFrontBootstrap_bm_eai_bm : null);

    if (!api) {
      throw new Error('front_bootstrap API is not available');
    }

    const res = await api(requestedRow, signal);
    console.log('%c[E2.4] backend response','color:#4af', { res });
    return res;
  }

  let _chartTimer = 0;
  let _chartRunId = 0;
  let _chartAbort = null;

  async function pollOnce(runId){
    if (runId !== _chartRunId) return { done:true };

    const reqRow = targetRow();

    if (_chartAbort) try { _chartAbort.abort(); } catch(_){}
    const controller = new AbortController();
    _chartAbort = controller;

    try {
      const res = await apiFrontChart_bm(reqRow, controller.signal);
      if (runId !== _chartRunId) return { done:true };

      const serverRow  = Number(res?.row || 0);
      const chartBlk   = res?.chart || {};
      const chartReady = !!chartBlk.ready && !!chartBlk.data;

      console.log('%c[E2.4] pollOnce','color:#4af', {
        reqRow, serverRow, chartReady, chartBlk
      });

      // ✅ защита от старых row, как в макросах
      if (reqRow && serverRow && serverRow < Number(reqRow)) {
        console.log('%c[E2.4] old row, waiting','color:#f80', { reqRow, serverRow });
        const wait = Math.max(200, Math.min(1000, Number(res?.retry_after_ms) || 500));
        return { done:false, wait };
      }

      if (Number.isFinite(serverRow) && (reqRow == null || serverRow > reqRow)) {
        try { 
          setRowCalcForUser_bm(serverRow); 
          console.log('%c[E2.4] rowCalc updated','color:#4af', serverRow);
        } catch(_){}
      }

      if (chartReady) {
        const uid = currentUserId_bm();
        const chartRow = Number(chartBlk.row || serverRow || 0);

        // ✅ не кладём в кэш график, если он старее desiredRow — аналог макросов
        if (reqRow && chartRow && chartRow < Number(reqRow)) {
          console.log('%c[E2.4] chartRow < reqRow — skip cache','color:#f00', { chartRow, reqRow });
          const wait = Math.max(200, Math.min(1000, Number(res?.retry_after_ms) || 500));
          return { done:false, wait };
        }

        const seed = {
          row: chartRow || null,
          data: chartBlk.data,
          updated_at: chartBlk.updated_at || res.updated_at || new Date().toISOString()
        };

        saveChartCache_bm(seed, uid);

        console.log('%c[E2.4] call view refresh','color:#4af');
        try { window.startChartFlow_bm_bm && window.startChartFlow_bm_bm(); } catch(_){}

        return { done:true };
      }

      // ⬅ если chart ещё не ready — ждём retry_after_ms, как в макросах
      const wait = Math.max(200, Math.min(1000, Number(res?.retry_after_ms) || 500));
      return { done:false, wait };

    } catch(err){
      if (err?.name === 'AbortError') return { done:true };
      if (runId !== _chartRunId) return { done:true };
      console.error('[E2.4] poll error:', err);
      return { done:false, wait: 1000 };
    }
  }

  async function pollLoop(runId){
    clearTimeout(_chartTimer);
    const r = await pollOnce(runId);
    if (r.done || runId !== _chartRunId) return;
    _chartTimer = setTimeout(() => pollLoop(runId), r.wait);
  }

  window.startChartDataFlow_bm_bm = function(){
    console.log('%c[E2.4] START DATA FLOW','color:#0f0');

    _chartRunId += 1;
    const runId = _chartRunId;

    clearTimeout(_chartTimer);
    if (_chartAbort) try { _chartAbort.abort(); } catch(_){}

    // сначала отрисуем то, что есть в кэше (или очистим график), как в макросах
    try { window.startChartFlow_bm_bm && window.startChartFlow_bm_bm(); } catch(_){}

    pollLoop(runId);
  };

  document.addEventListener('visibilitychange', ()=>{
    if (document.visibilityState === 'hidden'){
      clearTimeout(_chartTimer);
      if (_chartAbort) try { _chartAbort.abort(); } catch(_){}
    } else {
      window.startChartDataFlow_bm_bm && window.startChartDataFlow_bm_bm();
    }
  });

  console.log('%c[E2.4] initialized','color:#4af');
  window.startChartDataFlow_bm_bm && window.startChartDataFlow_bm_bm();
})();



/* ============================================================
 *  BLOCK E2.5 — Chart Flow (view)
 * ============================================================ */
(function chartFlowInit(){
  console.log('%c[E2.5] init', 'color:#c4f');

  const CHART_KEY_PREFIX = 'bm:chart:data:';

  function currentUserId_bm(){ 
    try { return window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 'anon'; }
    catch(_){ return 'anon'; }
  }
  function chartKey_bm(uid){
    return CHART_KEY_PREFIX + String(uid ?? currentUserId_bm());
  }
  function loadChartCache_bm(uid){
    try {
      const raw = localStorage.getItem(chartKey_bm(uid ?? currentUserId_bm()));
      const obj = raw ? JSON.parse(raw) : null;
      console.log('%c[E2.5] load cache','color:#c4f', obj);
      return obj;
    } catch(err){
      console.warn('[E2.5] cache load error', err);
      return null;
    }
  }

  function targetRow(){
    try {
      const dr = (typeof desiredRow === 'function') ? desiredRow() : null;
      const gr = (typeof getRowCalcForUser_bm === 'function') ? getRowCalcForUser_bm() : null;
      const use = dr ?? gr;
      console.log('%c[E2.5] targetRow','color:#c4f', { dr, gr, use });
      return use;
    } catch(err){
      console.warn('[E2.5] targetRow error', err);
      return null;
    }
  }

  function renderChart(chartData){
    console.log('%c[E2.5] renderChart','color:#c4f', chartData);

    // нет данных – очищаем виджет
    if (!chartData || !chartData.data) {
      window.PLAN_FACT_SERIES = null;
      if (window.PlanFactChart) {
        try {
          if (typeof window.PlanFactChart.setSeries === 'function') {
            window.PlanFactChart.setSeries(null);
          } else if (typeof window.PlanFactChart.setData === 'function') {
            window.PlanFactChart.setData([]); // пустой список строк
          }
        } catch(err){
          console.error('[E2.5] clear chart error', err);
        }
      }
      return;
    }

    // полноценная серия (в формате PLAN_FACT_SERIES / chartBlk.data)
    window.PLAN_FACT_SERIES = chartData.data;

    if (window.PlanFactChart) {
      try {
        if (typeof window.PlanFactChart.setSeries === 'function') {
          // основной путь: передаём всю серию, блок E2 сам пересоберёт шкалу и строки
          window.PlanFactChart.setSeries(chartData.data);
        } else if (typeof window.PlanFactChart.setData === 'function') {
          // fallback на старое поведение: просто отрисуем последний снапшот,
          // если setSeries по какой-то причине недоступен
          window.PlanFactChart.setData(chartData.data);
        }
        console.log('%c[E2.5] update chart OK','color:#0f0');
      } catch(err){
        console.error('[E2.5] chart update error', err);
      }
    }
  }

  window.startChartFlow_bm_bm = function(){
    console.log('%c[E2.5] START VIEW FLOW','color:#0f0');

    const target = targetRow();
    const cached = loadChartCache_bm();

    console.log('%c[E2.5] cached vs target','color:#c4f', { cached, target });

    // как у макросов: показываем только кэш, который не старее desiredRow/rowCalc
    if (cached?.data && !(target && Number(cached.row||0) < Number(target))) {
      renderChart(cached);
    } else {
      console.log('%c[E2.5] waiting fresh chart...','color:#f80');
      renderChart(null); // стандартизованный сброс
    }
  };

  document.addEventListener('visibilitychange', ()=>{
    if (document.visibilityState === 'visible'){
      window.startChartFlow_bm_bm();
    }
  });

  console.log('%c[E2.5] initialized','color:#c4f');
  window.startChartFlow_bm_bm();
})();


  
//============================================================
//  BLOCK E2 — ЗАМЕРЫ ПЛАН ФАКТ ДЕЛЬТА
//============================================================
(function(){
  const LABELS = {
    fat:'% Жира',
    neck:'Шея',
    shoulders:'Плечи',
    chest:'Грудь',
    waist:'Талия',
    hips:'Ягодицы',
    thigh:'Бедро',
    calf:'Икра',
    bicep:'Бицепс'
  };
  
  const ORDER = ['fat','neck','shoulders','chest','waist','hips','thigh','calf','bicep'];

  function toRows(json){
    var rows = [];
    if(!json) return rows;
    
    for(var i=0; i<ORDER.length; i++){
      var key = ORDER[i];
      var it = json[key];
      if(!it) continue;
      
      var unit = it.unit || (key==='fat' ? '%' : 'см');
      var plan = Number(it.plan);
      var fact = Number(it.fact);
      
      if(!isFinite(plan) || !isFinite(fact)) continue;
      
      var delta = (it.hasOwnProperty('delta') && isFinite(Number(it.delta))) ? Number(it.delta) : null;
      
      rows.push({
        key: key,
        label: (LABELS[key] || key),
        unit: unit,
        target: plan,
        actual: fact,
        delta: delta
      });
    }
    
    return rows;
  }

  function render(el, initialData){
    var state = { data: initialData };
    var rowsEl = el.querySelector('#rows');
    var scroller = el.querySelector('#scroller');
    var hint = el.querySelector('#scrollHint');
    
    if(!rowsEl || !scroller){
      return { setData: function(_){} };
    }

    var lastScrollTop = scroller.scrollTop || 0;
    var lastDirUp = false;

    function buildDomains(list){
      var cmMax = 0;
      for(var i=0; i<list.length; i++){
        var d = list[i];
        var u = (d.unit||'').trim();
        if(u !== '%') cmMax = Math.max(cmMax, (d.target||0), (d.actual||0));
      }
      return { '%':100, 'см':cmMax||1, 'cm':cmMax||1 };
    }

    function draw(){
      var data = state.data || [];
      var maxByUnit = buildDomains(data);
      rowsEl.innerHTML = '';
      
      for(var i=0; i<data.length; i++){
        var d = data[i];
        var delta = (isFinite(d.delta) ? d.delta : null);
        var unitMax = maxByUnit[(d.unit||'').trim()] || 1;
        var wp = Math.max(0, Math.min(100, ((d.target||0)/unitMax)*100));
        var wf = Math.max(0, Math.min(100, ((d.actual||0)/unitMax)*100));

        var row = document.createElement('div');
        row.className = 'row';
        
        var top = document.createElement('div');
        top.className = 'top';
        top.innerHTML = '<span class="name">'+(d.key==='fat' ? (LABELS[d.key]||d.label) : (d.label+' ('+d.unit+')'))+'</span>'+
          '<span class="vals">'+
            '<span class="kv"><span class="lab">Факт:</span> <b class="val">'+round(d.actual,1)+'</b></span>'+
            '<span class="dot">•</span>'+
            '<span class="kv"><span class="lab">План:</span> <b class="val">'+round(d.target,1)+'</b></span>'+
            '<span class="dot">•</span>'+
            '<span class="kv"><span class="lab">∆:</span> <b class="val">'+fmtDeltaNoUnit(delta)+(isFinite(delta)?(delta>0?' ▲':(delta<0?' ▼':'')):'')+'</b></span>'+
          '</span>';

        var g = document.createElement('div');
        g.className = 'gauge';
        
        var plan = document.createElement('div');
        plan.className = 'plan';
        plan.style.setProperty('--wp', wp+'%');
        
        var fact = document.createElement('div');
        fact.className = 'fact';
        fact.style.setProperty('--wf', wf+'%');

        if (isFinite(delta)) {
          if (d.key === 'fat' || d.key === 'waist') {
            if (d.actual > d.target) fact.classList.add('red');
          } else {
            if (d.actual < d.target) fact.classList.add('orange');
          }
        } else {
          fact.classList.add('neutral');
        }

        g.appendChild(plan);
        g.appendChild(fact);
        row.appendChild(top);
        row.appendChild(g);
        rowsEl.appendChild(row);
      }
      
      limitToRows(5);
      updateHint();
    }

    function limitToRows(n){
      var items = rowsEl.children;
      var rows = [];
      for(var i=0; i<items.length; i++){
        if(items[i].classList && items[i].classList.contains('row')) rows.push(items[i]);
      }
      if(!rows.length) return;
      
      var csList = getComputedStyle(rowsEl);
      var maxH = parseFloat(csList.paddingTop) + parseFloat(csList.paddingBottom);
      for(var i=0; i<Math.min(n, rows.length); i++){
        var r = rows[i];
        var cs = getComputedStyle(r);
        maxH += r.offsetHeight + parseFloat(cs.marginTop||0) + parseFloat(cs.marginBottom||0);
      }
      maxH += 2;
      scroller.style.maxHeight = Math.ceil(maxH) + 'px';
    }

function updateHint(){
  if(!hint) return;

  // есть ли вообще что скроллить
  var hasMore = (scroller.scrollHeight - scroller.clientHeight) > 2;
  hint.classList.toggle('hidden', !hasMore);
  if(!hasMore) return;

  var st = scroller.scrollTop;

  // запоминаем направление прокрутки (если захочешь использовать дальше)
  if(Math.abs(st - lastScrollTop) > 0.5){
    lastDirUp = st < lastScrollTop;
  }
  lastScrollTop = st;

  var nearTop = st <= 1;
  var nearBottom = Math.ceil(st + scroller.clientHeight) >= scroller.scrollHeight - 2;

  // показываем затемнение только когда пользователь вверху и есть скрытые строки
  var showFade = nearTop && !nearBottom;
  hint.classList.toggle('visible', showFade);
}


    function fmtDeltaNoUnit(n){
      if(!isFinite(n)) return '—';
      var s = n>0 ? '+' : '';
      return s + round(n,1);
    }
    
    function round(n,p){
      var m = Math.pow(10, (p||1));
      return Math.round(n*m)/m;
    }

    draw();
    scroller.addEventListener('scroll', updateHint, { passive:true });
    window.addEventListener('resize', function(){ limitToRows(5); updateHint(); }, { passive:true });

    return {
      setData: function(payload){
        state.data = Array.isArray(payload) ? payload : toRows(payload);
        draw();
      }
    };
  }

  var container = document.getElementById('pfHApp');
  if (!container) {
    console.error('PlanFactChart: контейнер #pfHApp не найден');
    return;
  }

  /*// ВСЕ 9 ПАРАМЕТРОВ для каждой даты
  window.PLAN_FACT_SERIES = {
    "series": {
      "2025-10-01": {
        "fat": { "unit": "%", "plan": 18, "fact": 20, "delta": -2 },
        "neck": { "unit": "см", "plan": 39, "fact": 39, "delta": 0 },
        "shoulders": { "unit": "см", "plan": 140, "fact": 124, "delta": 16 },
        "chest": { "unit": "см", "plan": 115, "fact": 112, "delta": 3 },
        "waist": { "unit": "см", "plan": 89, "fact": 88, "delta": 1 },
        "hips": { "unit": "см", "plan": 102, "fact": 97, "delta": 5 },
        "thigh": { "unit": "см", "plan": 62, "fact": 55, "delta": 7 },
        "calf": { "unit": "см", "plan": 44, "fact": 32, "delta": 12 },
        "bicep": { "unit": "см", "plan": 44, "fact": 38, "delta": 6 }
      },
      "2025-11-01": {
        "fat": { "unit": "%", "plan": 18, "fact": 21, "delta": -3 },
        "neck": { "unit": "см", "plan": 39, "fact": 40, "delta": -1 },
        "shoulders": { "unit": "см", "plan": 140, "fact": 125, "delta": 15 },
        "chest": { "unit": "см", "plan": 115, "fact": 113, "delta": 2 },
        "waist": { "unit": "см", "plan": 89, "fact": 89, "delta": 0 },
        "hips": { "unit": "см", "plan": 102, "fact": 98, "delta": 4 },
        "thigh": { "unit": "см", "plan": 62, "fact": 56, "delta": 6 },
        "calf": { "unit": "см", "plan": 44, "fact": 33, "delta": 11 },
        "bicep": { "unit": "см", "plan": 44, "fact": 39, "delta": 5 }
      },
      "2025-12-01": {
        "fat": { "unit": "%", "plan": 18, "fact": 22, "delta": -4 },
        "neck": { "unit": "см", "plan": 39, "fact": 41, "delta": -2 },
        "shoulders": { "unit": "см", "plan": 140, "fact": 126, "delta": 14 },
        "chest": { "unit": "см", "plan": 115, "fact": 114, "delta": 1 },
        "waist": { "unit": "см", "plan": 89, "fact": 90, "delta": -1 },
        "hips": { "unit": "см", "plan": 102, "fact": 99, "delta": 3 },
        "thigh": { "unit": "см", "plan": 62, "fact": 57, "delta": 5 },
        "calf": { "unit": "см", "plan": 44, "fact": 34, "delta": 10 },
        "bicep": { "unit": "см", "plan": 44, "fact": 40, "delta": 4 }
      }
    }
  };*/

  var api = render(container, []);

/* ==================== Временная шкала (V6: FORCE NOWRAP) ==================== */
  (function initTimeline(){
    // Состояние
    let _dates = []; 
    let _rows = [];  
    let _domItems = []; 
    let _lastDatesStr = '';

    // Элементы
    const tl = document.getElementById('timeline');
    const wheel = document.getElementById('dateWheel');
    const maskEl = tl ? tl.querySelector('.wheel-mask') : null;

    // --- 0. ЖЕСТКИЙ ФИКС КОНТЕЙНЕРА ---
    // Гарантируем, что элементы выстроятся в одну линию и не будут переноситься
    if (wheel) {
      wheel.style.display = 'flex';
      wheel.style.flexWrap = 'nowrap';
      wheel.style.flexDirection = 'row';
      wheel.style.alignItems = 'center';
    }

    // --- 1. Утилиты ---
    function formatDateRu(s){
      const d = new Date(s);
      if(!isFinite(d.getTime())) return s;
      return d.toLocaleDateString('ru-RU', {day:'2-digit', month:'short'});
    }

    function normalizeSeries(input){
      if(!input) return { dates:[], rows:[] };
      let seriesMap = null;
      if (input.series && !Array.isArray(input.series)) { seriesMap = input.series; } 
      else if (Array.isArray(input) && input.length && input[0]?.date) {
        seriesMap = {};
        input.forEach((it, i) => { seriesMap[it.date||i] = it.data || it.snapshot || {}; });
      } else { return { dates:['—'], rows:[ toRows(input) ] }; }
      
      const dates = Object.keys(seriesMap).sort((a,b) => new Date(a) - new Date(b));
      const rows = dates.map(d => toRows(seriesMap[d]||{}));
      return { dates, rows };
    }

    // --- 2. Визуал ---
    function updateVisuals() {
      // Берем ширину контейнера или окна, если скрыто
      const contW = wheel.clientWidth || window.innerWidth;
      if (!contW || !_domItems.length) return;

      const center = wheel.scrollLeft + contW / 2;
      let bestIdx = 0;
      let minDst = Infinity;

      _domItems.forEach((btn, i) => {
        // btn.offsetLeft - это расстояние от левого края прокручиваемой ленты
        const btnCenter = btn.offsetLeft + btn.offsetWidth / 2; 
        const dst = Math.abs(btnCenter - center);
        if (dst < minDst) { minDst = dst; bestIdx = i; }
      });

      _domItems.forEach((btn, i) => {
        const isActive = (i === bestIdx);
        if (btn.classList.contains('active') !== isActive) {
           btn.classList.toggle('active', isActive);
           if (isActive) {
             window._pf_active_date = _dates[i]; 
             if (api) api.setData(_rows[i] || []);
             try { window.Telegram?.WebApp?.HapticFeedback?.selectionChanged(); } catch(_){}
           }
        }
      });

      // Маска
      if (maskEl && _domItems[bestIdx]) {
        const el = _domItems[bestIdx];
        const elW = el.offsetWidth || 60; 
        const elH = el.offsetHeight || 30;
        const maskW = Math.round(elW * 1.3 + 16); 
        const maskH = Math.round(elH + 8);
        
        if (wheel.clientWidth > 0) {
           const wr = wheel.getBoundingClientRect();
           const pr = tl.getBoundingClientRect();
           const centerX = (wr.left + wr.width/2) - pr.left;
           const left = centerX - maskW/2;
           const top = (wr.top - pr.top) + (wr.height - maskH)/2;
           maskEl.style.setProperty('--mask-left', `${left}px`);
           maskEl.style.setProperty('--mask-top', `${top}px`);
        }
        maskEl.style.setProperty('--mask-w', `${maskW}px`);
        maskEl.style.setProperty('--mask-h', `${maskH}px`);
      }
    }

    // --- 3. Скролл ---
    function scrollToIdx(idx, smooth) {
      if (!_domItems[idx]) return;
      const el = _domItems[idx];
      const contW = wheel.clientWidth || window.innerWidth; 
      const elW = el.offsetWidth || 80; 
      
      const target = el.offsetLeft - (contW / 2) + (elW / 2);
      
      wheel.scrollTo({ left: target, behavior: smooth ? 'smooth' : 'auto' });
      if (!smooth) requestAnimationFrame(updateVisuals);
    }

    // --- 4. DOM (ФИКС: NO-WRAP + PIXEL WIDTH) ---
    function buildDOM(dates) {
      wheel.innerHTML = '';
      _domItems = [];
      
      // 1. Считаем половину экрана
      const halfScreen = Math.floor((wheel.clientWidth || window.innerWidth) / 2);
      
      // 2. Стиль распорки:
      // flex-shrink: 0 -> ЗАПРЕТИТЬ сжатие
      // width/min-width -> Задать жесткий размер
      // display: block -> Убедиться, что это блок
      const spacerStyle = `
        display: block;
        flex: 0 0 ${halfScreen}px; 
        min-width: ${halfScreen}px; 
        width: ${halfScreen}px;
        height: 1px;
        pointer-events: none;
      `;
      
      const leftSpacer = document.createElement('div');
      leftSpacer.style.cssText = spacerStyle;
      // Неразрывный пробел на всякий случай
      leftSpacer.innerHTML = '&nbsp;';
      wheel.appendChild(leftSpacer);

      dates.forEach((d, i) => {
        const btn = document.createElement('div');
        btn.className = 'item';
        btn.textContent = formatDateRu(d);
        btn.onclick = () => scrollToIdx(i, true);
        
        // Гарантируем, что сами элементы тоже не сожмутся
        btn.style.flexShrink = '0';
        
        wheel.appendChild(btn);
        _domItems.push(btn);
      });

      const rightSpacer = document.createElement('div');
      rightSpacer.style.cssText = spacerStyle;
      rightSpacer.innerHTML = '&nbsp;';
      wheel.appendChild(rightSpacer);
    }

    // --- 5. Слушатели ---
    let scrollT = null;
    wheel.addEventListener('scroll', () => {
      if (scrollT) return;
      scrollT = requestAnimationFrame(() => {
        updateVisuals();
        scrollT = null;
      });
    }, { passive: true });
    
    window.addEventListener('resize', () => {
      const spacers = wheel.querySelectorAll('div[style*="flex: 0 0"]');
      const newHalf = Math.floor((wheel.clientWidth || window.innerWidth) / 2);
      spacers.forEach(sp => {
          sp.style.minWidth = newHalf + 'px';
          sp.style.width = newHalf + 'px';
          sp.style.flexBasis = newHalf + 'px';
      });
      requestAnimationFrame(updateVisuals);
    }, { passive: true });


    // ================= PUBLIC API =================
    if (typeof window.PlanFactChart !== 'object') window.PlanFactChart = {};

    window.PlanFactChart.setSeries = function(seriesInput) {
      window.PLAN_FACT_SERIES = seriesInput;
      const norm = normalizeSeries(seriesInput);
      _dates = norm.dates;
      _rows = norm.rows;

      if (!_dates.length) {
        if (tl) tl.hidden = true;
        if (api) api.setData([]);
        return;
      }
      if (tl) tl.hidden = false;

      const newDatesStr = _dates.join('|');
      if (newDatesStr !== _lastDatesStr) {
        buildDOM(_dates);
        _lastDatesStr = newDatesStr;
      }

      let targetIdx = -1;
      if (window._pf_active_date) targetIdx = _dates.indexOf(window._pf_active_date);
      if (targetIdx === -1) targetIdx = _dates.length - 1;

      // Заливаем данные сразу
      if (api && _rows[targetIdx]) {
        api.setData(_rows[targetIdx]);
      }
      
      window._pf_active_date = _dates[targetIdx];
      
      _domItems.forEach(el => el.classList.remove('active'));
      if (_domItems[targetIdx]) _domItems[targetIdx].classList.add('active');

      scrollToIdx(targetIdx, false);
    };

    window.PlanFactChart.setData = function(json){ 
      if(api) api.setData(json); 
    };

    const initial = window.PLAN_FACT_SERIES || window.PLAN_FACT_JSON;
    if (initial) window.PlanFactChart.setSeries(initial);
    
  })();
})();

  /* ============================================================
 *  BLOCK E3.1 — Weight Chart Data Flow (poll + cache)
 * ============================================================ */
(function weightChartDataFlowInit(){
  console.log('%c[E3.1] Weight chart data flow init','color:#9370db');

  const tg = window.Telegram?.WebApp;
  const BACKEND = (typeof BACKEND_URL_bm !== 'undefined' && BACKEND_URL_bm) ? BACKEND_URL_bm : '';

  const WEIGHT_CHART_KEY_PREFIX = 'bm:chart_weight:data:';

  function currentUserId_bm(){ 
    try { return window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 'anon'; }
    catch(_){ return 'anon'; }
  }

  function weightChartKey_bm(uid){
    return WEIGHT_CHART_KEY_PREFIX + String(uid ?? currentUserId_bm());
  }

  function saveWeightChartCache_bm(obj, uid){
    try {
      console.log('%c[E3.1] save cache','color:#9370db', obj);
      localStorage.setItem(weightChartKey_bm(uid ?? currentUserId_bm()), JSON.stringify(obj));
    } catch(err){
      console.warn('[E3.1] cache save error', err);
    }
  }

  function loadWeightChartCache_bm(uid){
    try {
      const raw = localStorage.getItem(weightChartKey_bm(uid ?? currentUserId_bm()));
      const obj = raw ? JSON.parse(raw) : null;
      console.log('%c[E3.1] load cache','color:#9370db', obj);
      return obj;
    } catch(err){
      console.warn('[E3.1] cache load error', err);
      return null;
    }
  }

  function targetRow(){
    try {
      const dr = (typeof desiredRow === 'function') ? desiredRow() : null;
      const gr = (typeof getRowCalcForUser_bm === 'function') ? getRowCalcForUser_bm() : null;
      const use = dr ?? gr;
      console.log('%c[E3.1] targetRow','color:#9370db', { desired:dr, rowCalc:gr, use });
      return use;
    } catch(err){
      console.warn('[E3.1] targetRow error', err);
      return null;
    }
  }

  // Используем общий bootstrap-API
  async function apiFrontWeightChart_bm(requestedRow, signal){
    console.log('%c[E3.1] request to backend','color:#9370db', { requestedRow });

    const api = (window && typeof window.apiFrontBootstrap_bm_bm_eai_bm === 'function')
      ? window.apiFrontBootstrap_bm_bm_eai_bm
      : (typeof apiFrontBootstrap_bm_eai_bm === 'function' ? apiFrontBootstrap_bm_eai_bm : null);

    if (!api) {
      throw new Error('front_bootstrap API is not available');
    }

    const res = await api(requestedRow, signal);
    console.log('%c[E3.1] backend response','color:#9370db', { res });
    return res;
  }

  let _weightChartTimer = 0;
  let _weightChartRunId = 0;
  let _weightChartAbort = null;

  async function pollOnce(runId){
    if (runId !== _weightChartRunId) return { done:true };

    const reqRow = targetRow();

    if (_weightChartAbort) try { _weightChartAbort.abort(); } catch(_){}
    const controller = new AbortController();
    _weightChartAbort = controller;

    try {
      const res = await apiFrontWeightChart_bm(reqRow, controller.signal);
      if (runId !== _weightChartRunId) return { done:true };

      const serverRow  = Number(res?.row || 0);
      const chartWeightBlk = res?.chart_weight || {};
      const chartWeightReady = !!chartWeightBlk.ready && !!chartWeightBlk.data;

      console.log('%c[E3.1] pollOnce','color:#9370db', {
        reqRow, serverRow, chartWeightReady, chartWeightBlk
      });

      // Защита от старых row
      if (reqRow && serverRow && serverRow < Number(reqRow)) {
        console.log('%c[E3.1] old row, waiting','color:#f80', { reqRow, serverRow });
        const wait = Math.max(200, Math.min(1000, Number(res?.retry_after_ms) || 500));
        return { done:false, wait };
      }

      if (Number.isFinite(serverRow) && (reqRow == null || serverRow > reqRow)) {
        try { 
          setRowCalcForUser_bm(serverRow); 
          console.log('%c[E3.1] rowCalc updated','color:#9370db', serverRow);
        } catch(_){}
      }

      if (chartWeightReady) {
        const uid = currentUserId_bm();
        const chartWeightRow = Number(chartWeightBlk.row || serverRow || 0);

        // Не кладём в кэш график, если он старее desiredRow
        if (reqRow && chartWeightRow && chartWeightRow < Number(reqRow)) {
          console.log('%c[E3.1] chartWeightRow < reqRow – skip cache','color:#f00', { chartWeightRow, reqRow });
          const wait = Math.max(200, Math.min(1000, Number(res?.retry_after_ms) || 500));
          return { done:false, wait };
        }

        const seed = {
          row: chartWeightRow || null,
          data: chartWeightBlk.data,
          updated_at: chartWeightBlk.updated_at || res.updated_at || new Date().toISOString()
        };

        saveWeightChartCache_bm(seed, uid);

        console.log('%c[E3.1] call view refresh','color:#9370db');
        try { window.startWeightChartFlow_bm_bm && window.startWeightChartFlow_bm_bm(); } catch(_){}

        return { done:true };
      }

      // Если chart_weight ещё не ready – ждём retry_after_ms
      const wait = Math.max(200, Math.min(1000, Number(res?.retry_after_ms) || 500));
      return { done:false, wait };

    } catch(err){
      if (err?.name === 'AbortError') return { done:true };
      if (runId !== _weightChartRunId) return { done:true };
      console.error('[E3.1] poll error:', err);
      return { done:false, wait: 1000 };
    }
  }

  async function pollLoop(runId){
    clearTimeout(_weightChartTimer);
    const r = await pollOnce(runId);
    if (r.done || runId !== _weightChartRunId) return;
    _weightChartTimer = setTimeout(() => pollLoop(runId), r.wait);
  }

  window.startWeightChartDataFlow_bm_bm = function(){
    console.log('%c[E3.1] START WEIGHT CHART DATA FLOW','color:#0f0');

    _weightChartRunId += 1;
    const runId = _weightChartRunId;

    clearTimeout(_weightChartTimer);
    if (_weightChartAbort) try { _weightChartAbort.abort(); } catch(_){}

    // Сначала отрисуем то, что есть в кэше (или очистим график)
    try { window.startWeightChartFlow_bm_bm && window.startWeightChartFlow_bm_bm(); } catch(_){}

    pollLoop(runId);
  };

  document.addEventListener('visibilitychange', ()=>{
    if (document.visibilityState === 'hidden'){
      clearTimeout(_weightChartTimer);
      if (_weightChartAbort) try { _weightChartAbort.abort(); } catch(_){}
    } else {
      window.startWeightChartDataFlow_bm_bm && window.startWeightChartDataFlow_bm_bm();
    }
  });

  console.log('%c[E3.1] initialized','color:#9370db');
  window.startWeightChartDataFlow_bm_bm && window.startWeightChartDataFlow_bm_bm();
})();
  
/* ============================================================
 * BLOCK E3.0 — Weight Chart View Flow (динамика веса) [FIXED]
 * ============================================================ */
(function weightChartViewFlowInit(){
  console.log('%c[E3.0] Weight chart view flow init','color:#8a2be2');

  var WEIGHT_CHART_KEY_PREFIX = 'bm:chart_weight:data:';
  
  function currentUserId_bm(){ 
    try { return window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 'anon'; } 
    catch(_){ return 'anon'; } 
  }
  
  function weightChartKey_bm(uid){ 
    return WEIGHT_CHART_KEY_PREFIX + String(uid ?? currentUserId_bm()); 
  }
  
  function loadWeightChartCache_bm(uid){ 
    try { 
      const raw = localStorage.getItem(weightChartKey_bm(uid ?? currentUserId_bm())); 
      return raw ? JSON.parse(raw) : null; 
    } catch(_) { return null; } 
  }

  // Улучшенная функция конвертации (понимает и массив, и объект)
  function convertToWeightChartFormat(inputData){
    if (!inputData) return [];
    
    var source = inputData;
    if (inputData.series) source = inputData.series;
    else if (inputData.data) source = inputData.data;
    
    var result = [];
    
    // Вариант А: Массив [{date, weight}, ...]
    if (Array.isArray(source)) {
      for (var i = 0; i < source.length; i++) {
        var entry = source[i];
        var w = (typeof entry.weight === 'number') ? entry.weight : entry[1];
        var dStr = entry.date || entry[0];
        
        if (dStr && typeof w === 'number') {
          if (dStr.includes('-') || dStr.includes('T')) {
             try {
               var dobj = new Date(dStr);
               dStr = dobj.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
             } catch(_){}
          }
          result.push({ date: dStr, weight: w });
        }
      }
    }
    // Вариант Б: Объект {"YYYY-MM-DD": weight}
    else if (typeof source === 'object') {
      var dates = Object.keys(source).sort(function(a, b){ return new Date(a) - new Date(b); });
      for (var j = 0; j < dates.length; j++) {
        var dateKey = dates[j];
        var val = source[dateKey];
        var weight = (typeof val === 'object' && val.weight) ? val.weight : val;
        
        if (typeof weight === 'number') {
           var d = new Date(dateKey);
           var dateStr = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
           result.push({ date: dateStr, weight: weight });
        }
      }
    }
    return result;
  }

  function renderWeightChart(chartWeightData){
    // Ищем глобальный объект графика
    var ChartApi = window.WeightChart || (typeof WeightChart !== 'undefined' ? WeightChart : null);

    if (!ChartApi || !ChartApi.setData) {
      console.log('%c[E3.0] WeightChart api not ready yet','color:#f00');
      return; 
    }

    if (!chartWeightData || !chartWeightData.data){
      ChartApi.setData(null); 
      return;
    }
    
    var formattedData = convertToWeightChartFormat(chartWeightData.data);
    if (formattedData.length === 0) return;
    
    ChartApi.setData(formattedData);
  }

  function targetRow(){
    return (typeof desiredRow === 'function' && desiredRow() != null)
      ? desiredRow()
      : (typeof getRowCalcForUser_bm === 'function' ? getRowCalcForUser_bm() : null);
  }

  window.startWeightChartFlow_bm_bm = function(){
    console.log('%c[E3.0] START VIEW FLOW','color:#8a2be2');
    var target = targetRow();
    var cached = loadWeightChartCache_bm();

    // Если кэш есть — рисуем сразу
    if (cached?.data && !(target && Number(cached.row||0) < Number(target))) {
      renderWeightChart(cached);
    } else {
      renderWeightChart(null);
    }
  };
  
  // Пытаемся запуститься сразу, если DOM уже готов
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(window.startWeightChartFlow_bm_bm, 50);
  }
})();

  
/* ============================================================
 * E3 Динамика веса (Native SVG Filter for iOS + Fixed Density)
 * ============================================================ */
window.WeightChart = (function() {
  'use strict';

  let chart, yAxis, scroll, inner;
  const PADDING = { top: 30, right: 30, bottom: 30, left: 15 };
  const HEIGHT = 220;
  const Y_AXIS_WIDTH = 32;
  const VISIBLE_POINTS = 5; // Видим 5 точек на экране
  const GRID_LINES = 5;

  function createSVGElement(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
  }

  // Создаем нативный SVG фильтр для свечения (работает на iOS лучше CSS)
  function createGlowFilter(svg) {
    // Проверяем, есть ли уже defs
    let defs = svg.querySelector('defs');
    if (!defs) {
      defs = createSVGElement('defs');
      svg.prepend(defs);
    }
    
    // Если фильтр уже есть, не дублируем
    if (svg.getElementById('neon-glow')) return;

    const filter = createSVGElement('filter');
    filter.setAttribute('id', 'neon-glow');
    // Расширяем область фильтра, чтобы свечение не обрезалось
    filter.setAttribute('x', '-50%');
    filter.setAttribute('y', '-50%');
    filter.setAttribute('width', '200%');
    filter.setAttribute('height', '200%');

    // 1. Размытие (свечение)
    const blur = createSVGElement('feGaussianBlur');
    blur.setAttribute('stdDeviation', '3.5'); // Сила размытия
    blur.setAttribute('result', 'coloredBlur');

    // 2. Объединяем размытие и оригинальную линию
    const merge = createSVGElement('feMerge');
    const node1 = createSVGElement('feMergeNode');
    node1.setAttribute('in', 'coloredBlur');
    const node2 = createSVGElement('feMergeNode');
    node2.setAttribute('in', 'SourceGraphic'); // Сама белая линия поверх

    merge.appendChild(node1);
    merge.appendChild(node2);
    filter.appendChild(blur);
    filter.appendChild(merge);
    defs.appendChild(filter);
  }

  function getSmoothPath(points) {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i === 0 ? 0 : i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  }

  function draw(data) {
    if (!chart || !data || data.length === 0) return;

    // --- 1. Логика плотности (чтобы не растаскивало по углам) ---
    const containerWidth = scroll.clientWidth || 300;
    // Фиксированный шаг: ширина экрана / (желаемое кол-во точек - 1)
    const step = (containerWidth - PADDING.left - PADDING.right) / (VISIBLE_POINTS - 1);
    
    // Итоговая ширина SVG
    const contentWidth = PADDING.left + PADDING.right + (data.length - 1) * step;
    const svgWidth = Math.max(containerWidth, contentWidth);
    const chartHeight = HEIGHT - PADDING.top - PADDING.bottom;

    // --- 2. Масштабирование Y ---
    const weights = data.map(d => d.weight);
    let minWeight = Math.min(...weights);
    let maxWeight = Math.max(...weights);
    const range = maxWeight - minWeight;
    const paddingY = range === 0 ? 1 : range * 0.3;
    minWeight -= paddingY;
    maxWeight += paddingY;

    const xScale = i => PADDING.left + i * step;
    const yScale = w => PADDING.top + (1 - (w - minWeight) / (maxWeight - minWeight)) * chartHeight;

    // --- 3. DOM ---
    inner.style.minWidth = svgWidth + 'px';
    chart.setAttribute('width', svgWidth);
    chart.setAttribute('height', HEIGHT);
    yAxis.setAttribute('width', Y_AXIS_WIDTH);
    yAxis.setAttribute('height', HEIGHT);
    chart.innerHTML = '';
    yAxis.innerHTML = '';

    // Важно: создаем фильтр внутри этого SVG
    createGlowFilter(chart);

    // Сетка
    for (let i = 0; i <= GRID_LINES; i++) {
      const y = PADDING.top + (i / GRID_LINES) * chartHeight;
      const value = maxWeight - (i / GRID_LINES) * (maxWeight - minWeight);
      
      const label = createSVGElement('text');
      label.setAttribute('x', Y_AXIS_WIDTH - 4);
      label.setAttribute('y', y + 4);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('class', 'wc-grid-label');
      label.textContent = value.toFixed(0);
      yAxis.appendChild(label);

      const line = createSVGElement('line');
      line.setAttribute('x1', 0); line.setAttribute('y1', y);
      line.setAttribute('x2', svgWidth); line.setAttribute('y2', y);
      line.setAttribute('class', 'wc-grid-line');
      chart.appendChild(line);
    }

    const points = data.map((d, i) => ({ x: xScale(i), y: yScale(d.weight) }));

    // Ось X
    data.forEach((d, i) => {
      const label = createSVGElement('text');
      label.setAttribute('x', points[i].x);
      label.setAttribute('y', HEIGHT - 6);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'wc-axis-label');
      label.textContent = d.date;
      chart.appendChild(label);
    });

    // --- ЛИНИЯ С SVG ФИЛЬТРОМ ---
    const pathD = getSmoothPath(points);
    const line = createSVGElement('path');
    line.setAttribute('d', pathD);
    line.setAttribute('class', 'wc-line');
    
    // ПРИМЕНЯЕМ ФИЛЬТР ЗДЕСЬ
    line.setAttribute('filter', 'url(#neon-glow)');
    // На всякий случай дублируем через стиль для Safari
    line.style.filter = 'url(#neon-glow)';
    
    chart.appendChild(line);

    // Точки и метки
    points.forEach((p, i) => {
      const label = createSVGElement('text');
      label.setAttribute('x', p.x);
      label.setAttribute('y', p.y - 16);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'wc-point-label');
      // Парсим число, убираем .0
      label.textContent = parseFloat(data[i].weight.toFixed(1));
      chart.appendChild(label);

      const point = createSVGElement('circle');
      point.setAttribute('cx', p.x);
      point.setAttribute('cy', p.y);
      point.setAttribute('r', 5);
      point.setAttribute('class', 'wc-point');
      // Точкам тоже можно дать легкое свечение, если хочется
      // point.setAttribute('filter', 'url(#neon-glow)'); 
      chart.appendChild(point);
    });

    requestAnimationFrame(() => { 
      if (data.length > VISIBLE_POINTS) {
          scroll.scrollLeft = scroll.scrollWidth; 
      } else {
          scroll.scrollLeft = 0;
      }
    });
  }

  return {
    init: function(data) {
      chart = document.getElementById('wcChart');
      yAxis = document.getElementById('wcYAxis');
      scroll = document.getElementById('wcScroll');
      inner = document.getElementById('wcInner');
      if(data) draw(data);
    },
    setData: function(data) {
      if (!chart) { 
         chart = document.getElementById('wcChart');
         if (!chart) return; 
         this.init(data); return; 
      }
      if (data === null) { chart.innerHTML = ''; return; }
      draw(data);
    }
  };
})();

/* ============================================================
 * BLOCK P (Admin): «Скорость работы»
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
 * BLOCK Z: Аккордеон + видимость секций
 * ============================================================ */

/* === Survey: haptics + events + visibility === */
(function(){
  const TMA = window.Telegram?.WebApp;
  try{ TMA?.ready?.(); }catch(_){}
  const hapticImpact = (type='light')=>{ try{ TMA?.HapticFeedback?.impactOccurred?.(type); }catch(_){} };
  const hapticSelect = ()=>{ try{ TMA?.HapticFeedback?.selectionChanged?.(); }catch(_){} };
  const bump = el => { if(!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); };

  document.addEventListener('pointerdown', (e)=>{
    //const el = e.target.closest?.('.binary-btn, .choice-item, #bf-none-wrap, #saveBtn');
      const el = e.target.closest?.('.binary-btn, #saveBtn');
    
    if (!el) return;
    hapticImpact('light'); bump(el);
  }, {passive:true});

  document.addEventListener('click', (e)=>{
    const bbtn = e.target.closest?.('.binary-btn');
    if (bbtn){
      const field = bbtn.dataset.field;
      document.querySelectorAll('.binary-btn[data-field="'+field+'"]').forEach(b=>{ b.classList.remove('active'); b.setAttribute('aria-pressed','false'); });
      bbtn.classList.add('active'); bbtn.setAttribute('aria-pressed','true');
      hapticSelect(); // updateCycleVisibility();
      return;
    }
    }, {passive:true});
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
    const lastTime = (typeof getLastMeasurementTime_bm === 'function') && getLastMeasurementTime_bm();
    if (lastTime) updateLastTimeDisplay(lastTime);
  } catch(_){}
})();


// Автоматическая инициализация при загрузке
document.addEventListener('DOMContentLoaded', function() {
  // 1. Инициализируем сам график (находит элементы в DOM)
  if (window.WeightChart) window.WeightChart.init();

  // 2. 🔥 ВАЖНО: Сразу рисуем данные из кэша (чтобы не ждать 3 секунды)
  if (typeof window.startWeightChartFlow_bm_bm === 'function') {
    window.startWeightChartFlow_bm_bm(); 
  }

  // 3. И только потом запускаем опрос сервера за новыми данными
  if (typeof window.startWeightChartDataFlow_bm_bm === 'function') {
    window.startWeightChartDataFlow_bm_bm();
  }
});

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