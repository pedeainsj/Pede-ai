import { db, APP_URL } from './config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const STORAGE_KEY = 'carrinho_pedeai';

// ─── ACESSO SEGURO AO STORAGE ──────────────────────────────────────────────
// Alguns navegadores internos (ex: WebView do Instagram/Facebook) podem lançar
// exceção ao acessar localStorage (em vez de simplesmente retornar null),
// dependendo do modo de privacidade ou política de cookies de terceiros.
// Sem proteção, isso quebra silenciosamente toda a função que tentar usá-lo.
// Aqui criamos um fallback em memória para a sessão atual, garantindo que o
// carrinho continue funcionando mesmo se o localStorage estiver indisponível.
window.__carrinhoFallbackMemoria = window.__carrinhoFallbackMemoria || null;

function lerCarrinhoStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.warn('localStorage indisponível, usando carrinho em memória (sessão atual).', e);
        return window.__carrinhoFallbackMemoria || [];
    }
}

function salvarCarrinhoStorage(carrinho) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(carrinho));
    } catch (e) {
        console.warn('localStorage indisponível, mantendo carrinho em memória (sessão atual).', e);
        window.__carrinhoFallbackMemoria = carrinho;
    }
}

// 1. ADICIONAR AO CARRINHO (Ajustado para integridade total da descrição real)
window.adicionarAoCarrinho = (id, nome, preco, owner, whatsapp, imagem, linkProduto, descricao = "") => {
    let carrinho = lerCarrinhoStorage();
    
    // Reconstrói o link da vitrine caso venha vazio
    let linkFinal = linkProduto;
    if (!linkFinal || linkFinal === 'undefined' || linkFinal === '') {
        const base = `${APP_URL}/vitrine-lojista.html`;
        linkFinal = `${base}?seller=${owner}&product=${id}&modo=produto`;
    }

    // REGRA: Captura a descrição real. Se vier "undefined" ou nulo, fica vazio (string limpa).
    let descricaoFinal = (descricao && descricao !== "undefined") ? descricao : "";

    const item = { 
        id, 
        nome, 
        preco, 
        owner, 
        whatsapp, 
        imagem, 
        linkProduto: linkFinal, 
        descricao: descricaoFinal, 
        qtd: 1 
    };

    // Busca item idêntico no carrinho (incluindo descrição na comparação para itens personalizados)
    const index = carrinho.findIndex(i => i.id === id && i.nome === nome && i.descricao === descricaoFinal);
    
    if (index > -1) { 
        carrinho[index].qtd += 1; 
    } else { 
        carrinho.push(item); 
    }
    
    salvarCarrinhoStorage(carrinho);
    window.atualizarIconeCarrinho();
    
    window.__dispararFlyAnimation(imagem);
};

// 2. ALTERAR QUANTIDADE
window.alterarQuantidadeCarrinho = (id, delta) => {
    let carrinho = lerCarrinhoStorage();
    const index = carrinho.findIndex(i => i.id === id);
    if (index > -1) {
        carrinho[index].qtd += delta;
        if (carrinho[index].qtd <= 0) { carrinho.splice(index, 1); }
        salvarCarrinhoStorage(carrinho);
        window.atualizarIconeCarrinho();
        window.abrirModalCarrinho();
        // Atualiza badge da barra fixa da vitrine
    const vitrineBadge = document.getElementById('cart-badge-fixed');
    if (vitrineBadge) {
        const totalItens = carrinho.reduce((acc, i) => acc + i.qtd, 0);
        if (totalItens > 0) {
            vitrineBadge.textContent = totalItens > 99 ? '99+' : totalItens;
            vitrineBadge.style.display = 'block';
        } else {
            vitrineBadge.style.display = 'none';
        }
    }
    }
};

// 3. REMOVER ITEM
window.removerDoCarrinho = (id) => {
    let carrinho = lerCarrinhoStorage();
    carrinho = carrinho.filter(i => i.id !== id);
    salvarCarrinhoStorage(carrinho);
    window.atualizarIconeCarrinho();
    window.abrirModalCarrinho();
};

