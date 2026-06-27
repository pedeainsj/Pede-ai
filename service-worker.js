const CACHE_NAME = 'pedeai-v57';
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

// Limite máximo de imagens guardadas no cache. Acima disso, as entradas
// mais antigas são removidas (estratégia LRU simples) para evitar que o
// Cache Storage cresça indefinidamente conforme o usuário navega entre
// produtos — crescimento sem limite é a causa raiz da lentidão progressiva
// observada após várias navegações.
const MAX_IMAGENS_CACHE = 60;

async function limitarTamanhoCache(cacheName, maxItens) {
  const cache = await caches.open(cacheName);
  const chaves = await cache.keys();
  if (chaves.length <= maxItens) return;

  // Remove as entradas mais antigas (as primeiras adicionadas) até
  // voltar ao limite. cache.keys() preserva a ordem de inserção.
  const excedente = chaves.length - maxItens;
  for (let i = 0; i < excedente; i++) {
    await cache.delete(chaves[i]);
  }
}

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
      Promise.all(
        keys.map(k => {
          if (k !== CACHE_NAME) {
            console.log('[SW] Removendo cache antigo:', k);
            return caches.delete(k);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch - Estratégia Network First com validação de versão
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Para scripts e documentos, sempre buscar da rede primeiro e validar
  if (e.request.mode === 'navigate' || e.request.destination === 'script') {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }) // ignora cache HTTP
        .then(response => {
          // Atualiza o cache em segundo plano
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return response;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Vídeos: nunca interceptar
  if (e.request.destination === 'video') {
    return;
  }

  e.respondWith(
    caches.match(e.request).then(async (resp) => {
      if (resp) return resp;

      const response = await fetch(e.request);
      // Salva apenas imagens do Cloudinary
      if (
        url.hostname.includes('res.cloudinary.com') &&
        e.request.destination === 'image'
      ) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(e.request, response.clone());
        // Mantém o cache de imagens dentro de um limite saudável,
        // evitando a degradação de performance do Cache Storage que
        // ocorre conforme o número de entradas cresce sem controle.
        limitarTamanhoCache(CACHE_NAME, MAX_IMAGENS_CACHE);
      }
      return response;
    })
  );
});



// Recebe mensagem do client para forçar recarga
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});