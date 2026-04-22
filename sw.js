const CACHE_NAME = 'chunjen-pwa-v1';

// 安裝時立刻接管
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// 攔截網路請求 (為了配合我們系統「每次都要最新資料」的要求，這裡設定只要有網路就去雲端抓)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