// 4. FINALIZAR PEDIDO (ENVIO PARA WHATSAPP - FORMATO ATUALIZADO)
window.finalizarGrupoLojista = async (ownerId) => {
    let carrinho = lerCarrinhoStorage();
    const itensLoja = carrinho.filter(i => i.owner === ownerId);
    if (itensLoja.length === 0) return;

    // Removemos o async/await para garantir que o Safari iOS não bloqueie o redirecionamento.
    // Usamos o WhatsApp já armazenado no item para ação imediata.
    let foneFinal = '';

try {
    const userRef = doc(db, "usuarios", ownerId);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
        const userData = userSnap.data();

        if (userData.whatsapp) {
            foneFinal = userData.whatsapp.replace(/\D/g, '');
        }
    }

    // Segurança: fallback caso não encontre no Firestore
    if (!foneFinal) {
        foneFinal = itensLoja[0].whatsapp.replace(/\D/g, '');
    }

} catch (error) {
    console.error("Erro ao buscar WhatsApp atualizado:", error);

    // fallback de segurança
    foneFinal = itensLoja[0].whatsapp.replace(/\D/g, '');
}

// Remove duplicações de 55 no início
while (foneFinal.startsWith('5555')) {
    foneFinal = foneFinal.substring(2);
}

// Se não tiver 55, adiciona automaticamente
if (!foneFinal.startsWith('55')) {
    foneFinal = '55' + foneFinal;
}

    let texto = `📌 *NOVO PEDIDO RECEBIDO*\n`;
    texto += `────────────────────\n\n`;
    
    let total = 0;
    itensLoja.forEach((item) => {
        const precoLimpo = parseFloat(item.preco.replace('R$', '').replace(/\./g, '').replace(',', '.'));
        const subtotal = precoLimpo * item.qtd;
        total += subtotal;

        texto += `🛍️ *Produto:* ${item.qtd}x ${item.nome.toUpperCase()}\n`;
        
        if (item.descricao && item.descricao.trim() !== "") {
            // Converte vírgulas ou quebras de linha em tópicos para melhor visualização
            const linhasDescricao = item.descricao.split(/[,\n]/).filter(d => d.trim() !== "");
            texto += `📄 *Descrição:*\n`;
            linhasDescricao.forEach(linha => {
                texto += `• ${linha.trim()}\n`;
            });
        }
        
        texto += `\n💰 *Valor unitário:* R$ ${item.preco}\n\n`;
        
        if (item.linkProduto) {
            texto += `🔗 *Ver produto:*\n👉 Toque para visualizar\n${item.linkProduto}\n`;
        }
        
        texto += `────────────────────\n`;
    });

    texto += `\n💵 *Total do pedido: R$ ${total.toFixed(2).replace('.', ',')}*\n\n`;
    texto += `_Pedido gerado via catálogo online_\n*Pede Aí*`;

    const novoCarrinho = carrinho.filter(i => i.owner !== ownerId);
    salvarCarrinhoStorage(novoCarrinho);
    
    window.atualizarIconeCarrinho();
    window.abrirModalCarrinho();
    
    const urlFinal = `https://wa.me/${foneFinal}?text=${encodeURIComponent(texto)}`;
    
    // No Safari iOS, window.location.assign é mais confiável para deep-links (WhatsApp) após o primeiro uso.
    window.location.assign(urlFinal);
};

// 5. INTERFACE E UI
window.atualizarIconeCarrinho = () => {
    const flutuante = document.getElementById('carrinho-flutuante');
    const contador = document.getElementById('cart-count') || document.getElementById('carrinho-count');
    const carrinho = lerCarrinhoStorage();
    const totalItens = carrinho.reduce((acc, i) => acc + i.qtd, 0);
    
    if (flutuante) {
        const modalComida = document.getElementById('modalComida');
        const modoMontarAtivo = modalComida && modalComida.classList.contains('active');

        if (modoMontarAtivo || totalItens <= 0) {
            flutuante.style.display = 'none';
        } else {
            flutuante.style.display = 'flex';
        }

        if (contador) contador.innerText = totalItens;

        const barMontar = document.getElementById('barMontar');
        const barraVisivel = barMontar && (barMontar.offsetWidth > 0 || barMontar.offsetHeight > 0);

        // AJUSTE: Removido o controle de bottom dinâmico para respeitar o CSS fixo de 110px
    }

    // ===== NOVO: Atualiza a badge da barra inferior =====
    const navBadge = document.getElementById('cart-badge-nav');
    if (navBadge) {
        if (totalItens > 0) {
            navBadge.textContent = totalItens > 99 ? '99+' : totalItens;
            navBadge.style.display = 'block';
        } else {
            navBadge.style.display = 'none';
        }
    }
    
    // Atualiza o contador do botão Carrinho na barra fixa da vitrine
    const cartCountSpan = document.getElementById('cart-count-fixed');
    if (cartCountSpan) {
        cartCountSpan.innerText = totalItens;
    }
};


