import { db, GetRegrasLojista, APP_URL } from './config.js';
import { collection, getDocs, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Verifica se o Service Worker foi atualizado e recarrega a página
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[SW] Controller mudou, recarregando para garantir nova versão');
        window.location.reload();
    });
}

let todosProdutos = [];
let modoAtual = sessionStorage.getItem('pedeai_mode') || 'products';
let filtroChip = '';
let filtroTexto = '';
let animationId = null;
let isReturning = false;
let inicializacaoEmAndamento = false; // mutex: evita inicializar() concorrente (causa raiz da duplicação)
let inicializacaoPromiseAtual = null; // guarda a Promise da inicialização em andamento, para que uma chamada concorrente (ex: listener 'online' x clique) AGUARDE o mesmo resultado em vez de ser descartada em silêncio

// Timeout seguro para qualquer Promise
function withTimeout(promise, ms, message = 'Operação excedeu o tempo limite') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);
}

// Cache para armazenar a posição do scroll de cada categoria
const scrollModesCache = {
    'products': 0,
    'restaurants': 0,
    'classifieds': 0
};

const urlCache = new Map();
function otimizarURL(url, width = 400) {
    if (!url || typeof url !== 'string') return url;
    if (!url.includes('cloudinary.com')) return url;
    const key = `${url}|${width}`;
    if (urlCache.has(key)) return urlCache.get(key);
    
    // Só aplica transformação se a URL já não tiver parâmetros otimizados
    if (url.includes('f_auto') && url.includes('q_auto')) {
        urlCache.set(key, url);
        return url;
    }
    
    const optimized = url.replace(/\/upload\/(.*?)(\/v\d+\/)/, `/upload/f_auto,q_auto:eco,w_${width},c_limit$2`);
    urlCache.set(key, optimized);
    return optimized;
}

function otimizarVideoURL(url) {
    if (!url || typeof url !== 'string') return url;
    if (!url.includes('res.cloudinary.com')) return url;
    if (!url.includes('/video/upload/')) return url;
    // Já tem transformação aplicada — não duplicar
    if (url.includes('q_auto') || url.includes('f_auto')) return url;
    return url.replace('/video/upload/', '/video/upload/f_auto,q_auto:low,vc_auto/');
}

// Função auxiliar para gerar HTML de mídia (imagem ou vídeo) no card
function renderizarMediaCard(produto, modo) {
    if (produto.videoUrl && produto.videoUrl.trim() !== "") {
    const videoId = `vid_${produto.id}`;
    const posterUrl = produto.videoUrl && produto.videoUrl.includes('res.cloudinary.com') ? produto.videoUrl.replace('/video/upload/', '/video/upload/so_0/').replace(/\.(mp4|mov|webm)$/i, '.jpg') : '';
    return `
        <div style="position: relative; width: 100%; height: 100%; background: ${posterUrl ? `url('${posterUrl}') center/cover no-repeat` : '#1a1a1a'};">
            <video 
    id="${videoId}"
    data-src="${otimizarVideoURL(produto.videoUrl)}"
    poster="${posterUrl}"
    preload="none"
    muted
    playsinline
    style="width: 100%; height: 100%; object-fit: cover; will-change: transform; opacity: 0; transition: opacity 0.2s ease;"
></video>
            <div style="position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.6); border-radius: 20px; padding: 4px 8px; display: flex; align-items: center; gap: 4px; backdrop-filter: blur(4px);">
                <i class="fas fa-play" style="font-size: 10px; color: white;"></i>
                <span style="font-size: 9px; color: white;">Vídeo</span>
            </div>
        </div>
    `;
   } else {
        const imgUrl = produto.foto || (produto.fotos && produto.fotos[0]) || "https://via.placeholder.com/300";
        const imgOptimized = otimizarURL(imgUrl, 400);
        return `<img src="${imgOptimized}" loading="lazy" style="width: 100%; height: 230px; background: #fcfcfc; padding: 4px; border-radius: 14px 14px 0 0; display: block; transition: 0.2s; object-fit: cover;">`;
    }
}

const MAPAS_FILTROS = {
    'products': {
        'eletrônicos': ['ventilador', 'tv', 'televisao', 'eletronico', 'fone', 'liquidificador', 'eletro', 'aparelho', 'som', 'computador', 'notebook', 'pc', 'bivolt', 'voltagem', 'microondas', 'geladeira'],
        'celulares': ['celular', 'smartphone', 'iphone', 'samsung', 'xiaomi', 'motorola', 'redmi', 'android', 'ios', 'capinha', 'carregador'],
        'ferramentas': ['ferramenta', 'furadeira', 'makita', 'serra', 'pa', 'martelo', 'chave', 'parafusadeira', 'trena', 'alicate'],
        'cosméticos': ['batom', 'perfume', 'desodorante', 'creme', 'hidratante', 'maquiagem', 'shampoo', 'condicionador', 'esmalte', 'beleza', 'cosmetico'],
        'promoção': ['promoção', 'promocao', 'oferta', 'queima', 'desconto', 'liquidando', 'barato', 'off']
    },
    'restaurants': {
        'lanches': ['lanche', 'hamburguer', 'hambúrguer', 'pastel', 'pizza', 'sanduiche', 'artesanal', 'hot dog'],
        'bebidas': ['bebida', 'refrigerante', 'suco', 'água', 'coca', 'guaraná', 'cerveja', 'vinho', 'refri'],
        'sorvetes': ['sorvete', 'picolé', 'açaí', 'gelato', 'casquinha'],
        'doces': ['doce', 'bolo', 'chocolate', 'brownie', 'pudim', 'torta', 'confeitaria'],
        'salgados': ['salgado', 'coxinha', 'empada', 'quibe', 'kibe', 'enroladinho', 'esfiha'],
        'fitness': ['fitness', 'fit', 'saudavel', 'salada', 'legumes', 'marmita fitness', 'marmita fit', 'leve', 'diet', 'natural'],
        'promoção': ['promoção', 'promocao', 'oferta', 'combo', 'desconto', 'barato', 'off']
    },
    'classifieds': {
        'veículos': ['carro', 'moto', 'caminhão', 'veiculo', 'automóvel', 'pick-up', 'carreta'],
        'imóveis': ['casa', 'lote', 'terreno', 'imóvel', 'apartamento', 'sitio', 'fazenda', 'aluguel'],
        'animais': ['gado', 'boi', 'vaca', 'cavalo', 'porco', 'ovino', 'bezerro', 'nelore'],
        'máquinas': ['trator', 'máquina', 'equipamento', 'agricola', 'ferramenta usada', 'industrial'],
        'outros': []
    }
};

