(function() {
    // 1. Скрываем экран, чтобы не моргало старым дизайном
    const style = document.createElement('style');
    style.innerHTML = 'body { opacity: 0 !important; transition: opacity 0.2s ease; pointer-events: none; }';
    document.head.appendChild(style);

    function showPage() {
        style.innerHTML = 'body { opacity: 1 !important; pointer-events: auto; }';
    }

    // Если инет тупит, через 2 сек все равно покажем страницу
    const safetyTimeout = setTimeout(showPage, 2000);

    const antiCache = Date.now();
    fetch('versions.json?t=' + antiCache)
        .then(res => {
            if (!res.ok) throw new Error("JSON fail");
            return res.json();
        })
        .then(data => {
            let currentPage = window.location.pathname.split('/').pop();
            if (!currentPage || currentPage === '/') currentPage = 'index.html';
            if (currentPage.includes('?')) currentPage = currentPage.split('?')[0];

            const requiredVersion = data.pages[currentPage] || data.default;
            const url = new URL(window.location.href);
            const currentVersion = url.searchParams.get('v');

            if (currentVersion !== requiredVersion) {
                // ВЕРСИИ РАЗНЫЕ -> ОБНОВЛЯЕМ
                url.searchParams.set('v', requiredVersion);
                window.location.replace(url.href);
            } else {
                // ВЕРСИИ СОВПАЛИ -> ПОКАЗЫВАЕМ
                clearTimeout(safetyTimeout);
                showPage();
            }
        })
        .catch(err => {
            console.error(err);
            clearTimeout(safetyTimeout);
            showPage();
        });
})();
