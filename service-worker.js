const CACHE_NAME = 'pedeai-v35';
const FILES_TO_CACHE = [
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'index.js',
  'carrinho.js',
  'classifieds-app.js',
  'overlay.js',
  'config.js'
];

// Instala
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

// Ativa
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch - Estratégia Network First para documentos e scripts para evitar travas no carregamento
self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate' || e.request.destination === 'script') {
    e.respondWith(
      fetch(e.request).then(response => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, responseClone));
        return response;
      }).catch(() => caches.match(e.request))
    );
  } else {
    // Vídeos: nunca interceptar — deixar o navegador gerenciar Range Requests nativamente
    if (e.request.destination === 'video') {
      return;
    }

    e.respondWith(
  caches.match(e.request).then(async (resp) => {
    if (resp) return resp;

    const response = await fetch(e.request);

    // Salva apenas IMAGENS do Cloudinary — vídeos são excluídos
    // porque Range Requests de vídeo são incompatíveis com Cache API
    if (
      e.request.url.includes('res.cloudinary.com') &&
      e.request.destination === 'image'
    ) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(e.request, response.clone());
    }

    return response;
  })
);
  }
});