const CHIPS_POR_MODO = {
    'products': ['Todos', 'Eletrônicos', 'Celulares', 'Ferramentas', 'Cosméticos', 'Promoção'],
    'restaurants': ['Todos', 'Lanches', 'Bebidas', 'Sorvetes', 'Doces', 'Salgados', 'Fitness', 'Promoção'],
    'classifieds': ['Todos', 'Veículos', 'Imóveis', 'Animais', 'Máquinas', 'Outros']
};

function normalizar(texto) {
    return texto ? texto.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
}

const ordemFixaCache = {};

function aplicarAlgoritmoVisibilidade(lista) {
    const pesos = { 'vip': 5, 'premium': 3, 'basico': 1 };
    const obterSeed = (id) => {
        if (ordemFixaCache[id] === undefined) {
            ordemFixaCache[id] = Math.random() - 0.5;
        }
        return ordemFixaCache[id];
    };

    const grupos = {
        vip: lista.filter(p => p.planoLojista === 'vip').sort((a, b) => obterSeed(a.id) - obterSeed(b.id)),
        premium: lista.filter(p => p.planoLojista === 'premium').sort((a, b) => obterSeed(a.id) - obterSeed(b.id)),
        basico: lista.filter(p => (p.planoLojista === 'basico' || !p.planoLojista)).sort((a, b) => obterSeed(a.id) - obterSeed(b.id))
    };

    const resultado = [];
    const totalVip = grupos.vip.length;
    const totalPremium = grupos.premium.length;
    const totalBasico = grupos.basico.length;
    let iV = 0, iP = 0, iB = 0;

    while (iV < totalVip || iP < totalPremium || iB < totalBasico) {
        for (let j = 0; j < pesos.vip && iV < totalVip; j++) resultado.push(grupos.vip[iV++]);
        for (let j = 0; j < pesos.premium && iP < totalPremium; j++) resultado.push(grupos.premium[iP++]);
        for (let j = 0; j < pesos.basico && iB < totalBasico; j++) resultado.push(grupos.basico[iB++]);
    }
    return resultado;
}

const ESTADOS_INIT = {
    INICIANDO: 'INICIANDO',
    CARREGANDO_FIREBASE: 'CARREGANDO_FIREBASE',
    CARREGANDO_PRODUTOS: 'CARREGANDO_PRODUTOS',
    CARREGANDO_CATEGORIAS: 'CARREGANDO_CATEGORIAS',
    CARREGANDO_CARROSSEL: 'CARREGANDO_CARROSSEL',
    RENDERIZACAO_CONCLUIDA: 'RENDERIZACAO_CONCLUIDA',
    ERRO: 'ERRO'
};

let estadoInitAtual = null;
function setEstadoInit(novoEstado) {
    estadoInitAtual = novoEstado;
    console.log(`[init] ${novoEstado}`);
}

// Verifica de fato, no DOM, que cada seção saiu do skeleton e tem conteúdo real.
// Esta é a ÚNICA condição que autoriza a transição para RENDERIZACAO_CONCLUIDA.
function renderizacaoFoiConcluida() {
    const grid = document.getElementById('grid-produtos');
    const chips = document.getElementById('chipContainer');

    const gridOk = !!grid && grid.children.length > 0 && !grid.querySelector('[data-skeleton]');
    const chipsOk = !!chips && chips.children.length > 0;

    // O carrossel é opcional (pode legitimamente ficar vazio se não há produtos turbo),
    // então não bloqueia a conclusão — inicializarArialProdutos() já trata esse caso.
    return gridOk && chipsOk;
}

function inicializar(opts = {}) {
    const { forceReset = false } = opts;
    if (forceReset) {
        // Reset completo do estado
        todosProdutos = [];
        sessionStorage.removeItem('todosProdutosCache');
        sessionStorage.removeItem('pedeai_dom_cache');
        sessionStorage.removeItem('pedeai_carousel_cache');
        sessionStorage.removeItem('pedeai_scroll');
        urlCache.clear();
        for (const key in ordemFixaCache) delete ordemFixaCache[key];
        // Limpa DOM para skeleton
        const grid = document.getElementById('grid-produtos');
        if (grid) {
            grid.innerHTML = `
                <div class="skeleton-card"><div class="skeleton-img"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>
                <div class="skeleton-card"><div class="skeleton-img"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>
                <div class="skeleton-card"><div class="skeleton-img"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>
                <div class="skeleton-card"><div class="skeleton-img"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>
            `;
        }
        const track = document.getElementById('carouselTrack');
        if (track) track.innerHTML = '';
        const chips = document.getElementById('chipContainer');
        if (chips) chips.innerHTML = '';
    }

    if (inicializacaoPromiseAtual && !opcoes?.forceReset) {
    return inicializacaoPromiseAtual;
}
    inicializacaoPromiseAtual = (async () => {
    try {
        return await inicializarInterno();
    } finally {
        inicializacaoPromiseAtual = null;
    }
})();

return inicializacaoPromiseAtual;
}