window.abrirModalCarrinho = () => {
    const modal = document.getElementById('modal-carrinho');
    const corpo = document.getElementById('lista-carrinho-lojas');
    const carrinho = lerCarrinhoStorage();
    
    if (carrinho.length === 0) { 
        if (corpo) {
            corpo.innerHTML = `
                <div class="cart-empty-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 24px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#b0b0b0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 16px;">
                        <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                        <line x1="3" y1="6" x2="21" y2="6"></line>
                        <path d="M16 10a4 4 0 0 1-8 0"></path>
                    </svg>
                    <div style="font-size: 16px; font-weight: 600; color: #222; margin-bottom: 6px;">Seu carrinho está vazio</div>
                    <div style="font-size: 13px; color: #777; line-height: 1.4;">Adicione produtos para continuar</div>
                </div>
            `;
        }
        if (modal) modal.style.display = 'flex'; 
        return; 
    }

    const grupos = carrinho.reduce((acc, item) => { 
        if (!acc[item.owner]) acc[item.owner] = []; 
        acc[item.owner].push(item); 
        return acc; 
    }, {});

    if (corpo) {
        corpo.innerHTML = "";
        for (const owner in grupos) {
            const itens = grupos[owner];
            corpo.innerHTML += `
                <div class="cart-store-group">
                    <div class="cart-store-header">PEDIDO PARA LOJA</div>
                    ${itens.map(i => `
                        <div class="cart-item">
                            <img src="${i.imagem}" style="width:40px; height:40px; border-radius:5px; object-fit:cover;">
                            <div class="cart-item-info">
                                <div class="cart-item-name">${i.nome}</div>
                                <div class="cart-item-price">R$ ${i.preco}</div>
                                <div class="qty-control-cart" style="display:flex; align-items:center; margin-top:5px; gap:10px;">
                                    <button ontouchstart="window.alterarQuantidadeCarrinho('${i.id}', -1)" onclick="event.preventDefault();" class="qty-btn-cart">-</button>
                                    <span style="font-size:13px; font-weight:bold;">${i.qtd}</span>
                                    <button ontouchstart="window.alterarQuantidadeCarrinho('${i.id}', 1)" onclick="event.preventDefault();" class="qty-btn-cart">+</button>
                                </div>
                            </div>
                            <i class="fas fa-trash-alt cart-remove" ontouchstart="window.removerDoCarrinho('${i.id}')" onclick="event.preventDefault();"></i>
                        </div>
                    `).join('')}
                    <button class="btn-finish-store" onclick="window.finalizarGrupoLojista('${owner}')">
                        <i class="fab fa-whatsapp"></i> Enviar pelo WhatsApp
                    </button>
            <p style="font-size:14px;text-align:center;margin-top:8px;">
                        Envie seu pedido diretamente para a loja pelo WhatsApp.
                    </p>
                </div>`;
        }
    }
    if(modal) modal.style.display = 'flex';
};

// ─── FLY-TO-CART ANIMATION ────────────────────────────────────────────────
// Rastreia a posição do último toque/clique para usar como origem da animação.
// Captura na fase de captura (capture:true) para pegar antes do stopPropagation.
window.__pedeaiLastPos = { x: window.innerWidth / 2, y: window.innerHeight * 0.45 };

