 const tg = window.Telegram.WebApp;
  const BOT_USERNAME = "llmacros_bot";
  
  // Инициализация
  if(tg) {
    tg.ready();
    tg.expand();
    tg.setHeaderColor('#050505'); 
    tg.setBackgroundColor('#050505');
    
    // Кнопка назад -> router.html
    if(tg.BackButton) {
        tg.BackButton.show();
        tg.BackButton.onClick(function() {
            haptic('light');
            window.location.href = 'router.html';
        });
    }
  }

  const userId = tg.initDataUnsafe?.user?.id || '12345'; 
  const refLink = `https://t.me/${BOT_USERNAME}?start=ref_${userId}`;

  // Рендер QR
  const qrCode = new QRCodeStyling({
    width: 200,
    height: 200,
    type: "svg",
    data: refLink,
    dotsOptions: { color: "#000000", type: "rounded" },
    backgroundOptions: { color: "#ffffff" },
    imageOptions: { crossOrigin: "anonymous", margin: 10 },
    cornersSquareOptions: { type: "extra-rounded" },
    cornersDotOptions: { type: "dot" }
  });
  qrCode.append(document.getElementById("qrcode"));

  // ИЗМЕНЕНО: Логика кнопки "Поделиться" с использованием нативного меню
  function shareRef() {
    haptic('medium');
    
    const textToShare = `Присоединяйся к Macros. Это закрытая экосистема для биохакинга: контроль питания, умные тренировки и ментальное здоровье под контролем Ai.\n\nТвой персональный доступ:\n${refLink}`;
    
    // Проверяем поддержку нативного шаринга браузером
    if (navigator.share) {
      navigator.share({
        text: textToShare
      })
      .catch((error) => console.log('Ошибка при шаринге', error));
    } else {
      // Fallback (запасной вариант) для старых устройств - открывает только Telegram
      const shareUrl = `https://t.me/share/url?url=&text=${encodeURIComponent(textToShare)}`;
      tg.openTelegramLink(shareUrl);
    }
  }

  // ИЗМЕНЕНО: Функция copyRef() удалена за ненадобностью

  function haptic(style) {
    if(tg.HapticFeedback) tg.HapticFeedback.impactOccurred(style);
  }