async function inicializarInterno() {
  // Timeout global de segurança: 20 segundos
  return withTimeout(
    (async () => {
      inicializacaoEmAndamento = true;
      setEstadoInit(ESTADOS_INIT.INICIANDO);

      const removerSplash = () => {
        const splash = document.getElementById('pedeai-splash');
        if (splash) {
          splash.classList.add('splash-hidden');
          splash.addEventListener('transitionend', () => splash.remove(), { once: true });
          setTimeout(() => { if (splash.isConnected) splash.remove(); }, 600);
        }
        sessionStorage.setItem('splashExibido', 'true');
      };

      // Fallback para remover splash se o Firestore travar
      const splashFallbackTimer = setTimeout(() => {
        console.warn('[init] fallback de segurança acionado — Firestore não respondeu a tempo');
        removerSplash();
        if (!navigator.onLine) mostrarEstadoOffline();
        // AGORA TAMBÉM REJEITAMOS A PROMISE PARA DESBLOQUEAR
        throw new Error('Firestore timeout (fallback)');
      }, 17000);

      try {
        setEstadoInit(ESTADOS_INIT.CARREGANDO_FIREBASE);

        const cachedProdutos = sessionStorage.getItem('todosProdutosCache');
        if (cachedProdutos && !todosProdutos.length) {
          try {
            todosProdutos = JSON.parse(cachedProdutos);
            console.log('Produtos restaurados do cache');
          } catch(e) { console.warn(e); }
        }

        setEstadoInit(ESTADOS_INIT.CARREGANDO_PRODUTOS);

        if (todosProdutos.length === 0) {
          const timeoutFirestore = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore timeout ao reabrir o app')), ms));
          const [snapProdutos, snapUsuarios] = await Promise.race([
            Promise.all([
              getDocs(collection(db, "produtos")),
              getDocs(collection(db, "usuarios"))
            ]),
            timeoutFirestore(8000)
          ]);
          
          const dadosLojistas = {};
          snapUsuarios.forEach(u => {
            dadosLojistas[u.id] = u.data();
          });

          snapProdutos.forEach(d => {
            const data = d.data();
            if(data.promocao === 'sim' && data.promoExpira && Date.now() > data.promoExpira) data.promocao = 'nao';
            
            const lojista = dadosLojistas[data.owner];
            const regras = GetRegrasLojista(lojista);

            todosProdutos.push({ 
              id: d.id, 
              ...data, 
              nomeLoja: lojista?.nomeLoja || 'Loja Parceira',
              planoLojista: lojista?.planoAtivo || 'basico',
              isLojistaAprovado: lojista ? regras.podeExibirProdutos : false,
              isProdutoAtivo: data.status !== 'inativo' && data.visivel !== false
            });
          });
          sessionStorage.setItem('todosProdutosCache', JSON.stringify(todosProdutos));
        }

        const domCache = sessionStorage.getItem('pedeai_dom_cache');
        isReturning = (domCache !== null);

        const navAtivo = document.getElementById(`nav-${modoAtual}`);
        if(navAtivo) {
          document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
          navAtivo.classList.add('active');
        }
        
        const logo = document.getElementById('main-logo');
        if(logo) {
          let iconHtml = modoAtual === 'restaurants' ? '<i class="fas fa-utensils"></i>' : (modoAtual === 'classifieds' ? '<i class="fas fa-bullhorn"></i>' : '<i class="fas fa-bag-shopping"></i>');
          logo.innerHTML = `${iconHtml} Pede Aí`;
        }

        if (isReturning) {
          const domCache = sessionStorage.getItem('pedeai_dom_cache');
          const grid = document.getElementById('grid-produtos');
          
          if (domCache && grid && domCache.trim() !== "") {
            setEstadoInit(ESTADOS_INIT.CARREGANDO_CATEGORIAS);
            grid.innerHTML = domCache;
            grid.querySelectorAll('video').forEach(video => {
              const rawSrc = video.getAttribute('src') || video.getAttribute('data-src');
              if (rawSrc) {
                const transformedSrc = otimizarVideoURL(rawSrc);
                video.setAttribute('src', transformedSrc);
                video.removeAttribute('data-src');
              }
            });
            setEstadoInit(ESTADOS_INIT.CARREGANDO_CARROSSEL);
            const carouselCache = sessionStorage.getItem('pedeai_carousel_cache');
            const track = document.getElementById('carouselTrack');
            if (carouselCache && track) track.innerHTML = carouselCache;
            renderizarFiltros();
            const scrollPos = sessionStorage.getItem('pedeai_scroll');
            if (scrollPos) window.scrollTo(0, parseInt(scrollPos));
            isReturning = false;

            clearTimeout(splashFallbackTimer);
            setEstadoInit(ESTADOS_INIT.RENDERIZACAO_CONCLUIDA);
            removerSplash();
            window.IosOverlayManager?.hideAll();
            garantirRenderizacaoValida();
            return;
          }
          console.warn("Cache do grid inválido ou vazio. Recriando normalmente.");
          isReturning = false;
        }

        setEstadoInit(ESTADOS_INIT.CARREGANDO_CATEGORIAS);
        renderizarFiltros();

        setEstadoInit(ESTADOS_INIT.CARREGANDO_CARROSSEL);
        try { inicializarArialProdutos(); } catch (e) { console.error('Falha ao renderizar o carrossel:', e); }

        await renderizarProdutos();

        clearTimeout(splashFallbackTimer);

        if (renderizacaoFoiConcluida()) {
          setEstadoInit(ESTADOS_INIT.RENDERIZACAO_CONCLUIDA);
          removerSplash();
        } else {
          console.warn('[init] renderização não confirmada no DOM — mantendo splash removido para expor skeleton/retry');
          setEstadoInit(ESTADOS_INIT.ERRO);
          removerSplash();
        }
        window.IosOverlayManager?.hideAll();
        garantirRenderizacaoValida();

      } catch (e) { 
        console.error("Erro ao inicializar:", e); 
        setEstadoInit(ESTADOS_INIT.ERRO);
        clearTimeout(splashFallbackTimer);
        removerSplash();
        window.IosOverlayManager?.hideAll();
        if (todosProdutos.length === 0) {
          mostrarEstadoOffline();
        } else {
          garantirRenderizacaoValida();
        }
        throw e; // Re-lança para o timeout global capturar
      } finally {
        inicializacaoEmAndamento = false;
      }
    })(),
    20000, // 20 segundos
    'Tempo limite global da inicialização excedido'
  );
}

let carouselAnimationId = null;
let carouselTouchHandler = null;
let carouselEndHandler = null;
let carouselVisibilityHandler = null;