(function _registrarTrackerPosicao() {
    const _atualizar = (x, y) => { window.__pedeaiLastPos = { x, y }; };
    document.addEventListener('touchstart', e => {
        if (e.touches && e.touches[0]) _atualizar(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true, capture: true });
    document.addEventListener('mousedown', e => {
        _atualizar(e.clientX, e.clientY);
    }, { passive: true, capture: true });
})();

window.__dispararFlyAnimation = function(imagemUrl) {
    // ── Localiza o alvo do carrinho dinamicamente ──────────────────────
    // Ordem de prioridade:
    //   1. #carrinho-flutuante   → vitrine-cartao (layout original flutuante)
    //   2. #cart-badge-fixed     → vitrine (badge na barra fixa)
    //   3. #cart-count           → contador visível em qualquer layout
    //   4. #carrinho-count       → id alternativo do contador
    //   5. [onclick*="abrirModalCarrinho"] → qualquer botão que abre o modal
    // Usa getBoundingClientRect() para confirmar que o elemento tem área real.
    function __encontrarAlvoCarrinho() {
        const seletores = [
            '#carrinho-flutuante',
            '#cart-badge-fixed',
            '#cart-count',
            '#carrinho-count',
            '[onclick*="abrirModalCarrinho"]',
        ];
        for (const sel of seletores) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return el;
        }
        return null;
    }

    const cartEl = __encontrarAlvoCarrinho();
    if (!cartEl) return; // nenhum elemento de carrinho encontrado na tela

    const cartRect = cartEl.getBoundingClientRect();
    const origin   = window.__pedeaiLastPos;
    const SIZE     = 54;
    const halfSize = SIZE / 2;

    // ── Cria miniatura voadora ─────────────────────────────────────────
    const thumb = document.createElement('div');
    thumb.setAttribute('aria-hidden', 'true');
    thumb.style.cssText = [
        'position:fixed',
        `left:${origin.x - halfSize}px`,
        `top:${origin.y - halfSize}px`,
        `width:${SIZE}px`,
        `height:${SIZE}px`,
        'border-radius:50%',
        'overflow:hidden',
        'border:2px solid rgba(255,255,255,0.9)',
        'box-shadow:0 6px 22px rgba(0,0,0,0.30)',
        'z-index:99999',
        'pointer-events:none',
        'will-change:transform,opacity',
        'backface-visibility:hidden',
        '-webkit-backface-visibility:hidden',
    ].join(';');

    const img = document.createElement('img');
    img.src = imagemUrl || '';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    thumb.appendChild(img);
    document.body.appendChild(thumb);

    // ── Vetor origem → centro real do carrinho ────────────────────────
    const destX = (cartRect.left + cartRect.width  / 2) - origin.x;
    const destY = (cartRect.top  + cartRect.height / 2) - origin.y;

    // ── Dois rAF garantem que o navegador pinta o thumb antes de mover ─
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            thumb.style.transition =
                'transform 0.54s cubic-bezier(0.22,1,0.36,1),' +
                'opacity   0.40s ease 0.14s';
            // translate3d ativa o compositor GPU — sem reflow, sem flash
            thumb.style.transform = `translate3d(${destX}px,${destY}px,0) scale(0.22)`;
            thumb.style.opacity   = '0';
        });
    });

    // ── Ao chegar: remove thumb e bounce no elemento alvo ─────────────
    setTimeout(() => {
        thumb.remove();
        cartEl.classList.remove('__pedeai-cart-bounce');
        void cartEl.offsetWidth; // força reflow — necessário no Safari
        cartEl.classList.add('__pedeai-cart-bounce');
        setTimeout(() => cartEl.classList.remove('__pedeai-cart-bounce'), 460);
    }, 520);
};
// ─────────────────────────────────────────────────────────────────────────────

