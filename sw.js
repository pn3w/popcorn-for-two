// Service worker ขั้นต่ำ เพื่อให้ติดตั้งเป็นแอปและรับ "แชร์" จากแอปอื่นได้ (Android)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => new Response(
      '<meta charset="utf-8"><body style="background:#131118;color:#eee;font-family:sans-serif;padding:2rem">ออฟไลน์อยู่ ต่อเน็ตแล้วลองใหม่</body>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
  }
});