function inicializarArialProdutos() {
    const track = document.getElementById('carouselTrack');
    if (!track) return;
    
    if (carouselAnimationId) {
        cancelAnimationFrame(carouselAnimationId);
        carouselAnimationId = null;
    }
    if (carouselTouchHandler) {
        track.removeEventListener('touchstart', carouselTouchHandler);
        track.removeEventListener('touchend', carouselEndHandler);
    }
    if (carouselVisibilityHandler) {
        document.removeEventListener('visibilitychange', carouselVisibilityHandler);
        carouselVisibilityHandler = null;
    }
    
    const categoriaFirebase = modoAtual === 'restaurants' ? 'Comida' : (modoAtual === 'classifieds' ? 'Classificados' : 'Geral');
    
    const poolTurbo = todosProdutos.filter(p => 
        p.turbo === 'sim' && 
        p.categoria === categoriaFirebase &&
        p.isLojistaAprovado && 
        p.isProdutoAtivo
    );
    
    const data = aplicarAlgoritmoVisibilidade(poolTurbo).slice(0, 20);
    
    if (data.length === 0) {
        const strip = document.getElementById('featuredStrip');
        if (strip) {
            strip.style.opacity = '0';
            strip.style.pointerEvents = 'none';
            // NÃO usar visibility:hidden nem display:none — causa recálculo do sticky
            // chipContainer no iOS Safari, fazendo o cabeçalho sumir ao trocar filtros
        }
        return;
    }
    const strip = document.getElementById('featuredStrip');
    if (strip) {
        strip.style.opacity = '1';
        strip.style.pointerEvents = '';
    }

    const paramModo =
    modoAtual === 'restaurants'
        ? 'gourmet'
        : modoAtual === 'classifieds'
            ? 'anuncio'
            : 'produto';
    track.innerHTML = data.map(p => {
        const imgRaw = p.foto || (p.fotos && p.fotos[0]) || "https://via.placeholder.com/150";
        const img = imgRaw.includes('cloudinary.com') 
            ? imgRaw.replace(/\/upload\/(.*?)(\/v\d+\/)/, `/upload/f_auto,q_auto:eco,w_300,h_300,c_fill$2`)
            : imgRaw;

        return `<div class="banner-box" onclick="navegarParaProduto('${p.owner}', '${p.id}', '${paramModo}')"><img src="${img}" fetchpriority="high"><div class="banner-overlay"><span class="banner-price">R$ ${p.preco}</span></div></div>`;
    }).join('');
    
    let scrollPos = track.scrollLeft;
    let isTouching = false;
    let lastTime = 0;
    let animationFrameActive = true;

    carouselTouchHandler = () => { isTouching = true; };
    carouselEndHandler = () => { isTouching = false; scrollPos = track.scrollLeft; };
    
    track.addEventListener('touchstart', carouselTouchHandler, { passive: true });
    track.addEventListener('touchend', carouselEndHandler, { passive: true });
    
    function step(timestamp) {
        if (!animationFrameActive) return;
        if (!isTouching) {
            if (!lastTime) lastTime = timestamp;
            const elapsed = timestamp - lastTime;
            if (elapsed > 16) {
                scrollPos += 0.8;
                if (scrollPos >= (track.scrollWidth / 2)) scrollPos = 0;
                track.scrollLeft = scrollPos;
                lastTime = timestamp;
            }
        }
        carouselAnimationId = requestAnimationFrame(step);
    }
    
    carouselVisibilityHandler = () => {
        if (document.hidden) {
            animationFrameActive = false;
            if (carouselAnimationId) {
                cancelAnimationFrame(carouselAnimationId);
                carouselAnimationId = null;
            }
        } else {
            if (!carouselAnimationId && animationFrameActive === false) {
                animationFrameActive = true;
                lastTime = 0;
                carouselAnimationId = requestAnimationFrame(step);
            }
        }
    };
    document.addEventListener('visibilitychange', carouselVisibilityHandler);
    
    carouselAnimationId = requestAnimationFrame(step);
}

function renderizarFiltros() {
    const container = document.getElementById('chipContainer');
    if (!container) return;
    container.innerHTML = CHIPS_POR_MODO[modoAtual].map((nome, index) => `
        <div class="filter-chip ${normalizar(nome) === filtroChip || (filtroChip === '' && index === 0) ? 'active' : ''}" 
             onclick="filtrarPorPalavra('${nome === 'Todos' ? '' : nome}', this)">
            ${nome}
        </div>`).join('');
   
}