function inicializarCarrinho() {
    if (document.getElementById('carrinho-flutuante')) {
        window.atualizarIconeCarrinho();
        return;
    }
    const css = `<style>
        #carrinho-flutuante, .btn-finish-store, .qty-btn-cart, .cart-remove, .fa-times { 
            touch-action: manipulation; 
            -webkit-tap-highlight-color: transparent; 
        }
        @keyframes __pedeaiCartBounce {
            0%   { transform: scale(1); }
            35%  { transform: scale(1.42); }
            60%  { transform: scale(0.88); }
            80%  { transform: scale(1.12); }
            100% { transform: scale(1); }
        }
        .__pedeai-cart-bounce {
            animation: __pedeaiCartBounce 0.44s cubic-bezier(0.34, 1.56, 0.64, 1) forwards !important;
            transition: none !important;
        }
        #carrinho-flutuante { position: fixed; right: 25px; bottom: 110px !important; width: 60px; height: 60px; background: #ee4d2d; border-radius: 50%; color: white; display: none; justify-content: center; align-items: center; box-shadow: 0 4px 15px rgba(0,0,0,0.3); z-index: 9999; cursor: pointer; transition: transform 0.2s, opacity 0.3s; }
        #cart-count { position: absolute; top: -2px; right: -2px; background: #fff; color: #ee4d2d; border-radius: 50%; width: 22px; height: 22px; display: flex; justify-content: center; align-items: center; font-size: 11px; font-weight: 800; border: 2px solid #ee4d2d; }
        #modal-carrinho { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; display: none; justify-content: center; align-items: flex-end; }
        .conteudo-modal { background: #f4f4f4; width: 100%; max-width: 500px; max-height: 80vh; border-radius: 20px 20px 0 0; display: flex; flex-direction: column; overflow: hidden; padding: 0; }
        .cabecalho-modal-carrinho { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; background: #ffffff; border-bottom: 1px solid #e5e5e5; box-shadow: 0 2px 8px rgba(0,0,0,0.04); z-index: 10; border-radius: 20px 20px 0 0; }
        #lista-carrinho-lojas { padding: 20px; overflow-y: auto; flex: 1; }
        .cart-store-group { background: white; border-radius: 10px; padding: 15px; margin-bottom: 15px; }
        .cart-store-header { font-size: 10px; color: #999; font-weight: bold; margin-bottom: 10px; border-bottom: 1px solid #eee; }
        .cart-item { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .cart-item-info { flex: 1; }
        .cart-item-name { font-size: 13px; font-weight: bold; color: #333; }
        .cart-item-price { font-size: 12px; color: #ee4d2d; }
        .cart-remove { color: #ccc; cursor: pointer; padding: 5px; }
        .qty-btn-cart { border: 1px solid #ddd; background: #f9f9f9; width: 24px; height: 24px; border-radius: 4px; cursor: pointer; }
        .btn-finish-store { width: 100%; background: #25d366; color: white; border: none; padding: 10px; border-radius: 6px; font-weight: bold; margin-top: 5px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; }
    </style>`;
    // Função para fechar o modal bloqueando o "clique fantasma" no Safari
    window.fecharModalCarrinho = (e) => {
        if (e.currentTarget && e.currentTarget.classList && e.currentTarget.classList.contains('fa-times')) {
            e.preventDefault();
            e.stopPropagation();
            
            const modal = document.getElementById('modal-carrinho');
            if (modal) modal.style.display = 'none';
            
            // Bloqueia interações no fundo por 400ms para o Safari não clicar no produto atrás
            document.body.style.pointerEvents = 'none';
            setTimeout(() => { document.body.style.pointerEvents = 'auto'; }, 400);
        }
    };

    const html = `
        <div id="carrinho-flutuante" onclick="abrirModalCarrinho()">
            <i class="fas fa-shopping-cart" style="font-size: 24px;"></i>
            <span id="cart-count">0</span>
        </div>
        <div id="modal-carrinho" onclick="window.fecharModalCarrinho(event)">
            <div class="conteudo-modal">
                <div class="cabecalho-modal-carrinho">
                    <b style="font-size:18px; color: #222; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">🛒 Meu Carrinho</b>
                    <i class="fas fa-times" onclick="window.fecharModalCarrinho(event)" style="cursor:pointer; padding:10px; color: #666; font-size: 18px;"></i>
                </div>
                <div id="lista-carrinho-lojas"></div>
            </div>
        </div>`;
    document.head.insertAdjacentHTML('beforeend', css);
    document.body.insertAdjacentHTML('beforeend', html);
    
    setInterval(window.atualizarIconeCarrinho, 400);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarCarrinho);
} else {
    inicializarCarrinho();
}