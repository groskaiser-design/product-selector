 // Глобальные переменные
    const tg = window.Telegram?.WebApp;
    const HOME_URL = './router.html';

    /* ==================================================================
       1. TELEGRAM SETUP (КНОПКА НАЗАД - ОТДЕЛЬНО)
       ================================================================== */
    function setupTelegramBackButton() {
      if (!tg) return;
      try {
        tg.ready();
        tg.expand();
        tg.setHeaderColor?.('#050505'); 
        if (tg.isVersionAtLeast?.('6.1')) tg.disableVerticalSwipes?.();
        
        const back = tg.BackButton;
        if (back) {
           back.show();
           // Безопасный сброс старых обработчиков
           if (typeof back.offClick === 'function') {
              try { back.offClick(); } catch(e){}
           }
           // Установка нового обработчика
           back.onClick(() => { 
              // Вибрация для отклика
              if(tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
              location.href = HOME_URL; 
           });
        }
      } catch (e) {
        console.warn('TG setup error:', e);
      }
    }

    /* ==================================================================
       2. LAYOUT
       ================================================================== */
    (function initStableLayout() {
      const app = document.querySelector('.container');
      const inputArea = document.getElementById('inputArea');
      const chatArea = document.getElementById('chatArea');
      const input = document.getElementById('messageInput');

      function setHeight() {
        if(!app) return;
        const h = (tg && tg.viewportHeight) ? tg.viewportHeight : window.innerHeight;
        app.style.height = `${h}px`;
        
        if(inputArea) {
           const inputH = inputArea.offsetHeight;
           // Динамический отступ, чтобы поле ввода не перекрывало текст
           chatArea.style.paddingBottom = `${inputH + 40}px`;
        }
      }

      if (tg) {
        tg.onEvent('viewportChanged', ({ isStateStable }) => {
          setHeight();
          if (isStateStable) requestAnimationFrame(() => { chatArea.scrollTop = chatArea.scrollHeight; });
        });
      } else {
        window.addEventListener('resize', setHeight);
      }
      setHeight();

      if (input) {
        input.addEventListener('input', () => { requestAnimationFrame(setHeight); });
        input.addEventListener('focus', () => { setTimeout(() => { chatArea.scrollTop = chatArea.scrollHeight; }, 300); });
      }
    })();

    // ЗАПУСК НАСТРОЙКИ ТЕЛЕГРАМ
    setupTelegramBackButton();

    /* ==================================================================
       3. CHAT LOGIC
       ================================================================== */
    const BACKEND_URL = 'https://script.google.com/macros/s/AKfycbzvlDKUH6qsON-A6iSHYvMU_6XWtReZc5oXnnZOMTgETfvZqMMh2zUbdQJF-iOanMBc/exec';
    const REQUEST_TIMEOUT_MS = 45000;

    let messages = [];
    let isTyping = false;

    const chatArea = document.getElementById('chatArea');
    const emptyState = document.getElementById('emptyState');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const clearBtn = document.getElementById('clearBtn'); // Может быть скрыт
    
    const modal = document.getElementById('confirmModal');
    const mTitle = document.getElementById('modalTitle');
    const mText = document.getElementById('modalText');
    let modalCallback = null;

    async function callBackend(action, payload) {
      const u = tg?.initDataUnsafe?.user || {};
      const uid = u.id || localStorage.getItem('debug_uid') || 'd-'+Math.floor(Math.random()*1e9);
      if(!u.id) localStorage.setItem('debug_uid', uid);

      const body = {
        action, user_id: uid,
        user_data: { first_name: u.first_name, username: u.username },
        init_data: tg?.initData || '',
        ...payload
      };

      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const res = await fetch(BACKEND_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        clearTimeout(id);
        return await res.json();
      } catch (e) {
        return { success:false, error: String(e) };
      }
    }

    function formatTime(ts) {
      const d = new Date(ts);
      return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
    }

    function createMessageElement(m, idx) {
      const div = document.createElement('div');
      div.className = `message ${m.role}`;
      
      const bubble = document.createElement('div');
      bubble.className = 'message-bubble';
      bubble.innerHTML = m.content.replace(/\n/g, '<br>');
      
      const delBtn = document.createElement('div');
      delBtn.className = 'delete-btn';
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/></svg>';
      delBtn.onclick = (e) => { e.stopPropagation(); confirmDelete(idx); };

      let timer;
      bubble.addEventListener('touchstart', () => timer = setTimeout(() => {
         div.classList.add('show-delete');
         if(tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
      }, 500));
      bubble.addEventListener('touchend', () => clearTimeout(timer));

      const time = document.createElement('div');
      time.className = 'message-time';
      time.textContent = formatTime(m.timestamp);

      div.appendChild(delBtn);
      div.appendChild(bubble);
      div.appendChild(time);
      return div;
    }

    function createTypingIndicator() {
      const div = document.createElement('div');
      div.className = 'message ai'; div.id = 'typingIndicator';
      div.innerHTML = `<div class="message-bubble"><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>`;
      return div;
    }

    function renderMessages() {
      Array.from(chatArea.children).forEach(c => { if(c.id!=='emptyState') c.remove(); });
      if(messages.length > 0) {
        emptyState.style.display = 'none';
        messages.forEach((m,i) => chatArea.appendChild(createMessageElement(m,i)));
      } else {
        emptyState.style.display = 'flex';
      }
      requestAnimationFrame(() => chatArea.scrollTop = chatArea.scrollHeight);
    }

    function autoResizeTextarea(){
        messageInput.style.height='auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight,120)+'px';
    }

    function updateSendButton(){ const t=messageInput.value.trim(); sendBtn.disabled = !t || isTyping; }

    async function sendMessage() {
      const text = messageInput.value.trim();
      if(!text || isTyping) return;
      if(tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');

      messages.push({ role:'user', content:text, timestamp:Date.now() });
      localStorage.setItem('ai_chat_messages', JSON.stringify(messages));
      renderMessages();

      messageInput.value = ''; autoResizeTextarea(); updateSendButton();
      isTyping = true;

      chatArea.appendChild(createTypingIndicator());
      chatArea.scrollTop = chatArea.scrollHeight;

      const res = await callBackend('send_message', { message: text });
      isTyping = false;
      const typ = document.getElementById('typingIndicator');
      if(typ) typ.remove();

      let aiContent = 'Ошибка сети';
      if(res.success) {
         aiContent = res.text || 'Пустой ответ';
         if(tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
      } else {
         aiContent = res.error || 'Ошибка сервера';
         if(tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
      }

      messages.push({ role:'ai', content:aiContent, timestamp:Date.now() });
      localStorage.setItem('ai_chat_messages', JSON.stringify(messages));
      renderMessages();
    }

    function confirmDelete(i) {
      if(mTitle) mTitle.textContent = 'Удалить?';
      if(mText) mText.textContent = 'Действие необратимо.';
      modalCallback = () => {
         messages.splice(i,1);
         localStorage.setItem('ai_chat_messages', JSON.stringify(messages));
         renderMessages();
      };
      modal.classList.add('show');
    }

    // Если кнопка очистки скрыта, но существует в DOM, логику вешаем (на всякий случай)
    if(clearBtn) clearBtn.onclick = () => {
      if(!messages.length) return;
      if(mTitle) mTitle.textContent = 'Очистить историю?';
      if(mText) mText.textContent = 'Начнется новый диалог.';
      modalCallback = async () => {
         messages = [];
         localStorage.removeItem('ai_chat_messages');
         renderMessages();
         callBackend('clear_history', {});
      };
      modal.classList.add('show');
    };

    document.getElementById('modalCancel').onclick = () => modal.classList.remove('show');
    document.getElementById('modalConfirm').onclick = () => { if(modalCallback) modalCallback(); modal.classList.remove('show'); };
    
    messageInput.addEventListener('input', ()=>{ updateSendButton(); autoResizeTextarea(); });
    messageInput.addEventListener('keydown', (e) => { if(e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    sendBtn.onclick = sendMessage;

    document.addEventListener('click', (e) => {
       document.querySelectorAll('.message.show-delete').forEach(el => { if(!el.contains(e.target)) el.classList.remove('show-delete'); });
    });

    const saved = localStorage.getItem('ai_chat_messages');
    if(saved) { try { messages = JSON.parse(saved); renderMessages(); } catch(e){} }
    updateSendButton();