async function renderizarProdutos(opcoes = {}) {
    const { silencioso = false } = opcoes;
    const grid = document.getElementById('grid-produtos');
    if (!grid) return;
    
    if (!silencioso) {
        if (videoObserver) {
            videoObserver.disconnect();
            videoObserver = null;
        }
        document.querySelectorAll('#grid-produtos video').forEach(v => v.pause());
    }
    
    let filtrados = todosProdutos.filter(p => {
        if (!p.isLojistaAprovado) return false;
        if (!p.isProdutoAtivo) return false;

        if (modoAtual === 'restaurants' && p.categoria !== 'Comida') return false;
        if (modoAtual === 'products' && p.categoria !== 'Geral') return false;
        if (modoAtual === 'classifieds' && p.categoria !== 'Classificados') return false;

        const termoBusca = normalizar(filtroTexto);
        const alvoBusca = normalizar(`${p.nome} ${p.nomeLoja} ${p.descricao || ''}`);
        
        if (filtroTexto && !alvoBusca.includes(termoBusca)) return false;

        if (filtroChip === 'promocao') return p.promocao === 'sim';
        if (filtroChip && filtroChip !== '') {
            const keywords = MAPAS_FILTROS[modoAtual][filtroChip] || [];
            const textoCardFiltro = normalizar(`${p.nome} ${p.descricao || ''}`);
            if (!keywords.some(k => textoCardFiltro.includes(normalizar(k))) && !textoCardFiltro.includes(normalizar(filtroChip))) return false;
        }
        return true;
    });

    filtrados = aplicarAlgoritmoVisibilidade(filtrados);
    
    if (filtrados.length === 0 && todosProdutos.length === 0) {
        mostrarEstadoOffline();
        setTimeout(() => iniciarObservadorDeVideos({ pausarAntes: false }), 100);
        return;
    }

    for (let i = 0; i < filtrados.length - 1; i += 2) {
        const temVideoA = !!(filtrados[i].videoUrl && filtrados[i].videoUrl.trim());
        const temVideoB = !!(filtrados[i+1].videoUrl && filtrados[i+1].videoUrl.trim());
        if (temVideoA && temVideoB) {
            let indexTroca = -1;
            for (let j = i + 2; j < filtrados.length; j++) {
                if (!filtrados[j].videoUrl || !filtrados[j].videoUrl.trim()) {
                    indexTroca = j;
                    break;
                }
            }
            if (indexTroca !== -1) {
                [filtrados[i+1], filtrados[indexTroca]] = [filtrados[indexTroca], filtrados[i+1]];
            }
        }
    }

    const paramModo = modoAtual === 'restaurants' ? 'gourmet' : 'produto';
    const fragment = document.createDocumentFragment();
    const posterPromises = [];

    for (const p of filtrados) {
        const card = document.createElement('div');
        const imgRaw = p.foto || (p.fotos && p.fotos[0]) || "https://via.placeholder.com/300";
        const nomeSanitizado = p.nome.replace(/'/g, "\\'");
        const descSanitizada = (p.descricao || "").replace(/'/g, "\\'").replace(/\n/g, " ");
        const linkProduto = `${APP_URL}/vitrine-lojista.html?seller=${p.owner}&product=${p.id}&modo=${paramModo}`;

        const lojistaTag = `<div style="font-size: 10px; color: var(--text-muted); margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
            <i class="fas fa-store" style="font-size: 9px;"></i> ${p.nomeLoja}
        </div>`;

        const menuDenuncia = `
            <div class="report-menu-container" onclick="event.stopPropagation()">
                <button class="btn-report-trigger" onclick="window.toggleReportMenu('${p.id}')">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
                <div id="report-dropdown-${p.id}" class="report-dropdown">
                    <div class="report-item" onclick="window.abrirDenuncia('${p.id}', '${nomeSanitizado}', '${p.owner}', '${p.nomeLoja.replace(/'/g, "\\'")}')">
                        <i class="fas fa-flag"></i> Denunciar produto
                    </div>
                </div>
            </div>`;

        let innerHTML = '';
        if (modoAtual === 'classifieds') {
            innerHTML = `
                <div class="img-box">
                    ${renderizarMediaCard(p, modoAtual)}
                </div>
                <div class="card-body">
                    ${lojistaTag}
                    <div class="p-name">${p.nome}</div>
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-top:auto;">
                        <div class="p-price" style="color:#0077ff;">R$ ${p.preco}</div>
                        ${menuDenuncia}
                    </div>
                    <button class="btn-add-main">Ver anúncio</button>
                </div>`;
            card.className = 'product-card';
        } else if (modoAtual === 'restaurants') {
            const mediaHtml = (p.videoUrl && p.videoUrl.trim()) ?
                `<div style="position: relative; width: 100%; height: 100%; background: #1a1a1a;">
                    <video id="vid_${p.id}" data-src="${otimizarVideoURL(p.videoUrl)}" poster="${p.videoUrl.includes('cloudinary') ? p.videoUrl.replace('/video/upload/', '/video/upload/so_0/').replace(/\.(mp4|mov|webm)$/i, '.jpg') : ''}" preload="none" muted playsinline style="width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 0.2s ease;"></video>
                    <div style="position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.6); border-radius: 20px; padding: 4px 8px; backdrop-filter: blur(4px);"><i class="fas fa-play" style="font-size: 10px; color: white;"></i><span style="font-size: 9px; color: white;">Vídeo</span></div>
                </div>` :
                `<img src="${otimizarURL(imgRaw, 400)}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;">`;
            innerHTML = `
                <div class="gourmet-img-box" style="position: relative;">${mediaHtml}</div>
                <div class="gourmet-body">
                    ${lojistaTag}
                    <div class="gourmet-name">${p.nome}</div>
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <div class="gourmet-price">R$ ${p.preco}</div>
                        ${menuDenuncia}
                    </div>
                </div>`;
            card.className = 'gourmet-card';
        } else {
            const isRoupa = p.tipoProduto === 'roupa';
            const temTamanhos = (p.tamanhosDisponiveis && p.tamanhosDisponiveis.length > 0) || (p.numeracoes && p.numeracoes.trim() !== "");
            const btnHTML = (isRoupa && temTamanhos) ?
                `<button class="btn-add-main">Escolher opções</button>` :
                `<button class="btn-add-main" onclick="event.preventDefault(); event.stopPropagation(); window.adicionarAoCarrinho('${p.id}', '${nomeSanitizado}', '${p.preco}', '${p.owner}', '${p.whatsapp}', '${imgRaw}', '${linkProduto}', '${descSanitizada}')">Adicionar</button>`;
            innerHTML = `
                <div class="img-box">
                    ${renderizarMediaCard(p, modoAtual)}
                </div>
                <div class="card-body">
                    ${lojistaTag}
                    <div class="p-name">${p.nome}</div>
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-top:auto;">
                        <div class="p-price">R$ ${p.preco}</div>
                        ${menuDenuncia}
                    </div>
                    ${btnHTML}
                </div>`;
            card.className = 'product-card';
        }

        card.setAttribute('onclick', `navegarParaProduto('${p.owner}', '${p.id}', '${paramModo}')`);
        card.innerHTML = innerHTML;
        card.dataset.busca = normalizar(`${p.nome} ${p.nomeLoja} ${p.descricao || ''}`);
        card.dataset.chip = normalizar(`${p.nome} ${p.descricao || ''}`);
        card.dataset.promocao = p.promocao === 'sim' ? 'sim' : '';

        if (p.videoUrl && p.videoUrl.trim()) {
            const posterUrl = p.videoUrl.includes('cloudinary') ? p.videoUrl.replace('/video/upload/', '/video/upload/so_0/').replace(/\.(mp4|mov|webm)$/i, '.jpg') : '';
            if (posterUrl) {
                posterPromises.push(new Promise(resolve => {
                    const img = new Image();
                    img.onload = img.onerror = resolve;
                    img.src = posterUrl;
                }));
            }
        }
        fragment.appendChild(card);
    }

    grid.replaceChildren(fragment);

    filtrarCards();

    if (posterPromises.length) {
        Promise.all(posterPromises).then(() => {
            iniciarObservadorDeVideos({ pausarAntes: false });
        });
    } else {
        requestAnimationFrame(() => {
            iniciarObservadorDeVideos({ pausarAntes: false });
        });
    }
}

window.navegarParaProduto = (owner, id, modo) => {
    const grid = document.getElementById('grid-produtos');
    if (grid) sessionStorage.setItem('pedeai_dom_cache', grid.innerHTML);
    const track = document.getElementById('carouselTrack');
    if (track && track.innerHTML.trim()) sessionStorage.setItem('pedeai_carousel_cache', track.innerHTML);
    sessionStorage.setItem('pedeai_scroll', window.scrollY);
    window.location.href = `vitrine-lojista.html?seller=${owner}&product=${id}&modo=${modo}`;
};

function filtrarCards() {
    const grid = document.getElementById('grid-produtos');
    if (!grid) return;

    const cards = grid.querySelectorAll('.product-card, .gourmet-card');
    const termoBusca = normalizar(filtroTexto);
    let visiveisCount = 0;

    cards.forEach(card => {
        const busca = card.dataset.busca || '';
        const chip = card.dataset.chip || '';
        const promocao = card.dataset.promocao || '';

        let visivel = true;

        if (filtroTexto && !busca.includes(termoBusca)) visivel = false;

        if (visivel && filtroChip === 'promocao') {
            if (promocao !== 'sim') visivel = false;
        } else if (visivel && filtroChip && filtroChip !== '') {
            const chavesMapa = Object.keys(MAPAS_FILTROS[modoAtual] || {});
            const chaveReal = chavesMapa.find(k => normalizar(k) === filtroChip) || filtroChip;
            const keywords = MAPAS_FILTROS[modoAtual][chaveReal] || [];
            if (!keywords.some(k => chip.includes(normalizar(k))) && !chip.includes(filtroChip)) {
                visivel = false;
            }
        }

        card.style.display = visivel ? '' : 'none';
        if (visivel) visiveisCount++;
    });

    const emptyExistente = grid.querySelector('[data-empty-state]');
    if (visiveisCount === 0) {
        if (!emptyExistente) {
            const emptyDiv = document.createElement('div');
            emptyDiv.setAttribute('data-empty-state', '');
            emptyDiv.style.cssText = 'grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 64px 24px; text-align: center; min-height: 300px;';
            emptyDiv.innerHTML = `
                <div style="width: 72px; height: 72px; background: #f2f2f7; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 18px;">
                    <i class="fas fa-magnifying-glass" style="font-size: 26px; color: #aeaeb2;"></i>
                </div>
                <p style="font-size: 17px; font-weight: 600; color: #1c1c1e; margin: 0 0 8px 0;">Nenhum resultado encontrado</p>
                <p style="font-size: 14px; color: #8e8e93; margin: 0;">Tente outro filtro ou palavra-chave</p>
            `;
            grid.appendChild(emptyDiv);
        }
    } else {
        if (emptyExistente) emptyExistente.remove();
    }
}

window.filtrarPorPalavra = (termo, elemento) => {
    const novoFiltro = normalizar(termo);
    if (filtroChip === novoFiltro) return;
    filtroChip = novoFiltro;
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    elemento.classList.add('active');

    const overlay = document.getElementById('filter-overlay');
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const corAnterior = themeMeta ? themeMeta.getAttribute('content') : '#ee4d2d';

    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;

    if (overlay) { overlay.style.display = 'flex'; }
    if (themeMeta) { themeMeta.setAttribute('content', '#ffffff'); }

    const DURACAO_MINIMA = 500;

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            filtrarCards();
            setTimeout(() => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        if (overlay) { overlay.style.display = 'none'; }
                        if (themeMeta) { themeMeta.setAttribute('content', corAnterior); }
                    });
                });
            }, DURACAO_MINIMA);
        });
    });
};

window.addEventListener('changeMode', (e) => {
    scrollModesCache[modoAtual] = window.scrollY;

    modoAtual = e.detail;
    filtroChip = ''; 

    const logo = document.getElementById('main-logo');
    if(logo) {
        let iconHtml = modoAtual === 'restaurants' ? '<i class="fas fa-utensils"></i>' : (modoAtual === 'classifieds' ? '<i class="fas fa-bullhorn"></i>' : '<i class="fas fa-bag-shopping"></i>');
        logo.innerHTML = `${iconHtml} Pede Aí`;
    }

    inicializarArialProdutos();
    renderizarFiltros();
    renderizarProdutos();

    setTimeout(() => {
        window.scrollTo({
            top: scrollModesCache[modoAtual] || 0,
            behavior: 'instant'
        });
        // Removido: window.IosOverlayManager?.hideAll(); agora é chamado após o repaint no setAppMode
    }, 0);
});

let buscaTimeout;
let ultimoFiltroTexto = '';
document.getElementById('inputBusca')?.addEventListener('input', (e) => {
    const novoTexto = e.target.value;
    if (buscaTimeout) clearTimeout(buscaTimeout);
    buscaTimeout = setTimeout(() => {
        if (ultimoFiltroTexto === novoTexto) return; // ✅ evita duplicado
        ultimoFiltroTexto = novoTexto;
        filtroTexto = novoTexto;
        window.scrollTo({ top: 0, behavior: 'instant' });
        filtrarCards();
    }, 300);
});

document.addEventListener('touchstart', function() {}, {passive: true});
document.querySelectorAll('button, .filter-chip, .nav-item').forEach(el => {
    el.addEventListener('touchend', function(e) {
        const agora = Date.now();
        const ultimo = el.dataset.lastTap || 0;
        if (agora - ultimo < 300 && agora - ultimo > 0) e.preventDefault();
        el.dataset.lastTap = agora;
    }, {passive: false});
});

window.toggleReportMenu = (id) => {
    document.querySelectorAll('.report-dropdown').forEach(el => {
        if(el.id !== `report-dropdown-${id}`) el.classList.remove('show');
    });
    const menu = document.getElementById(`report-dropdown-${id}`);
    if(menu) menu.classList.toggle('show');
};

window.abrirDenuncia = (id, nome, lojistaId, nomeLoja) => {
    document.querySelectorAll('.report-dropdown').forEach(el => el.classList.remove('show'));

    const modalDenuncia = document.createElement('div');
    modalDenuncia.id = 'ios-report-modal';
    modalDenuncia.style = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.4); z-index: 10000; display: flex;
        align-items: flex-end; justify-content: center;
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        animation: fadeInIOS 0.25s ease-out;
    `;
    
    modalDenuncia.innerHTML = `
        <div style="background: #fff; width: 100%; max-width: 500px; border-radius: 16px 16px 0 0; padding: 20px; box-sizing: border-box; transform: translateY(0); transition: transform 0.3s cubic-bezier(0.1, 0.76, 0.55, 0.94); padding-bottom: calc(env(safe-area-inset-bottom) + 20px);">
            <div style="width: 40px; height: 5px; background: #ddd; border-radius: 3px; margin: 0 auto 15px;"></div>
            <h3 style="margin: 0 0 8px 0; font-size: 17px; font-weight: 600; text-align: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">Denunciar Produto</h3>
            <p style="margin: 0 0 16px 0; font-size: 13px; color: #666; text-align: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">Por qual motivo deseja denunciar o produto "<strong>${nome}</strong>"?</p>
            <input type="text" id="ios-report-reason" placeholder="Ex: Falso, abusivo, categoria errada" style="width: 100%; padding: 14px; border: 1px solid #e5e5ea; border-radius: 10px; font-size: 15px; outline: none; margin-bottom: 20px; box-sizing: border-box; background: #f2f2f7; -webkit-appearance: none; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
            <div style="display: flex; gap: 12px;">
                <button id="ios-report-cancel" style="flex: 1; padding: 14px; border: none; background: #e5e5ea; color: #007afc; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer;">Cancelar</button>
                <button id="ios-report-submit" style="flex: 1; padding: 14px; border: none; background: #ff3b30; color: #fff; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer;">Denunciar</button>
            </div>
        </div>
    `;

    document.body.appendChild(modalDenuncia);
    
    setTimeout(() => document.getElementById('ios-report-reason').focus(), 100);

    const fecharModal = () => { modalDenuncia.remove(); };

    document.getElementById('ios-report-cancel').onclick = fecharModal;

    document.getElementById('ios-report-submit').onclick = async () => {
        const motivo = document.getElementById('ios-report-reason').value;
        if (motivo && motivo.trim() !== "") {
            try {
                await addDoc(collection(db, "denuncias"), {
                    produtoId: id,
                    lojistaId: lojistaId,
                    nomeProduto: nome,
                    nomeLoja: nomeLoja,
                    motivo: motivo.trim(),
                    data: serverTimestamp(),
                    status: "pendente"
                });
                fecharModal();
                window.mostrarToastIOS("Denúncia enviada com sucesso!");
            } catch (error) {
                console.error("Erro ao denunciar:", error);
                window.mostrarToastIOS("Erro ao enviar denúncia.", true);
            }
        }
    };
};

window.mostrarToastIOS = (mensagem, erro = false) => {
    const toast = document.createElement('div');
    toast.style = `
        position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
        background: ${erro ? '#ff3b30' : 'rgba(34,34,34,0.9)'}; color: #fff;
        padding: 12px 24px; border-radius: 24px; font-size: 14px; font-weight: 500;
        z-index: 11000; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        pointer-events: none; opacity: 0; transition: opacity 0.3s ease;
    `;
    toast.innerText = mensagem;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '1'; }, 50);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

let videoObserver = null;
const videoBufferRecentes = []; // URLs dos últimos 2 vídeos assistidos — mantém buffer sem novo download
const VIDEO_BUFFER_MAX = 2;

function iniciarObservadorDeVideos({ pausarAntes = true } = {}) {
    if (videoObserver) {
        videoObserver.disconnect();
        videoObserver = null;
    }

    if (pausarAntes) {
        document.querySelectorAll('video').forEach(video => {
            video.pause();
        });
    }

    videoObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target;
            
            if (entry.isIntersecting) {
    document.querySelectorAll('video').forEach(v => {
        if (v !== video && !v.paused) {
            v.pause();
            v.currentTime = 0;
        }
    });

    const videoSrc = video.getAttribute('src');
    if (videoSrc) {
        // Vídeo já tem src — buffer ainda presente, só dá play
        video.muted = true;
        // Registra no buffer de recentes
        if (!videoBufferRecentes.includes(videoSrc)) {
            videoBufferRecentes.push(videoSrc);
            if (videoBufferRecentes.length > VIDEO_BUFFER_MAX) {
                videoBufferRecentes.shift();
            }
        }
        if (video.readyState >= 3) {
            video.play().catch(() => {});
            setTimeout(() => { if (!video.paused) video.pause(); }, 15000);
        } else {
            video.addEventListener('canplay', () => {
                video.play().catch(() => {});
                setTimeout(() => { if (!video.paused) video.pause(); }, 15000);
            }, { once: true });
        }
    } else {
        const lazySrc = video.getAttribute('data-src');
        if (lazySrc) {
            video.muted = true;
            video.removeAttribute('data-src');
            video.setAttribute('src', lazySrc);
            // Registra no buffer de recentes
            if (!videoBufferRecentes.includes(lazySrc)) {
                videoBufferRecentes.push(lazySrc);
                if (videoBufferRecentes.length > VIDEO_BUFFER_MAX) {
                    videoBufferRecentes.shift();
                }
            }
            video.load();
            // Revela o vídeo apenas quando há conteúdo visual — elimina o branco no iOS
            video.addEventListener('loadeddata', () => {
                video.style.opacity = '1';
            }, { once: true });
            // Fallback: se loadeddata não disparar (iOS restritivo), revela no canplay
            video.addEventListener('canplay', () => {
                video.style.opacity = '1';
            }, { once: true });
            const tentarPlay = () => {
                if (!video.getAttribute('src')) return;
                video.play().catch(() => {});
                setTimeout(() => { if (!video.paused) video.pause(); }, 15000);
            };
            if (video.readyState >= 3) {
                tentarPlay();
            } else {
                video.addEventListener('canplay', tentarPlay, { once: true });
            }
        }
    }
            } else {
    video.pause();

    const srcAtual = video.getAttribute('src');
    if (srcAtual) {
        // Mantém src e buffer se o vídeo está entre os 2 mais recentes
        // Evita novo download do Cloudinary ao rolar de volta
        if (videoBufferRecentes.includes(srcAtual)) {
            video.currentTime = 0; // reseta posição mas mantém buffer
        } else {
            // Fora do buffer: descarta para liberar RAM
            video.currentTime = 0;
            video.dataset.src = srcAtual;
            video.removeAttribute('src');
        }
    }
}
        });
    }, { 
        rootMargin: "-35% 0px -35% 0px", 
        threshold: 0.1 
    }); 
    
    document.querySelectorAll('video').forEach(video => {
    const attrSrc = video.getAttribute('src');
    if (attrSrc && !video.dataset.src) {
        video.dataset.src = attrSrc;
        video.removeAttribute('src');
    }

    video.setAttribute('data-observed', 'true');
    videoObserver.observe(video);
});
}

const observerRender = new MutationObserver(() => {
    if (videoObserver) {
        document.querySelectorAll('video').forEach(video => {
            if (!video.hasAttribute('data-observed')) {
                video.setAttribute('data-observed', 'true');
                videoObserver.observe(video);
            }
        });
    }
});

const gridEl = document.getElementById('grid-produtos');
if (gridEl) {
    observerRender.observe(gridEl, { childList: true, subtree: true });
}

window.addEventListener('load', () => {
    iniciarObservadorDeVideos();

    const btnAnuncios = document.querySelector('[onclick*="anuncios.html"]');
    if (btnAnuncios) {
        btnAnuncios.removeAttribute('onclick');
        btnAnuncios.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.IosOverlayManager) window.IosOverlayManager.show('anuncios');
            setTimeout(() => window.location.href = 'anuncios.html', 300);
        });
    }
});

inicializar();

window.addEventListener('pagehide', () => {
    document.querySelectorAll('video').forEach(video => {
        video.pause();
    });
});

function mostrarEstadoOffline() {
    const grid = document.getElementById('grid-produtos');
    if (!grid) return;
    if (videoObserver) { videoObserver.disconnect(); videoObserver = null; }
    document.querySelectorAll('#grid-produtos video').forEach(v => { v.pause(); v.removeAttribute('src'); });
    grid.innerHTML = `
        <div data-offline-state style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 64px 24px; text-align: center; min-height: 300px;">
            <div style="width: 80px; height: 80px; background: #f2f2f7; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 20px; position: relative;">
                <i class="fas fa-wifi" style="font-size: 28px; color: #aeaeb2;"></i>
                <div style="position: absolute; bottom: 4px; right: 4px; width: 24px; height: 24px; background: #ff3b30; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 2px solid #f2f2f7;">
                    <i class="fas fa-xmark" style="font-size: 10px; color: #fff;"></i>
                </div>
            </div>
            <p style="font-size: 18px; font-weight: 700; color: #1c1c1e; margin: 0 0 8px 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">Sem conexão</p>
            <p style="font-size: 14px; color: #8e8e93; margin: 0 0 28px 0; line-height: 1.5; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">Verifique sua internet e tente novamente</p>
            <button onclick="window.__tentarNovamente()" style="background: #0077ff; color: #fff; border: none; border-radius: 14px; padding: 14px 32px; font-size: 15px; font-weight: 600; cursor: pointer; font-family: -apple-system, BlinkMacSystemFont, sans-serif; box-shadow: 0 4px 12px rgba(0,119,255,0.3);">Tentar novamente</button>
        </div>`;
}

window.addEventListener('offline', () => mostrarEstadoOffline());

window.addEventListener('online', () => {
    const grid = document.getElementById('grid-produtos');
    if (grid && grid.querySelector('[data-offline-state]')) inicializar();
});

// Tentar novamente: verifica conexão antes de agir
// Usa inicializar() em vez de reload() para reconstruir corretamente no iPhone
window.__tentarNovamente = async function() {
    if (window._isRetrying) return;
    window._isRetrying = true;

    try {
        // Se houver SW, tenta ativar a nova versão
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage('skipWaiting');
        }

        if (!navigator.onLine) {
            const btn = document.querySelector('[data-offline-state] button');
            if (btn) {
                btn.textContent = 'Sem conexão...';
                setTimeout(() => { btn.textContent = 'Tentar novamente'; }, 2000);
            }
            return;
        }

        const btn = document.querySelector('[data-offline-state] button');
        if (btn) btn.textContent = 'Carregando...';

        // 🔥 invalida qualquer execução anterior (ESSENCIAL)
inicializacaoPromiseAtual = null;

        // Força reset completo e inicia nova execução
        await inicializar({ forceReset: true });

    } catch (err) {
        console.error('Erro no tentarNovamente:', err);
        mostrarEstadoOffline();
    } finally {
        window._isRetrying = false;
        const btn = document.querySelector('[data-offline-state] button');
        if (btn && btn.textContent === 'Carregando...') {
            btn.textContent = 'Tentar novamente';
        }
    }
};

function garantirRenderizacaoValida() {
    const grid = document.getElementById('grid-produtos');
    const chips = document.getElementById('chipContainer');
    const track = document.getElementById('carouselTrack');

    // Se há produtos carregados no array mas o grid ficou totalmente em branco por delay de renderização
    if (grid && grid.children.length === 0 && todosProdutos.length > 0) {
        try { renderizarProdutos(); } catch (e) { console.error('Retentativa de renderizarProdutos falhou:', e); }
    }

    if (chips && chips.children.length === 0) {
        try { renderizarFiltros(); } catch (e) { console.error('Retentativa de renderizarFiltros falhou:', e); }
    }

    if (track && track.children.length === 0 && todosProdutos.length > 0) {
        try { inicializarArialProdutos(); } catch (e) { console.error('Retentativa de inicializarArialProdutos falhou:', e); }
    }
}

// ORQUESTRADOR ÚNICO: cada seção tem seu próprio try/catch, então uma falha
// isolada no carrossel nunca impede categorias e produtos de renderizarem.
function renderizarTudo() {
    try { inicializarArialProdutos(); } catch (e) { console.error('Falha ao renderizar o carrossel:', e); }
    try { renderizarFiltros(); } catch (e) { console.error('Falha ao renderizar as categorias:', e); }
    try { renderizarProdutos(); } catch (e) { console.error('Falha ao renderizar os produtos:', e); }
    garantirRenderizacaoValida();
}

// Flag para evitar execução concorrente do pageshow
let pageshowRunning = false;

window.addEventListener('pageshow', (event) => {
    // Se estiver em retry, não faz nada (evita conflito)
    if (window._isRetrying) {
        console.log('[pageshow] Ignorado porque _isRetrying está ativo');
        return;
    }
    if (pageshowRunning) return;
    pageshowRunning = true;

    try {
        const modoSalvo = sessionStorage.getItem('pedeai_mode') || 'products';
        if (modoSalvo === 'classifieds') {
            if (window.IosOverlayManager) {
                window.IosOverlayManager.show('anuncios');
            }
            return;
        }

        if (!(event.persisted || window.performance.navigation.type === 2)) {
            return;
        }

        // Função para finalizar carga com debounce
        let finalizarCargaTimeout = null;
        const finalizarCarga = () => {
            if (finalizarCargaTimeout) clearTimeout(finalizarCargaTimeout);
            finalizarCargaTimeout = setTimeout(() => {
                try { inicializarArialProdutos(); } catch (e) { console.error('Falha carrossel (pageshow):', e); }
                try { renderizarFiltros(); } catch (e) { console.error('Falha filtros (pageshow):', e); }
                try {
                    const domCacheAtual = sessionStorage.getItem('pedeai_dom_cache');
                    const gridAtual = document.getElementById('grid-produtos');
                    if (!domCacheAtual || !gridAtual || gridAtual.innerHTML.trim() === '') {
                        renderizarProdutos();
                    } else {
                        gridAtual.querySelectorAll('video').forEach(video => {
                            const fonte = video.getAttribute('src') || video.getAttribute('data-src');
                            if (fonte) {
                                video.setAttribute('src', fonte);
                                video.removeAttribute('data-src');
                            }
                        });
                    }
                    iniciarObservadorDeVideos({ pausarAntes: false });
                } catch (e) { console.error('Falha produtos (pageshow):', e); }
                garantirRenderizacaoValida();
                if (window.IosOverlayManager) {
                    setTimeout(() => window.IosOverlayManager.hideAll(), 450);
                }
            }, 100);
        };

        if (todosProdutos.length > 0) {
            finalizarCarga();
        } else {
            const aguardar = setInterval(() => {
                if (todosProdutos.length > 0) {
                    clearInterval(aguardar);
                    finalizarCarga();
                }
            }, 50);
        }
    } finally {
        // Libera a flag após um tempo para não bloquear futuros events
        setTimeout(() => { pageshowRunning = false; }, 500);
    }
});